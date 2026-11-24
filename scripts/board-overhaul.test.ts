import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    evaluateRematchOutcome,
    parseRematchPayload,
    REMATCH_TIMEOUT_MS,
} from '../lib/rematch';

const root = join(import.meta.dirname ?? __dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('Board Visual Overhaul, Split Terminal HUD & Online Rematch Flow', () => {
    it('validates rematch payloads and evaluates accept, decline, partial hybrid fill, and solo fallback', () => {
        assert.equal(REMATCH_TIMEOUT_MS, 15_000);

        const parsed = parseRematchPayload({
            kind: 'propose',
            proposalId: 'prop-1',
            color: 'green',
            t: Date.now(),
        });
        assert.ok(parsed);
        assert.equal(parsed.kind, 'propose');
        assert.equal(parseRematchPayload({ kind: 'bad', proposalId: 'x', color: 'green', t: 1 }), null);

        // 1v1: both accept -> rematch all
        const allOk = evaluateRematchOutcome({
            votes: { green: 'accepted', yellow: 'accepted' },
            humanColors: ['green', 'yellow'],
            myColor: 'green',
            playerCount: '1v1',
            expired: false,
        });
        assert.equal(allOk.outcome, 'all_accepted');
        assert.equal(allOk.slotsNeeded, 0);

        // 1v1: opponent declines -> accepter routes to solo quick search
        const soloFallback = evaluateRematchOutcome({
            votes: { green: 'accepted', yellow: 'declined' },
            humanColors: ['green', 'yellow'],
            myColor: 'green',
            playerCount: '1v1',
            expired: false,
        });
        assert.equal(soloFallback.outcome, 'solo_quick_search');
        assert.equal(soloFallback.slotsNeeded, 1);

        // 4P: 3 accept, 1 declines -> hybrid quick search for remaining 1 seat
        const hybridFallback = evaluateRematchOutcome({
            votes: { green: 'accepted', red: 'accepted', yellow: 'accepted', blue: 'declined' },
            humanColors: ['green', 'red', 'yellow', 'blue'],
            myColor: 'green',
            playerCount: '4P',
            expired: false,
        });
        assert.equal(hybridFallback.outcome, 'hybrid_quick_search');
        assert.equal(hybridFallback.slotsNeeded, 1);
        assert.deepEqual(hybridFallback.acceptedColors, ['green', 'red', 'yellow']);

        // Timeout expiry resolves for remaining proposer vs declined opponent
        const timeoutStarter = evaluateRematchOutcome({
            votes: { green: 'accepted' },
            humanColors: ['green', 'red', 'yellow', 'blue'],
            myColor: 'green',
            playerCount: '2v2',
            expired: true,
        });
        assert.equal(timeoutStarter.outcome, 'solo_quick_search');

        const timeoutDecliner = evaluateRematchOutcome({
            votes: { green: 'accepted', yellow: 'declined' },
            humanColors: ['green', 'yellow'],
            myColor: 'yellow',
            playerCount: '1v1',
            expired: true,
        });
        assert.equal(timeoutDecliner.outcome, 'declined');
    });

    it('fixes 3077 & Retro board-home bays (!important), tames 3077 orb glow, and restores Daybreak saturated player colors', () => {
        const boardCss = read('app/styles/board.css');

        assert.match(boardCss, /body\.theme-3077 \.board-home\.green[\s\S]*#060a08\s*!important/);
        assert.match(boardCss, /body\.theme-retro-futurism \.board-home\.green\s*\{[^}]*#071110[^}]*!important/);
        assert.match(boardCss, /body\.theme-3077\.token-style-orb \.ludo-token[\s\S]*filter:\s*none;/);
        assert.match(boardCss, /body\.theme-daybreak \.board-home\.green\s*\{[\s\S]*#16a34a/);
        assert.doesNotMatch(boardCss, /body\.theme-daybreak \.board-home\.green\s*\{[\s\S]*#edf9f1/);
        assert.match(boardCss, /body\.theme-daybreak \.board-turn-status\.is-yours[\s\S]*var\(--accent\)/);
        assert.match(boardCss, /\.match-stats-row\s*\{[\s\S]*flex-direction:\s*column/);
        assert.match(boardCss, /\.board-self-prompt/);
    });

    it('renders PilotAvatar across PlayerInfoRow, MatchStatsOverlay, and PlayerProfileSheet and batch-syncs opponent profiles', () => {
        const row = read('app/components/PlayerInfoRow.tsx');
        const stats = read('app/components/MatchStatsOverlay.tsx');
        const sheet = read('app/components/PlayerProfileSheet.tsx');
        const layoutHook = read('hooks/useBoardLayout.ts');

        assert.match(row, /<PilotAvatar/);
        assert.match(stats, /<PilotAvatar/);
        assert.match(sheet, /<PilotAvatar/);
        assert.match(layoutHook, /\.in\('wallet_address',\s*wallets\)/);
    });

    it('splits opponent status top vs self TerminalTypeText prompt bottom and removes cramped home deploy pill', () => {
        const board = read('app/components/Board.tsx');
        const row = read('app/components/PlayerInfoRow.tsx');
        const home = read('app/components/BoardHome.tsx');

        assert.match(board, /<TerminalTypeText/);
        assert.match(board, /centerPrompt=\{selfPrompt\}/);
        assert.match(row, /<TerminalTypeText/);
        assert.match(row, /board-self-prompt/);
        assert.doesNotMatch(home, /home-deploy-anchor/);
        assert.doesNotMatch(home, /fontSize:\s*isDone\s*\?\s*'14px'\s*:\s*'9px'/);
    });
});
