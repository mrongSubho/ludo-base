import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    RETRO_SYNTH_LABELS,
    RETRO_SYNTH_TIERS,
    nearestSynthTierIndex,
} from '../app/components/RetroSynthFeeFader';

const root = join(import.meta.dirname ?? __dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('Retro Theme Redesign & Swapped Lobby Setup Decks', () => {
    it('isolates body.theme-retro-futurism into app/styles/themes/retro.css and imports it in globals.css', () => {
        const globals = read('app/globals.css');
        assert.match(globals, /@import\s+"\.\/styles\/themes\/retro\.css";/);

        const panels = read('app/styles/panels.css');
        assert.doesNotMatch(panels, /body\.theme-retro-futurism\s*\{/);

        const retro = read('app/styles/themes/retro.css');
        assert.match(retro, /body\.theme-retro-futurism\s*\{/);
        assert.match(retro, /body\.theme-retro-futurism\[data-deploy-mode="team"\]/);
        assert.match(retro, /body\.theme-retro-futurism\[data-deploy-mode="offline"\]/);
        assert.match(retro, /body\.theme-retro-futurism::before/);
        assert.match(retro, /body\.theme-retro-futurism::after/);
        assert.match(retro, /body\.theme-retro-futurism \.lobby-backdrop::after/);
        assert.doesNotMatch(retro, /rgba\(124,\s*58,\s*237/);
        // Never add nested overflow lock in retro.css
        assert.doesNotMatch(retro, /\.overflow-y-auto[^}]*overflow-y:\s*visible\s*!important/);
    });

    it('implements OrbitalCanopyDeck with themeVariant support (3077 & retro) and ARIA radiogroups', () => {
        const canopy = read('app/components/OrbitalCanopyDeck.tsx');
        assert.match(canopy, /export function OrbitalCanopyDeck/);
        assert.match(canopy, /themeVariant\s*=\s*'3077'/);
        assert.match(canopy, /deployTheme\.hex/);
        assert.match(canopy, /role="radiogroup"/);
        assert.match(canopy, /aria-label="Select Game Mode"/);
        assert.match(canopy, /aria-label="Match Type"/);
        assert.match(canopy, /POWER/);
        assert.match(canopy, /CLASSIC/);
        assert.match(canopy, /CANOPY_MODES[\s\S]*id:\s*'power'[\s\S]*startDeg:\s*-31\.5[\s\S]*id:\s*'classic'[\s\S]*startDeg:\s*0\.75/);
        assert.match(canopy, /prefersReducedMotion/);
        assert.doesNotMatch(canopy, /rgba\(0,\s*229,\s*255/);
        assert.doesNotMatch(canopy, /rgba\(34,\s*211,\s*238/);
    });

    it('implements RetroSynthFeeFader with 7 ascending VU columns, shared SoundEngine, and knurled fader', () => {
        assert.equal(RETRO_SYNTH_TIERS.length, 7);
        assert.equal(RETRO_SYNTH_LABELS.length, 7);
        assert.equal(nearestSynthTierIndex(0), 0);
        assert.equal(nearestSynthTierIndex(450), 1);
        assert.equal(nearestSynthTierIndex(100_000), 4);
        assert.equal(nearestSynthTierIndex(10_000_000), 6);

        const fader = read('app/components/RetroSynthFeeFader.tsx');
        assert.match(fader, /export function RetroSynthFeeFader/);
        assert.match(fader, /getSoundEngine\(\)/);
        assert.doesNotMatch(fader, /new\s+(window\.)?(AudioContext|webkitAudioContext)/);
        assert.match(fader, /role="radiogroup"/);
        assert.match(fader, /role="slider"/);
        assert.match(fader, /setPointerCapture/);
    });

    it('keeps OrbitalFeeDock capsule and circular pod pill-shaped in 3077 and expands to EntryFeeKnob', () => {
        const css3077 = read('app/styles/themes/theme-3077.css');
        assert.match(css3077, /\.fee-tier\.fee-tier-orbital-capsule/);
        assert.match(css3077, /\.fee-tier\.fee-tier-orbital-pod/);
        assert.match(css3077, /border-radius:\s*9999px\s*!important/);

        const dock = read('app/components/OrbitalFeeDock.tsx');
        assert.match(dock, /fee-tier-orbital-pod/);
        assert.match(dock, /-top-10/);
        assert.match(dock, /w-\[292px\]/);
        assert.match(dock, /aspect-square rounded-full/);
        assert.match(dock, /prefersReducedMotion/);
        assert.match(dock, /rotate:/);

        const knob = read('app/components/EntryFeeKnob.tsx');
        assert.match(knob, /circular\s*=\s*false/);

        const lobby = read('app/components/GameLobby.tsx');
        assert.match(lobby, /const isRetro = preferences\.theme === 'retro'/);
        assert.match(lobby, /<OrbitalCanopyDeck/);
        assert.match(lobby, /<OrbitalFeeDock[\s\S]*circular/);
        assert.match(lobby, /<EntryFeeKnob[\s\S]*circular/);
        assert.match(lobby, /<LobbyCommandDeck/);
        assert.match(lobby, /<RetroSynthFeeFader/);

        const deck = read('app/components/LobbyCommandDeck.tsx');
        assert.match(deck, /grid-cols-\[minmax\(0,0\.88fr\)_minmax\(0,1\.26fr\)\]/);
        assert.match(deck, /translateY\(/);
    });

    it('renders dotted orbital floor ring and OrbitalModeDock in ActionDice when retro is active', () => {
        const dice = read('app/components/ActionDice.tsx');
        const modeDock = read('app/components/OrbitalModeDock.tsx');
        assert.match(dice, /const isRetro = preferences\.theme === 'retro'/);
        assert.match(dice, /orbital-dice-ring/);
        assert.match(dice, /<OrbitalModeDock/);
        assert.match(dice, /<DeploymentModeRail/);
        assert.match(modeDock, /export function OrbitalModeDock/);
        assert.match(modeDock, /role="radiogroup"/);
    });

    it('upgrades Retro game board recessed bays and orbital in-match LudoDice without altering 3077/Daybreak', () => {
        const board = read('app/styles/board.css');
        assert.match(board, /body\.theme-retro-futurism \.board-home\.green[\s\S]*#071110/);
        assert.match(board, /body\.theme-retro-futurism \.finish-core/);
        assert.match(board, /body\.theme-3077 \.board-home\.green/);
        assert.match(board, /body\.theme-daybreak \.board-grid/);

        const ludoDice = read('app/components/LudoDice.tsx');
        assert.match(ludoDice, /const isRetro = preferences\.theme === 'retro'/);
        assert.match(ludoDice, /DICE_RETRO_SKIN/);
        assert.match(ludoDice, /COLOR_MAP_RETRO/);
    });
});
