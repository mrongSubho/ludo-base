/* eslint-disable @typescript-eslint/no-explicit-any */
import { serviceDb } from '@/lib/serverAuth';
import type {
    ClanWarCall,
    ClanWarStake,
    ClanWar,
    ClanWarFixture,
    FixtureGameShape,
    FixtureStatus,
} from './types';
import { ClanServiceError, getClan } from './clanService';

/**
 * Fetch the active war call (notice/search) for a clan.
 */
export async function getActiveWarCall(clanId: string): Promise<{
    warCall: ClanWarCall | null;
    stakes: ClanWarStake[];
    totalCommitted: number;
}> {
    const db = serviceDb();

    const { data: call, error } = await (db as any)
        .from('clan_war_calls')
        .select('*')
        .eq('clan_id', clanId)
        .in('status', ['notice_open', 'searching'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error || !call) {
        return { warCall: null, stakes: [], totalCommitted: 0 };
    }

    const { data: stakes } = await (db as any)
        .from('clan_war_stakes')
        .select('*')
        .eq('war_call_id', call.id)
        .eq('status', 'locked');

    const totalCommitted = (stakes || []).reduce((sum: number, s: any) => sum + Number(s.stake_amount), 0);

    return {
        warCall: call as ClanWarCall,
        stakes: (stakes || []) as ClanWarStake[],
        totalCommitted,
    };
}

/**
 * Post a new War Notice / Call-to-Arms (Commander or Officer only).
 */
export async function postWarNotice(params: {
    clanId: string;
    actorWallet: string;
    bracket: 5 | 10 | 15 | 20;
    memberFee: number;
    stakersPct: number;
    treasuryPct: number;
    leaderPct: number;
    officersPct: number;
    treasurySubsidy?: number;
}): Promise<ClanWarCall> {
    const db = serviceDb();
    const actor = params.actorWallet.toLowerCase();

    // Verify actor is commander or officer
    const { data: member } = await (db as any)
        .from('clan_members')
        .select('role')
        .eq('clan_id', params.clanId)
        .eq('wallet_address', actor)
        .maybeSingle();

    if (!member || !['commander', 'officer'].includes(member.role)) {
        throw new ClanServiceError('Only commanders and officers can post war notices', 403);
    }

    // Check if clan already has an active call or active war
    const { warCall } = await getActiveWarCall(params.clanId);
    if (warCall) {
        throw new ClanServiceError('Clan already has an active war notice or search', 409);
    }

    const { data: activeWar } = await (db as any)
        .from('clan_wars')
        .select('id')
        .or(`clan_a_id.eq.${params.clanId},clan_b_id.eq.${params.clanId}`)
        .in('status', ['prep_phase', 'active_war', 'settling'])
        .maybeSingle();

    if (activeWar) {
        throw new ClanServiceError('Clan is already participating in an active war', 409);
    }

    if (params.memberFee < 500) {
        throw new ClanServiceError('Minimum war entry fee is 500 CHIPS', 400);
    }

    const splitSum = params.stakersPct + params.treasuryPct + params.leaderPct + params.officersPct;
    if (splitSum !== 100) {
        throw new ClanServiceError(`Governance split percentages must sum to 100% (currently ${splitSum}%)`, 400);
    }

    if (params.leaderPct > 50 || params.officersPct > 50) {
        throw new ClanServiceError('Leader or Officer governance cuts cannot exceed 50%', 400);
    }

    const treasurySubsidy = Math.max(0, params.treasurySubsidy ?? 0);
    if (treasurySubsidy > 0) {
        const clan = await getClan(params.clanId);
        if (!clan || clan.treasury_balance < treasurySubsidy) {
            throw new ClanServiceError('Insufficient clan treasury balance for specified subsidy', 400);
        }
    }

    const totalRequired = params.bracket * params.memberFee;

    const { data: created, error } = await (db as any)
        .from('clan_war_calls')
        .insert({
            clan_id: params.clanId,
            bracket: params.bracket,
            member_fee: params.memberFee,
            stakers_pct: params.stakersPct,
            treasury_pct: params.treasuryPct,
            leader_pct: params.leaderPct,
            officers_pct: params.officersPct,
            treasury_subsidy: treasurySubsidy,
            total_stake: totalRequired,
            status: 'notice_open',
        })
        .select('*')
        .single();

    if (error) throw new ClanServiceError(error.message, 500);

    return created as ClanWarCall;
}

/**
 * Cancel an active War Notice / Search (Commander or Officer only).
 * Marks locked stakes as claimable refunds.
 */
export async function cancelWarNotice(clanId: string, actorWallet: string): Promise<void> {
    const db = serviceDb();
    const actor = actorWallet.toLowerCase();

    const { data: member } = await (db as any)
        .from('clan_members')
        .select('role')
        .eq('clan_id', clanId)
        .eq('wallet_address', actor)
        .maybeSingle();

    if (!member || !['commander', 'officer'].includes(member.role)) {
        throw new ClanServiceError('Only commanders and officers can cancel war calls', 403);
    }

    const { warCall } = await getActiveWarCall(clanId);
    if (!warCall) {
        throw new ClanServiceError('No active war notice found to cancel', 404);
    }

    // Set call status to cancelled
    await (db as any)
        .from('clan_war_calls')
        .update({ status: 'cancelled' })
        .eq('id', warCall.id);

    // Convert locked stakes to claimable refunds
    const { data: stakes } = await (db as any)
        .from('clan_war_stakes')
        .select('*')
        .eq('war_call_id', warCall.id)
        .eq('status', 'locked');

    if (stakes && stakes.length > 0) {
        for (const s of stakes) {
            await (db as any)
                .from('clan_war_stakes')
                .update({ status: 'claimable_refund' })
                .eq('id', s.id);

            // Register in universal pull-claims ledger (D16)
            await (db as any).from('clan_claims').insert({
                wallet_address: s.wallet_address,
                clan_id: clanId,
                claim_type: 'war_refund',
                amount: s.stake_amount,
                source_id: s.id,
                status: 'claimable',
            });
        }
    }
}

/**
 * Lock member entry fee into the active war call.
 */
export async function buyInWarCall(params: {
    clanId: string;
    walletAddress: string;
    stakeAmount: number;
}): Promise<ClanWarStake> {
    const db = serviceDb();
    const wallet = params.walletAddress.toLowerCase();

    // Check membership
    const { data: member } = await (db as any)
        .from('clan_members')
        .select('id')
        .eq('clan_id', params.clanId)
        .eq('wallet_address', wallet)
        .maybeSingle();

    if (!member) throw new ClanServiceError('You must be a member of this clan to join war roster', 403);

    const { warCall } = await getActiveWarCall(params.clanId);
    if (!warCall || warCall.status !== 'notice_open') {
        throw new ClanServiceError('War notice is not currently open for buy-in', 400);
    }

    if (params.stakeAmount < warCall.member_fee) {
        throw new ClanServiceError(`Required member fee is ${warCall.member_fee} CHIPS`, 400);
    }

    // Check current roster count
    const { count } = await (db as any)
        .from('clan_war_stakes')
        .select('*', { count: 'exact', head: true })
        .eq('war_call_id', warCall.id)
        .eq('kind', 'member_fee')
        .eq('status', 'locked');

    if ((count || 0) >= warCall.bracket) {
        throw new ClanServiceError(`War roster is full (${warCall.bracket}/${warCall.bracket})`, 400);
    }

    // Debit escrow and insert stake row
    const { data: stake, error } = await (db as any)
        .from('clan_war_stakes')
        .insert({
            war_call_id: warCall.id,
            wallet_address: wallet,
            stake_amount: params.stakeAmount,
            kind: 'member_fee',
            status: 'locked',
        })
        .select('*')
        .single();

    if (error) {
        if (error.code === '23505') {
            throw new ClanServiceError('You have already secured a war roster spot', 409);
        }
        throw new ClanServiceError(error.message, 500);
    }

    return stake as ClanWarStake;
}

/**
 * Start searching for a match once the roster is full.
 */
export async function startWarSearch(clanId: string, actorWallet: string): Promise<void> {
    const db = serviceDb();
    const actor = actorWallet.toLowerCase();

    const { data: member } = await (db as any)
        .from('clan_members')
        .select('role')
        .eq('clan_id', clanId)
        .eq('wallet_address', actor)
        .maybeSingle();

    if (!member || !['commander', 'officer'].includes(member.role)) {
        throw new ClanServiceError('Only commanders and officers can start war search', 403);
    }

    const { warCall, stakes } = await getActiveWarCall(clanId);
    if (!warCall || warCall.status !== 'notice_open') {
        throw new ClanServiceError('No open war notice ready to search', 400);
    }

    const rosterCount = stakes.filter((s) => s.kind === 'member_fee').length;
    if (rosterCount < warCall.bracket) {
        throw new ClanServiceError(`Roster not full (${rosterCount}/${warCall.bracket} spots filled)`, 400);
    }

    // Update status to searching
    const searchExpiresAt = new Date(Date.now() + 7 * 86400 * 1000).toISOString();
    await (db as any)
        .from('clan_war_calls')
        .update({
            status: 'searching',
            search_expires_at: searchExpiresAt,
        })
        .eq('id', warCall.id);

    // Attempt instant auto-match against another searching clan
    await tryAutoMatch(warCall.id);
}

/**
 * Query the Open War Board for opposing clans searching for war.
 */
export async function getOpenWarBoard(options?: { bracket?: number }): Promise<Array<ClanWarCall & { clan: any }>> {
    const db = serviceDb();
    let query = (db as any)
        .from('clan_war_calls')
        .select(`
            *,
            clan:clans (
                id,
                name,
                tag,
                crest,
                level,
                division,
                cwr
            )
        `)
        .eq('status', 'searching');

    if (options?.bracket) {
        query = query.eq('bracket', options.bracket);
    }

    const { data, error } = await query.order('created_at', { ascending: true });
    if (error) throw new ClanServiceError(error.message, 500);

    return (data || []) as any[];
}

/**
 * Match two clans (Auto-match or Open War Board selection).
 * Generates 48h prep phase and the full 3N Fixtures Matrix.
 */
export async function matchClans(callAId: string, callBId: string): Promise<ClanWar> {
    const db = serviceDb();

    const { data: callA } = await (db as any).from('clan_war_calls').select('*').eq('id', callAId).single();
    const { data: callB } = await (db as any).from('clan_war_calls').select('*').eq('id', callBId).single();

    if (!callA || !callB) throw new ClanServiceError('One or both war calls not found', 404);
    if (callA.clan_id === callB.clan_id) throw new ClanServiceError('Cannot match clan with itself', 400);
    if (callA.bracket !== callB.bracket) throw new ClanServiceError('War brackets do not match', 400);

    const stakePerClan = Math.min(Number(callA.total_stake), Number(callB.total_stake));
    const now = Date.now();
    const warStartAt = new Date(now + 48 * 3600 * 1000).toISOString();
    const warEndAt = new Date(now + 96 * 3600 * 1000).toISOString();

    // Create clan_wars row
    const { data: war, error: warErr } = await (db as any)
        .from('clan_wars')
        .insert({
            clan_a_id: callA.clan_id,
            clan_b_id: callB.clan_id,
            bracket: callA.bracket,
            stake_per_clan: stakePerClan,
            status: 'prep_phase',
            war_start_at: warStartAt,
            war_end_at: warEndAt,
        })
        .select('*')
        .single();

    if (warErr) throw new ClanServiceError(warErr.message, 500);

    // Update war calls to matched
    await (db as any).from('clan_war_calls').update({ status: 'matched' }).in('id', [callAId, callBId]);

    // Fetch roster participants for both clans
    const { data: stakesA } = await (db as any)
        .from('clan_war_stakes')
        .select('wallet_address')
        .eq('war_call_id', callAId)
        .eq('kind', 'member_fee')
        .order('created_at', { ascending: true });

    const { data: stakesB } = await (db as any)
        .from('clan_war_stakes')
        .select('wallet_address')
        .eq('war_call_id', callBId)
        .eq('kind', 'member_fee')
        .order('created_at', { ascending: true });

    const rosterA: string[] = (stakesA || []).map((s: any) => s.wallet_address);
    const rosterB: string[] = (stakesB || []).map((s: any) => s.wallet_address);

    // Generate 3N fixtures matrix
    await generateFixturesMatrix(war.id, callA.bracket, rosterA, rosterB);

    return war as ClanWar;
}

/**
 * Generate 3N fixtures matrix:
 * 5v5: 15 fixtures (10x 1v1, 5x 2v2)
 * 10v10: 30 fixtures (20x 1v1, 10x 2v2)
 * 15v15: 45 fixtures (30x 1v1, 15x 2v2)
 * 20v20: 60 fixtures (40x 1v1, 20x 2v2)
 */
async function generateFixturesMatrix(
    warId: string,
    bracket: number,
    rosterA: string[],
    rosterB: string[],
): Promise<void> {
    const db = serviceDb();
    const fixtures: Array<{
        war_id: string;
        fixture_index: number;
        game_shape: FixtureGameShape;
        clan_a_seats: string[];
        clan_b_seats: string[];
        status: FixtureStatus;
    }> = [];

    let fixtureIndex = 1;
    const N = bracket;

    // Wave 1: Direct Seed 1v1 Matches (N fixtures)
    for (let i = 0; i < N; i++) {
        const playerA = rosterA[i % rosterA.length];
        const playerB = rosterB[i % rosterB.length];
        fixtures.push({
            war_id: warId,
            fixture_index: fixtureIndex++,
            game_shape: '1v1',
            clan_a_seats: [playerA],
            clan_b_seats: [playerB],
            status: 'unscheduled',
        });
    }

    // Wave 2: Cross Seed 1v1 Matches (N fixtures)
    for (let i = 0; i < N; i++) {
        const playerA = rosterA[i % rosterA.length];
        const playerB = rosterB[(i + 1) % rosterB.length];
        fixtures.push({
            war_id: warId,
            fixture_index: fixtureIndex++,
            game_shape: '1v1',
            clan_a_seats: [playerA],
            clan_b_seats: [playerB],
            status: 'unscheduled',
        });
    }

    // Wave 3: Tactical 2v2 Team Battles (N fixtures: N pairs)
    for (let i = 0; i < N; i++) {
        const teamA1 = rosterA[i % rosterA.length];
        const teamA2 = rosterA[(i + 1) % rosterA.length];
        const teamB1 = rosterB[i % rosterB.length];
        const teamB2 = rosterB[(i + 1) % rosterB.length];

        fixtures.push({
            war_id: warId,
            fixture_index: fixtureIndex++,
            game_shape: '2v2',
            clan_a_seats: [teamA1, teamA2],
            clan_b_seats: [teamB1, teamB2],
            status: 'unscheduled',
        });
    }

    const { error } = await (db as any).from('clan_war_fixtures').insert(fixtures);
    if (error) {
        console.error('Failed to generate fixtures matrix:', error);
        throw new ClanServiceError(error.message, 500);
    }
}

/**
 * Helper to auto-match searching clan calls.
 */
async function tryAutoMatch(callerWarCallId: string): Promise<ClanWar | null> {
    const db = serviceDb();

    const { data: callA } = await (db as any).from('clan_war_calls').select('*').eq('id', callerWarCallId).single();
    if (!callA || callA.status !== 'searching') return null;

    // Find another searching call with same bracket and comparable stake
    const { data: candidates } = await (db as any)
        .from('clan_war_calls')
        .select('*')
        .eq('bracket', callA.bracket)
        .eq('status', 'searching')
        .neq('clan_id', callA.clan_id)
        .order('created_at', { ascending: true })
        .limit(1);

    if (!candidates || candidates.length === 0) return null;

    const callB = candidates[0];
    return await matchClans(callA.id, callB.id);
}

/**
 * Fetch all fixtures for an active or completed clan war.
 */
export async function getWarFixtures(warId: string): Promise<ClanWarFixture[]> {
    const db = serviceDb();
    const { data, error } = await (db as any)
        .from('clan_war_fixtures')
        .select('*')
        .eq('war_id', warId)
        .order('fixture_index', { ascending: true });

    if (error) throw new ClanServiceError(error.message, 500);
    return (data || []) as ClanWarFixture[];
}

/**
 * Fixture scheduling: propose or confirm bilateral scheduled time.
 */
export async function scheduleFixtureTime(params: {
    fixtureId: string;
    actorWallet: string;
    scheduledAt: string;
}): Promise<void> {
    const db = serviceDb();
    const actor = params.actorWallet.toLowerCase();

    const { data: fixture } = await (db as any)
        .from('clan_war_fixtures')
        .select('*, war:clan_wars(*)')
        .eq('id', params.fixtureId)
        .single();

    if (!fixture) throw new ClanServiceError('Fixture not found', 404);

    const isParticipant =
        fixture.clan_a_seats.map((s: string) => s.toLowerCase()).includes(actor) ||
        fixture.clan_b_seats.map((s: string) => s.toLowerCase()).includes(actor);

    if (!isParticipant) {
        throw new ClanServiceError('Only assigned players or clan officers can schedule fixture', 403);
    }

    await (db as any)
        .from('clan_war_fixtures')
        .update({
            scheduled_at: params.scheduledAt,
            status: 'scheduled_agreed',
        })
        .eq('id', params.fixtureId);
}
