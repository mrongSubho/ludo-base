/**
 * Onboarding / referral / Galxe server helpers (CHIPS_PLANNING 7.7).
 * Pure functions only — unit-testable without Supabase or Next runtime.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export type OnboardingTrack =
    | 'tutorial'
    | 'ai_classic'
    | 'ai_power'
    | 'ai_snakes'
    | 'pvp'
    | 'playtime'
    | 'social'
    | 'day2'
    | 'day3'
    | 'friend_dm'
    | 'clan';

export interface TrackDef {
    /** Progress units required to complete (playtime is minutes). */
    target: number;
    /** Whole CHIPS payout. */
    reward: number;
    label: string;
    /** Core package (A–E) gates the extended tracks. */
    core: boolean;
}

/** Targets/rewards mirror CHIPS_PLANNING 7.7 (core 1,000 + extended tiers). */
export const ONBOARDING_TRACKS: Record<OnboardingTrack, TrackDef> = {
    tutorial: { target: 1, reward: 100, label: 'Tutorial', core: true },
    ai_classic: { target: 1, reward: 100, label: 'AI Classic', core: true },
    ai_power: { target: 1, reward: 100, label: 'AI Power', core: true },
    ai_snakes: { target: 1, reward: 100, label: 'AI Snakes', core: true },
    pvp: { target: 1, reward: 150, label: 'First PvP', core: true },
    playtime: { target: 60, reward: 150, label: 'Playtime', core: true },
    social: { target: 4, reward: 300, label: 'Social', core: true },
    day2: { target: 1, reward: 50, label: 'Day 2 Return', core: false },
    day3: { target: 1, reward: 100, label: 'Day 3 Return', core: false },
    friend_dm: { target: 10, reward: 100, label: 'Friends + DM', core: false },
    clan: { target: 1, reward: 100, label: 'Clan Join', core: false },
};

export const ONBOARDING_TRACK_KEYS = Object.keys(ONBOARDING_TRACKS) as OnboardingTrack[];

/** One-time welcome grant (Phase-0 locked 50 CHIPS) — not a track row. */
export const WELCOME_GRANT_REWARD = 50;
export const WELCOME_GRANT_MISSION_ID = 'welcome_grant';

export const REFERRAL_SLOTS = 5000;
export const REFERRAL_TIER_WINNERS = 10;
export const REFERRAL_TIER_TOP = 50;
export const REFERRAL_TIER_TAIL = 10;

export function isOnboardingTrack(value: unknown): value is OnboardingTrack {
    return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ONBOARDING_TRACKS, value);
}

/**
 * HMAC-SHA256 over the raw request body (fail-closed).
 * Header may be hex or base64, optionally `sha256=`-prefixed.
 */
export function verifyGalxeHmac(
    rawBody: string,
    signatureHeader: string | null | undefined,
    secret: string | null | undefined,
): boolean {
    if (!rawBody || !signatureHeader || !secret) return false;
    const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest();
    const cleaned = signatureHeader.trim().replace(/^sha256=/i, '');
    if (!cleaned) return false;
    let provided: Buffer;
    if (/^[0-9a-fA-F]{64}$/.test(cleaned)) {
        provided = Buffer.from(cleaned, 'hex');
    } else {
        provided = Buffer.from(cleaned, 'base64');
    }
    if (provided.length !== expected.length || provided.length === 0) return false;
    return timingSafeEqual(provided, expected);
}

export interface OnboardingRow {
    progress: number;
    target: number;
    is_claimed: boolean;
}

export type ClaimCheck = { ok: true } | { ok: false; error: string; status: number };

/**
 * Claim gate for an onboarding track. `is_claimed` is server-owned — clients
 * can only request; they can never set or clear the flag.
 */
export function checkTrackClaimable(
    track: string,
    row: OnboardingRow | null | undefined,
    coreComplete: boolean,
): ClaimCheck {
    if (!isOnboardingTrack(track)) return { ok: false, error: 'Unknown track', status: 400 };
    if (!row) return { ok: false, error: 'Track not started', status: 400 };
    if (row.is_claimed) return { ok: false, error: 'Already claimed', status: 400 };
    const def = ONBOARDING_TRACKS[track];
    if (row.progress < (row.target > 0 ? row.target : def.target)) {
        return { ok: false, error: 'Mission not completed', status: 400 };
    }
    if (!def.core && !coreComplete) {
        return { ok: false, error: 'Core package not complete', status: 403 };
    }
    return { ok: true };
}

/** Welcome grant is one-time; `alreadyClaimed` comes from an existing voucher row. */
export function checkWelcomeGrantClaimable(alreadyClaimed: boolean): ClaimCheck {
    if (alreadyClaimed) return { ok: false, error: 'Already claimed', status: 400 };
    return { ok: true };
}

/** Core package complete = every core track claimed. */
export function isCorePackageComplete(rows: Array<{ track: string; is_claimed: boolean }>): boolean {
    for (const key of ONBOARDING_TRACK_KEYS) {
        if (!ONBOARDING_TRACKS[key].core) continue;
        if (!rows.some((r) => r.track === key && r.is_claimed)) return false;
    }
    return true;
}

/** Short shareable code: first 8 hex chars of the wallet (after 0x). */
export function referralCodeFor(wallet: string): string {
    return String(wallet || '').toLowerCase().replace(/^0x/, '').slice(0, 8);
}

export type ReferralCodeInput =
    | { kind: 'wallet'; wallet: string }
    | { kind: 'code'; code: string };

/** Accept a full wallet or a short hex code (resolved by address prefix). */
export function normalizeReferralCode(input: unknown): ReferralCodeInput | null {
    const s = String(input ?? '').trim().toLowerCase();
    if (/^0x[a-f0-9]{40}$/.test(s)) return { kind: 'wallet', wallet: s };
    if (/^[a-f0-9]{6,16}$/.test(s)) return { kind: 'code', code: s };
    return null;
}

/** Payout tier by success order (0-based index of already-successful referees). */
export function referralTierForSuccessOrder(successIndex: number): number {
    return successIndex < REFERRAL_TIER_WINNERS ? REFERRAL_TIER_TOP : REFERRAL_TIER_TAIL;
}
