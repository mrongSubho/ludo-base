/**
 * Shared onboarding catalog and validation helpers.
 * Keep this module browser-safe: it is imported by the onboarding UI.
 */
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
    target: number;
    reward: number;
    label: string;
    core: boolean;
}

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
export const WELCOME_GRANT_REWARD = 50;
export const WELCOME_GRANT_MISSION_ID = 'welcome_grant';
export const REFERRAL_SLOTS = 5000;
export const REFERRAL_TIER_WINNERS = 10;
export const REFERRAL_TIER_TOP = 50;
export const REFERRAL_TIER_TAIL = 10;

export function isOnboardingTrack(value: unknown): value is OnboardingTrack {
    return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ONBOARDING_TRACKS, value);
}

export interface OnboardingRow {
    progress: number;
    target: number;
    is_claimed: boolean;
}

export type ClaimCheck = { ok: true } | { ok: false; error: string; status: number };

export function checkTrackClaimable(track: string, row: OnboardingRow | null | undefined, coreComplete: boolean): ClaimCheck {
    if (!isOnboardingTrack(track)) return { ok: false, error: 'Unknown track', status: 400 };
    if (!row) return { ok: false, error: 'Track not started', status: 400 };
    if (row.is_claimed) return { ok: false, error: 'Already claimed', status: 400 };
    const def = ONBOARDING_TRACKS[track];
    if (row.progress < (row.target > 0 ? row.target : def.target)) {
        return { ok: false, error: 'Mission not completed', status: 400 };
    }
    if (!def.core && !coreComplete) return { ok: false, error: 'Core package not complete', status: 403 };
    return { ok: true };
}

export function checkWelcomeGrantClaimable(alreadyClaimed: boolean): ClaimCheck {
    if (alreadyClaimed) return { ok: false, error: 'Already claimed', status: 400 };
    return { ok: true };
}

export function isCorePackageComplete(rows: Array<{ track: string; is_claimed: boolean }>): boolean {
    for (const key of ONBOARDING_TRACK_KEYS) {
        if (!ONBOARDING_TRACKS[key].core) continue;
        if (!rows.some((row) => row.track === key && row.is_claimed)) return false;
    }
    return true;
}

export function referralCodeFor(wallet: string): string {
    return String(wallet || '').toLowerCase().replace(/^0x/, '').slice(0, 8);
}

export type ReferralCodeInput = { kind: 'wallet'; wallet: string } | { kind: 'code'; code: string };

export function normalizeReferralCode(input: unknown): ReferralCodeInput | null {
    const value = String(input ?? '').trim().toLowerCase();
    if (/^0x[a-f0-9]{40}$/.test(value)) return { kind: 'wallet', wallet: value };
    if (/^[a-f0-9]{6,16}$/.test(value)) return { kind: 'code', code: value };
    return null;
}

export function referralTierForSuccessOrder(successIndex: number): number {
    return successIndex < REFERRAL_TIER_WINNERS ? REFERRAL_TIER_TOP : REFERRAL_TIER_TAIL;
}
