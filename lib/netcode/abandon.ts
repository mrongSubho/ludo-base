/**
 * G3 — abandon / AFK honesty (no CHIPS burn wiring in this phase).
 * Dual-path abandon classification is ready for Phase-1 economics; burn split
 * stays feature-flagged off until CHIPS value track (HIGH-2).
 */

import type { AfkPlayerStats, PlayerColor } from '../types';
import { bumpNet } from './counters';
import { track } from '../telemetry';

/** Grace window before abandon is submittable after disconnect (ms). */
export const ABANDON_GRACE_MS = 60_000;

/** Feature flag — CHIPS burn split is OFF until stable + value track. */
export const ABANDON_BURN_SPLIT_ENABLED = false;

export type AbandonEvidence = {
    /** Edge signature present (Mode: Edge-only path). */
    hasEdgeSig: boolean;
    /** Host or second signature (dual path). */
    hasHostSig: boolean;
    /** ms since disconnect/AFK start. */
    sinceDisconnectMs: number;
    /** Match already finished? */
    matchEnded?: boolean;
};

export type AbandonOutcome =
    | { mode: 'none'; reason: 'grace' | 'ended' | 'insufficient'; burnBps: 0; refundBps: 10000 }
    | { mode: 'edge_only_refund'; burnBps: 0; refundBps: 10000; note: string }
    | { mode: 'dual_sign_burn_split'; burnBps: 5000; refundBps: 5000; note: string; burnEnabled: boolean };

/**
 * Classify an abandon submission. Deterministic; does not move funds.
 * Policy (HIGH-2): Edge-only → 100% refund / no burn.
 *                  Dual-sign → 50% burn / 50% prize — only when burn flag on.
 */
export function classifyAbandon(evidence: AbandonEvidence): AbandonOutcome {
    if (evidence.matchEnded) {
        return { mode: 'none', reason: 'ended', burnBps: 0, refundBps: 10000 };
    }
    if (evidence.sinceDisconnectMs < ABANDON_GRACE_MS) {
        return { mode: 'none', reason: 'grace', burnBps: 0, refundBps: 10000 };
    }
    if (evidence.hasEdgeSig && evidence.hasHostSig) {
        bumpNet('net_intent_ok');
        return {
            mode: 'dual_sign_burn_split',
            burnBps: 5000,
            refundBps: 5000,
            note: 'dual-sign abandon — burn split reserved; flag gate for CHIPS',
            burnEnabled: ABANDON_BURN_SPLIT_ENABLED,
        };
    }
    if (evidence.hasEdgeSig) {
        bumpNet('net_intent_ok');
        return {
            mode: 'edge_only_refund',
            burnBps: 0,
            refundBps: 10000,
            note: 'Edge-only abandon — full refund, burn = 0 (HIGH-2)',
        };
    }
    return { mode: 'none', reason: 'insufficient', burnBps: 0, refundBps: 10000 };
}

export type AfkHonestyView = {
    color: PlayerColor;
    isAutoPlaying: boolean;
    consecutiveTurns: number;
    totalTriggers: number;
    isKicked: boolean;
    /** Player-facing copy key. */
    label: 'ok' | 'autoplaying' | 'warned' | 'kicked';
    copy: string;
};

export function afkHonestyView(color: PlayerColor, stats: AfkPlayerStats | undefined): AfkHonestyView {
    const s = stats ?? { isAutoPlaying: false, consecutiveTurns: 0, totalTriggers: 0, isKicked: false };
    let label: AfkHonestyView['label'] = 'ok';
    let copy = 'Active';
    if (s.isKicked) {
        label = 'kicked';
        copy = 'Removed for inactivity — bot is finishing this match';
    } else if (s.consecutiveTurns >= 4) {
        label = 'warned';
        copy = 'Warning: play a turn soon or a bot will take over';
    } else if (s.isAutoPlaying) {
        label = 'autoplaying';
        copy = 'Bot is covering turns while you are away';
    }
    return {
        color,
        isAutoPlaying: s.isAutoPlaying,
        consecutiveTurns: s.consecutiveTurns,
        totalTriggers: s.totalTriggers,
        isKicked: s.isKicked,
        label,
        copy,
    };
}

/** Remaining grace before abandon may be filed. */
export function abandonGraceRemainingMs(sinceDisconnectMs: number): number {
    return Math.max(0, ABANDON_GRACE_MS - sinceDisconnectMs);
}

export function recordAbandonAttempt(outcome: AbandonOutcome, matchId?: string): void {
    track('match_end', {
        kind: 'abandon_attempt',
        mode: outcome.mode,
        matchId,
    });
    if (outcome.mode === 'none') {
        track('net_degraded', { reason: 'abandon_rejected', why: outcome.reason });
    }
}
