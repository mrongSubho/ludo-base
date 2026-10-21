/**
 * Server-side onboarding progress writers (match / social / return visits).
 * Service-role only — claim flags stay server-owned (see lib/onboardingServer.ts).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.types';
import {
    ONBOARDING_TRACKS,
    isOnboardingTrack,
    type OnboardingTrack,
} from './onboardingServer';
import { reportProgress } from '@/lib/missionOracle';

type Db = SupabaseClient<Database>;

/** Upsert a track increment, clamped to target. Never touches is_claimed. */
export async function bumpOnboardingProgress(
    db: Db,
    wallet: string,
    track: OnboardingTrack | string,
    delta = 1,
): Promise<void> {
    if (!isOnboardingTrack(track)) return;
    const walletAddress = String(wallet || '').toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(walletAddress)) return;
    const def = ONBOARDING_TRACKS[track];
    const step = Number.isFinite(delta) && delta > 0 ? Math.floor(delta) : 1;

    const { data: existing, error: readError } = await db
        .from('onboarding_progress')
        .select('progress, target, is_claimed')
        .eq('wallet_address', walletAddress)
        .eq('track', track)
        .maybeSingle();
    if (readError) {
        console.error('[onboarding] read failed', track, readError.message);
        return;
    }

    const prev = existing?.progress ?? 0;
    const target = existing?.target && existing.target > 0 ? existing.target : def.target;
    const progress = Math.min(prev + step, target);
    if (progress === prev) return;
    // On-chain mirror: report the same delta to MissionSystem (no-op until configured).
    void reportProgress(walletAddress, String(track), step);

    const { error: upsertError } = await db.from('onboarding_progress').upsert(
        {
            wallet_address: walletAddress,
            track,
            progress,
            target,
            is_claimed: existing?.is_claimed ?? false,
            updated_at: new Date().toISOString(),
        },
        { onConflict: 'wallet_address,track' },
    );
    if (upsertError) {
        console.error('[onboarding] upsert failed', track, upsertError.message);
    }
}

/** Map classic/power/snakes to onboarding core tracks (first completion counts). */
export function aiTrackForGameMode(gameMode: string | null | undefined): OnboardingTrack | null {
    const mode = String(gameMode || '').toLowerCase();
    if (mode === 'power') return 'ai_power';
    if (mode === 'snakes') return 'ai_snakes';
    if (mode === 'classic') return 'ai_classic';
    return null;
}

/** UTC day index — one integer per calendar day, so day maths cannot drift. */
function dayIndex(iso: string | null | undefined): number | null {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86_400_000);
}

export type OnboardingPlayerSnapshot = {
    wallet_address: string;
    created_at: string | null;
    last_played_at: string | null;
};

/**
 * After a recorded online match: pvp + return-day tracks for every participant.
 * AI / tutorial / playtime stay client-driven (offline path) via /api/onboarding/progress.
 *
 * Batched deliberately: this runs on the match-settlement path, where the old
 * per-wallet shape cost 3–7 round trips each (a select + upsert per track, plus
 * a players read per wallet). Now it is at most one read and one upsert for the
 * whole match, whatever the seat count.
 */
export async function recordMatchOnboarding(
    db: Db,
    args: {
        participants: string[];
        gameMode?: string | null;
        /** True when the human finished a bot/offline board that the client reports. */
        versusAi?: boolean;
        /**
         * `players` rows as they were BEFORE the caller wrote progression.
         * `recordReturnVisit` needs the pre-match `last_played_at`; when the
         * caller omits this, it is read here (one extra query, same values).
         */
        preUpdatePlayers?: OnboardingPlayerSnapshot[];
    },
): Promise<void> {
    const parts = [...new Set((args.participants || [])
        .map((p) => String(p || '').toLowerCase())
        .filter((p) => /^0x[a-f0-9]{40}$/.test(p)))];
    if (parts.length === 0) return;

    const now = new Date();
    const aiTrack = args.versusAi ? aiTrackForGameMode(args.gameMode) : null;

    // 1. What each wallet earns from *this* match.
    const earned = new Map<string, Set<OnboardingTrack>>();
    for (const wallet of parts) {
        const tracks = new Set<OnboardingTrack>();
        if (aiTrack) tracks.add(aiTrack);
        else if (parts.length >= 2) tracks.add('pvp');
        earned.set(wallet, tracks);
    }

    // 2. Return-visit tracks (day2 / day3) from the PRE-update snapshot.
    const snapshot = new Map<string, OnboardingPlayerSnapshot>();
    for (const row of args.preUpdatePlayers ?? []) {
        snapshot.set(String(row.wallet_address || '').toLowerCase(), row);
    }
    if (parts.some((w) => !snapshot.has(w))) {
        const { data, error } = await db
            .from('players')
            .select('wallet_address, created_at, last_played_at')
            .in('wallet_address', parts);
        if (error) {
            console.error('[onboarding] player snapshot read failed', error.message);
        }
        for (const row of (data ?? []) as OnboardingPlayerSnapshot[]) {
            snapshot.set(String(row.wallet_address).toLowerCase(), row);
        }
    }

    const today = dayIndex(now.toISOString());
    for (const wallet of parts) {
        const row = snapshot.get(wallet);
        if (!row || today == null) continue;
        const createdDay = dayIndex(row.created_at);
        const lastDay = dayIndex(row.last_played_at);
        if (createdDay == null) continue;
        // First activity of the UTC day (last_played still on an older day, or never).
        if (lastDay != null && lastDay >= today) continue;
        const dayNumber = today - createdDay + 1; // 1-based day of life
        const tracks = earned.get(wallet)!;
        if (dayNumber >= 2) tracks.add('day2');
        if (dayNumber >= 3) tracks.add('day3');
    }

    const pairs = [...earned.entries()].flatMap(([wallet, tracks]) =>
        [...tracks].map((track) => ({ wallet, track })),
    );
    if (pairs.length === 0) return;

    // 3. One read of the current progress for every (wallet, track) pair.
    const { data: existing, error: readError } = await db
        .from('onboarding_progress')
        .select('wallet_address, track, progress, target, is_claimed')
        .in('wallet_address', parts)
        .in('track', [...new Set(pairs.map((p) => p.track))]);
    if (readError) {
        console.error('[onboarding] progress read failed', readError.message);
        return;
    }

    const existingByKey = new Map<string, { progress: number; target: number | null; is_claimed: boolean }>();
    for (const row of existing ?? []) {
        existingByKey.set(`${row.wallet_address}:${row.track}`, {
            progress: Number(row.progress || 0),
            target: row.target == null ? null : Number(row.target),
            is_claimed: Boolean(row.is_claimed),
        });
    }

    // 4. Clamp to target and write everything in one upsert.
    const rows: Array<{
        wallet_address: string;
        track: string;
        progress: number;
        target: number;
        is_claimed: boolean;
        updated_at: string;
    }> = [];
    for (const { wallet, track } of pairs) {
        const def = ONBOARDING_TRACKS[track];
        const prior = existingByKey.get(`${wallet}:${track}`);
        const prev = prior?.progress ?? 0;
        const target = prior?.target && prior.target > 0 ? prior.target : def.target;
        const progress = Math.min(prev + 1, target);
        if (progress === prev) continue;
        // On-chain mirror: same delta as the DB row (no-op until configured).
        void reportProgress(wallet, String(track), 1);
        rows.push({
            wallet_address: wallet,
            track,
            progress,
            target,
            is_claimed: prior?.is_claimed ?? false,
            updated_at: now.toISOString(),
        });
    }
    if (rows.length === 0) return;

    const { error: upsertError } = await db
        .from('onboarding_progress')
        .upsert(rows, { onConflict: 'wallet_address,track' });
    if (upsertError) {
        console.error('[onboarding] bulk upsert failed', upsertError.message);
    }
}

/**
 * day2 / day3: second and third distinct UTC calendar days with play activity.
 * Uses players.last_played_at (before this call updates it) + created_at day offset.
 */
export async function recordReturnVisit(db: Db, wallet: string): Promise<void> {
    const walletAddress = String(wallet || '').toLowerCase();
    const { data: player, error } = await db
        .from('players')
        .select('created_at, last_played_at')
        .ilike('wallet_address', walletAddress)
        .maybeSingle();
    if (error || !player) return;

    const today = dayIndex(new Date().toISOString());
    const createdDay = dayIndex(player.created_at);
    const lastDay = dayIndex(player.last_played_at);
    if (today == null || createdDay == null) return;

    // First activity of the UTC day (last_played still on an older day, or never).
    const firstToday = lastDay == null || lastDay < today;
    if (!firstToday) return;

    const dayNumber = today - createdDay + 1; // 1-based day of life
    if (dayNumber >= 2) await bumpOnboardingProgress(db, walletAddress, 'day2', 1);
    if (dayNumber >= 3) await bumpOnboardingProgress(db, walletAddress, 'day3', 1);
}

/** friend_dm + social: unique counterpart that day is enforced by callers. */
export async function recordSocialOnboarding(
    db: Db,
    wallet: string,
    track: 'social' | 'friend_dm' | 'clan',
    delta = 1,
): Promise<void> {
    await bumpOnboardingProgress(db, wallet, track, delta);
    // On-chain mirror: a friend DM also counts toward weekly_friend_dm_3.
    if (track === 'friend_dm') void reportProgress(wallet, 'weekly_friend_dm_3', delta);
}
