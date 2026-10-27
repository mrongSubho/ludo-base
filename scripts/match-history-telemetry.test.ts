/**
 * Match History Telemetry & Free Match Sync Queue tests.
 *
 * Verifies:
 * 1. Scoreboard drawer telemetry: participant profile includes `kicks` and `gotKicked`.
 * 2. Unsynced match panel consistency: tap-to-expand header states ("All Matches Synced On-Chain" vs "${count} Unsynced Matches ready to sync").
 * 3. Automatic backfill synchronization between /api/matches/history and /api/matches/unsynced.
 * 4. Combatant interactivity: clickable names and avatars popping up PublicProfileModal.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatWeb3Error } from '../lib/web3Error';

const root = join(import.meta.dirname ?? __dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

test('MatchParticipantProfile includes home, kicks and gotKicked metrics', () => {
    const historyRoute = read('app/api/matches/history/route.ts');
    assert.match(
        historyRoute,
        /home:\s*number;/,
        'MatchParticipantProfile must include home telemetry'
    );
    assert.match(
        historyRoute,
        /kicks:\s*number;/,
        'MatchParticipantProfile must include kicks telemetry'
    );
    assert.match(
        historyRoute,
        /gotKicked:\s*number;/,
        'MatchParticipantProfile must include gotKicked telemetry'
    );
});

test('both /api/matches/history and /api/matches/unsynced invoke backfillPlayerFreeMatches', () => {
    const historyRoute = read('app/api/matches/history/route.ts');
    const unsyncedRoute = read('app/api/matches/unsynced/route.ts');

    assert.match(
        historyRoute,
        /backfillPlayerFreeMatches/,
        'history route must invoke backfillPlayerFreeMatches'
    );
    assert.match(
        unsyncedRoute,
        /backfillPlayerFreeMatches/,
        'unsynced route must invoke backfillPlayerFreeMatches'
    );
});

test('UnsyncedMatchesPanel has tap-to-expand collapsible states with required titles', () => {
    const panelCode = read('app/components/UnsyncedMatchesPanel.tsx');

    // Title text checks
    assert.match(
        panelCode,
        /All Matches Synced On-Chain/,
        'Must display "All Matches Synced On-Chain" when 0 unsynced'
    );
    assert.match(
        panelCode,
        /\$\{count\}\s*Unsynced Matches ready to sync/,
        'Must display "${count} Unsynced Matches ready to sync" when > 0'
    );

    // Collapsible / Tap-to-Expand
    assert.match(panelCode, /isExpanded/, 'Must maintain isExpanded state');
    assert.match(panelCode, /setIsExpanded/, 'Must toggle isExpanded on click');
});

test('MatchHistoryTab renders participant home, kicks, gotKicked and wires PublicProfileModal', () => {
    const tabCode = read('app/components/MatchHistoryTab.tsx');

    assert.match(tabCode, /PublicProfileModal/, 'Must import and render PublicProfileModal');
    assert.match(tabCode, /p\.home/, 'Must display participant home count');
    assert.match(tabCode, /p\.kicks/, 'Must display participant kicks');
    assert.match(tabCode, /p\.gotKicked/, 'Must display participant gotKicked');
    assert.match(tabCode, /setSelectedProfileAddress/, 'Must trigger profile modal on participant click');
    assert.match(tabCode, /Winner/, 'Must display Winner badge');
    assert.match(tabCode, /Defeated/, 'Must display Defeated badge');
});

test('MatchStatsOverlay implements unified tactical design matching MatchHistoryTab with clickable profiles', () => {
    const overlayCode = read('app/components/MatchStatsOverlay.tsx');

    assert.match(overlayCode, /PublicProfileModal/, 'Must import and render PublicProfileModal');
    assert.match(overlayCode, /FiHome/, 'Must render FiHome icon');
    assert.match(overlayCode, /LuSwords/, 'Must render LuSwords icon');
    assert.match(overlayCode, /LuShieldAlert/, 'Must render LuShieldAlert icon');
    assert.match(overlayCode, /LuTrophy/, 'Must render LuTrophy icon');
    assert.match(overlayCode, /row\.home/, 'Must display row.home count');
    assert.match(overlayCode, /row\.kicks/, 'Must display row.kicks count');
    assert.match(overlayCode, /row\.gotKicked/, 'Must display row.gotKicked count');
    assert.match(overlayCode, /setSelectedProfileAddress/, 'Must support local profile modal trigger');
    assert.match(overlayCode, /onOpenProfile/, 'Must support onOpenProfile callback');
    assert.match(overlayCode, /Winner/, 'Must display Winner badge');
    assert.match(overlayCode, /Defeated/, 'Must display Defeated badge');
});

test('MatchHistoryTab uses Ranked Match branding instead of Paid', () => {
    const tabCode = read('app/components/MatchHistoryTab.tsx');

    assert.match(tabCode, /label:\s*'Ranked Match'/, 'Filter pill must be named Ranked Match');
    assert.match(tabCode, /'Ranked Match'/, 'Paid pool matches must display as Ranked Match');
    assert.ok(!tabCode.includes("label: 'Paid'"), 'Must not have Paid filter pill');
    assert.ok(!tabCode.includes("'Paid Pool'"), 'Must not display Paid Pool');
});

test('formatWeb3Error turns raw EVM/gas limit revert strings into clean player-friendly messages', () => {
    const gasError = 'The contract function "syncFreeMatches" reverted with the following reason: RPC 0x14a34 Custom eth_sendRawTransaction: exceeds max transaction gas limit Contract Call: address: 0xdfB78b0A8c1877156f00858c764CA72Ba4a6e2C6 function: syncFreeMatches(...) args: ([...50 items...]) Docs: https://viem.sh';
    const formatted = formatWeb3Error(new Error(gasError));
    assert.match(formatted, /gas limit/i, 'Must mention gas limit');
    assert.ok(!formatted.includes('0xdfB78b0A'), 'Must not leak contract address');
    assert.ok(!formatted.includes('Contract Call:'), 'Must not leak Contract Call internals');
    assert.ok(!formatted.includes('viem.sh'), 'Must not leak docs link');

    const userReject = 'User rejected the request.';
    assert.equal(formatWeb3Error(new Error(userReject)), 'Transaction cancelled in wallet.');

    const fundsError = 'insufficient funds for gas * price + value';
    assert.equal(formatWeb3Error(new Error(fundsError)), 'Insufficient ETH balance on Base for gas fee.');
});

test('/api/matches/unsynced enforces 10-match safe batch size and returns totalCount', () => {
    const unsyncedCode = read('app/api/matches/unsynced/route.ts');
    assert.match(unsyncedCode, /BATCH_SIZE\s*=\s*10/, 'Must define BATCH_SIZE = 10');
    assert.match(unsyncedCode, /totalCount/, 'Must include totalCount in response');
});

test('UnsyncedMatchesPanel renders batch progress button and uses formatWeb3Error', () => {
    const panelCode = read('app/components/UnsyncedMatchesPanel.tsx');
    assert.match(panelCode, /formatWeb3Error/, 'Must use formatWeb3Error');
    assert.match(panelCode, /batchCount/, 'Must read batchCount');
    assert.match(panelCode, /count > batchCount/, 'Must format batch progress button label');
});
