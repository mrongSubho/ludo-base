import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname ?? __dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('Retro Theme Redesign (Orbital Canopy + Minimal Arcade CRT)', () => {
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

    it('implements Option B OrbitalCanopyDeck with concentric SVG annular arcs and ARIA radiogroups', () => {
        const canopy = read('app/components/OrbitalCanopyDeck.tsx');
        assert.match(canopy, /export function OrbitalCanopyDeck/);
        assert.match(canopy, /role="radiogroup"/);
        assert.match(canopy, /aria-label="Select Game Mode"/);
        assert.match(canopy, /aria-label="Match Type"/);
        assert.match(canopy, /CLASSIC/);
        assert.match(canopy, /POWER/);
        assert.match(canopy, /useDeployTheme\(/);
        assert.match(canopy, /prefersReducedMotion/);
        assert.doesNotMatch(canopy, /rgba\(0,\s*229,\s*255/);
        assert.doesNotMatch(canopy, /rgba\(34,\s*211,\s*238/);
    });

    it('implements in-place OrbitalFeeDock preset drawer with 1-tap CHIPS presets', () => {
        const dock = read('app/components/OrbitalFeeDock.tsx');
        assert.match(dock, /export function OrbitalFeeDock/);
        assert.match(dock, /fee-tier-expanded-retro/);
        assert.match(dock, /FREE/);
        assert.match(dock, /10M/);
        assert.match(dock, /playableChips/);
    });

    it('mounts OrbitalCanopyDeck + OrbitalFeeDock in GameLobby for retro without breaking 3077', () => {
        const lobby = read('app/components/GameLobby.tsx');
        assert.match(lobby, /const isRetro = preferences\.theme === 'retro'/);
        assert.match(lobby, /<OrbitalCanopyDeck/);
        assert.match(lobby, /<OrbitalFeeDock/);
        assert.match(lobby, /<LobbyCommandDeck/);
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
