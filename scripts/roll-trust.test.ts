/**
 * Roll-receipt trust boundary (Phase 2 / SEC-01, SEC-33).
 *
 * Tests the real authorization logic — it lives in
 * `supabase/functions/_shared/rollReceipt.ts` as pure functions precisely so it
 * can be executed here instead of being asserted by reading Edge source, which
 * is all the `dice-trust` suite could manage for the React effect.
 *
 * The headline property: **retry until you roll a six is impossible.** A second
 * mint in the same turn returns the first face. Before this, `roll-dice` took a
 * client-chosen `actionId`, so the (match_id, action_id) idempotency it claimed
 * to provide bound nothing — a fresh id per attempt minted a fresh face.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    checkRollBinding,
    decideRollMint,
    isFreshRollRequest,
    isSeatColor,
    SEAT_COLORS,
} from '../supabase/functions/_shared/rollReceipt';

const HOST = '0xbcCa5DcBF293D98A627fD3814D5AE8249bB1DFaF'.toLowerCase();
const ADA = '0xada0000000000000000000000000000000000001'.toLowerCase();
const CY = '0xcy000000000000000000000000000000000000002'.toLowerCase();

const seats: Record<string, string> = { green: ADA, red: HOST };
const seatWallet = (c: string) => seats[c] ?? null;

const goodRoll = (over: Record<string, unknown> = {}) => ({
    id: 'r1',
    result: 6,
    match_id: 'm1',
    status: 'open',
    seat_color: 'green',
    turn_seq: 7,
    wallet_address: HOST,
    ...over,
});

// ── Binding: what may spend a receipt ───────────────────────────────────────

test('a receipt may be spent by its own seat, in its own turn, by its minter', () => {
    assert.deepEqual(
        checkRollBinding({ roll: goodRoll(), color: 'green', seq: 7, hostAddress: HOST, seatWallet }),
        { ok: true },
    );
});

test('a receipt cannot be spent on another seat', () => {
    const v = checkRollBinding({ roll: goodRoll(), color: 'red', seq: 7, hostAddress: HOST, seatWallet });
    assert.equal(v.ok, false);
    assert.equal(v.ok === false && v.status, 403);
});

test('a receipt cannot be spent by a later turn', () => {
    // This is SEC-01's "a roll can only be spent by the turn that minted it".
    const v = checkRollBinding({ roll: goodRoll(), color: 'green', seq: 8, hostAddress: HOST, seatWallet });
    assert.equal(v.ok, false);
    assert.equal(v.ok === false && v.code, 'STALE_SEQ');
});

test('a receipt cannot be replayed against an earlier turn either', () => {
    const v = checkRollBinding({ roll: goodRoll(), color: 'green', seq: 6, hostAddress: HOST, seatWallet });
    assert.equal(v.ok === false && v.code, 'STALE_SEQ');
});

test('an unbound receipt is refused, not guessed at', () => {
    // Pre-migration rows have no seat/turn. Refusing is the only safe answer:
    // inferring a seat could let a roll be spent against the wrong colour.
    for (const bad of [{ seat_color: null }, { seat_color: undefined }, { turn_seq: null }]) {
        const v = checkRollBinding({
            roll: goodRoll(bad),
            color: 'green',
            seq: 7,
            hostAddress: HOST,
            seatWallet,
        });
        assert.equal(v.ok, false, JSON.stringify(bad));
        assert.equal(v.ok === false && v.code, 'ROLL_UNBOUND');
    }
});

test('a receipt from an unknown seat is unbound, not trusted', () => {
    const v = checkRollBinding({
        roll: goodRoll({ seat_color: 'purple' }),
        color: 'purple',
        seq: 7,
        hostAddress: HOST,
        seatWallet: () => 'purple',
    });
    assert.equal(v.ok === false && v.code, 'ROLL_UNBOUND');
});

test('a receipt minted by an unrelated wallet is refused', () => {
    const v = checkRollBinding({
        roll: goodRoll({ wallet_address: CY }),
        color: 'green',
        seq: 7,
        hostAddress: HOST,
        seatWallet,
    });
    assert.equal(v.ok, false);
    assert.equal(v.ok === false && v.error, 'Roll was not minted by this match');
});

test('the seat owner may mint and spend their own receipt', () => {
    assert.deepEqual(
        checkRollBinding({
            roll: goodRoll({ wallet_address: ADA }),
            color: 'green',
            seq: 7,
            hostAddress: HOST,
            seatWallet,
        }),
        { ok: true },
    );
});

test('a bot seat is spendable because the host minted it', () => {
    // SEC-33: hosted bots and AFK seats roll through the host. There is no human
    // wallet for the seat, so `seatWallet` returns null and the host is the only
    // permitted minter. Previously the client sent a literal "<color>-bot"
    // string as wallet_address, which cannot satisfy the players FK — so hosted
    // bots could not roll at all.
    const v = checkRollBinding({
        roll: goodRoll({ seat_color: 'blue', wallet_address: HOST }),
        color: 'blue',
        seq: 7,
        hostAddress: HOST,
        seatWallet: () => null,
    });
    assert.deepEqual(v, { ok: true });
});

test('a missing receipt is a 404, and wallet comparison is case-insensitive', () => {
    const v = checkRollBinding({ roll: null, color: 'green', seq: 7, hostAddress: HOST, seatWallet });
    assert.equal(v.ok === false && v.status, 404);
    assert.deepEqual(
        checkRollBinding({
            roll: goodRoll({ wallet_address: HOST.toUpperCase() }),
            color: 'green',
            seq: 7,
            hostAddress: HOST.toUpperCase(),
            seatWallet,
        }),
        { ok: true },
    );
});

// ── Minting: may a new face be produced ─────────────────────────────────────

const mint = (over: Record<string, unknown> = {}) => ({
    matchFound: true,
    hostAddress: HOST,
    minter: HOST,
    statePresent: true,
    terminal: false,
    currentPlayer: 'green',
    seatColor: 'green',
    existingRoll: null,
    ...over,
});

test('the host mints a face for the seat whose turn it is', () => {
    assert.deepEqual(decideRollMint(mint()), { ok: true, action: 'mint' });
});

test('RETRY UNTIL SIX IS IMPOSSIBLE: a second mint in the same turn replays', () => {
    const first = decideRollMint(mint());
    assert.deepEqual(first, { ok: true, action: 'mint' });

    // Whatever the caller does on the second attempt — new actionId, new
    // signature, same body — the existing receipt comes back verbatim.
    const existing = goodRoll({ id: 'r-first', result: 6, seat_color: 'green', turn_seq: 7 });
    const second = decideRollMint(mint({ existingRoll: existing }));
    assert.equal(second.ok, true);
    assert.equal(second.ok === true && second.action, 'replay');
    assert.equal(second.ok === true && second.action === 'replay' && second.roll.result, 6);
});

test('a non-host cannot mint a roll', () => {
    const v = decideRollMint(mint({ minter: ADA }));
    assert.equal(v.ok, false);
    assert.equal(v.ok === false && v.status, 403);
});

test('a roll cannot be minted for a seat that is not on turn', () => {
    const v = decideRollMint(mint({ seatColor: 'red' }));
    assert.equal(v.ok, false);
    assert.equal(v.ok === false && v.status, 403);
    assert.equal(v.ok === false && v.error, 'Not this seat turn');
});

test('a finished or unseeded match mints nothing', () => {
    assert.equal(decideRollMint(mint({ terminal: true })).ok, false);
    assert.equal(decideRollMint(mint({ statePresent: false })).ok, false);
    assert.equal(decideRollMint(mint({ matchFound: false })).ok, false);
});

test('a match with no host mints nothing', () => {
    const v = decideRollMint(mint({ hostAddress: null }));
    assert.equal(v.ok === false && v.status, 403);
});

test('an unknown seat colour is rejected before any state is touched', () => {
    const v = decideRollMint(mint({ seatColor: 'purple' }));
    assert.equal(v.ok === false && v.status, 400);
    for (const c of SEAT_COLORS) assert.equal(isSeatColor(c), true);
    for (const c of ['purple', '', null, 3, 'GREEN']) assert.equal(isSeatColor(c), false);
});

// ── Freshness of the one-off signature fallback ─────────────────────────────

test('a stale or absent issuedAt cannot authorize a roll', () => {
    const now = 1_700_000_000_000;
    assert.equal(isFreshRollRequest(new Date(now).toISOString(), now), true);
    assert.equal(isFreshRollRequest(new Date(now - 30_000).toISOString(), now), true);
    assert.equal(isFreshRollRequest(new Date(now - 200_000).toISOString(), now), false);
    assert.equal(isFreshRollRequest(new Date(now + 600_000).toISOString(), now), false);
    assert.equal(isFreshRollRequest(undefined, now), false);
    assert.equal(isFreshRollRequest('', now), false);
    assert.equal(isFreshRollRequest('not-a-date', now), false);
});

// ── Wiring: the Edge functions must actually use the tested rules ───────────
//
// The rules above are only worth anything if the Edge handlers call them, and
// Deno is not installed here so these functions cannot be executed in CI. These
// are source assertions and are labelled as such — weaker than the behavioural
// tests, and the gap is real.

const root = join(import.meta.dirname ?? __dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const code = (p: string) =>
    read(p)
        .split('\n')
        .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*'))
        .join('\n');

test('roll-dice no longer trusts the body for attribution', () => {
    const src = code('supabase/functions/roll-dice/index.ts');
    // The original accepted `walletAddress` from the caller and wrote it into
    // the receipt, so anyone could attribute a roll to any existing player.
    assert.doesNotMatch(src, /body\.walletAddress/, 'must not read walletAddress from the body');
    assert.doesNotMatch(src, /wallet_address:\s*String\(body/, 'must not write a body wallet into the receipt');
    assert.match(src, /wallet_address:\s*minter/, 'the receipt wallet must be the recovered minter');
});

test('roll-dice requires authentication before it mints', () => {
    const src = code('supabase/functions/roll-dice/index.ts');
    assert.match(src, /if \(!sessionId && !signature\)/, 'must demand a session or a signature');
    assert.match(src, /verifyMatchSession\(/, 'must verify the match session');
    assert.match(src, /verifyPersonalSign\(/, 'must verify the one-off signature fallback');
    // Authentication must come before the mint decision, not after.
    assert.ok(src.indexOf('verifyPersonalSign(') < src.indexOf('decideRollMint('));
    assert.ok(src.indexOf('verifyMatchSession(') < src.indexOf('decideRollMint('));
});

test('roll-dice delegates authorization to the tested decision function', () => {
    const src = code('supabase/functions/roll-dice/index.ts');
    assert.match(src, /decideRollMint\(/);
    // It must not open-code a second "is this the host" check that can drift.
    assert.doesNotMatch(src, /Only the host may mint rolls/, 'the host rule belongs in decideRollMint');
});

test('move-auth binds the receipt in both the move and the pass handler', () => {
    const src = code('supabase/functions/move-auth/index.ts');
    assert.match(src, /checkRollBinding\(/);
    // One call per handler; a pass that skipped the check would let a spent
    // turn's roll be reused to hand the turn over on demand.
    assert.equal((src.match(/checkRollBinding\(\{/g) || []).length, 2, 'move and pass must both bind the roll');
    assert.match(src, /select\('id, result, match_id, status, seat_color, turn_seq, wallet_address'\)/);
    assert.equal(
        (src.match(/select\('id, result, match_id, status, seat_color, turn_seq, wallet_address'\)/g) || []).length,
        2,
        'both handlers must read the binding columns',
    );
});

test('the session verifier is shared, not duplicated per function', () => {
    const shared = code('supabase/functions/_shared/matchSession.ts');
    assert.match(shared, /export async function verifyMatchSession/);
    for (const f of ['move-auth', 'roll-dice']) {
        assert.match(
            code(`supabase/functions/${f}/index.ts`),
            /from '\.\.\/_shared\/matchSession\.ts'/,
            `${f} must import the shared verifier`,
        );
    }
    // Exactly one implementation in the repo.
    assert.equal(
        (read('supabase/functions/move-auth/index.ts').match(/async function verifyMatchSession\(/g) || []).length,
        0,
        'move-auth must not keep its own copy',
    );
});
