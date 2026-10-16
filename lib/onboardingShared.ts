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
    /** User-facing detail line: what the track is for, what to do, what it unlocks. */
    desc: string;
}

export const ONBOARDING_TRACKS: Record<OnboardingTrack, TrackDef> = {
    tutorial: {
        target: 1, reward: 100, label: 'Tutorial', core: true,
        desc: 'Finish the guided tutorial to learn how tokens move, capture opponents and reach home. One run leaves you ready to plan a real turn.',
    },
    ai_classic: {
        target: 1, reward: 100, label: 'AI Classic', core: true,
        desc: 'Play a full match against the Classic AI and take it to the end. Closing out a bot proves you can finish a game, not just open one.',
    },
    ai_power: {
        target: 1, reward: 100, label: 'AI Power', core: true,
        desc: 'Win a match with power tiles switched on. Landing a boost or trap at the right moment is what sets a power board apart.',
    },
    ai_snakes: {
        target: 1, reward: 100, label: 'AI Snakes', core: true,
        desc: 'Complete a run on the Snakes board, where ladders and drops rewrite every route. Finishing one means reading a different board.',
    },
    pvp: {
        target: 1, reward: 150, label: 'First PvP', core: true,
        desc: 'Play your first match against a real opponent and see it through. Ranked play is where the win streak behind your form begins.',
    },
    playtime: {
        target: 60, reward: 150, label: 'Playtime', core: true,
        desc: 'Spend 60 minutes in matches across your first sessions. Time on the board is what turns one-off wins into a steady win rate.',
    },
    social: {
        target: 4, reward: 300, label: 'Social', core: true,
        desc: 'Do four social things — friend requests, messages and profile visits. A full friends list is what makes invites and DMs worth having.',
    },
    day2: {
        target: 1, reward: 50, label: 'Day 2 Return', core: false,
        desc: 'Come back on a second day and finish one match. Returning players earn more, so day two is where the habit starts paying.',
    },
    day3: {
        target: 1, reward: 100, label: 'Day 3 Return', core: false,
        desc: 'Return on a third day and play again. By three sessions your rank settles and the rewards scale with it.',
    },
    friend_dm: {
        target: 10, reward: 100, label: 'Friends + DM', core: false,
        desc: 'Add ten friends and swap a message with at least one of them. Playing with people you know is what keeps matches coming back.',
    },
    clan: {
        target: 1, reward: 100, label: 'Clan Join', core: false,
        desc: 'Join a clan and take your first seat in it. Clans open team play and shared goals you cannot reach on your own.',
    },
};

export const ONBOARDING_TRACK_KEYS = Object.keys(ONBOARDING_TRACKS) as OnboardingTrack[];
export const WELCOME_GRANT_REWARD = 50;
export const WELCOME_GRANT_MISSION_ID = 'welcome_grant';
export const WELCOME_GRANT_DESC =
    'Link your first wallet and claim 50 CHIPS once — a one-time grant that stays yours to keep.';
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
