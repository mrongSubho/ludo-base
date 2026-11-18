/* eslint-disable @typescript-eslint/no-explicit-any */
import { createPublicClient, createWalletClient, http, keccak256, parseUnits, toBytes, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import { serviceDb } from '@/lib/serverAuth';
import { CLAN_CLAIM_DEPOSIT_ABI, DEFAULT_CLAN_CLAIM_ADDRESS, clanClaimAddress } from '@/lib/chips';
import { getClan } from './clanService';

/**
 * Validate that a recorded match legitimately corresponds to a Clan War fixture.
 * Enforces active_war window, seat participant match, game_shape arity, and valid winner.
 */
export function validateWarFixtureMatch(params: {
    fixture: {
        status: string;
        game_shape: '1v1' | '2v2';
        clan_a_seats: string[];
        clan_b_seats: string[];
    };
    war: {
        status: string;
        war_start_at: string;
        clan_a_id: string;
        clan_b_id: string;
    };
    participants: string[];
    winnerLower: string | null;
    nowMs?: number;
}):
    | {
          valid: true;
          winnerClanId: string;
          losingClanId: string;
          winnerWallets: string[];
          losingWallets: string[];
      }
    | { valid: false; reason: string } {
    if (!params.winnerLower) {
        return { valid: false, reason: 'Winner address required' };
    }
    if (['completed', 'walkover', 'mutual_void'].includes(params.fixture.status)) {
        return { valid: false, reason: 'Fixture already resolved' };
    }
    if (['settling', 'completed', 'draw_refunded'].includes(params.war.status)) {
        return { valid: false, reason: 'War already settled' };
    }
    const now = params.nowMs ?? Date.now();
    if (params.war.status === 'prep_phase' && now < new Date(params.war.war_start_at).getTime()) {
        return { valid: false, reason: 'War is still in preparation phase' };
    }

    const lowerA = params.fixture.clan_a_seats.map((s) => s.toLowerCase());
    const lowerB = params.fixture.clan_b_seats.map((s) => s.toLowerCase());
    const expectedSeats = params.fixture.game_shape === '2v2' ? 2 : 1;
    if (lowerA.length !== expectedSeats || lowerB.length !== expectedSeats) {
        return { valid: false, reason: 'Fixture seat count does not match game_shape' };
    }

    const participantSet = new Set(params.participants.map((p) => p.toLowerCase()));
    const allSeats = [...lowerA, ...lowerB];
    if (participantSet.size !== allSeats.length || !allSeats.every((s) => participantSet.has(s))) {
        return { valid: false, reason: 'Match participants do not match fixture seats' };
    }

    const winnerInA = lowerA.includes(params.winnerLower);
    const winnerInB = lowerB.includes(params.winnerLower);
    if (!winnerInA && !winnerInB) {
        return { valid: false, reason: 'Match winner is not seated in this fixture' };
    }

    return {
        valid: true,
        winnerClanId: winnerInA ? params.war.clan_a_id : params.war.clan_b_id,
        losingClanId: winnerInA ? params.war.clan_b_id : params.war.clan_a_id,
        winnerWallets: winnerInA ? lowerA : lowerB,
        losingWallets: winnerInA ? lowerB : lowerA,
    };
}

/**
 * Pure CXP calculation for a recorded match:
 * - Paid match: 30 win / 10 loss; Free online match: 10 win / 3 loss
 * - Opposing clanmates in 1v1 (or >2 same-clan in 4p) -> 0 CXP (anti-farm)
 * - 2v2 clanmate duo (2 same-clan in 4p) -> 1.25x multiplier
 */
export function computeMatchCxpAwards(params: {
    memberships: Array<{ clan_id: string; wallet_address: string }>;
    participantCount: number;
    winnerLower: string | null;
    isPaidMatch: boolean;
}): {
    memberAwards: Array<{ clanId: string; wallet: string; cxp: number }>;
    clanAwards: Record<string, number>;
} {
    const byClan = new Map<string, string[]>();
    for (const m of params.memberships) {
        const w = m.wallet_address.toLowerCase();
        const arr = byClan.get(m.clan_id) || [];
        arr.push(w);
        byClan.set(m.clan_id, arr);
    }

    const baseWin = params.isPaidMatch ? 30 : 10;
    const baseLoss = params.isPaidMatch ? 10 : 3;

    const memberAwards: Array<{ clanId: string; wallet: string; cxp: number }> = [];
    const clanAwards: Record<string, number> = {};

    for (const m of params.memberships) {
        const w = m.wallet_address.toLowerCase();
        const sameClanCount = (byClan.get(m.clan_id) || []).length;

        // Anti-farm: opposing clanmates in 1v1 (2 players, both same clan) or >2 same clan in 4P earn 0
        if ((params.participantCount <= 2 && sameClanCount > 1) || sameClanCount > 2) {
            continue;
        }

        const isWinner = params.winnerLower !== null && w === params.winnerLower;
        let cxp = isWinner ? baseWin : baseLoss;

        // 2v2 clanmate duo bonus
        if (params.participantCount >= 4 && sameClanCount === 2) {
            cxp = Math.round(cxp * 1.25);
        }

        memberAwards.push({ clanId: m.clan_id, wallet: w, cxp });
        clanAwards[m.clan_id] = (clanAwards[m.clan_id] || 0) + cxp;
    }

    return { memberAwards, clanAwards };
}

/**
 * Pure settlement breakdown helper for unit testing and server execution.
 */
export function computeWarSettlementAmounts(params: {
    stakePerClan: number;
    winningPrincipalTotal: number;
    stakersPct: number;
    treasuryPct: number;
    leaderPct: number;
    officersPct: number;
}) {
    const totalPot = params.stakePerClan * 2;
    const protocolRake = totalPot * 0.05;
    const netPot = totalPot - protocolRake;
    const netProfit = Math.max(0, netPot - params.winningPrincipalTotal);
    const meritPool = netProfit * 0.8;
    const govPool = netProfit * 0.2;
    return {
        totalPot,
        protocolRake,
        netPot,
        netProfit,
        meritPool,
        govPool,
        stakersShare: (params.stakersPct / 100) * govPool,
        treasuryCut: (params.treasuryPct / 100) * govPool,
        leaderCut: (params.leaderPct / 100) * govPool,
        officersCut: (params.officersPct / 100) * govPool,
    };
}

async function settleWarCallOnChain(params: {
    warCallId: string;
    winningClanId: string | null;
    protocolRakeChips: number;
    winningTreasuryCutChips: number;
}): Promise<void> {
    const pkRaw =
        process.env.SETTLEMENT_OP_KEY ||
        process.env.MISSION_OP_PRIVATE_KEY ||
        process.env.EDGE_SETTLE_PRIVATE_KEY;
    if (!pkRaw) return;

    try {
        const pk = (pkRaw.startsWith('0x') ? pkRaw : `0x${pkRaw}`) as Hex;
        const account = privateKeyToAccount(pk);
        const rpc = process.env.SEPOLIA_RPC || process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org';
        const claimContract = clanClaimAddress() || DEFAULT_CLAN_CLAIM_ADDRESS;
        const walletClient = createWalletClient({
            account,
            chain: baseSepolia,
            transport: http(rpc),
        });
        const publicClient = createPublicClient({
            chain: baseSepolia,
            transport: http(rpc),
        });

        const warIdBytes32 = keccak256(toBytes(params.warCallId));
        const winClanBytes32 = params.winningClanId
            ? keccak256(toBytes(params.winningClanId))
            : ('0x0000000000000000000000000000000000000000000000000000000000000000' as Hex);
        const rakeWei = parseUnits(params.protocolRakeChips.toFixed(6), 18);
        const cutWei = parseUnits(params.winningTreasuryCutChips.toFixed(6), 18);

        const hash = await walletClient.writeContract({
            address: claimContract,
            abi: CLAN_CLAIM_DEPOSIT_ABI,
            functionName: 'settleWar',
            args: [warIdBytes32, winClanBytes32, rakeWei, cutWei],
        });
        await publicClient.waitForTransactionReceipt({ hash });
    } catch (err) {
        console.warn('[clanScorer:settleWarOnChain] skipped/failed:', err);
    }
}

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

        // Atomic member WP + CXP update
        await (db as any).rpc('increment_member_cxp_wp', {
            p_clan_id: params.winnerClanId,
            p_wallet: wallet,
            p_wp: winWp,
            p_cxp: 50,
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

        await (db as any).rpc('increment_member_cxp_wp', {
            p_clan_id: params.losingClanId,
            p_wallet: wallet,
            p_wp: lossWp,
            p_cxp: 15,
        });
    }

    // 3. Atomically update clan CXP + check level-up
    await Promise.all([
        (db as any).rpc('increment_clan_cxp', { p_clan_id: params.winnerClanId, p_cxp_delta: 100 }),
        (db as any).rpc('increment_clan_cxp', { p_clan_id: params.losingClanId, p_cxp_delta: 30 }),
    ]);

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

    // Broadcast live fixture completion and updated scores on private war channel
    try {
        await (db as any).channel(`clan-war-${war.id}`, { config: { private: true } }).send({
            type: 'broadcast',
            event: 'fixture_completed',
            payload: {
                warId: war.id,
                fixtureId: params.fixtureId,
                winnerClanId: params.winnerClanId,
                clanAScore: newScoreA,
                clanBScore: newScoreB,
            },
        });
    } catch (bErr) {
        console.warn('[clanScorer:broadcast:fixture]', bErr);
    }

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

        const callIds = [war.clan_a_call_id, war.clan_b_call_id].filter(Boolean);
        const { data: calls } = callIds.length
            ? await (db as any).from('clan_war_calls').select('id, clan_id').in('id', callIds)
            : await (db as any)
                  .from('clan_war_calls')
                  .select('id, clan_id')
                  .in('clan_id', [war.clan_a_id, war.clan_b_id])
                  .eq('status', 'matched');

        if (calls) {
            for (const c of calls) {
                const { data: stakes } = await (db as any).from('clan_war_stakes').select('*').eq('war_call_id', c.id);
                for (const s of (stakes || [])) {
                    await (db as any).from('clan_claims').upsert({
                        wallet_address: s.wallet_address,
                        clan_id: c.clan_id,
                        claim_type: 'war_refund',
                        amount: s.stake_amount,
                        source_id: s.id,
                        status: 'claimable',
                    }, { onConflict: 'wallet_address,claim_type,source_id', ignoreDuplicates: true });
                    await (db as any).from('clan_war_stakes').update({ status: 'claimable_refund' }).eq('id', s.id);
                }
                await settleWarCallOnChain({
                    warCallId: c.id,
                    winningClanId: null,
                    protocolRakeChips: 0,
                    winningTreasuryCutChips: 0,
                });
            }
        }
        return;
    }

    const winnerClanId = scoreA > scoreB ? war.clan_a_id : war.clan_b_id;
    const loserClanId = scoreA > scoreB ? war.clan_b_id : war.clan_a_id;
    const winCallIdFromWar = scoreA > scoreB ? war.clan_a_call_id : war.clan_b_call_id;
    const loseCallIdFromWar = scoreA > scoreB ? war.clan_b_call_id : war.clan_a_call_id;

    // Fetch winner clan war call for split configuration
    const { data: winCall } = winCallIdFromWar
        ? await (db as any).from('clan_war_calls').select('*').eq('id', winCallIdFromWar).maybeSingle()
        : await (db as any)
              .from('clan_war_calls')
              .select('*')
              .eq('clan_id', winnerClanId)
              .eq('status', 'matched')
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle();

    const { data: loseCall } = loseCallIdFromWar
        ? await (db as any).from('clan_war_calls').select('id').eq('id', loseCallIdFromWar).maybeSingle()
        : await (db as any)
              .from('clan_war_calls')
              .select('id')
              .eq('clan_id', loserClanId)
              .eq('status', 'matched')
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle();

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
            // 100% principal return pull claim (idempotent)
            await (db as any).from('clan_claims').upsert({
                wallet_address: s.wallet_address,
                clan_id: winnerClanId,
                claim_type: 'war_principal',
                amount: s.stake_amount,
                source_id: s.id,
                status: 'claimable',
            }, { onConflict: 'wallet_address,claim_type,source_id', ignoreDuplicates: true });
            await (db as any).from('clan_war_stakes').update({ status: 'settled' }).eq('id', s.id);
        }
    }

    if (loseCall?.id) {
        await (db as any).from('clan_war_stakes').update({ status: 'settled' }).eq('war_call_id', loseCall.id);
    }

    const stakersPct = winCall?.stakers_pct ?? 50;
    const treasuryPct = winCall?.treasury_pct ?? 25;
    const leaderPct = winCall?.leader_pct ?? 15;
    const officersPct = winCall?.officers_pct ?? 10;

    const settlement = computeWarSettlementAmounts({
        stakePerClan: Number(war.stake_per_clan),
        winningPrincipalTotal: totalPrincipalReturned,
        stakersPct,
        treasuryPct,
        leaderPct,
        officersPct,
    });

    if (settlement.netProfit > 0) {
        // 2. 80% War Points Merit Pool
        const meritPool = settlement.meritPool;
        const { data: points } = await (db as any)
            .from('clan_war_points')
            .select('wallet_address, wp_amount')
            .eq('war_id', war.id)
            .eq('clan_id', winnerClanId);

        const totalWp = (points || []).reduce((sum: number, p: any) => sum + p.wp_amount, 0);

        if (totalWp > 0 && points) {
            const wpByWallet: Record<string, number> = {};
            for (const p of points) {
                wpByWallet[p.wallet_address] = (wpByWallet[p.wallet_address] || 0) + p.wp_amount;
            }

            for (const [wallet, wp] of Object.entries(wpByWallet)) {
                const meritShare = (wp / totalWp) * meritPool;
                if (meritShare > 0) {
                    await (db as any).from('clan_claims').upsert({
                        wallet_address: wallet,
                        clan_id: winnerClanId,
                        claim_type: 'war_merit_wp',
                        amount: meritShare,
                        source_id: war.id,
                        status: 'claimable',
                    }, { onConflict: 'wallet_address,claim_type,source_id', ignoreDuplicates: true });
                }
            }
        }

        // 3. 20% Governance Split Pool
        // A. Stakers share
        if (settlement.stakersShare > 0 && winStakes && winStakes.length > 0) {
            const perStaker = settlement.stakersShare / winStakes.length;
            for (const s of winStakes) {
                await (db as any).from('clan_claims').upsert({
                    wallet_address: s.wallet_address,
                    clan_id: winnerClanId,
                    claim_type: 'war_gov_share',
                    amount: perStaker,
                    source_id: s.id,
                    status: 'claimable',
                }, { onConflict: 'wallet_address,claim_type,source_id', ignoreDuplicates: true });
            }
        }

        // B. Treasury cut
        if (settlement.treasuryCut > 0) {
            const clan = await getClan(winnerClanId);
            if (clan) {
                await (db as any).from('clans').update({
                    treasury_balance: Number(clan.treasury_balance) + settlement.treasuryCut,
                }).eq('id', winnerClanId);

                await (db as any).from('clan_treasury_ledger').insert({
                    clan_id: winnerClanId,
                    amount: settlement.treasuryCut,
                    reason: 'war_cut',
                    ref: `war:${war.id}`,
                });
            }
        }

        // C. Leader cut
        const clan = await getClan(winnerClanId);
        if (settlement.leaderCut > 0 && clan?.leader_wallet) {
            await (db as any).from('clan_claims').upsert({
                wallet_address: clan.leader_wallet,
                clan_id: winnerClanId,
                claim_type: 'war_gov_share',
                amount: settlement.leaderCut,
                source_id: war.id,
                status: 'claimable',
            }, { onConflict: 'wallet_address,claim_type,source_id', ignoreDuplicates: true });
        }

        // D. Officers cut
        const { data: officers } = await (db as any)
            .from('clan_members')
            .select('wallet_address')
            .eq('clan_id', winnerClanId)
            .eq('role', 'officer');

        if (settlement.officersCut > 0 && officers && officers.length > 0) {
            const perOfficer = settlement.officersCut / officers.length;
            for (const o of officers) {
                await (db as any).from('clan_claims').upsert({
                    wallet_address: o.wallet_address,
                    clan_id: winnerClanId,
                    claim_type: 'war_gov_share',
                    amount: perOfficer,
                    source_id: war.id,
                    status: 'claimable',
                }, { onConflict: 'wallet_address,claim_type,source_id', ignoreDuplicates: true });
            }
        }
    }

    // Settle both warCall escrow buckets on-chain via ClanClaim.settleWar (when oracle key configured)
    const rakePerCall = settlement.protocolRake / 2;
    if (loseCall?.id) {
        await settleWarCallOnChain({
            warCallId: loseCall.id,
            winningClanId: winnerClanId,
            protocolRakeChips: rakePerCall,
            winningTreasuryCutChips: 0,
        });
    }
    if (winCall?.id) {
        await settleWarCallOnChain({
            warCallId: winCall.id,
            winningClanId: winnerClanId,
            protocolRakeChips: rakePerCall,
            winningTreasuryCutChips: settlement.treasuryCut,
        });
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

    try {
        await (db as any).channel(`clan-war-${war.id}`, { config: { private: true } }).send({
            type: 'broadcast',
            event: 'war_settled',
            payload: { warId: war.id, winnerClanId },
        });
    } catch (bErr) {
        console.warn('[clanScorer:broadcast:settled]', bErr);
    }
}
