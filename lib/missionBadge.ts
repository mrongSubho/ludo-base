/**
 * Mission badge descriptors — pure, browser-safe, unit-testable.
 *
 * Regression history: MissionPanel used to switch on a `type` wire field
 * ('play'|'win'|'streak'|'social'|'predict') left over from the old hardcoded
 * DAILY_MISSIONS table. Commit 1084c72 ("missions on CHIPS, single reward
 * source") replaced that source with `mission_catalog` (migration
 * 202609300003), which has no `type` column — so `/api/missions/list` stopped
 * sending the field. The switch fell through for every mission and returned
 * undefined, and `badge.bg` then threw "Cannot read properties of undefined
 * (reading 'bg')" on the first mission row, taking the whole Mission panel
 * down for every signed-in user.
 *
 * The mapping therefore keys off `mission_id` — a field the catalog actually
 * has — and is total by construction: it always ends in a default, so an
 * unknown or future catalog id can never produce an undefined badge.
 */
export type MissionBadgeKey = 'bonus' | 'play' | 'win' | 'capture' | 'poke' | 'predict' | 'social' | 'default';

export interface MissionBadgeStyle {
    /** Stable key the UI maps to a lucide icon. */
    key: MissionBadgeKey;
    color: string;
    bg: string;
}

const DEFAULT_BADGE: MissionBadgeStyle = { key: 'default', color: 'text-white/60', bg: 'bg-white/5' };

/**
 * Badge style for a catalog `mission_id`.
 *
 * Order matters: earlier rules win (e.g. `daily_bonus` before the generic
 * `play` rule so "bonus" doesn't get dice).
 */
export function missionBadgeFor(missionId: string): MissionBadgeStyle {
    const id = missionId ?? '';
    if (id.startsWith('daily_bonus')) {
        return { key: 'bonus', color: 'text-yellow-400', bg: 'bg-yellow-500/20' };
    }
    if (id.includes('play')) {
        return { key: 'play', color: 'text-cyan-400', bg: 'bg-white/5' };
    }
    if (id.includes('win')) {
        return { key: 'win', color: 'text-yellow-400', bg: 'bg-yellow-500/20' };
    }
    if (id.includes('capture') || id.includes('pvp')) {
        return { key: 'capture', color: 'text-orange-400', bg: 'bg-orange-500/20' };
    }
    if (id.includes('poke')) {
        return { key: 'poke', color: 'text-cyan-400', bg: 'bg-white/5' };
    }
    if (id.includes('predict') || id.includes('spectate')) {
        return { key: 'predict', color: 'text-pink-400', bg: 'bg-pink-500/20' };
    }
    if (id.includes('dm') || id.includes('friend')) {
        return { key: 'social', color: 'text-cyan-400', bg: 'bg-white/5' };
    }
    // Unknown/future catalog id — stay on a neutral badge, never undefined.
    return { ...DEFAULT_BADGE };
}

/** Every mission_id seeded by migration 202609300003 (the shipped catalog). */
export const SEEDED_MISSION_IDS: readonly string[] = [
    'daily_bonus',
    'daily_play_3',
    'daily_win_1',
    'daily_poke_back',
    'daily_capture_2',
    'daily_predict_1',
    'weekly_play_10',
    'weekly_win_3',
    'weekly_capture_10',
    'weekly_pvp_2',
    'weekly_spectate_5',
    'weekly_friend_dm_3',
];
