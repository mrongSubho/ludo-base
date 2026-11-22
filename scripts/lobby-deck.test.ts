import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname ?? __dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('3077 Tactical Command Console (LobbyCommandDeck)', () => {
    it('places POWER mode first on the armed slide-breaker and shifts Cyan <-> Amber accents without an overlay box', () => {
        const deck = read('app/components/LobbyCommandDeck.tsx');
        assert.match(deck, /const MODE_ORDER:\s*readonly LobbyGameMode\[\]\s*=\s*\['power',\s*'classic'\]/);
        assert.match(deck, /const accentHex = isPower \? '#F59E0B' : '#00E5FF'/);
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

    it('wires LobbyCommandDeck into 3077 GameLobby only and omits tier name from the Entry Fee dock bar', () => {
        const lobby = read('app/components/GameLobby.tsx');
        assert.match(lobby, /import \{ LobbyCommandDeck \} from '\.\/LobbyCommandDeck'/);
        assert.match(lobby, /<LobbyCommandDeck/);
        assert.match(lobby, /\{formatEntryFee\(wager\)\}/);
        assert.match(lobby, /\{formatEntryFee\(dialWager\)\}/);
        assert.doesNotMatch(lobby, /getEntryFeeTierName/);
    });

    it('defaults lobby boot to Power + 1v1 + Quick Match and syncs ruleset color across ActionDice, DeploymentModeRail, and EntryFeeKnob', () => {
        const page = read('app/page.tsx');
        assert.match(page, /useState<'classic' \| 'power'>\('power'\)/);
        assert.match(page, /useState<'1v1' \| '2v2' \| '4P'>\('1v1'\)/);

        const dice = read('app/components/ActionDice.tsx');
        assert.match(dice, /const rulesetHex3077 = gameMode === 'power' \? '#F59E0B' : '#00E5FF'/);
        assert.match(dice, /accentHex=\{rulesetHex3077\}/);
        assert.match(dice, /data-ruleset=\{gameMode\}/);

        const css = read('app/styles/themes/theme-3077.css');
        assert.match(css, /\.dice-tier\[data-ruleset='power'\]/);

        const lobby = read('app/components/GameLobby.tsx');
        assert.match(lobby, /<ActionDice\s+gameMode=\{gameMode\}/);
    });
});
