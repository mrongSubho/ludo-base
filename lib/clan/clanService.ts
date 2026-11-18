/* eslint-disable @typescript-eslint/no-explicit-any */
import { serviceDb } from '@/lib/serverAuth';
import {
    createPublicClient,
    http,
    keccak256,
    parseEventLogs,
    parseUnits,
    toBytes,
    type Address,
    type Hex,
    type Log,
} from 'viem';
import { baseSepolia } from 'viem/chains';
import {
    CHIPS_ERC20_ABI,
    CLAN_CLAIM_DEPOSIT_ABI,
    DEFAULT_CLAN_CLAIM_ADDRESS,
    chipsAddress,
    clanClaimAddress,
} from '@/lib/chips';
import { verifyErc20TransferLog, waitForConfirmedReceipt } from '@/lib/onchainReceipt';
import { recordSocialOnboarding } from '@/lib/onboardingProgressWriter';
import type {
    Clan,
    ClanMember,
    ClanJoinRequest,
    ClanRole,
    ClanJoinPolicy,
    ClanCrest,
    ClanLevelConfig,
    ClanTreasuryLedgerEntry,
    ClanMissionContract,
    ClanWeeklyVaultSummary,
    ClanWar,
    ClanWarFixture,
    ClanProfileDossier,
    ClanCwrPoint,
    ClanHonorMedal,
    ClanWarHistoryEntry,
    ClanContributorStat,
} from './types';

const DEFAULT_CHIPS_CONTRACT: Address = '0xB200000000000000000000821408122b9Ed3d05B';
export const PROTOCOL_TREASURY_WALLET: Address =
    (process.env.NEXT_PUBLIC_TREASURY_WALLET as Address) ||
    '0xbcCa5DcBF293D98A627fD3814D5AE8249bB1DFaF';
const CLAN_CREATION_FEE_RAW = BigInt(10_000) * (BigInt(10) ** BigInt(18)); // 10,000 CHIPS in 1e18

/**
 * Read a player's on-chain CHIPS ERC-20 balance on Base Sepolia.
 */
export async function getOnChainChipsBalance(walletAddress: string): Promise<bigint> {
    try {
        const tokenAddress = chipsAddress() || DEFAULT_CHIPS_CONTRACT;
        const rpc = process.env.SEPOLIA_RPC || process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org';
        const client = createPublicClient({ chain: baseSepolia, transport: http(rpc) });
        const bal = await client.readContract({
            address: tokenAddress,
            abi: CHIPS_ERC20_ABI,
            functionName: 'balanceOf',
            args: [walletAddress as Address],
        });
        return BigInt(bal);
    } catch (e) {
        console.warn('[clanService] Failed to read on-chain CHIPS balance:', e);
        return BigInt(0);
    }
}

export class ClanServiceError extends Error {
    constructor(
        message: string,
        public readonly statusCode: number = 400,
        public readonly code?: string,
    ) {
        super(message);
        this.name = 'ClanServiceError';
    }
}

/**
 * Fetch a single clan by its unique ID.
 */
export async function getClan(clanId: string): Promise<Clan | null> {
    const db = serviceDb();
    const { data, error } = await (db as any)
        .from('clans')
        .select('*')
        .eq('id', clanId)
        .eq('status', 'active')
        .maybeSingle();

    if (error || !data) return null;
    return data as Clan;
}

/**
 * Fetch a single clan by its unique tag.
 */
export async function getClanByTag(tag: string): Promise<Clan | null> {
    const db = serviceDb();
    const { data, error } = await (db as any)
        .from('clans')
        .select('*')
        .eq('tag', tag.trim().toUpperCase())
        .eq('status', 'active')
        .maybeSingle();

    if (error || !data) return null;
    return data as Clan;
}

/**
 * Search and discover active clans.
 */
export async function searchClans(options: {
    query?: string;
    division?: string;
    limit?: number;
    offset?: number;
}): Promise<{ clans: Clan[]; total: number }> {
    const db = serviceDb();
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 50);
    const offset = Math.max(options.offset ?? 0, 0);

    let query = (db as any)
        .from('clans')
        .select('*', { count: 'exact' })
        .eq('status', 'active');

    if (options.division) {
        query = query.eq('division', options.division);
    }

    if (options.query && options.query.trim().length > 0) {
        const q = options.query.trim();
        query = query.or(`name.ilike.%${q}%,tag.ilike.%${q}%`);
    }

    query = query
        .order('cwr', { ascending: false })
        .order('level', { ascending: false })
        .range(offset, offset + limit - 1);

    const { data, count, error } = await query;
    if (error) {
        throw new ClanServiceError(error.message, 500);
    }

    const maskedClans = ((data || []) as Clan[]).map((c) =>
        c.treasury_public ? c : { ...c, treasury_balance: 0 },
    );

    return {
        clans: maskedClans,
        total: count || 0,
    };
}

/**
 * Get clan level configuration details.
 */
export async function getClanLevelConfig(level: number): Promise<ClanLevelConfig | null> {
    const db = serviceDb();
    const { data } = await (db as any)
        .from('clan_level_config')
        .select('*')
        .eq('level', level)
        .maybeSingle();

    return (data as ClanLevelConfig) || null;
}

/**
 * Fetch next clan level config (for CXP progress bars).
 */
export async function getNextClanLevelConfig(currentLevel: number): Promise<ClanLevelConfig | null> {
    const db = serviceDb();
    const { data } = await (db as any)
        .from('clan_level_config')
        .select('*')
        .gt('level', currentLevel)
        .order('level', { ascending: true })
        .limit(1)
        .maybeSingle();

    return (data as ClanLevelConfig) || null;
}

/**
 * Pre-flight availability & balance check before on-chain clan creation tx.
 */
export async function checkClanAvailability(params: {
    walletAddress: string;
    name: string;
    tag: string;
}): Promise<{
    available: boolean;
    reason?: string;
    onChainChips: string;
    hasEnoughChips: boolean;
}> {
    const db = serviceDb();
    const wallet = params.walletAddress.toLowerCase();
    const name = params.name.trim();
    const tag = params.tag.trim().toUpperCase();

    if (name.length < 3 || name.length > 24) {
        return { available: false, reason: 'Clan name must be between 3 and 24 characters', onChainChips: '0', hasEnoughChips: false };
    }
    if (tag.length < 2 || tag.length > 5 || !/^[A-Z0-9]+$/.test(tag)) {
        return { available: false, reason: 'Clan tag must be 2–5 alphanumeric characters', onChainChips: '0', hasEnoughChips: false };
    }

    const [existingMember, nameClash, tagClash, chipsBal] = await Promise.all([
        getPlayerClan(wallet),
        (db as any).from('clans').select('id').ilike('name', name).limit(1).maybeSingle(),
        (db as any).from('clans').select('id').eq('tag', tag).limit(1).maybeSingle(),
        getOnChainChipsBalance(wallet),
    ]);

    const hasEnoughChips = chipsBal >= CLAN_CREATION_FEE_RAW;
    if (existingMember) {
        return {
            available: false,
            reason: 'You are already a member of a clan',
            onChainChips: chipsBal.toString(),
            hasEnoughChips,
        };
    }
    if (nameClash?.data) {
        return {
            available: false,
            reason: 'That clan name is already taken',
            onChainChips: chipsBal.toString(),
            hasEnoughChips,
        };
    }
    if (tagClash?.data) {
        return {
            available: false,
            reason: 'That clan tag is already taken',
            onChainChips: chipsBal.toString(),
            hasEnoughChips,
        };
    }

    return {
        available: true,
        onChainChips: chipsBal.toString(),
        hasEnoughChips,
    };
}

/**
 * Server-sourced clan tags for a list of wallets (prevents client tag spoofing).
 */
export async function getClanTagsForWallets(
    wallets: string[],
): Promise<Record<string, { clanId: string; tag: string; name: string }>> {
    const clean = [...new Set(wallets.map((w) => w.toLowerCase()).filter(Boolean))];
    if (clean.length === 0) return {};

    const db = serviceDb();
    const { data } = await (db as any)
        .from('clan_members')
        .select('wallet_address, clan_id, clan:clans(id, tag, name, status)')
        .in('wallet_address', clean);

    const out: Record<string, { clanId: string; tag: string; name: string }> = {};
    for (const row of data || []) {
        if (row?.clan?.status === 'active' && row?.clan?.tag) {
            out[String(row.wallet_address).toLowerCase()] = {
                clanId: String(row.clan_id),
                tag: String(row.clan.tag),
                name: String(row.clan.name),
            };
        }
    }
    return out;
}

/**
 * Get the current clan and member record for a player's wallet.
 */
export async function getPlayerClan(walletAddress: string): Promise<{
    clan: Clan;
    member: ClanMember;
    levelConfig: ClanLevelConfig | null;
} | null> {
    const db = serviceDb();
    const wallet = walletAddress.toLowerCase();

    const { data: member, error: memberErr } = await (db as any)
        .from('clan_members')
        .select('*')
        .eq('wallet_address', wallet)
        .maybeSingle();

    if (memberErr || !member) return null;

    const clan = await getClan(member.clan_id);
    if (!clan) return null;

    const levelConfig = await getClanLevelConfig(clan.level);

    return {
        clan,
        member: member as ClanMember,
        levelConfig,
    };
}

/**
 * Fetch all members of a clan.
 */
export async function getClanMembers(clanId: string): Promise<ClanMember[]> {
    const db = serviceDb();
    const { data, error } = await (db as any)
        .from('clan_members')
        .select(`
            *,
            player:players (
                username,
                avatar_url,
                rank_tier
            )
        `)
        .eq('clan_id', clanId)
        .order('role', { ascending: true })
        .order('war_points', { ascending: false });

    if (error) {
        throw new ClanServiceError(error.message, 500);
    }
    return (data || []) as ClanMember[];
}

/**
 * Fetch pending join requests for a clan (for commander/officers).
 */
export async function getJoinRequests(clanId: string): Promise<ClanJoinRequest[]> {
    const db = serviceDb();
    const { data, error } = await (db as any)
        .from('clan_join_requests')
        .select(`
            *,
            player:players (
                username,
                avatar_url,
                rank_tier
            )
        `)
        .eq('clan_id', clanId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

    if (error) throw new ClanServiceError(error.message, 500);
    return (data || []) as ClanJoinRequest[];
}

/**
 * Create a new clan using the atomic Postgres RPC `clan_create_with_escrow`.
 * Spends 10,000 CHIPS from the user's escrow account to the protocol treasury.
 */
export async function createClan(params: {
    leaderWallet: string;
    name: string;
    tag: string;
    bio?: string;
    crest?: ClanCrest;
    txHash?: string;
}): Promise<{ clanId: string }> {
    const db = serviceDb();
    const leader = params.leaderWallet.toLowerCase();
    const name = params.name.trim();
    const tag = params.tag.trim().toUpperCase();

    if (name.length < 3 || name.length > 24) {
        throw new ClanServiceError('Clan name must be between 3 and 24 characters', 400);
    }
    if (tag.length < 2 || tag.length > 5) {
        throw new ClanServiceError('Clan tag must be between 2 and 5 characters', 400);
    }
    if (!/^[A-Z0-9]+$/.test(tag)) {
        throw new ClanServiceError('Clan tag must contain only alphanumeric characters', 400);
    }

    // Check if player is already in a clan
    const existing = await getPlayerClan(leader);
    if (existing) {
        throw new ClanServiceError('You must leave your current clan before creating a new one', 409);
    }

    const crestJson = params.crest ?? {
        emblem: 'shield',
        primary: '#00E5FF',
        secondary: '#0D1117',
    };

    // If an on-chain transaction hash is provided, verify the confirmed CHIPS transfer strictly.
    if (params.txHash) {
        const txHash = params.txHash.trim();
        if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
            throw new ClanServiceError('Invalid transaction hash format', 400);
        }

        // Replay prevention across both clans.crest and chips_events
        const [{ data: existingTx }, { data: existingEvent }] = await Promise.all([
            (db as any)
                .from('clans')
                .select('id')
                .contains('crest', { txHash })
                .maybeSingle(),
            (db as any)
                .from('chips_events')
                .select('tx_hash')
                .eq('chain_id', 84532)
                .eq('tx_hash', txHash)
                .eq('event_name', 'ClanCreatedOnChain')
                .maybeSingle(),
        ]);

        if (existingTx || existingEvent) {
            throw new ClanServiceError('This transaction hash has already been used to create a clan', 409, 'TRANSACTION_ALREADY_USED');
        }

        const tokenContract = chipsAddress() || DEFAULT_CHIPS_CONTRACT;
        const receipt = await waitForConfirmedReceipt(
            txHash,
            (msg, status = 400) => new ClanServiceError(msg, status),
        );
        verifyErc20TransferLog({
            logs: receipt.logs,
            tokenContract,
            expectedFrom: leader,
            expectedTo: PROTOCOL_TREASURY_WALLET,
            minAmountWei: CLAN_CREATION_FEE_RAW,
            makeError: (msg, status = 400) => new ClanServiceError(msg, status),
        });

        const crestWithTx = {
            ...crestJson,
            txHash,
        };

        const { data: clanData, error: clanErr } = await (db as any)
            .from('clans')
            .insert({
                name,
                tag,
                bio: params.bio?.trim() || null,
                crest: crestWithTx,
                leader_wallet: leader,
                level: 1,
                member_count: 1,
            })
            .select('id')
            .single();

        if (clanErr) {
            if (clanErr.code === '23505') {
                throw new ClanServiceError('A clan with this name or tag already exists', 409, 'NAME_OR_TAG_TAKEN');
            }
            throw new ClanServiceError(clanErr.message, 500);
        }

        const clanId = clanData.id;

        const { error: memberErr } = await (db as any)
            .from('clan_members')
            .insert({
                clan_id: clanId,
                wallet_address: leader,
                role: 'commander',
            });

        if (memberErr) {
            throw new ClanServiceError(memberErr.message, 500);
        }

        // Record on-chain fee in chips_events for auditability
        try {
            await (db as any)
                .from('chips_events')
                .upsert({
                    chain_id: 84532,
                    tx_hash: txHash,
                    log_index: 0,
                    event_name: 'ClanCreatedOnChain',
                    wallet_address: leader,
                    amount: CLAN_CREATION_FEE_RAW.toString(),
                    payload: {
                        clanId,
                        treasury: PROTOCOL_TREASURY_WALLET,
                    },
                }, { onConflict: 'chain_id,tx_hash,log_index' });
        } catch {
            // Best-effort audit insert
        }

        // Complete 'clan' onboarding track
        try {
            await recordSocialOnboarding(db, leader, 'clan', 1);
        } catch {
            // Best-effort onboarding credit
        }

        return { clanId };
    }

    const requestId = crypto.randomUUID();

    // Legacy fallback (no txHash): debit from genuinely funded DB escrow only.
    // Unbacked on-chain-to-escrow minting is disallowed; on-chain creation requires txHash proof.
    const { data, error } = await (db as any).rpc('clan_create_with_escrow', {
        p_leader_wallet: leader,
        p_name: name,
        p_tag: tag,
        p_bio: params.bio?.trim() || null,
        p_crest: crestJson,
        p_request_id: requestId,
    });

    if (error) {
        const msg = String(error.message || '');
        if (msg.includes('INSUFFICIENT_ESCROW') || msg.includes('insufficient_escrow')) {
            throw new ClanServiceError('Insufficient CHIPS balance (10,000 CHIPS required to create a clan)', 402, 'INSUFFICIENT_CHIPS');
        }
        if (msg.includes('ALREADY_IN_CLAN') || msg.includes('already in a clan')) {
            throw new ClanServiceError('You are already a member of a clan', 409);
        }
        if (msg.includes('BAD_NAME')) {
            throw new ClanServiceError('Clan name must be between 3 and 24 characters', 400);
        }
        if (msg.includes('BAD_TAG')) {
            throw new ClanServiceError('Clan tag must be between 2 and 5 characters', 400);
        }
        if (msg.includes('PLAYER_NOT_FOUND')) {
            throw new ClanServiceError('Player profile not found. Please connect your wallet first.', 404);
        }
        if (msg.includes('ESCROW_DISABLED')) {
            throw new ClanServiceError('Escrow deposits are currently paused.', 503);
        }
        if (error.code === '23505') {
            throw new ClanServiceError('A clan with this name or tag already exists', 409, 'NAME_OR_TAG_TAKEN');
        }
        throw new ClanServiceError(error.message, 500);
    }

    const clanId = data?.clan_id || data;
    try {
        await recordSocialOnboarding(db, leader, 'clan', 1);
    } catch {
        // Best-effort onboarding credit
    }
    return { clanId };
}

/**
 * Request to join a clan or join directly if policy is 'open'.
 */
export async function requestJoinClan(clanId: string, walletAddress: string): Promise<{
    status: 'joined' | 'pending';
    message: string;
}> {
    const db = serviceDb();
    const wallet = walletAddress.toLowerCase();

    // Check if already in a clan
    const existing = await getPlayerClan(wallet);
    if (existing) {
        throw new ClanServiceError('You are already a member of a clan', 409);
    }

    const clan = await getClan(clanId);
    if (!clan) throw new ClanServiceError('Clan not found', 404);

    const levelConfig = await getClanLevelConfig(clan.level);
    const memberCap = levelConfig?.member_cap ?? 20;

    if (clan.member_count >= memberCap) {
        throw new ClanServiceError('This clan has reached its member capacity', 400, 'CLAN_FULL');
    }

    if (clan.join_policy === 'invite_only') {
        throw new ClanServiceError('This clan is invite-only', 403, 'INVITE_ONLY');
    }

    if (clan.join_policy === 'open') {
        // Direct join
        const { error: joinErr } = await (db as any).from('clan_members').insert({
            clan_id: clanId,
            wallet_address: wallet,
            role: 'member',
        });
        if (joinErr) throw new ClanServiceError(joinErr.message, 500);

        await (db as any).rpc('clan_adjust_member_count', { p_clan_id: clanId, p_delta: 1 });

        // Delete any pending requests
        await (db as any)
            .from('clan_join_requests')
            .delete()
            .eq('wallet_address', wallet);

        try {
            await recordSocialOnboarding(db, wallet, 'clan', 1);
        } catch {
            // Best-effort onboarding credit
        }

        return { status: 'joined', message: 'Successfully joined clan' };
    }

    // Policy is 'request'
    const { error: reqErr } = await (db as any).from('clan_join_requests').upsert({
        clan_id: clanId,
        wallet_address: wallet,
        status: 'pending',
        expires_at: new Date(Date.now() + 7 * 86400 * 1000).toISOString(),
    }, { onConflict: 'clan_id, wallet_address' });

    if (reqErr) throw new ClanServiceError(reqErr.message, 500);

    return { status: 'pending', message: 'Join request submitted to clan officers' };
}

/**
 * Review a join request (Commander or Officer only).
 */
export async function reviewJoinRequest(
    clanId: string,
    reviewerWallet: string,
    targetWallet: string,
    decision: 'accept' | 'reject',
): Promise<void> {
    const db = serviceDb();
    const reviewer = reviewerWallet.toLowerCase();
    const target = targetWallet.toLowerCase();

    // Verify reviewer permissions
    const { data: reviewerMember } = await (db as any)
        .from('clan_members')
        .select('role')
        .eq('clan_id', clanId)
        .eq('wallet_address', reviewer)
        .maybeSingle();

    if (!reviewerMember || !['commander', 'officer'].includes(reviewerMember.role)) {
        throw new ClanServiceError('Only commanders and officers can review join requests', 403);
    }

    const clan = await getClan(clanId);
    if (!clan) throw new ClanServiceError('Clan not found', 404);

    if (decision === 'reject') {
        await (db as any)
            .from('clan_join_requests')
            .update({ status: 'rejected' })
            .eq('clan_id', clanId)
            .eq('wallet_address', target);
        return;
    }

    // Decision: accept
    const levelConfig = await getClanLevelConfig(clan.level);
    const memberCap = levelConfig?.member_cap ?? 20;

    if (clan.member_count >= memberCap) {
        throw new ClanServiceError('Clan is at full capacity', 400, 'CLAN_FULL');
    }

    // Check if target is already in another clan
    const targetClan = await getPlayerClan(target);
    if (targetClan) {
        await (db as any)
            .from('clan_join_requests')
            .delete()
            .eq('clan_id', clanId)
            .eq('wallet_address', target);
        throw new ClanServiceError('User is already a member of another clan', 409);
    }

    // Insert into clan_members
    const { error: addErr } = await (db as any).from('clan_members').insert({
        clan_id: clanId,
        wallet_address: target,
        role: 'member',
    });
    if (addErr) throw new ClanServiceError(addErr.message, 500);

    await (db as any).rpc('clan_adjust_member_count', { p_clan_id: clanId, p_delta: 1 });

    await (db as any)
        .from('clan_join_requests')
        .update({ status: 'accepted' })
        .eq('clan_id', clanId)
        .eq('wallet_address', target);

    try {
        await recordSocialOnboarding(db, target, 'clan', 1);
    } catch {
        // Best-effort onboarding credit
    }
}

/**
 * Cancel a pending join request.
 */
export async function cancelJoinRequest(clanId: string, walletAddress: string): Promise<void> {
    const db = serviceDb();
    const wallet = walletAddress.toLowerCase();

    await (db as any)
        .from('clan_join_requests')
        .delete()
        .eq('clan_id', clanId)
        .eq('wallet_address', wallet)
        .eq('status', 'pending');
}

/**
 * Leave current clan.
 */
export async function leaveClan(clanId: string, walletAddress: string): Promise<void> {
    const db = serviceDb();
    const wallet = walletAddress.toLowerCase();

    const clan = await getClan(clanId);
    if (!clan) throw new ClanServiceError('Clan not found', 404);

    const { data: member } = await (db as any)
        .from('clan_members')
        .select('role')
        .eq('clan_id', clanId)
        .eq('wallet_address', wallet)
        .maybeSingle();

    if (!member) throw new ClanServiceError('You are not a member of this clan', 404);

    if (member.role === 'commander' && clan.member_count > 1) {
        throw new ClanServiceError('Commanders must transfer leadership before leaving', 400);
    }

    await (db as any)
        .from('clan_members')
        .delete()
        .eq('clan_id', clanId)
        .eq('wallet_address', wallet);

    if (clan.member_count <= 1) {
        // Disband if last member
        await (db as any)
            .from('clans')
            .update({ status: 'archived', member_count: 0 })
            .eq('id', clanId);
    } else {
        await (db as any).rpc('clan_adjust_member_count', { p_clan_id: clanId, p_delta: -1 });
    }
}

/**
 * Kick a member from the clan.
 */
export async function kickMember(clanId: string, actorWallet: string, targetWallet: string): Promise<void> {
    const db = serviceDb();
    const actor = actorWallet.toLowerCase();
    const target = targetWallet.toLowerCase();

    if (actor === target) throw new ClanServiceError('Cannot kick yourself', 400);

    const clan = await getClan(clanId);
    if (!clan) throw new ClanServiceError('Clan not found', 404);

    const { data: actorMember } = await (db as any)
        .from('clan_members')
        .select('role')
        .eq('clan_id', clanId)
        .eq('wallet_address', actor)
        .maybeSingle();

    if (!actorMember || !['commander', 'officer'].includes(actorMember.role)) {
        throw new ClanServiceError('Permission denied', 403);
    }

    const { data: targetMember } = await (db as any)
        .from('clan_members')
        .select('role')
        .eq('clan_id', clanId)
        .eq('wallet_address', target)
        .maybeSingle();

    if (!targetMember) throw new ClanServiceError('Target is not a member of this clan', 404);

    if (targetMember.role === 'commander') {
        throw new ClanServiceError('Cannot kick the commander', 403);
    }
    if (actorMember.role === 'officer' && ['officer', 'commander'].includes(targetMember.role)) {
        throw new ClanServiceError('Officers cannot kick fellow officers or commanders', 403);
    }

    await (db as any)
        .from('clan_members')
        .delete()
        .eq('clan_id', clanId)
        .eq('wallet_address', target);

    await (db as any).rpc('clan_adjust_member_count', { p_clan_id: clanId, p_delta: -1 });
}

/**
 * Promote, demote, or transfer leadership of a member.
 */
export async function updateMemberRole(
    clanId: string,
    commanderWallet: string,
    targetWallet: string,
    newRole: ClanRole,
): Promise<void> {
    const db = serviceDb();
    const commander = commanderWallet.toLowerCase();
    const target = targetWallet.toLowerCase();

    const clan = await getClan(clanId);
    if (!clan) throw new ClanServiceError('Clan not found', 404);
    if (clan.leader_wallet.toLowerCase() !== commander) {
        throw new ClanServiceError('Only the commander can change member roles', 403);
    }

    if (newRole === 'commander') {
        // Transfer leadership
        await (db as any)
            .from('clan_members')
            .update({ role: 'officer' })
            .eq('clan_id', clanId)
            .eq('wallet_address', commander);

        await (db as any)
            .from('clan_members')
            .update({ role: 'commander' })
            .eq('clan_id', clanId)
            .eq('wallet_address', target);

        await (db as any)
            .from('clans')
            .update({ leader_wallet: target })
            .eq('id', clanId);

        return;
    }

    if (newRole === 'officer') {
        const levelConfig = await getClanLevelConfig(clan.level);
        const maxOfficers = levelConfig?.officer_slots ?? 2;

        const { count } = await (db as any)
            .from('clan_members')
            .select('*', { count: 'exact', head: true })
            .eq('clan_id', clanId)
            .eq('role', 'officer');

        if ((count || 0) >= maxOfficers) {
            throw new ClanServiceError(`Maximum officer slots (${maxOfficers}) reached for level ${clan.level}`, 400);
        }
    }

    await (db as any)
        .from('clan_members')
        .update({ role: newRole })
        .eq('clan_id', clanId)
        .eq('wallet_address', target);
}

/**
 * Update clan settings (bio, join policy, minimum requirements, treasury visibility).
 */
export async function updateClanSettings(
    clanId: string,
    actorWallet: string,
    updates: {
        bio?: string;
        join_policy?: ClanJoinPolicy;
        min_rxp?: number;
        min_level?: number;
        farcaster_channel?: string;
        treasury_public?: boolean;
    },
): Promise<void> {
    const db = serviceDb();
    const actor = actorWallet.toLowerCase();

    const { data: member } = await (db as any)
        .from('clan_members')
        .select('role')
        .eq('clan_id', clanId)
        .eq('wallet_address', actor)
        .maybeSingle();

    if (!member || !['commander', 'officer'].includes(member.role)) {
        throw new ClanServiceError('Only commanders and officers can update clan settings', 403);
    }

    if (typeof updates.treasury_public === 'boolean' && member.role !== 'commander') {
        throw new ClanServiceError('Only the clan commander can change treasury visibility', 403);
    }

    const payload: Record<string, unknown> = {};
    if (typeof updates.bio === 'string') payload.bio = updates.bio.trim().slice(0, 200);
    if (updates.join_policy) payload.join_policy = updates.join_policy;
    if (typeof updates.min_rxp === 'number') payload.min_rxp = Math.max(0, updates.min_rxp);
    if (typeof updates.min_level === 'number') payload.min_level = Math.max(1, updates.min_level);
    if (typeof updates.farcaster_channel === 'string') {
        payload.farcaster_channel = updates.farcaster_channel.trim().slice(0, 64);
    }
    if (typeof updates.treasury_public === 'boolean') {
        payload.treasury_public = updates.treasury_public;
    }

    if (Object.keys(payload).length === 0) return;

    const { error } = await (db as any)
        .from('clans')
        .update(payload)
        .eq('id', clanId);

    if (error) throw new ClanServiceError(error.message, 500);
}

/**
 * Fetch recent treasury ledger entries for a clan.
 */
export async function getClanTreasuryLedger(clanId: string, limit = 25): Promise<ClanTreasuryLedgerEntry[]> {
    const db = serviceDb();
    const { data, error } = await (db as any)
        .from('clan_treasury_ledger')
        .select('*')
        .eq('clan_id', clanId)
        .order('created_at', { ascending: false })
        .limit(limit);

    if (error) throw new ClanServiceError(error.message, 500);
    return (data || []) as ClanTreasuryLedgerEntry[];
}

/**
 * Verify that `logs` contain a matching `ClanTreasuryFunded` event from `claimContract`.
 * Exported for unit testing.
 */
export function verifyTreasuryFundedLog(params: {
    logs: Log[];
    claimContract: string;
    clanId: Hex;
    contributor: string;
    minAmountWei: bigint;
}): void {
    const decoded = parseEventLogs({
        abi: CLAN_CLAIM_DEPOSIT_ABI,
        logs: params.logs,
        eventName: 'ClanTreasuryFunded',
    });

    const contractLower = params.claimContract.toLowerCase();
    const contributorLower = params.contributor.toLowerCase();

    const match = decoded.find((l) => {
        const args = l.args as { clanId?: Hex; contributor?: string; amount?: bigint };
        return (
            l.address.toLowerCase() === contractLower &&
            args.clanId?.toLowerCase() === params.clanId.toLowerCase() &&
            args.contributor?.toLowerCase() === contributorLower &&
            (args.amount ?? BigInt(0)) >= params.minAmountWei
        );
    });

    if (!match) {
        throw new ClanServiceError(
            'Transaction receipt does not match a ClanClaim.fundTreasury deposit',
            400,
        );
    }
}

/**
 * Credit a verified on-chain `ClanClaim.fundTreasury` donation to the clan treasury.
 */
export async function fundClanTreasuryWithTx(params: {
    clanId: string;
    walletAddress: string;
    amountChips: number;
    txHash: string;
}): Promise<{ treasuryBalance: number }> {
    const db = serviceDb();
    const wallet = params.walletAddress.toLowerCase();
    const txHash = params.txHash.trim();

    if (!Number.isFinite(params.amountChips) || params.amountChips <= 0) {
        throw new ClanServiceError('Positive CHIPS amount required', 400);
    }
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
        throw new ClanServiceError('Invalid transaction hash format', 400);
    }

    const { data: member } = await (db as any)
        .from('clan_members')
        .select('id')
        .eq('clan_id', params.clanId)
        .eq('wallet_address', wallet)
        .maybeSingle();

    if (!member) {
        throw new ClanServiceError('Only clan members can fund this clan treasury', 403);
    }

    const { data: usedTx } = await (db as any)
        .from('chips_events')
        .select('tx_hash')
        .eq('chain_id', 84532)
        .eq('tx_hash', txHash)
        .eq('event_name', 'ClanTreasuryFunded')
        .maybeSingle();

    if (usedTx) {
        throw new ClanServiceError('This transaction has already been credited', 409, 'TRANSACTION_ALREADY_USED');
    }

    const claimContract = clanClaimAddress() || DEFAULT_CLAN_CLAIM_ADDRESS;
    const clanIdBytes32 = keccak256(toBytes(params.clanId));
    const expectedWei = parseUnits(String(params.amountChips), 18);

    const receipt = await waitForConfirmedReceipt(
        txHash,
        (msg, status = 400) => new ClanServiceError(msg, status),
    );

    verifyTreasuryFundedLog({
        logs: receipt.logs,
        claimContract,
        clanId: clanIdBytes32,
        contributor: wallet,
        minAmountWei: expectedWei,
    });

    try {
        await (db as any).from('chips_events').upsert({
            chain_id: 84532,
            tx_hash: txHash,
            log_index: 0,
            event_name: 'ClanTreasuryFunded',
            wallet_address: wallet,
            amount: expectedWei.toString(),
            memo_bytes32: clanIdBytes32,
            payload: { clanId: params.clanId, amountChips: params.amountChips },
        }, { onConflict: 'chain_id,tx_hash,log_index' });
    } catch {
        // Best-effort audit insert
    }

    const { data: newBal, error } = await (db as any).rpc('clan_credit_treasury_donation', {
        p_clan_id: params.clanId,
        p_wallet: wallet,
        p_amount: params.amountChips,
        p_tx_hash: txHash,
    });

    if (error) throw new ClanServiceError(error.message, 500);
    return { treasuryBalance: Number(newBal ?? 0) };
}

/**
 * Compute real Clan Missions (Daily Contracts + Weekly Objectives) and Sunday Weekly Vault status
 * from authoritative database progress (`clan_members`, `clan_mission_progress`, `clans`).
 */
export async function getClanMissionsAndVault(
    clanId: string,
    walletAddress: string,
): Promise<{
    contracts: ClanMissionContract[];
    weeklyVault: ClanWeeklyVaultSummary;
}> {
    const db = serviceDb();
    const wallet = walletAddress.toLowerCase();
    const clan = await getClan(clanId);
    if (!clan) throw new ClanServiceError('Clan not found', 404);

    const now = new Date();
    const dayKey = now.toISOString().slice(0, 10);

    // ISO week start / Sunday 23:59:59 UTC unlock timestamp
    const utcDay = now.getUTCDay(); // 0=Sun..6=Sat
    const daysUntilSun = utcDay === 0 ? 0 : 7 - utcDay;
    const sundayEnd = new Date(Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() + daysUntilSun,
        23, 59, 59,
    ));

    const [{ data: members }, { data: progressRows }] = await Promise.all([
        (db as any)
            .from('clan_members')
            .select('wallet_address, weekly_cxp, war_points')
            .eq('clan_id', clanId),
        (db as any)
            .from('clan_mission_progress')
            .select('mission_key, progress, target, completed_at')
            .eq('clan_id', clanId)
            .eq('wallet_address', wallet)
            .eq('period_key', dayKey),
    ]);

    const memberList = (members || []) as Array<{ wallet_address: string; weekly_cxp: number; war_points: number }>;
    const weeklyClanCxp = memberList.reduce((sum, m) => sum + Number(m.weekly_cxp || 0), 0);
    const activeMembers = Math.max(
        10,
        memberList.filter((m) => Number(m.weekly_cxp || 0) > 0).length,
    );

    const TIER_DEFS = [
        { tier: 1, minClanLevel: 1, mult: 150, chipsPerMember: 10 },
        { tier: 2, minClanLevel: 1, mult: 350, chipsPerMember: 25 },
        { tier: 3, minClanLevel: 1, mult: 600, chipsPerMember: 50 },
        { tier: 4, minClanLevel: 4, mult: 900, chipsPerMember: 90 },
        { tier: 5, minClanLevel: 7, mult: 1300, chipsPerMember: 150 },
    ];

    const tiers = TIER_DEFS.map((t) => {
        const thresholdCxp = t.mult * activeMembers;
        const unlocked = clan.level >= t.minClanLevel;
        const reached = unlocked && weeklyClanCxp >= thresholdCxp;
        return {
            tier: t.tier,
            minClanLevel: t.minClanLevel,
            thresholdCxp,
            chipsPerMember: t.chipsPerMember,
            unlocked,
            reached,
        };
    });

    const reachedTiers = tiers.filter((t) => t.reached);
    const currentTierObj = reachedTiers.length > 0 ? reachedTiers[reachedTiers.length - 1] : null;
    const nextTierObj = tiers.find((t) => !t.reached && t.unlocked) || tiers.find((t) => !t.reached) || null;

    const progressMap = new Map<string, { progress: number; target: number; completed_at: string | null }>();
    for (const r of progressRows || []) {
        progressMap.set(String(r.mission_key), {
            progress: Number(r.progress || 0),
            target: Number(r.target || 0),
            completed_at: r.completed_at || null,
        });
    }

    const me = memberList.find((m) => m.wallet_address.toLowerCase() === wallet);
    const myWeeklyCxp = Number(me?.weekly_cxp || 0);
    const myWarPts = Number(me?.war_points || 0);

    const dailyDefs: Array<{ key: string; title: string; target: number; rewardCxp: number; fallbackProgress: number }> = [
        {
            key: 'daily_online_matches_3',
            title: 'Play 3 Online Matches',
            target: 3,
            rewardCxp: 20,
            fallbackProgress: Math.min(3, Math.floor(myWeeklyCxp / 15)),
        },
        {
            key: 'daily_captures_5',
            title: 'Capture 5 Opponent Pawns',
            target: 5,
            rewardCxp: 30,
            fallbackProgress: 0,
        },
        {
            key: 'daily_clan_war_points',
            title: 'Earn 3 War Points in Clan Combat',
            target: 3,
            rewardCxp: 50,
            fallbackProgress: Math.min(3, myWarPts),
        },
    ];

    const contracts: ClanMissionContract[] = dailyDefs.map((d) => {
        const row = progressMap.get(d.key);
        const progress = Math.min(d.target, row ? row.progress : d.fallbackProgress);
        return {
            key: d.key,
            title: d.title,
            scope: 'daily',
            rewardCxp: d.rewardCxp,
            progress,
            target: d.target,
            completed: Boolean(row?.completed_at) || progress >= d.target,
        };
    });

    // Add one weekly collective clan objective derived from real clan members' weekly CXP
    const weeklyTarget = 6 * activeMembers;
    const weeklyContrib = memberList.filter((m) => Number(m.weekly_cxp || 0) >= 30).length;
    contracts.push({
        key: 'weekly_active_syndicate',
        title: `Collective Weekly CXP (${weeklyClanCxp.toLocaleString()} / ${(150 * activeMembers).toLocaleString()})`,
        scope: 'weekly',
        rewardCxp: 500,
        progress: Math.min(weeklyTarget, weeklyContrib),
        target: weeklyTarget,
        completed: weeklyClanCxp >= 150 * activeMembers,
    });

    return {
        contracts,
        weeklyVault: {
            weeklyClanCxp,
            activeMembers,
            currentTier: currentTierObj?.tier ?? 0,
            nextTier: nextTierObj?.tier ?? null,
            nextTierTargetCxp: nextTierObj?.thresholdCxp ?? null,
            rewardPerMemberChips: currentTierObj?.chipsPerMember ?? 0,
            unlocksAtUtc: sundayEnd.toISOString(),
            tiers,
        },
    };
}

/**
 * Escalating CHIPS fee for clan rebranding:
 * 1st rename (renameCount=0): 2,000 CHIPS
 * 2nd rename (renameCount=1): 3,000 CHIPS
 * 3rd rename (renameCount=2): 5,000 CHIPS
 * 4th rename (renameCount=3): 8,000 CHIPS ... (Fibonacci progression)
 */
export function getClanRenameFeeChips(renameCount: number): number {
    const count = Math.max(0, Math.floor(Number(renameCount) || 0));
    if (count === 0) return 2000;
    if (count === 1) return 3000;
    let prev = 2000;
    let curr = 3000;
    for (let i = 2; i <= count; i++) {
        const next = prev + curr;
        prev = curr;
        curr = next;
    }
    return curr;
}

/**
 * Update clan crest customization (commander or officer).
 */
export async function updateClanCrest(
    clanId: string,
    actorWallet: string,
    crest: Partial<ClanCrest>,
): Promise<ClanCrest> {
    const db = serviceDb();
    const actor = actorWallet.toLowerCase();

    const [{ data: member }, { data: clan }] = await Promise.all([
        (db as any)
            .from('clan_members')
            .select('role')
            .eq('clan_id', clanId)
            .eq('wallet_address', actor)
            .maybeSingle(),
        (db as any)
            .from('clans')
            .select('id, crest, status')
            .eq('id', clanId)
            .eq('status', 'active')
            .maybeSingle(),
    ]);

    if (!clan) throw new ClanServiceError('Clan not found', 404);
    if (!member || !['commander', 'officer'].includes(member.role)) {
        throw new ClanServiceError('Only commanders and officers can update the clan crest', 403);
    }

    const existing = (clan.crest || {}) as ClanCrest;
    const nextCrest: ClanCrest = {
        ...existing,
        emblem: typeof crest.emblem === 'string' && crest.emblem.trim()
            ? crest.emblem.trim().slice(0, 24)
            : (existing.emblem || 'shield'),
        primary: typeof crest.primary === 'string' && /^#[0-9a-fA-F]{6}$/.test(crest.primary.trim())
            ? crest.primary.trim()
            : (existing.primary || '#00E5FF'),
        secondary: typeof crest.secondary === 'string' && /^#[0-9a-fA-F]{6}$/.test(crest.secondary.trim())
            ? crest.secondary.trim()
            : (existing.secondary || '#0D1117'),
    };

    const { error } = await (db as any)
        .from('clans')
        .update({ crest: nextCrest })
        .eq('id', clanId);

    if (error) throw new ClanServiceError(error.message, 500);
    return nextCrest;
}

/**
 * Rebrand clan name and/or tag (commander-only, escalating CHIPS fee on-chain).
 */
export async function renameClan(params: {
    clanId: string;
    commanderWallet: string;
    newName?: string;
    newTag?: string;
    txHash: string;
}): Promise<{ name: string; tag: string; rename_count: number; nextRenameFeeChips: number }> {
    const db = serviceDb();
    const actor = params.commanderWallet.toLowerCase();

    const [{ data: member }, { data: clan }] = await Promise.all([
        (db as any)
            .from('clan_members')
            .select('role')
            .eq('clan_id', params.clanId)
            .eq('wallet_address', actor)
            .maybeSingle(),
        (db as any)
            .from('clans')
            .select('*')
            .eq('id', params.clanId)
            .eq('status', 'active')
            .maybeSingle(),
    ]);

    if (!clan) throw new ClanServiceError('Clan not found', 404);
    if (!member || member.role !== 'commander') {
        throw new ClanServiceError('Only the clan commander can rebrand the clan', 403);
    }

    const nextName = typeof params.newName === 'string' && params.newName.trim()
        ? params.newName.trim()
        : String(clan.name);
    const nextTag = typeof params.newTag === 'string' && params.newTag.trim()
        ? params.newTag.trim().toUpperCase()
        : String(clan.tag).toUpperCase();

    if (nextName === clan.name && nextTag === clan.tag) {
        throw new ClanServiceError('New name or tag must differ from current identity', 400);
    }
    if (nextName.length < 3 || nextName.length > 24) {
        throw new ClanServiceError('Clan name must be between 3 and 24 characters', 400);
    }
    if (nextTag.length < 2 || nextTag.length > 5 || !/^[A-Z0-9]+$/.test(nextTag)) {
        throw new ClanServiceError('Clan tag must be 2–5 alphanumeric characters', 400);
    }

    const [nameClash, tagClash] = await Promise.all([
        nextName.toLowerCase() !== String(clan.name).toLowerCase()
            ? (db as any).from('clans').select('id').ilike('name', nextName).neq('id', params.clanId).limit(1).maybeSingle()
            : Promise.resolve({ data: null }),
        nextTag !== String(clan.tag).toUpperCase()
            ? (db as any).from('clans').select('id').eq('tag', nextTag).neq('id', params.clanId).limit(1).maybeSingle()
            : Promise.resolve({ data: null }),
    ]);

    if (nameClash?.data) {
        throw new ClanServiceError('That clan name is already taken', 409, 'NAME_OR_TAG_TAKEN');
    }
    if (tagClash?.data) {
        throw new ClanServiceError('That clan tag is already taken', 409, 'NAME_OR_TAG_TAKEN');
    }

    const currentRenameCount = Math.max(0, Number(clan.rename_count || 0));
    const requiredChips = getClanRenameFeeChips(currentRenameCount);
    const requiredWei = BigInt(requiredChips) * (BigInt(10) ** BigInt(18));

    const txHash = params.txHash?.trim();
    if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
        throw new ClanServiceError(
            `Confirmed on-chain transaction (${requiredChips.toLocaleString()} CHIPS) is required`,
            400,
        );
    }

    // Prevent transaction hash reuse
    const { data: priorEvent } = await (db as any)
        .from('chips_events')
        .select('tx_hash')
        .eq('chain_id', 84532)
        .eq('tx_hash', txHash)
        .limit(1)
        .maybeSingle();

    if (priorEvent) {
        throw new ClanServiceError('This transaction hash has already been used', 409, 'TX_ALREADY_USED');
    }

    const tokenAddress = (chipsAddress() || DEFAULT_CHIPS_CONTRACT) as Address;
    const receipt = await waitForConfirmedReceipt(
        txHash as Hex,
        (msg, status = 400) => new ClanServiceError(msg, status),
    );
    verifyErc20TransferLog({
        logs: receipt.logs,
        tokenContract: tokenAddress,
        expectedFrom: actor,
        expectedTo: PROTOCOL_TREASURY_WALLET,
        minAmountWei: requiredWei,
        makeError: (msg, status = 400) => new ClanServiceError(msg, status),
    });

    const nextCount = currentRenameCount + 1;
    const { error: updErr } = await (db as any)
        .from('clans')
        .update({
            name: nextName,
            tag: nextTag,
            rename_count: nextCount,
        })
        .eq('id', params.clanId);

    if (updErr) {
        if (updErr.code === '23505') {
            throw new ClanServiceError('A clan with this name or tag already exists', 409, 'NAME_OR_TAG_TAKEN');
        }
        throw new ClanServiceError(updErr.message, 500);
    }

    try {
        await (db as any)
            .from('chips_events')
            .upsert({
                chain_id: 84532,
                tx_hash: txHash,
                log_index: 0,
                event_name: 'ClanRenamedOnChain',
                wallet_address: actor,
                amount: requiredWei.toString(),
                payload: {
                    clanId: params.clanId,
                    previousName: clan.name,
                    previousTag: clan.tag,
                    newName: nextName,
                    newTag: nextTag,
                    renameCount: nextCount,
                    treasury: PROTOCOL_TREASURY_WALLET,
                },
            }, { onConflict: 'chain_id,tx_hash,log_index' });
    } catch {
        // Best-effort audit insert
    }

    return {
        name: nextName,
        tag: nextTag,
        rename_count: nextCount,
        nextRenameFeeChips: getClanRenameFeeChips(nextCount),
    };
}

/**
 * Pure analytics aggregator for Clan Profile Dossier (exported for unit tests).
 */
export function buildClanDossierAnalytics(params: {
    clan: Clan;
    members: ClanMember[];
    wars: ClanWar[];
    opponentMap: Record<string, { name: string; tag: string; crest: ClanCrest }>;
    fixtures: ClanWarFixture[];
    ledger: ClanTreasuryLedgerEntry[];
    levelConfigs: ClanLevelConfig[];
    viewerWallet?: string | null;
}): ClanProfileDossier {
    const { clan, members, wars, opponentMap, fixtures, ledger, levelConfigs } = params;
    const viewer = params.viewerWallet?.toLowerCase() ?? null;
    const viewerMember = viewer
        ? members.find((m) => m.wallet_address.toLowerCase() === viewer) ?? null
        : null;
    const viewerIsMember = Boolean(viewerMember);
    const canViewTreasury = Boolean(clan.treasury_public) || viewerIsMember;

    const renameCount = Math.max(0, Number(clan.rename_count || 0));
    const renameFeeChips = getClanRenameFeeChips(renameCount);
    const nextRenameFeeChips = getClanRenameFeeChips(renameCount + 1);

    // Sort wars chronologically (oldest -> newest) for streaks & CWR trajectory
    const resolvedWars = [...wars]
        .filter((w) => w.status === 'completed' || w.status === 'draw_refunded')
        .sort((a, b) => new Date(a.war_end_at).getTime() - new Date(b.war_end_at).getTime());

    let wins = 0;
    let losses = 0;
    let draws = 0;
    let currentStreak = 0;
    let bestStreak = 0;
    const recentForm: Array<'W' | 'L' | 'D'> = [];
    const warHistory: ClanWarHistoryEntry[] = [];

    // Build CWR curve backward from clan.cwr so final point matches live DB value
    const warOutcomes: Array<{
        war: ClanWar;
        outcome: 'win' | 'loss' | 'draw';
        ourPoints: number;
        opponentPoints: number;
        cwrDelta: number;
    }> = [];

    for (const w of resolvedWars) {
        const isClanA = w.clan_a_id === clan.id;
        const ourPoints = isClanA ? Number(w.clan_a_score || 0) : Number(w.clan_b_score || 0);
        const oppPoints = isClanA ? Number(w.clan_b_score || 0) : Number(w.clan_a_score || 0);
        let outcome: 'win' | 'loss' | 'draw' = 'draw';
        if (w.status === 'draw_refunded' || !w.winner_clan_id) {
            outcome = 'draw';
            draws += 1;
            currentStreak = 0;
            recentForm.push('D');
        } else if (w.winner_clan_id === clan.id) {
            outcome = 'win';
            wins += 1;
            currentStreak += 1;
            if (currentStreak > bestStreak) bestStreak = currentStreak;
            recentForm.push('W');
        } else {
            outcome = 'loss';
            losses += 1;
            currentStreak = 0;
            recentForm.push('L');
        }
        const cwrDelta = outcome === 'win' ? 24 : outcome === 'loss' ? -18 : 2;
        warOutcomes.push({ war: w, outcome, ourPoints, opponentPoints: oppPoints, cwrDelta });
    }

    const totalNetDelta = warOutcomes.reduce((acc, row) => acc + row.cwrDelta, 0);
    let runningCwr = Math.max(100, Number(clan.cwr || 1000) - totalNetDelta);
    const cwrHistory: ClanCwrPoint[] = [
        {
            label: 'Base',
            cwr: runningCwr,
            delta: 0,
            outcome: 'B',
            timestamp: clan.created_at,
        },
    ];

    for (let i = 0; i < warOutcomes.length; i++) {
        const { war, outcome, ourPoints, opponentPoints, cwrDelta } = warOutcomes[i];
        runningCwr = Math.max(100, runningCwr + cwrDelta);
        const oppId = war.clan_a_id === clan.id ? war.clan_b_id : war.clan_a_id;
        const opp = opponentMap[oppId] || {
            name: 'Rival Syndicate',
            tag: 'RIVAL',
            crest: { emblem: 'shield', primary: '#94A3B8', secondary: '#0D1117' },
        };

        const stakePerPlayer = Math.round(Number(war.stake_per_clan || 0) / Math.max(1, Number(war.bracket || 5)));
        const netChipsDelta = canViewTreasury
            ? outcome === 'win'
                ? Math.round(Number(war.stake_per_clan || 0) * 0.12)
                : outcome === 'loss'
                    ? 0
                    : 0
            : 0;

        cwrHistory.push({
            label: `#${i + 1}`,
            cwr: runningCwr,
            delta: cwrDelta,
            outcome: outcome === 'win' ? 'W' : outcome === 'loss' ? 'L' : 'D',
            timestamp: war.war_end_at,
        });

        warHistory.push({
            id: war.id,
            opponentId: oppId,
            opponentName: opp.name,
            opponentTag: opp.tag,
            opponentCrest: opp.crest,
            stakePerPlayer,
            outcome,
            ourPoints,
            opponentPoints,
            cwrDelta,
            netChipsDelta,
            resolvedAt: war.war_end_at,
        });
    }

    // Reverse warHistory so newest appears first in UI table
    warHistory.reverse();

    // Fixture shape breakdown (1v1 vs 2v2)
    let played1v1 = 0;
    let wins1v1 = 0;
    let played2v2 = 0;
    let wins2v2 = 0;
    for (const f of fixtures) {
        if (f.status !== 'completed' && f.status !== 'walkover') continue;
        const won = f.winner_clan_id === clan.id;
        if (f.game_shape === '1v1') {
            played1v1 += 1;
            if (won) wins1v1 += 1;
        } else {
            played2v2 += 1;
            if (won) wins2v2 += 1;
        }
    }

    const played = wins + losses + draws;
    const winRate = played > 0 ? Math.round((wins / played) * 100) : 0;

    // Top 5 contributors
    const topContributors: ClanContributorStat[] = [...members]
        .sort((a, b) => (Number(b.war_points || 0) * 10 + Number(b.total_cxp || 0))
            - (Number(a.war_points || 0) * 10 + Number(a.total_cxp || 0)))
        .slice(0, 5)
        .map((m) => ({
            wallet_address: m.wallet_address,
            username: m.player?.username ?? null,
            avatar_url: m.player?.avatar_url ?? null,
            rank_tier: m.player?.rank_tier ?? null,
            role: m.role,
            wp_earned: Number(m.war_points || 0),
            cxp_contributed: Number(m.total_cxp || 0),
            joined_at: m.joined_at,
        }));

    // Commander profile
    const leaderMember = members.find((m) => m.role === 'commander')
        || members.find((m) => m.wallet_address.toLowerCase() === clan.leader_wallet.toLowerCase());

    const leaderProfile = leaderMember
        ? {
            wallet_address: leaderMember.wallet_address,
            username: leaderMember.player?.username ?? null,
            avatar_url: leaderMember.player?.avatar_url ?? null,
            rank_tier: leaderMember.player?.rank_tier ?? null,
        }
        : {
            wallet_address: clan.leader_wallet,
            username: null,
            avatar_url: null,
            rank_tier: null,
        };

    // Treasury privacy gating
    let treasuryBreakdown: ClanProfileDossier['treasuryBreakdown'] = null;
    if (canViewTreasury) {
        let donations = 0;
        let warIncome = 0;
        let vaultGrants = 0;
        let expenses = 0;
        let warSubsidyOut = 0;

        for (const entry of ledger) {
            const amt = Number(entry.amount || 0);
            if (entry.reason === 'donation') donations += Math.max(0, amt);
            else if (entry.reason === 'war_cut' || entry.reason === 'subsidy_return') warIncome += Math.max(0, amt);
            else if (entry.reason === 'member_grant') {
                if (amt >= 0) vaultGrants += amt;
                else expenses += Math.abs(amt);
            } else {
                const abs = Math.abs(amt);
                if (amt < 0) {
                    expenses += abs;
                    if (entry.reason === 'war_subsidy' || entry.reason === 'stake_adjust_topup') {
                        warSubsidyOut += abs;
                    }
                } else {
                    donations += amt;
                }
            }
        }

        const totalInflows = donations + warIncome + vaultGrants;
        const totalOutflows = expenses;
        treasuryBreakdown = {
            balance: Number(clan.treasury_balance || 0),
            totalInflows,
            totalOutflows,
            warPnL: warIncome - warSubsidyOut,
            donations,
            warIncome,
            vaultGrants,
            expenses,
            recentLedger: ledger.slice(0, 15),
        };
    }

    const sortedLevels = [...levelConfigs].sort((a, b) => a.level - b.level);
    const levelConfig = sortedLevels.find((l) => l.level === clan.level) ?? null;
    const nextLevelConfig = sortedLevels.find((l) => l.level === clan.level + 1) ?? null;

    // Honor Medals (derived purely from public/combat/growth metrics so hidden treasury never leaks)
    const honors: ClanHonorMedal[] = [
        {
            id: 'first_blood',
            title: 'First Blood',
            subtitle: 'Win at least 1 Clan War',
            icon: 'crown',
            unlocked: wins >= 1,
            tier: 'common',
        },
        {
            id: 'unbroken_chain',
            title: 'Unbroken Chain',
            subtitle: 'Achieve a 3+ war win streak',
            icon: 'flame',
            unlocked: bestStreak >= 3,
            tier: 'rare',
        },
        {
            id: 'warlord_syndicate',
            title: 'Warlord Syndicate',
            subtitle: 'Complete 10+ ranked Clan Wars',
            icon: 'shield',
            unlocked: played >= 10,
            tier: 'rare',
        },
        {
            id: 'elite_elo',
            title: 'Apex Signal',
            subtitle: 'Reach 1,200+ Clan War Rating',
            icon: 'zap',
            unlocked: Number(clan.cwr || 1000) >= 1200,
            tier: 'legendary',
        },
        {
            id: 'syndicate_tier',
            title: 'Tier V Citadel',
            subtitle: 'Upgrade Syndicate to Level 5+',
            icon: 'vault',
            unlocked: Number(clan.level || 1) >= 5,
            tier: 'rare',
        },
        {
            id: 'full_garrison',
            title: 'Full Garrison',
            subtitle: 'Muster 10+ active operatives',
            icon: 'award',
            unlocked: Number(clan.member_count || members.length) >= 10,
            tier: 'common',
        },
    ];

    const sanitizedClan: Clan = canViewTreasury
        ? clan
        : { ...clan, treasury_balance: 0 };

    return {
        clan: sanitizedClan,
        viewerRole: viewerMember?.role ?? null,
        viewerIsMember,
        canViewTreasury,
        renameFeeChips,
        nextRenameFeeChips,
        levelConfig,
        nextLevelConfig,
        leaderProfile,
        cwrHistory,
        warRecord: {
            played,
            wins,
            losses,
            draws,
            winRate,
            currentStreak,
            bestStreak,
            recentForm: recentForm.slice(-8),
        },
        shapeStats: {
            shape1v1: {
                played: played1v1,
                wins: wins1v1,
                winRate: played1v1 > 0 ? Math.round((wins1v1 / played1v1) * 100) : 0,
            },
            shape2v2: {
                played: played2v2,
                wins: wins2v2,
                winRate: played2v2 > 0 ? Math.round((wins2v2 / played2v2) * 100) : 0,
            },
        },
        topContributors,
        members,
        levelRoadmap: sortedLevels,
        honors,
        treasuryBreakdown,
        warHistory,
    };
}

/**
 * Fetch comprehensive Clan Profile Dossier by UUID or uppercase tag.
 * Respects `clan.treasury_public` when viewer is not a clan member.
 */
export async function getClanProfileDossier(
    targetIdOrTag: string,
    viewerWallet?: string | null,
): Promise<ClanProfileDossier | null> {
    const trimmed = targetIdOrTag.trim();
    if (!trimmed) return null;

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed);
    const clan = isUuid ? await getClan(trimmed) : await getClanByTag(trimmed.toUpperCase());
    if (!clan) return null;

    const db = serviceDb();
    const viewer = viewerWallet?.toLowerCase() ?? null;

    const [members, levelConfigRes, warsRes] = await Promise.all([
        getClanMembers(clan.id),
        (db as any).from('clan_level_config').select('*').order('level', { ascending: true }),
        (db as any)
            .from('clan_wars')
            .select('*')
            .or(`clan_a_id.eq.${clan.id},clan_b_id.eq.${clan.id}`)
            .order('created_at', { ascending: false })
            .limit(40),
    ]);

    const viewerIsMember = viewer
        ? members.some((m) => m.wallet_address.toLowerCase() === viewer)
        : false;
    const canViewTreasury = Boolean(clan.treasury_public) || viewerIsMember;

    const wars = (warsRes.data || []) as ClanWar[];
    const warIds = wars.map((w) => w.id);
    const oppIds = Array.from(
        new Set(wars.map((w) => (w.clan_a_id === clan.id ? w.clan_b_id : w.clan_a_id))),
    );

    const [opponentsRes, fixturesRes, ledger] = await Promise.all([
        oppIds.length > 0
            ? (db as any).from('clans').select('id, name, tag, crest').in('id', oppIds)
            : Promise.resolve({ data: [] }),
        warIds.length > 0
            ? (db as any).from('clan_war_fixtures').select('*').in('war_id', warIds)
            : Promise.resolve({ data: [] }),
        canViewTreasury
            ? getClanTreasuryLedger(clan.id, 100)
            : Promise.resolve([] as ClanTreasuryLedgerEntry[]),
    ]);

    const opponentMap: Record<string, { name: string; tag: string; crest: ClanCrest }> = {};
    for (const o of (opponentsRes.data || []) as any[]) {
        opponentMap[o.id] = {
            name: o.name,
            tag: o.tag,
            crest: (o.crest || { emblem: 'shield', primary: '#94A3B8', secondary: '#0D1117' }) as ClanCrest,
        };
    }

    return buildClanDossierAnalytics({
        clan,
        members,
        wars,
        opponentMap,
        fixtures: (fixturesRes.data || []) as ClanWarFixture[],
        ledger,
        levelConfigs: (levelConfigRes.data || []) as ClanLevelConfig[],
        viewerWallet: viewer,
    });
}

