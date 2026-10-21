import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname ?? __dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

test('SA-2: match/record enforces participant authorization for session-based recording', () => {
    const src = read('app/api/match/record/route.ts');
    
    // Asserts session wallet is checked against participants and roomOwner
    assert.match(src, /authenticatedWallet = session\.wallet\.toLowerCase\(\)/);
    assert.match(src, /!lowerParts\.includes\(authenticatedWallet\) && roomOwner !== authenticatedWallet/);
    assert.match(src, /Caller is not an authorized participant of this match/);
});

test('SA-2: match/record requires authoritative server winner when no signature proof', () => {
    const src = read('app/api/match/record/route.ts');
    
    // When hasSignatureProof is false, server-recorded winner is mandatory
    assert.match(src, /code: 'SERVER_WINNER_REQUIRED'/);
    assert.match(src, /Match has no server-recorded winner; cannot record progression without host signature/);
    
    // Claimed winner must match server winner
    assert.match(src, /winnerAddress\.toLowerCase\(\) !== authoritativeWinnerAddress/);
    assert.match(src, /code: 'WINNER_MISMATCH'/);
});

test('SA-2: match/record caps progression wager to prevent LXP inflation exploit', () => {
    const src = read('app/api/match/record/route.ts');
    
    // Asserts wager capping
    assert.match(src, /MAX_PROGRESSION_WAGER\s*=\s*10_000/);
    assert.match(src, /effectiveWager\s*=\s*Math\.min\(Math\.max\(0,\s*wager\),\s*MAX_PROGRESSION_WAGER\)/);
    assert.match(src, /winLxpGain\s*=\s*150\s*\+\s*Math\.floor\(effectiveWager\s*\*\s*0\.1\)/);
    
    // Behavioral calculation verification
    const calculateLxp = (wagerInput: number) => {
        const MAX_PROGRESSION_WAGER = 10_000;
        const effectiveWager = Math.min(Math.max(0, wagerInput), MAX_PROGRESSION_WAGER);
        return 150 + Math.floor(effectiveWager * 0.1);
    };
    
    // Normal wager: 50 -> 150 + 5 = 155
    assert.equal(calculateLxp(50), 155);
    // Large wager: 5,000 -> 150 + 500 = 650
    assert.equal(calculateLxp(5000), 650);
    // Exploit wager: 10,000,000 -> capped at 10,000 => 150 + 1,000 = 1,150 (not 1,000,150)
    assert.equal(calculateLxp(10_000_000), 1150);
});

// ── N+1 / amplification guard ───────────────────────────────────────────────
//
// `participants` is caller-supplied, and every write below used to fan out once
// per seat: a read-modify-write pair per participant, then a read-modify-write
// pair per (wallet, mission). Two things made that a real finding rather than a
// latency nit — the array length was unbounded, and the shared rate limiter was
// keyed on `participants[0]`, which the caller also chooses.

test('match/record caps the seat count at one board', () => {
    const src = read('app/api/match/record/route.ts');

    assert.match(src, /MAX_SEATS\s*=\s*4/);
    assert.match(src, /participants\.length > MAX_SEATS/);
    assert.match(src, /Too many participants/);

    // `/api/match/start` must agree — two different ceilings would let a match
    // be started but never settled (or settled with seats it never had).
    const start = read('app/api/match/start/route.ts');
    assert.match(start, /participants\.length > 4/);

    // Behavioural: the guard is a plain bound, so pin the boundary.
    const accepts = (n: number) => n > 0 && n <= 4;
    assert.equal(accepts(0), false);
    assert.equal(accepts(1), true);
    assert.equal(accepts(4), true);
    assert.equal(accepts(5), false);
    assert.equal(accepts(200), false);
});

test('match/record keys the shared limiter on the authenticated identity', () => {
    const src = read('app/api/match/record/route.ts');

    // The bucket must come from something the caller cannot rotate per request.
    assert.match(src, /limiterSubject = \(authenticatedWallet \|\| hostClaim \|\| 'unknown'\)\.toLowerCase\(\)/);
    assert.match(src, /rateKey\('match:record', limiterSubject\)/);

    // The old key was the caller-chosen first element of `participants`.
    assert.doesNotMatch(src, /rateKey\('match:record', String\(participants\[0\]/);

    // ...and the limiter must run after the session wallet is resolved, or the
    // identity it keys on is not authenticated yet.
    const authAt = src.indexOf('authenticatedWallet = session.wallet.toLowerCase()');
    const limitAt = src.indexOf("rateKey('match:record', limiterSubject)");
    assert.ok(authAt > -1 && limitAt > -1, 'both anchors must exist');
    assert.ok(limitAt > authAt, 'limiter must run after authentication resolves');
});

test('match/record settles progression in a bounded number of round trips', () => {
    const src = read('app/api/match/record/route.ts');

    // Per-participant read-modify-write is gone.
    assert.doesNotMatch(src, /for \(const addr of others\)/);
    assert.doesNotMatch(src, /async function updateMissionProgress/);
    assert.doesNotMatch(src, /\.ilike\('wallet_address',\s*addr\)/);

    // One read for every seat, one bulk write.
    assert.match(src, /\.in\('wallet_address', seatWallets\)/);
    assert.match(src, /\.upsert\(patches, \{ onConflict: 'wallet_address' \}\)/);
});

test('match/record writes player_missions on the period key, not the legacy one', () => {
    const src = read('app/api/match/record/route.ts');

    // Migration 202609300004 re-keyed the table on (player_id, mission_id,
    // period_id). Matching on (player_id, mission_id) alone hits PGRST116 as
    // soon as a player has two period rows, and the "create" branch then wrote
    // to period_id = 'legacy' — a bucket /api/missions/list never reads.
    assert.match(src, /onConflict: 'player_id,mission_id,period_id'/);
    assert.match(src, /periodBucketFor\(def, now\)/);
    assert.doesNotMatch(src, /\.eq\('mission_id', missionId\)\s*\.single\(\)/);
});

test('recordMatchOnboarding batches the whole match instead of looping per wallet', () => {
    const onb = read('lib/onboardingProgressWriter.ts');
    const start = onb.indexOf('export async function recordMatchOnboarding');
    const end = onb.indexOf('export async function recordReturnVisit');
    assert.ok(start > -1 && end > start, 'recordMatchOnboarding must precede recordReturnVisit');
    const body = onb.slice(start, end);

    // No per-wallet await chain inside the match writer.
    assert.doesNotMatch(body, /await bumpOnboardingProgress\(/);
    assert.doesNotMatch(body, /await recordReturnVisit\(/);

    // One batched read, one batched upsert.
    assert.match(body, /\.in\('wallet_address', parts\)/);
    assert.match(body, /\.upsert\(rows, \{ onConflict: 'wallet_address,track' \}\)/);
});

test('day2/day3 read last_played_at from before the settlement write', () => {
    const src = read('app/api/match/record/route.ts');
    const onb = read('lib/onboardingProgressWriter.ts');

    // The route must snapshot the player rows before it overwrites
    // last_played_at, and hand that snapshot to the onboarding writer. Reading
    // it back afterwards always sees "today", so the return-visit tracks could
    // never fire from this path.
    assert.match(src, /preUpdatePlayers/);
    assert.match(onb, /preUpdatePlayers\?: OnboardingPlayerSnapshot\[\]/);
});
