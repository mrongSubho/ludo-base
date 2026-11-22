import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname ?? __dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('3077 Tactical Command Console (LobbyCommandDeck)', () => {
    it('places POWER mode first on the armed slide-breaker and shifts Cyan <-> Amber accents', () => {
        const deck = read('app/components/LobbyCommandDeck.tsx');
        assert.match(deck, /const MODE_ORDER:\s*readonly LobbyGameMode\[\]\s*=\s*\['power',\s*'classic'\]/);
        assert.match(deck, /const accentHex = isPower \? '#F59E0B' : '#00E5FF'/);
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
});
