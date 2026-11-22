import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEPLOY_THEMES, isDeployModeId } from '../lib/deployTheme';

const root = join(import.meta.dirname ?? __dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('3077 Tactical Command Console & Deployment-Mode Theme', () => {
    it('defines Quick (Cyan), Team (Amber), and Offline (Emerald) deployment themes', () => {
        assert.equal(DEPLOY_THEMES.quick.hex, '#00E5FF');
        assert.equal(DEPLOY_THEMES.team.hex, '#F59E0B');
        assert.equal(DEPLOY_THEMES.offline.hex, '#00FF66');
        assert.equal(isDeployModeId('quick'), true);
        assert.equal(isDeployModeId('team'), true);
        assert.equal(isDeployModeId('offline'), true);
        assert.equal(isDeployModeId('invalid'), false);
    });

    it('places POWER mode first on the armed slide-breaker and uses TerminalTypeText without an overlay box', () => {
        const deck = read('app/components/LobbyCommandDeck.tsx');
        assert.match(deck, /const MODE_ORDER:\s*readonly LobbyGameMode\[\]\s*=\s*\['power',\s*'classic'\]/);
        assert.match(deck, /useDeployTheme\(/);
        assert.match(deck, /<TerminalTypeText/);
        assert.doesNotMatch(deck, /lobby-deck-rivet/);
        assert.match(deck, /role="radiogroup"/);
        assert.match(deck, /aria-label="Select Game Mode"/);
        assert.match(deck, /aria-label="Match Type"/);
        assert.match(deck, /prefersReducedMotion/);
        assert.match(deck, /setPointerCapture/);
    });

    it('uses TEAM_PAIRINGS and seatedColorsFor as single source of truth for formation radar glyphs', () => {
        const deck = read('app/components/LobbyCommandDeck.tsx');
        assert.match(deck, /import \{ TEAM_PAIRINGS \} from '@\/lib\/constants'/);
        assert.match(deck, /import \{ seatedColorsFor \} from '@\/lib\/engine\/core'/);
        assert.match(deck, /seatedColorsFor\(type\)/);
        assert.match(deck, /TEAM_PAIRINGS\.green/);
        assert.match(deck, /TEAM_PAIRINGS\.red/);
    });

    it('wires LobbyCommandDeck into 3077 GameLobby, omits tier name in fee bar, and matches expanded knob border', () => {
        const lobby = read('app/components/GameLobby.tsx');
        assert.match(lobby, /import \{ LobbyCommandDeck \} from '\.\/LobbyCommandDeck'/);
        assert.match(lobby, /<LobbyCommandDeck/);
        assert.match(lobby, /fee-tier-expanded-3077/);
        assert.match(lobby, /\{formatEntryFee\(wager\)\}/);
        assert.match(lobby, /\{formatEntryFee\(dialWager\)\}/);
        assert.doesNotMatch(lobby, /getEntryFeeTierName/);
    });

    it('defaults lobby boot to Power + 1v1 + Quick Match and syncs full HUD colors to ActionDice mode', () => {
        const page = read('app/page.tsx');
        assert.match(page, /useState<'classic' \| 'power'>\('power'\)/);
        assert.match(page, /useState<'1v1' \| '2v2' \| '4P'>\('1v1'\)/);

        const dice = read('app/components/ActionDice.tsx');
        assert.match(dice, /setDeployModeTheme\(/);
        assert.match(dice, /-left-24 sm:-left-28/);
        assert.match(dice, /-right-24 sm:-right-28/);
        assert.match(dice, /<TerminalTypeText/);

        const css = read('app/styles/themes/theme-3077.css');
        assert.match(css, /body\.theme-3077\[data-deploy-mode="team"\]/);
        assert.match(css, /body\.theme-3077\[data-deploy-mode="offline"\]/);
        assert.match(css, /--accent-rgb/);
        assert.match(css, /\.hud-header-coins-3077/);
        assert.match(css, /\.hud-header-name-3077/);
        assert.match(css, /\.hud-header-rank-3077/);
        assert.match(css, /\.hud-header-action-3077/);
        assert.match(css, /\.panel-child-rail-3077/);
    });
});
