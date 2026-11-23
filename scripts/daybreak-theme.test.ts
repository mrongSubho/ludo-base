import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    DAYBREAK_FEE_LABELS,
    DAYBREAK_FEE_TIERS,
    DAYBREAK_TIER_NAMES,
    nearestDaybreakTierIndex,
} from '../app/components/DaybreakFeePicker';

const root = join(import.meta.dirname ?? __dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('Daybreak Theme Redesign — Warm Studio Porcelain', () => {
    it('defines Warm Studio Porcelain palette and reactive mineral pigments in daybreak.css', () => {
        const css = read('app/styles/themes/daybreak.css');
        assert.match(css, /--ludo-bg:\s*#f4f1ea;/);
        assert.match(css, /body\.theme-daybreak\[data-deploy-mode="team"\][\s\S]*#b45309/);
        assert.match(css, /body\.theme-daybreak\[data-deploy-mode="offline"\][\s\S]*#166534/);
        assert.match(css, /--lobby-photo:\s*none;/);
        assert.doesNotMatch(css, /rgba\(124,\s*58,\s*237/);
    });

    it('implements DaybreakStudioDeck with POWER first, shared formation sources, and reduced motion', () => {
        const deck = read('app/components/DaybreakStudioDeck.tsx');
        assert.match(deck, /export function DaybreakStudioDeck/);
        assert.match(deck, /DAYBREAK_MODE_ORDER:\s*readonly LobbyGameMode\[\]\s*=\s*\['power',\s*'classic'\]/);
        assert.match(deck, /TEAM_PAIRINGS/);
        assert.match(deck, /seatedColorsFor/);
        assert.match(deck, /role="radiogroup"/);
        assert.match(deck, /prefersReducedMotion/);
        assert.match(deck, /getSoundEngine\(\)/);
        assert.doesNotMatch(deck, /new\s+(window\.)?(AudioContext|webkitAudioContext)/);
    });

    it('implements DaybreakFeePicker Vernier ruler slider helpers and compositor-only sliding puck', () => {
        assert.equal(DAYBREAK_FEE_TIERS.length, 10);
        assert.equal(DAYBREAK_FEE_LABELS.length, 10);
        assert.equal(DAYBREAK_TIER_NAMES.length, 10);
        assert.equal(nearestDaybreakTierIndex(0), 0);
        assert.equal(nearestDaybreakTierIndex(-100), 0);
        assert.equal(nearestDaybreakTierIndex(Number.NaN), 0);
        assert.equal(nearestDaybreakTierIndex(450), 1);
        assert.equal(nearestDaybreakTierIndex(100_000), 4);
        assert.equal(nearestDaybreakTierIndex(10_000_000), 9);
        assert.equal(nearestDaybreakTierIndex(99_000_000), 9);

        const picker = read('app/components/DaybreakFeePicker.tsx');
        assert.match(picker, /export function DaybreakFeePicker/);
        assert.match(picker, /role="slider"/);
        assert.match(picker, /setPointerCapture/);
        assert.match(picker, /scaleX\(/);
        assert.match(picker, /prefersReducedMotion/);
        assert.match(picker, /getSoundEngine\(\)/);
        assert.doesNotMatch(picker, /new\s+(window\.)?(AudioContext|webkitAudioContext)/);
    });

    it('implements DaybreakModeDock segmented trough and wires studio components into GameLobby & ActionDice', () => {
        const dock = read('app/components/DaybreakModeDock.tsx');
        assert.match(dock, /export function DaybreakModeDock/);
        assert.match(dock, /role="radiogroup"/);
        assert.match(dock, /prefersReducedMotion/);
        assert.match(dock, /#0D6D87/);
        assert.match(dock, /#B45309/);
        assert.match(dock, /#166534/);

        const lobby = read('app/components/GameLobby.tsx');
        assert.match(lobby, /<DaybreakStudioDeck/);
        assert.match(lobby, /<DaybreakFeePicker/);
        assert.doesNotMatch(lobby, /\(!is3077 && !isRetro\) \|\| !showFee/);
        assert.match(lobby, /if \(!showFee\) return;/);

        const dice = read('app/components/ActionDice.tsx');
        assert.match(dice, /<DaybreakModeDock/);
        assert.match(dice, /daybreak-dice-plinth/);
    });

    it('upgrades Daybreak sunlit tabletop courts & porcelain LudoDice while preserving 3077/Retro', () => {
        const board = read('app/styles/board.css');
        assert.match(board, /body\.theme-daybreak \.board-grid/);
        assert.match(board, /body\.theme-daybreak \.board-home\.green/);
        assert.match(board, /body\.theme-daybreak \.home-pad/);
        assert.match(board, /body\.theme-daybreak \.finish-core/);
        assert.match(board, /body\.theme-3077 \.board-grid/);
        assert.match(board, /body\.theme-retro-futurism \.board-grid/);

        const ludoDice = read('app/components/LudoDice.tsx');
        assert.match(ludoDice, /DICE_DAYBREAK_SKIN/);
        assert.match(ludoDice, /COLOR_MAP_DAYBREAK/);
        assert.match(ludoDice, /isPorcelainClassic/);
    });
});
