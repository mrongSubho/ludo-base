/* eslint-disable @typescript-eslint/no-explicit-any */
import { serviceDb } from '@/lib/serverAuth';
import {
    keccak256,
    parseEventLogs,
    parseUnits,
    toBytes,
    type Hex,
    type Log,
} from 'viem';
import {
    CLAN_CLAIM_DEPOSIT_ABI,
    DEFAULT_CLAN_CLAIM_ADDRESS,
    clanClaimAddress,
} from '@/lib/chips';
import { waitForConfirmedReceipt } from '@/lib/onchainReceipt';
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
            total_stake: treasurySubsidy,
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
 * Verify that `logs` contain a matching `WarStakeDeposited` event from `claimContract`.
 * Exported for unit testing.
 */
export function verifyWarStakeDepositLog(params: {
    logs: Log[];
    claimContract: string;
    warId: Hex;
    clanId: Hex;
    contributor: string;
    minAmountWei: bigint;
}): void {
    const decodedLogs = parseEventLogs({
        abi: CLAN_CLAIM_DEPOSIT_ABI,
        logs: params.logs,
        eventName: 'WarStakeDeposited',
    });

    const targetContract = params.claimContract.toLowerCase();
    const targetContributor = params.contributor.toLowerCase();

    const matchLog = decodedLogs.find((l) => {
        const sameContract = l.address.toLowerCase() === targetContract;
        const args = l.args as { warId?: Hex; clanId?: Hex; contributor?: string; amount?: bigint };
        return (
            sameContract &&
            args.warId?.toLowerCase() === params.warId.toLowerCase() &&
            args.clanId?.toLowerCase() === params.clanId.toLowerCase() &&
            args.contributor?.toLowerCase() === targetContributor &&
            (args.amount ?? BigInt(0)) >= params.minAmountWei
        );
    });

    if (!matchLog) {
        throw new ClanServiceError(
            'Transaction logs do not match the expected Clan War stake deposit',
            400,
        );
    }
}

/**
 * Lock member entry fee into the active war call (verified against ClanClaim.depositWarStake on Base Sepolia).
 */
export async function buyInWarCall(params: {
    clanId: string;
    walletAddress: string;
    stakeAmount: number;
    txHash: string;
}): Promise<ClanWarStake> {
    const db = serviceDb();
    const wallet = params.walletAddress.toLowerCase();

    if (!params.txHash || !params.txHash.trim()) {
        throw new ClanServiceError('On-chain transaction hash (txHash) is required for war buy-in', 400);
    }
    const txHash = params.txHash.trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
        throw new ClanServiceError('Invalid transaction hash format', 400);
    }

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

    // Prevent duplicate lock before verifying tx
    const { data: existingStake } = await (db as any)
        .from('clan_war_stakes')
        .select('id')
        .eq('war_call_id', warCall.id)
        .eq('wallet_address', wallet)
        .eq('kind', 'member_fee')
        .maybeSingle();

    if (existingStake) {
        throw new ClanServiceError('You have already secured a war roster spot', 409);
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

    // Replay prevention via chips_events
    const { data: usedTx } = await (db as any)
        .from('chips_events')
        .select('tx_hash')
        .eq('chain_id', 84532)
        .eq('tx_hash', txHash)
        .eq('event_name', 'WarStakeDeposited')
        .maybeSingle();

    if (usedTx) {
        throw new ClanServiceError('This transaction hash has already been used for a war stake', 409, 'TRANSACTION_ALREADY_USED');
    }

    const expectedBaseUnits = parseUnits(String(params.stakeAmount), 18);
    const expectedWarId = keccak256(toBytes(warCall.id));
    const expectedClanId = keccak256(toBytes(params.clanId));
    const claimContract = clanClaimAddress() || DEFAULT_CLAN_CLAIM_ADDRESS;

    const receipt = await waitForConfirmedReceipt(
        txHash,
        (msg, status = 400) => new ClanServiceError(msg, status),
    );

    verifyWarStakeDepositLog({
        logs: receipt.logs,
        claimContract,
        warId: expectedWarId,
        clanId: expectedClanId,
        contributor: wallet,
        minAmountWei: expectedBaseUnits,
    });

    try {
        await (db as any)
            .from('chips_events')
            .upsert({
                chain_id: 84532,
                tx_hash: txHash,
                log_index: 0,
                event_name: 'WarStakeDeposited',
                wallet_address: wallet,
                amount: expectedBaseUnits.toString(),
                memo_bytes32: expectedWarId,
                payload: {
                    warCallId: warCall.id,
                    clanId: params.clanId,
                    stakeAmount: params.stakeAmount,
                },
            }, { onConflict: 'chain_id,tx_hash,log_index' });
    } catch {
        // Best-effort audit insert
    }

    // Insert locked roster stake row
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

    // Recompute actual committed stake on the war call
    const { data: allStakes } = await (db as any)
        .from('clan_war_stakes')
        .select('stake_amount')
        .eq('war_call_id', warCall.id)
        .eq('status', 'locked');

    const committedSum = (allStakes || []).reduce((acc: number, row: any) => acc + Number(row.stake_amount), 0);
    await (db as any)
        .from('clan_war_calls')
        .update({ total_stake: committedSum + Number(warCall.treasury_subsidy || 0) })
        .eq('id', warCall.id);

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
 * Fetch the active (or settling) clan war and its fixtures for a clan,
 * automatically advancing `prep_phase` -> `active_war` once `war_start_at` elapses.
 */
export async function getActiveWarForClan(clanId: string): Promise<{
    activeWar: ClanWar | null;
    fixtures: ClanWarFixture[];
}> {
    const db = serviceDb();
    const { data: war, error } = await (db as any)
        .from('clan_wars')
        .select(`
            *,
            clan_a:clans!clan_wars_clan_a_id_fkey ( id, name, tag, crest, level, division, cwr ),
            clan_b:clans!clan_wars_clan_b_id_fkey ( id, name, tag, crest, level, division, cwr )
        `)
        .or(`clan_a_id.eq.${clanId},clan_b_id.eq.${clanId}`)
        .in('status', ['prep_phase', 'active_war', 'settling'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error || !war) {
        return { activeWar: null, fixtures: [] };
    }

    // Advance prep_phase -> active_war once war_start_at has passed
    if (war.status === 'prep_phase' && war.war_start_at && Date.now() >= new Date(war.war_start_at).getTime()) {
        await (db as any)
            .from('clan_wars')
            .update({ status: 'active_war' })
            .eq('id', war.id)
            .eq('status', 'prep_phase');
        war.status = 'active_war';
    }

    const fixtures = await getWarFixtures(war.id);
    return {
        activeWar: war as ClanWar,
        fixtures,
    };
}

/**
 * Match two clans (Auto-match or Open War Board selection).
 * Locks both calls atomically via `clan_match_war_calls` RPC and generates the 3N Fixtures Matrix.
 */
export async function matchClans(
    callAId: string,
    callBId: string,
    actorWallet?: string,
): Promise<ClanWar> {
    const db = serviceDb();

    const { data: callA } = await (db as any).from('clan_war_calls').select('*').eq('id', callAId).maybeSingle();
    const { data: callB } = await (db as any).from('clan_war_calls').select('*').eq('id', callBId).maybeSingle();

    if (!callA || !callB) throw new ClanServiceError('One or both war calls not found', 404);
    if (callA.clan_id === callB.clan_id) throw new ClanServiceError('Cannot match clan with itself', 400);
    if (callA.bracket !== callB.bracket) throw new ClanServiceError('War brackets do not match', 400);
    if (callA.status !== 'searching' || callB.status !== 'searching') {
        throw new ClanServiceError('Both war calls must be actively searching to match', 409);
    }

    // When invoked via Open War Board API, require caller is commander or officer of callA's clan
    if (actorWallet) {
        const actor = actorWallet.toLowerCase();
        const { data: member } = await (db as any)
            .from('clan_members')
            .select('role')
            .eq('clan_id', callA.clan_id)
            .eq('wallet_address', actor)
            .maybeSingle();

        if (!member || !['commander', 'officer'].includes(member.role)) {
            throw new ClanServiceError('Only commanders or officers of the challenging clan can initiate a war match', 403);
        }
    }

    const { data: warJson, error: matchErr } = await (db as any).rpc('clan_match_war_calls', {
        p_call_a_id: callAId,
        p_call_b_id: callBId,
    });

    if (matchErr || !warJson) {
        const msg = String(matchErr?.message || '');
        if (msg.includes('CALL_NOT_SEARCHING')) {
            throw new ClanServiceError('One of the war calls is no longer searching', 409);
        }
        if (msg.includes('BRACKET_MISMATCH')) {
            throw new ClanServiceError('War brackets do not match', 400);
        }
        if (msg.includes('SELF_MATCH_NOT_ALLOWED')) {
            throw new ClanServiceError('Cannot match a clan with itself', 400);
        }
        throw new ClanServiceError(msg || 'Failed to match war calls', 500);
    }

    const war = warJson as ClanWar;

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

    return war;
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
 * Fixture scheduling: bilateral propose / confirm between Clan A and Clan B participants or officers.
 */
export async function scheduleFixtureTime(params: {
    fixtureId: string;
    actorWallet: string;
    scheduledAt?: string;
    action?: 'propose' | 'confirm';
}): Promise<ClanWarFixture> {
    const db = serviceDb();
    const actor = params.actorWallet.toLowerCase();

    const { data: fixture } = await (db as any)
        .from('clan_war_fixtures')
        .select('*, war:clan_wars(*)')
        .eq('id', params.fixtureId)
        .maybeSingle();

    if (!fixture) throw new ClanServiceError('Fixture not found', 404);
    if (['completed', 'walkover', 'mutual_void'].includes(fixture.status)) {
        throw new ClanServiceError('Fixture is already resolved', 400);
    }

    const inClanASeats = (fixture.clan_a_seats || []).map((s: string) => s.toLowerCase()).includes(actor);
    const inClanBSeats = (fixture.clan_b_seats || []).map((s: string) => s.toLowerCase()).includes(actor);

    let actorSide: 'a' | 'b' | null = inClanASeats ? 'a' : inClanBSeats ? 'b' : null;

    if (!actorSide && fixture.war) {
        const { data: officerRows } = await (db as any)
            .from('clan_members')
            .select('clan_id, role')
            .eq('wallet_address', actor)
            .in('clan_id', [fixture.war.clan_a_id, fixture.war.clan_b_id])
            .in('role', ['commander', 'officer']);

        if (officerRows && officerRows.length > 0) {
            actorSide = officerRows[0].clan_id === fixture.war.clan_a_id ? 'a' : 'b';
        }
    }

    if (!actorSide) {
        throw new ClanServiceError('Only assigned players or clan officers can schedule this fixture', 403);
    }

    if (params.action === 'confirm') {
        if (!fixture.scheduled_at || !fixture.proposed_by) {
            throw new ClanServiceError('No pending schedule proposal to confirm', 400);
        }
        if (fixture.proposed_by === actorSide) {
            throw new ClanServiceError('Waiting for the opposing clan to confirm this time', 409);
        }
        const { data: updated, error } = await (db as any)
            .from('clan_war_fixtures')
            .update({ status: 'scheduled_agreed' })
            .eq('id', params.fixtureId)
            .select('*')
            .single();
        if (error) throw new ClanServiceError(error.message, 500);
        return updated as ClanWarFixture;
    }

    if (!params.scheduledAt) {
        throw new ClanServiceError('scheduledAt timestamp is required', 400);
    }
    const parsedTime = new Date(params.scheduledAt);
    if (Number.isNaN(parsedTime.getTime())) {
        throw new ClanServiceError('Invalid scheduledAt timestamp', 400);
    }

    // If opposing side already proposed this exact timestamp, confirm bilaterally
    const isConfirmingSameSlot =
        fixture.status === 'reschedule_pending' &&
        fixture.proposed_by &&
        fixture.proposed_by !== actorSide &&
        fixture.scheduled_at &&
        new Date(fixture.scheduled_at).getTime() === parsedTime.getTime();

    const nextStatus: FixtureStatus = isConfirmingSameSlot ? 'scheduled_agreed' : 'reschedule_pending';

    const { data: updated, error } = await (db as any)
        .from('clan_war_fixtures')
        .update({
            scheduled_at: parsedTime.toISOString(),
            proposed_by: actorSide,
            proposed_at: new Date().toISOString(),
            status: nextStatus,
        })
        .eq('id', params.fixtureId)
        .select('*')
        .single();

    if (error) throw new ClanServiceError(error.message, 500);
    return updated as ClanWarFixture;
}
