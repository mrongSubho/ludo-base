/**
 * Pure math & tier ladder for the Ludo 3077 rotary Entry Fee knob.
 * Zero DOM dependencies so it stays unit-testable under `npx tsx --test`.
 */

export const ENTRY_FEE_TIERS = [
    0,
    500,
    1_000,
    10_000,
    100_000,
    500_000,
    1_000_000,
    3_000_000,
    5_000_000,
    10_000_000,
] as const;

export type EntryFeeTier = (typeof ENTRY_FEE_TIERS)[number];

/** Smart futuristic arena rank names for every preset from Free (0) to 10M. */
export const ENTRY_FEE_TIER_NAMES: Record<EntryFeeTier, string> = {
    0: 'SCOUT',
    500: 'SPARK',
    1_000: 'STRIKE',
    10_000: 'PULSE',
    100_000: 'SURGE',
    500_000: 'BLITZ',
    1_000_000: 'TITAN',
    3_000_000: 'NOVA',
    5_000_000: 'OMEGA',
    10_000_000: 'APEX',
};

export const HIGH_ROLLER_MIN_WAGER = 1_000_000;

export const DIAL_MIN_DEG = -135;
export const DIAL_MAX_DEG = 135;
export const DIAL_SWEEP_DEG = DIAL_MAX_DEG - DIAL_MIN_DEG; // 270°
/** 45 intervals × 6° = 270°; every 5th tick (0, 5, ..., 45) aligns with 30° tier detents. */
export const DIAL_TICK_COUNT = 46;
export const DIAL_TIER_STEP_DEG = DIAL_SWEEP_DEG / (ENTRY_FEE_TIERS.length - 1); // 30°

/** Returns the smart arena name for any wager amount (`SCOUT` .. `APEX`). */
export function getEntryFeeTierName(wager: number): string {
    if (!Number.isFinite(wager) || wager <= 0) return ENTRY_FEE_TIER_NAMES[0];
    let matched: EntryFeeTier = ENTRY_FEE_TIERS[0];
    for (let i = 0; i < ENTRY_FEE_TIERS.length; i++) {
        if (wager >= ENTRY_FEE_TIERS[i]) matched = ENTRY_FEE_TIERS[i];
        else break;
    }
    return ENTRY_FEE_TIER_NAMES[matched];
}

/** Maps a tier index [0..9] to its angle in [-135°, +135°]. */
export function tierIndexToAngle(index: number): number {
    const clamped = Math.max(0, Math.min(ENTRY_FEE_TIERS.length - 1, Math.round(index)));
    return DIAL_MIN_DEG + clamped * DIAL_TIER_STEP_DEG;
}

/** Highest tier index affordable with `playableChips` (minimum 0 = Free). */
export function maxAffordableTierIndex(playableChips: number): number {
    if (!Number.isFinite(playableChips) || playableChips <= 0) return 0;
    let best = 0;
    for (let i = 0; i < ENTRY_FEE_TIERS.length; i++) {
        if (ENTRY_FEE_TIERS[i] <= playableChips) best = i;
        else break;
    }
    return best;
}

/**
 * Maps any wager (including custom typed values between detents) to [-135°, +135°]
 * using piecewise-linear interpolation between the bounding tiers.
 */
export function wagerToAngle(wager: number): number {
    if (!Number.isFinite(wager) || wager <= ENTRY_FEE_TIERS[0]) return DIAL_MIN_DEG;
    const lastIdx = ENTRY_FEE_TIERS.length - 1;
    if (wager >= ENTRY_FEE_TIERS[lastIdx]) return DIAL_MAX_DEG;

    for (let i = 0; i < lastIdx; i++) {
        const lo = ENTRY_FEE_TIERS[i];
        const hi = ENTRY_FEE_TIERS[i + 1];
        if (wager === lo) return tierIndexToAngle(i);
        if (wager > lo && wager < hi) {
            const frac = (wager - lo) / (hi - lo);
            return tierIndexToAngle(i) + frac * DIAL_TIER_STEP_DEG;
        }
    }
    return DIAL_MAX_DEG;
}

/**
 * Converts pointer delta from the dial center `(dx, dy)` to a clamped dial angle
 * in `[-135°, +135°]`, preventing jumps across the bottom dead-zone between Free and 10M.
 */
export function pointerToDialAngle(dx: number, dy: number, prevAngleDeg: number): number {
    if (dx === 0 && dy === 0) return Math.max(DIAL_MIN_DEG, Math.min(DIAL_MAX_DEG, prevAngleDeg));
    const raw = (Math.atan2(dx, -dy) * 180) / Math.PI;

    if (prevAngleDeg < -90 && raw > 90) return DIAL_MIN_DEG;
    if (prevAngleDeg > 90 && raw < -90) return DIAL_MAX_DEG;

    if (raw < DIAL_MIN_DEG || raw > DIAL_MAX_DEG) {
        return prevAngleDeg <= 0 ? DIAL_MIN_DEG : DIAL_MAX_DEG;
    }
    return raw;
}

/** Snaps a dial angle to the nearest tier index across the full 0..10M dial. */
export function angleToTierIndex(angleDeg: number): number {
    const clamped = Math.max(DIAL_MIN_DEG, Math.min(DIAL_MAX_DEG, angleDeg));
    const rawIdx = Math.round((clamped - DIAL_MIN_DEG) / DIAL_TIER_STEP_DEG);
    return Math.max(0, Math.min(ENTRY_FEE_TIERS.length - 1, rawIdx));
}

/** Steps up (+1) or down (-1) one tier across the full 0..10M ladder. */
export function stepTier(currentWager: number, direction: -1 | 1): number {
    if (direction === 1) {
        for (let i = 0; i < ENTRY_FEE_TIERS.length; i++) {
            const tier = ENTRY_FEE_TIERS[i];
            if (tier > currentWager) return tier;
        }
        return currentWager;
    }
    for (let i = ENTRY_FEE_TIERS.length - 1; i >= 0; i--) {
        const tier = ENTRY_FEE_TIERS[i];
        if (tier < currentWager) return tier;
    }
    return 0;
}

/** Compact uppercase arc label for each detent tier. */
export function formatDialTierLabel(val: number): string {
    if (val <= 0) return 'FREE';
    if (val >= 1_000_000) {
        const m = val / 1_000_000;
        return Number.isInteger(m) ? `${m}M` : `${m.toFixed(1)}M`;
    }
    if (val >= 1_000) return `${val / 1_000}K`;
    return String(val);
}
