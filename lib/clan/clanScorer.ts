/* eslint-disable @typescript-eslint/no-explicit-any */
import { serviceDb } from '@/lib/serverAuth';
import { getClan } from './clanService';

/**
 * Handle match score finalization for a clan war fixture.
 * Idempotent: checks if fixture is already completed.
 */
export async function finalizeFixtureScore(params: {
    matchId: string;
    warId: string;
    fixtureId: string;
    winnerClanId: string;
    losingClanId: string;
    winnerWallets: string[];
    losingWallets: string[];
    gameShape: '1v1' | '2v2';
}): Promise<{ warCompleted: boolean }> {
    const db = serviceDb();

    // Check if fixture is already completed
    const { data: fixture } = await (db as any)
        .from('clan_war_fixtures')
        .select('*')
        .eq('id', params.fixtureId)
        .single();

    if (!fixture || fixture.status === 'completed') {
        return { warCompleted: false };
    }

    // 1. Mark fixture completed
    await (db as any)
        .from('clan_war_fixtures')
        .update({
            status: 'completed',
            winner_clan_id: params.winnerClanId,
            match_id: params.matchId,
        })
        .eq('id', params.fixtureId);

    // 2. War Points calculation
    // 1v1: Win = 3 WP, Loss = 1 WP
    // 2v2: Win = 5 WP, Loss = 2 WP
    const winWp = params.gameShape === '2v2' ? 5 : 3;
    const lossWp = params.gameShape === '2v2' ? 2 : 1;

    // Record winner war points
    for (const w of params.winnerWallets) {
        const wallet = w.toLowerCase();
        await (db as any).from('clan_war_points').upsert({
            war_id: params.warId,
            fixture_id: params.fixtureId,
            clan_id: params.winnerClanId,
            wallet_address: wallet,
            wp_amount: winWp,
            kind: 'base_win',
        }, { onConflict: 'war_id, fixture_id, wallet_address, kind' });

        // Update clan_members stats
        await (db as any).rpc('increment_member_cxp_wp', {
            p_clan_id: params.winnerClanId,
            p_wallet: wallet,
            p_wp: winWp,
            p_cxp: 50,
        }).catch(async () => {
            // Fallback direct update
            const { data: m } = await (db as any).from('clan_members').select('war_points, weekly_cxp, total_cxp').eq('clan_id', params.winnerClanId).eq('wallet_address', wallet).maybeSingle();
            if (m) {
                await (db as any).from('clan_members').update({
                    war_points: (m.war_points || 0) + winWp,
                    weekly_cxp: (m.weekly_cxp || 0) + 50,
                    total_cxp: (m.total_cxp || 0) + 50,
                }).eq('clan_id', params.winnerClanId).eq('wallet_address', wallet);
            }
        });
    }

    // Record loser war points (participation merit)
    for (const l of params.losingWallets) {
        const wallet = l.toLowerCase();
        await (db as any).from('clan_war_points').upsert({
            war_id: params.warId,
            fixture_id: params.fixtureId,
            clan_id: params.losingClanId,
            wallet_address: wallet,
            wp_amount: lossWp,
            kind: 'loss',
        }, { onConflict: 'war_id, fixture_id, wallet_address, kind' });

        const { data: m } = await (db as any).from('clan_members').select('war_points, weekly_cxp, total_cxp').eq('clan_id', params.losingClanId).eq('wallet_address', wallet).maybeSingle();
        if (m) {
            await (db as any).from('clan_members').update({
                war_points: (m.war_points || 0) + lossWp,
                weekly_cxp: (m.weekly_cxp || 0) + 15,
                total_cxp: (m.total_cxp || 0) + 15,
            }).eq('clan_id', params.losingClanId).eq('wallet_address', wallet);
        }
    }

    // 3. Update clan CXP
    const clanWin = await getClan(params.winnerClanId);
    if (clanWin) {
        await (db as any).from('clans').update({ cxp: (clanWin.cxp || 0) + 100 }).eq('id', params.winnerClanId);
    }
    const clanLose = await getClan(params.losingClanId);
    if (clanLose) {
        await (db as any).from('clans').update({ cxp: (clanLose.cxp || 0) + 30 }).eq('id', params.losingClanId);
    }

    // 4. Update war score
    const { data: war } = await (db as any).from('clan_wars').select('*').eq('id', params.warId).single();
    if (!war) return { warCompleted: false };

    const isClanAWin = war.clan_a_id === params.winnerClanId;
    const newScoreA = isClanAWin ? war.clan_a_score + 1 : war.clan_a_score;
    const newScoreB = !isClanAWin ? war.clan_b_score + 1 : war.clan_b_score;

    await (db as any).from('clan_wars').update({
        clan_a_score: newScoreA,
        clan_b_score: newScoreB,
    }).eq('id', war.id);

    // 5. Check if all fixtures are completed
    const { count: pendingCount } = await (db as any)
        .from('clan_war_fixtures')
        .select('*', { count: 'exact', head: true })
        .eq('war_id', war.id)
        .in('status', ['unscheduled', 'scheduled_agreed', 'in_progress', 'reschedule_pending']);

    if ((pendingCount || 0) === 0) {
        await settleClanWar(war.id);
        return { warCompleted: true };
    }

    return { warCompleted: false };
}

/**
 * Authoritative Clan War Settlement Engine.
 * 1. 100% Principal return for winning stakers
 * 2. 80% Net profit allocated to War Points Merit Pool
 * 3. 20% Net profit allocated to Governance Split (Stakers / Treasury / Leader / Officers)
 * 4. 100% Pull claims registered in `clan_claims` (D16)
 */
export async function settleClanWar(warId: string): Promise<void> {
    const db = serviceDb();

    const { data: war } = await (db as any).from('clan_wars').select('*').eq('id', warId).single();
    if (!war || ['settling', 'completed', 'draw_refunded'].includes(war.status)) return;

    // Set status to settling
    await (db as any).from('clan_wars').update({ status: 'settling' }).eq('id', warId);

    const scoreA = war.clan_a_score;
    const scoreB = war.clan_b_score;

    // Handle Draw
    if (scoreA === scoreB) {
        await (db as any).from('clan_wars').update({ status: 'draw_refunded' }).eq('id', warId);

        // Refund all stakers of both clans 100%
        const { data: calls } = await (db as any)
            .from('clan_war_calls')
            .select('id, clan_id')
            .in('clan_id', [war.clan_a_id, war.clan_b_id])
            .eq('status', 'matched');

        if (calls) {
            for (const c of calls) {
                const { data: stakes } = await (db as any).from('clan_war_stakes').select('*').eq('war_call_id', c.id);
                for (const s of (stakes || [])) {
                    await (db as any).from('clan_claims').insert({
                        wallet_address: s.wallet_address,
                        clan_id: c.clan_id,
                        claim_type: 'war_refund',
                        amount: s.stake_amount,
                        source_id: s.id,
                        status: 'claimable',
                    });
                }
            }
        }
        return;
    }

    const winnerClanId = scoreA > scoreB ? war.clan_a_id : war.clan_b_id;
    const loserClanId = scoreA > scoreB ? war.clan_b_id : war.clan_a_id;

    // Fetch winner clan war call for split configuration
    const { data: winCall } = await (db as any)
        .from('clan_war_calls')
        .select('*')
        .eq('clan_id', winnerClanId)
        .eq('status', 'matched')
        .maybeSingle();

    const totalPot = Number(war.stake_per_clan) * 2;
    const protocolRake = totalPot * 0.05; // 5% protocol fee
    const netPot = totalPot - protocolRake;

    // 1. Principal Return for winning stakers
    const { data: winStakes } = await (db as any)
        .from('clan_war_stakes')
        .select('*')
        .eq('war_call_id', winCall?.id)
        .eq('status', 'locked');

    let totalPrincipalReturned = 0;
    if (winStakes) {
        for (const s of winStakes) {
            totalPrincipalReturned += Number(s.stake_amount);
            // 100% principal return pull claim
            await (db as any).from('clan_claims').insert({
                wallet_address: s.wallet_address,
                clan_id: winnerClanId,
                claim_type: 'war_principal',
                amount: s.stake_amount,
                source_id: s.id,
                status: 'claimable',
            });
            await (db as any).from('clan_war_stakes').update({ status: 'settled' }).eq('id', s.id);
        }
    }

    // Remaining profit after 100% principal return
    const netProfit = Math.max(0, netPot - totalPrincipalReturned);

    if (netProfit > 0) {
        // 2. 80% War Points Merit Pool
        const meritPool = netProfit * 0.8;
        const { data: points } = await (db as any)
            .from('clan_war_points')
            .select('wallet_address, wp_amount')
            .eq('war_id', war.id)
            .eq('clan_id', winnerClanId);

        const totalWp = (points || []).reduce((sum: number, p: any) => sum + p.wp_amount, 0);

        if (totalWp > 0 && points) {
            // Group by wallet
            const wpByWallet: Record<string, number> = {};
            for (const p of points) {
                wpByWallet[p.wallet_address] = (wpByWallet[p.wallet_address] || 0) + p.wp_amount;
            }

            for (const [wallet, wp] of Object.entries(wpByWallet)) {
                const meritShare = (wp / totalWp) * meritPool;
                if (meritShare > 0) {
                    await (db as any).from('clan_claims').insert({
                        wallet_address: wallet,
                        clan_id: winnerClanId,
                        claim_type: 'war_merit_wp',
                        amount: meritShare,
                        source_id: war.id,
                        status: 'claimable',
                    });
                }
            }
        }

        // 3. 20% Governance Split Pool
        const govPool = netProfit * 0.2;
        const stakersPct = winCall?.stakers_pct ?? 50;
        const treasuryPct = winCall?.treasury_pct ?? 25;
        const leaderPct = winCall?.leader_pct ?? 15;
        const officersPct = winCall?.officers_pct ?? 10;

        // A. Stakers share
        const stakersShare = (stakersPct / 100) * govPool;
        if (stakersShare > 0 && winStakes && winStakes.length > 0) {
            const perStaker = stakersShare / winStakes.length;
            for (const s of winStakes) {
                await (db as any).from('clan_claims').insert({
                    wallet_address: s.wallet_address,
                    clan_id: winnerClanId,
                    claim_type: 'war_gov_share',
                    amount: perStaker,
                    source_id: s.id,
                    status: 'claimable',
                });
            }
        }

        // B. Treasury cut
        const treasuryCut = (treasuryPct / 100) * govPool;
        if (treasuryCut > 0) {
            const clan = await getClan(winnerClanId);
            if (clan) {
                await (db as any).from('clans').update({
                    treasury_balance: Number(clan.treasury_balance) + treasuryCut,
                }).eq('id', winnerClanId);

                await (db as any).from('clan_treasury_ledger').insert({
                    clan_id: winnerClanId,
                    amount: treasuryCut,
                    reason: 'war_cut',
                    ref: `war:${war.id}`,
                });
            }
        }

        // C. Leader cut
        const leaderCut = (leaderPct / 100) * govPool;
        const clan = await getClan(winnerClanId);
        if (leaderCut > 0 && clan?.leader_wallet) {
            await (db as any).from('clan_claims').insert({
                wallet_address: clan.leader_wallet,
                clan_id: winnerClanId,
                claim_type: 'war_gov_share',
                amount: leaderCut,
                source_id: war.id,
                status: 'claimable',
            });
        }

        // D. Officers cut
        const officersCut = (officersPct / 100) * govPool;
        const { data: officers } = await (db as any)
            .from('clan_members')
            .select('wallet_address')
            .eq('clan_id', winnerClanId)
            .eq('role', 'officer');

        if (officersCut > 0 && officers && officers.length > 0) {
            const perOfficer = officersCut / officers.length;
            for (const o of officers) {
                await (db as any).from('clan_claims').insert({
                    wallet_address: o.wallet_address,
                    clan_id: winnerClanId,
                    claim_type: 'war_gov_share',
                    amount: perOfficer,
                    source_id: war.id,
                    status: 'claimable',
                });
            }
        }
    }

    // 4. Update CWR (Elo rating adjustment: Winner +32, Loser -24)
    const winnerClan = await getClan(winnerClanId);
    if (winnerClan) {
        await (db as any).from('clans').update({ cwr: winnerClan.cwr + 32 }).eq('id', winnerClanId);
    }
    const loserClan = await getClan(loserClanId);
    if (loserClan) {
        await (db as any).from('clans').update({ cwr: Math.max(100, loserClan.cwr - 24) }).eq('id', loserClanId);
    }

    // Mark war as completed
    await (db as any).from('clan_wars').update({
        status: 'completed',
        winner_clan_id: winnerClanId,
    }).eq('id', war.id);
}
