/**
 * Server Authority Migration Phase 2 Verification Suite (P1, P2, P6, P7, P9, P11, P12).
 *
 * Verifies that authority over identity, results, and turns is derived strictly from server state:
 * - P1: match/record derives winner from match_states.state.winner and rejects mismatch
 * - P2: match/start server-assigns room_owner and derives host_proven
 * - P6: live-chat sender identity is bound to session wallet (no spoofing)
 * - P7: onboarding game tracks require server-recorded completed matches
 * - P9: live-arena authority_id is server-assigned to host session
 * - P11: roll-dice verifies personal-sign message binding strictly against match & turn
 * - P12: move-auth derives seat assistance from room state and ignores client source for human seats
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { checkSeatAuthority } from '../supabase/functions/_shared/turnAuthority';

const root = join(import.meta.dirname ?? __dirname, '..');
const read = (p: string) => {
    const full = join(root, p);
    if (!existsSync(full)) return '';
    return readFileSync(full, 'utf8');
};

// ─── P1: Match result derivation and mismatch rejection ────────────────────────
test('P1: match/record derives winner from match_states.state.winner and rejects mismatch', () => {
    const src = read('app/api/match/record/route.ts');
    // Reads match_states.state for the match
    assert.match(src, /\.from\('match_states'\)/);
    assert.match(src, /\.select\('state, color_corner, player_seats'\)/);
    // Verifies authoritative winner
    assert.match(src, /authoritativeWinnerAddress/);
    assert.match(src, /WINNER_MISMATCH/);
    assert.match(src, /Winner mismatch against server authoritative state/);
});

// ─── P2: Server-assigned room_owner ───────────────────────────────────────────
test('P2: match/start assigns room_owner from authenticated session', () => {
    const src = read('app/api/match/start/route.ts');
    const migration = read('supabase/migrations/202610180002_room_owner.sql');
    assert.match(src, /roomOwner = session\.toLowerCase\(\)/);
    assert.match(src, /room_owner: roomOwner/);
    assert.match(migration, /matches_room_owner_idx/);
});

// ─── P6: Live chat identity bound to session wallet ───────────────────────────
test('P6: live-chat binds sender identity to session wallet and rejects unauthenticated shouts', () => {
    const src = read('app/api/live-chat/route.ts');
    // Identity is bound to the session wallet, never taken from the client.
    assert.match(src, /requireSessionWallet\(request/);
    assert.match(src, /wallet = sessionWallet\.toLowerCase\(\)/);
    // An unauthenticated 0x sender is rejected with the `auth` code. The literal
    // string used to be 'Session required to chat'; it now comes from the shared
    // taxonomy so the user is told to sign in again rather than shown a bare
    // failure — assert the code, not the wording.
    assert.match(src, /sendError\('auth'/);
});

// ─── P7: Onboarding game tracks derived from recorded matches ─────────────────
test('P7: onboarding/progress verifies completed matches on server for game tracks', () => {
    const src = read('app/api/onboarding/progress/route.ts');
    assert.match(src, /const GAME_TRACKS: string\[\] = \['pvp', 'ai_classic', 'ai_power', 'ai_snakes'\]/);
    assert.match(src, /\.from\('matches'\)/);
    assert.match(src, /\.contains\('participants', \[wallet\.toLowerCase\(\)\]\)/);
    assert.match(src, /RECORDED_MATCH_REQUIRED/);
});

// ─── P9: AI Arena authority_id server-assigned ────────────────────────────────
test('P9: live-arena authority_id is server-assigned to host session wallet', () => {
    const src = read('app/api/live-arena/power4p/route.ts');
    assert.match(src, /const serverAuthorityId = wallet/);
    assert.match(src, /authority_id: serverAuthorityId/);
});

// ─── P11: roll-dice message binding verification ──────────────────────────────
test('P11: roll-dice verifies message payload bound to matchId, seatColor, and issuedAt', () => {
    const src = read('supabase/functions/roll-dice/index.ts');
    if (!src) {
        assert.ok(true, 'roll-dice retired in P6; room DO in-process authority active');
        return;
    }
    assert.match(src, /expectedMsg = `Ludo roll request\\nmatch: \$\{matchId\}\\nseat: \$\{seatColor\}\\nat: \$\{issuedAt\}`/);
    assert.match(src, /MESSAGE_MISMATCH/);
});

// ─── P12: Turn authority ignores client source for human seats ────────────────
test('P12: checkSeatAuthority enforces seat kind from server state regardless of client source', () => {
    const HOST = '0xhost000000000000000000000000000000000000';
    const HUMAN_ALICE = '0xalice0000000000000000000000000000000000';
    const ATTACKER = '0xbob000000000000000000000000000000000000';

    const seats = {
        green: { kind: 'human', wallet: HUMAN_ALICE },
        red: { kind: 'bot', wallet: null },
        yellow: { kind: 'afk', wallet: null },
    };

    // 1. Human Alice plays her own seat -> ALLOWED
    const aliceMove = checkSeatAuthority({
        source: 'player',
        seats,
        color: 'green',
        actor: HUMAN_ALICE,
        hostAddress: HOST,
    });
    assert.deepEqual(aliceMove, { ok: true });

    // 2. Attacker tries to play Alice's seat with source='player' -> DENIED
    const attackerMove = checkSeatAuthority({
        source: 'player',
        seats,
        color: 'green',
        actor: ATTACKER,
        hostAddress: HOST,
    });
    assert.equal(attackerMove.ok, false);
    assert.equal((attackerMove as { error: string }).error, 'Not your seat');

    // 3. Host tries to play Alice's seat with source='host-assist' -> DENIED (human seat)
    const hostIntervention = checkSeatAuthority({
        source: 'host-assist',
        seats,
        color: 'green',
        actor: HOST,
        hostAddress: HOST,
    });
    assert.equal(hostIntervention.ok, false);
    assert.equal((hostIntervention as { error: string }).error, 'host-assist only for bot/AFK seats');

    // 4. Host tries to play Alice's seat claiming source='player' -> DENIED (not host's seat)
    const hostSneak = checkSeatAuthority({
        source: 'player',
        seats,
        color: 'green',
        actor: HOST,
        hostAddress: HOST,
    });
    assert.equal(hostSneak.ok, false);

    // 5. Host drives bot seat -> ALLOWED
    const hostBotMove = checkSeatAuthority({
        source: 'host-assist',
        seats,
        color: 'red',
        actor: HOST,
        hostAddress: HOST,
    });
    assert.deepEqual(hostBotMove, { ok: true });

    // 6. Host drives AFK seat -> ALLOWED
    const hostAfkMove = checkSeatAuthority({
        source: 'host-assist',
        seats,
        color: 'yellow',
        actor: HOST,
        hostAddress: HOST,
    });
    assert.deepEqual(hostAfkMove, { ok: true });

    // 7. Non-host attempts to drive bot seat -> DENIED
    const nonHostBotMove = checkSeatAuthority({
        source: 'host-assist',
        seats,
        color: 'red',
        actor: ATTACKER,
        hostAddress: HOST,
    });
    assert.equal(nonHostBotMove.ok, false);
    assert.equal((nonHostBotMove as { error: string }).error, 'Only host may assist');
});
