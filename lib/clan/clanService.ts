/* eslint-disable @typescript-eslint/no-explicit-any */
import { serviceDb } from '@/lib/serverAuth';
import type {
    Clan,
    ClanMember,
    ClanJoinRequest,
    ClanRole,
    ClanJoinPolicy,
    ClanCrest,
    ClanLevelConfig,
} from './types';

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

    return {
        clans: (data || []) as Clan[],
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

    const { data: clanId, error } = await (db as any).rpc('clan_create_with_escrow', {
        p_leader_wallet: leader,
        p_name: name,
        p_tag: tag,
        p_bio: params.bio?.trim() || null,
        p_crest: crestJson,
    });

    if (error) {
        if (error.message.includes('insufficient_escrow')) {
            throw new ClanServiceError('Insufficient CHIPS in escrow (10,000 CHIPS required to create a clan)', 402, 'INSUFFICIENT_ESCROW');
        }
        if (error.message.includes('already in a clan')) {
            throw new ClanServiceError('You are already a member of a clan', 409);
        }
        if (error.code === '23505') {
            throw new ClanServiceError('A clan with this name or tag already exists', 409, 'NAME_OR_TAG_TAKEN');
        }
        throw new ClanServiceError(error.message, 500);
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

        await (db as any)
            .from('clans')
            .update({ member_count: clan.member_count + 1 })
            .eq('id', clanId);

        // Delete any pending requests
        await (db as any)
            .from('clan_join_requests')
            .delete()
            .eq('wallet_address', wallet);

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

    await (db as any)
        .from('clans')
        .update({ member_count: clan.member_count + 1 })
        .eq('id', clanId);

    await (db as any)
        .from('clan_join_requests')
        .update({ status: 'accepted' })
        .eq('clan_id', clanId)
        .eq('wallet_address', target);
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
        await (db as any)
            .from('clans')
            .update({ member_count: Math.max(0, clan.member_count - 1) })
            .eq('id', clanId);
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

    await (db as any)
        .from('clans')
        .update({ member_count: Math.max(0, clan.member_count - 1) })
        .eq('id', clanId);
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
 * Update clan settings (bio, join policy, minimum requirements).
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

    const payload: Record<string, unknown> = {};
    if (typeof updates.bio === 'string') payload.bio = updates.bio.trim().slice(0, 200);
    if (updates.join_policy) payload.join_policy = updates.join_policy;
    if (typeof updates.min_rxp === 'number') payload.min_rxp = Math.max(0, updates.min_rxp);
    if (typeof updates.min_level === 'number') payload.min_level = Math.max(1, updates.min_level);
    if (typeof updates.farcaster_channel === 'string') {
        payload.farcaster_channel = updates.farcaster_channel.trim().slice(0, 64);
    }

    if (Object.keys(payload).length === 0) return;

    const { error } = await (db as any)
        .from('clans')
        .update(payload)
        .eq('id', clanId);

    if (error) throw new ClanServiceError(error.message, 500);
}
