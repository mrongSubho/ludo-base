import { POWER_EXPIRY_MS, type PowerType } from '@/lib/engine/core';

export const POWER_ORDER: readonly PowerType[] = ['boost', 'shield', 'teleport', 'nuke'];

export interface PowerMetaEntry {
    title: string;
    shortTag: string;
    summary: string;
    simCaption: string;
    ctaLabel: string;
    armedLabel: string;
    accentVar: string;
}

export const POWER_META: Record<PowerType, PowerMetaEntry> = {
    boost: {
        title: 'Boost',
        shortTag: '+6 THEN ROLL',
        summary: 'Play a bonus 6 first (can deploy from yard), then move your rolled die',
        simCaption: 'BOOST 6 FIRST → THEN ROLLED DIE · ANY ELIGIBLE TOKEN',
        ctaLabel: 'USE BOOST',
        armedLabel: 'BOOST ACTIVE',
        accentVar: '#f59e0b',
    },
    shield: {
        title: 'Shield',
        shortTag: '1-TURN AEGIS',
        summary: 'Protect your track tokens until your next turn',
        simCaption: 'BLOCKS CAPTURES & NUKES UNTIL NEXT TURN',
        ctaLabel: 'USE SHIELD',
        armedLabel: 'SHIELD UP',
        accentVar: '#06b6d4',
    },
    teleport: {
        title: 'Teleport',
        shortTag: 'STAR BLINK',
        summary: 'Blink one token to the next ★ star or straight home',
        simCaption: 'BLINKS TO NEXT ★ STAR · OR HOME FROM LANE',
        ctaLabel: 'ARM TELEPORT',
        armedLabel: 'TAP TARGET',
        accentVar: '#10b981',
    },
    nuke: {
        title: 'Nuke',
        shortTag: '±3 BLAST',
        summary: 'Blast solo unshielded enemies within ±3 tiles (stars & stacks safe)',
        simCaption: 'VAPORIZES SOLO ENEMIES WITHIN ±3 · STACKS & STARS SAFE',
        ctaLabel: 'ARM NUKE',
        armedLabel: 'TAP TARGET',
        accentVar: '#ef4444',
    },
};

export type PowerOrbTapOutcome = 'cast' | 'inspect' | 'close';

/**
 * Decide how a tap/click on a power dock orb behaves:
 * - Eligible (canSpend && count > 0): 1-tap instant-cast with no inspection delay.
 * - Not eligible: 1-tap toggles or switches the anchored inspection popover.
 */
export function resolvePowerOrbTapAction(input: {
    type: PowerType;
    count: number;
    canSpend: boolean;
    inspected: PowerType | null;
}): PowerOrbTapOutcome {
    if (input.canSpend && input.count > 0) return 'cast';
    if (input.inspected === input.type) return 'close';
    return 'inspect';
}

/** Return the crisp lock explanation shown in the inspection card when a power cannot currently be cast. */
export function getPowerLockReason(input: {
    count: number;
    isMyTurn: boolean;
    gamePhase: string;
    powerSpentThisTurn: boolean;
}): string | null {
    if (input.count <= 0) return 'Collect on cyan power tiles';
    if (!input.isMyTurn) return 'Wait for your turn';
    if (input.powerSpentThisTurn) return '1 power max per turn';
    if (input.gamePhase !== 'rolling') return 'Use before rolling';
    return null;
}

export type PowerExpiryUrgency = 'none' | 'normal' | 'warn' | 'critical';

/** Compute normalized progress (0..1) and urgency tier from the earliest item expiry timestamp. */
export function getPowerExpiryRingState(
    type: PowerType,
    soonestExpiresAt: number,
    now: number,
): { progress: number; remainingMs: number; urgency: PowerExpiryUrgency } {
    if (soonestExpiresAt <= 0) {
        return { progress: 0, remainingMs: 0, urgency: 'none' };
    }
    const remainingMs = Math.max(0, soonestExpiresAt - now);
    const ttl = POWER_EXPIRY_MS[type] || 180_000;
    const progress = Math.max(0, Math.min(1, remainingMs / ttl));
    const urgency: PowerExpiryUrgency =
        remainingMs <= 15_000 ? 'critical' : remainingMs <= 45_000 ? 'warn' : 'normal';
    return { progress, remainingMs, urgency };
}

/** Format remaining milliseconds as `m:ss` (e.g. `4:12`, `0:09`). */
export function formatPowerCountdown(remainingMs: number): string {
    const totalSec = Math.max(0, Math.ceil(remainingMs / 1000));
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}
