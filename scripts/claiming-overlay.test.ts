/**
 * Claiming overlay theme tokens and contract tests (node --test).
 * Run: npx tsx --test scripts/claiming-overlay.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const TOKENS_CSS = readFileSync(join(ROOT, 'app/styles/tokens.css'), 'utf8');
const DAYBREAK_CSS = readFileSync(join(ROOT, 'app/styles/themes/daybreak.css'), 'utf8');
const CLAIMING_OVERLAY_TSX = readFileSync(join(ROOT, 'app/components/ClaimingOverlay.tsx'), 'utf8');

const REQUIRED_OVERLAY_TOKENS = [
    '--claiming-overlay-bg',
    '--claiming-overlay-border',
    '--claiming-overlay-shadow',
    '--claiming-overlay-radar',
    '--claiming-overlay-ring-1',
    '--claiming-overlay-ring-2',
    '--claiming-overlay-pulse-border',
    '--claiming-overlay-pulse-bg',
    '--claiming-overlay-title',
    '--claiming-overlay-subtitle',
    '--claiming-overlay-laser',
    '--claiming-overlay-laser-shadow',
];

test('tokens.css: declares all tactical claiming overlay variables for default/retro theme', () => {
    for (const token of REQUIRED_OVERLAY_TOKENS) {
        assert.ok(
            TOKENS_CSS.includes(token),
            `tokens.css missing default claiming overlay token: ${token}`
        );
    }
});

test('daybreak.css: overrides all tactical claiming overlay variables for porcelain light theme', () => {
    for (const token of REQUIRED_OVERLAY_TOKENS) {
        assert.ok(
            DAYBREAK_CSS.includes(token),
            `daybreak.css missing daybreak claiming overlay token: ${token}`
        );
    }
});

test('daybreak.css: ensures high AA contrast deep cyan title and slate subtitle', () => {
    assert.ok(DAYBREAK_CSS.includes('--claiming-overlay-title: #0d6d87;'), 'Daybreak overlay title must use #0d6d87 for AA contrast');
    assert.ok(DAYBREAK_CSS.includes('--claiming-overlay-laser: #0d6d87;'), 'Daybreak laser must use #0d6d87');
});

test('ClaimingOverlay.tsx: references claiming overlay tokens without hardcoded dark values', () => {
    // Must NOT have hardcoded dark background and border on root
    assert.ok(!CLAIMING_OVERLAY_TSX.includes('bg-black/80'), 'ClaimingOverlay should not have hardcoded bg-black/80');
    assert.ok(!CLAIMING_OVERLAY_TSX.includes('border-cyan-400/50'), 'ClaimingOverlay should not have hardcoded border-cyan-400/50');
    assert.ok(!CLAIMING_OVERLAY_TSX.includes('text-white/50'), 'ClaimingOverlay subtitle should not be hardcoded text-white/50');

    // Must have references to theme variables
    for (const token of REQUIRED_OVERLAY_TOKENS) {
        assert.ok(
            CLAIMING_OVERLAY_TSX.includes(token),
            `ClaimingOverlay.tsx missing usage of token: ${token}`
        );
    }
});
