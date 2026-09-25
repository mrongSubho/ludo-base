/**
 * Server-side onboarding progress writers (match / social / return visits).
 * Service-role only — claim flags stay server-owned (see lib/onboardingServer.ts).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
    ONBOARDING_TRACKS,
    isOnboardingTrack,
    type OnboardingTrack,
} from './onboardingServer';

type Db = SupabaseClient;

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

/**
 * After a recorded online match: pvp + return-day tracks for every participant.
 * AI / tutorial / playtime stay client-driven (offline path) via /api/onboarding/progress.
 */
export async function recordMatchOnboarding(
    db: Db,
    args: {
        participants: string[];
        gameMode?: string | null;
        /** True when the human finished a bot/offline board that the client reports. */
        versusAi?: boolean;
    },
): Promise<void> {
    const parts = (args.participants || [])
        .map((p) => String(p || '').toLowerCase())
        .filter((p) => /^0x[a-f0-9]{40}$/.test(p));
    if (parts.length === 0) return;

    const aiTrack = args.versusAi ? aiTrackForGameMode(args.gameMode) : null;

    for (const wallet of parts) {
        if (aiTrack) {
            await bumpOnboardingProgress(db, wallet, aiTrack, 1);
        } else if (parts.length >= 2) {
            await bumpOnboardingProgress(db, wallet, 'pvp', 1);
        }
        await recordReturnVisit(db, wallet);
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

    const dayIndex = (iso: string | null | undefined) => {
        if (!iso) return null;
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return null;
        return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86_400_000);
    };

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
}
