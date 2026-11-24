import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { POWER_EXPIRY_MS } from '../lib/engine/core';
import {
    POWER_META,
    POWER_ORDER,
    formatPowerCountdown,
    getPowerExpiryRingState,
    getPowerLockReason,
    resolvePowerOrbTapAction,
} from '../lib/powerDockLogic';

const root = join(import.meta.dirname ?? __dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('Power Inventory Dock — Tap/Inspect State Machine & Telemetry', () => {
    it('defines metadata and order for all four powers without duplicates', () => {
        assert.deepEqual(POWER_ORDER, ['boost', 'shield', 'teleport', 'nuke']);
        for (const p of POWER_ORDER) {
            assert.ok(POWER_META[p].title.length > 0);
            assert.ok(POWER_META[p].summary.length > 0);
            assert.ok(POWER_META[p].simCaption.length > 0);
            assert.ok(POWER_META[p].ctaLabel.length > 0);
        }
    });

    it('uses 1-tap instant-cast when eligible, ignoring inspection state', () => {
        assert.equal(
            resolvePowerOrbTapAction({ type: 'boost', count: 1, canSpend: true, inspected: null }),
            'cast',
        );
        assert.equal(
            resolvePowerOrbTapAction({ type: 'nuke', count: 2, canSpend: true, inspected: 'shield' }),
            'cast',
        );
        assert.equal(
            resolvePowerOrbTapAction({ type: 'shield', count: 1, canSpend: true, inspected: 'shield' }),
            'cast',
        );
    });

    it('opens, switches, and closes the inspection popover when not eligible', () => {
        // Zero held
        assert.equal(
            resolvePowerOrbTapAction({ type: 'boost', count: 0, canSpend: true, inspected: null }),
            'inspect',
        );
        // Opponent turn / wrong phase (!canSpend)
        assert.equal(
            resolvePowerOrbTapAction({ type: 'nuke', count: 2, canSpend: false, inspected: null }),
            'inspect',
        );
        // Switch directly from another inspected power
        assert.equal(
            resolvePowerOrbTapAction({ type: 'teleport', count: 1, canSpend: false, inspected: 'nuke' }),
            'inspect',
        );
        // Second tap on same inspected power closes it
        assert.equal(
            resolvePowerOrbTapAction({ type: 'teleport', count: 1, canSpend: false, inspected: 'teleport' }),
            'close',
        );
    });

    it('computes accurate lock reasons in priority order', () => {
        assert.equal(
            getPowerLockReason({ count: 0, isMyTurn: true, gamePhase: 'rolling', powerSpentThisTurn: false }),
            'Collect on cyan power tiles',
        );
        assert.equal(
            getPowerLockReason({ count: 1, isMyTurn: false, gamePhase: 'rolling', powerSpentThisTurn: false }),
            'Wait for your turn',
        );
        assert.equal(
            getPowerLockReason({ count: 1, isMyTurn: true, gamePhase: 'rolling', powerSpentThisTurn: true }),
            '1 power max per turn',
        );
        assert.equal(
            getPowerLockReason({ count: 1, isMyTurn: true, gamePhase: 'moving', powerSpentThisTurn: false }),
            'Use before rolling',
        );
        assert.equal(
            getPowerLockReason({ count: 1, isMyTurn: true, gamePhase: 'rolling', powerSpentThisTurn: false }),
            null,
        );
    });

    it('computes expiry progress rings and m:ss countdowns accurately against POWER_EXPIRY_MS', () => {
        const now = 1_000_000;
        assert.deepEqual(getPowerExpiryRingState('nuke', 0, now), {
            progress: 0,
            remainingMs: 0,
            urgency: 'none',
        });

        const nukeHalf = getPowerExpiryRingState('nuke', now + POWER_EXPIRY_MS.nuke / 2, now);
        assert.equal(nukeHalf.urgency, 'normal');
        assert.ok(Math.abs(nukeHalf.progress - 0.5) < 1e-6);

        const shieldWarn = getPowerExpiryRingState('shield', now + 30_000, now);
        assert.equal(shieldWarn.urgency, 'warn');
        assert.equal(formatPowerCountdown(shieldWarn.remainingMs), '0:30');

        const boostCritical = getPowerExpiryRingState('boost', now + 9_200, now);
        assert.equal(boostCritical.urgency, 'critical');
        assert.equal(formatPowerCountdown(boostCritical.remainingMs), '0:10');

        assert.equal(formatPowerCountdown(0), '0:00');
        assert.equal(formatPowerCountdown(-500), '0:00');
    });

    it('implements Ludo 3077 original Tactical Module Dossier (no copy-pasted EXAMPLE ribbon), keeps non-eligible orbs clickable, and drops purple teleport styling', () => {
        const dock = read('app/components/PowerInventoryDock.tsx');
        assert.match(dock, /export function PowerInventoryDock/);
        assert.doesNotMatch(dock, /disabled=/);
        assert.doesNotMatch(dock, /EXAMPLE/);
        assert.match(dock, /resolvePowerOrbTapAction/);
        assert.match(dock, /HudCornerTicks/);
        assert.match(dock, /TerminalTypeText/);
        assert.match(dock, /PowerTrackSimulator/);
        assert.match(dock, /power-dossier-anchor/);
        assert.match(dock, /scaleX\(/);
        assert.match(dock, /prefersReducedMotion/);

        const board = read('app/components/Board.tsx');
        assert.match(board, /<PowerInventoryDock/);
        assert.doesNotMatch(board, /function PowerGlyph/);

        const boardCss = read('app/styles/board.css');
        assert.match(boardCss, /\.power-dossier/);
        assert.match(boardCss, /\.power-sim-stage/);
        assert.doesNotMatch(boardCss, /\.power-example-ribbon/);
        assert.match(boardCss, /\.power-orb-ring/);
        const teleportRule = boardCss.match(/\.power-orb-teleport\s*\{[^}]*\}/)?.[0] ?? '';
        assert.match(teleportRule, /#10b981/);
        assert.doesNotMatch(teleportRule, /#a78bfa|#7c3aed/i);
    });
});
