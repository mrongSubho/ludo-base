import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Phase 1 exit gate: concurrent money mutations must not double-credit or overdraw.
 *
 * These are the assertions that the read-then-write review findings (SEC-09
 * mission double-claim, SEC-05 spectator bet) actually needed. They are proven
 * against a real Postgres because the whole failure mode is transactional
 * interleaving, which a mocked client cannot reproduce.
 *
 * Skips unless LUDO_SCHEMA_DB_URL is set, so `npm test` stays dependency-free;
 * CI provides a postgres:17 service (see .github/workflows/ci.yml).
 *
 * Note on the retired path: the original gate text said "N concurrent
 * missions/claim". That route is now 410 Gone (coin rewards are frozen), so the
 * equivalent invariant is asserted against the CHIPS voucher claim lock, which
 * is the live reward path.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const url = process.env.LUDO_SCHEMA_DB_URL;
const enabled = Boolean(url);

// Loaded lazily in before(): a top-level await breaks the CJS transform that
// `npx tsx --test` uses, and `pg` must stay an optional dependency.
let pg: { Client: new (cfg: { connectionString: string }) => Client } | null = null;

function chainSql(): string {
    const dir = join(root, 'supabase', 'migrations');
    return readdirSync(dir)
        .filter((f) => f.endsWith('.sql'))
        .sort()
        .map((f) => readFileSync(join(dir, f), 'utf8'))
        .join('\n;\n');
}

type Client = import('pg').Client;

async function connect(): Promise<Client> {
    if (!pg) throw new Error('pg not loaded');
    const c = new pg.Client({ connectionString: url! });
    await c.connect();
    return c;
}

/** Run `fn` on N genuinely separate connections so the transactions overlap. */
async function concurrently(n: number, fn: (c: Client, i: number) => Promise<void>) {
    const clients = await Promise.all(Array.from({ length: n }, () => connect()));
    try {
        return await Promise.all(
            clients.map(async (c, i) => {
                try {
                    await fn(c, i);
                } finally {
                    await c.end();
                }
            }),
        );
    } finally {
        await Promise.all(clients.map((c) => c.end().catch(() => {})));
    }
}

/** Classify a Postgres error without depending on driver internals. */
function sqlState(e: unknown): string | null {
    const code = (e as { code?: string } | null)?.code;
    return typeof code === 'string' ? code : null;
}

// tsconfig targets < ES2020, so BigInt literals (1_000n) are a compile error here.
const E18 = BigInt('1000000000000000000');

before(async () => {
    if (!enabled) return;
    pg = (await import('pg')).default as unknown as typeof pg;
    const c = await connect();
    try {
        // The migration chain creates objects in `public`, so that is the schema
        // that must be reset for the suite to be re-runnable.
        await c.query('drop schema if exists public cascade; create schema public;');
        await c.query('drop schema if exists extensions cascade; create schema if not exists extensions');
        for (const r of ['anon', 'authenticated', 'service_role']) {
            await c.query(
                `do $$ begin if not exists (select 1 from pg_roles where rolname='${r}') then execute format('create role %I nologin','${r}'); end if; end $$;`,
            );
        }
        try {
            await c.query('create publication supabase_realtime');
        } catch (e) {
            if (sqlState(e) !== '42710') throw e;
        }
        // The chain hard-codes the public schema, so apply it there then move on.
        await c.query(chainSql());
    } finally {
        await c.end();
    }
});

after(async () => {
    if (!enabled) return;
    const c = await connect();
    try {
        await c.query('drop schema if exists public cascade; create schema public;');
    } finally {
        await c.end();
    }
});

const skip = enabled ? false : 'set LUDO_SCHEMA_DB_URL to run concurrency tests';

test('concurrent voucher claims credit exactly once per (wallet, mission, period)', { skip }, async () => {
    const setup = await connect();
    const wallet = '0x' + '11'.repeat(20);
    await setup.query(`insert into players(wallet_address) values ($1) on conflict do nothing`, [wallet]);
    await setup.end();

    const period = '0x' + 'ab'.repeat(32);
    let accepted = 0;
    let rejected = 0;
    await concurrently(8, async (c) => {
        try {
            await c.query(
                `insert into mission_vouchers
                   (wallet_address, mission_id, period_id, amount, signature, deadline)
                 values ($1, 'daily_bonus', $2, 10, 'pending', now())`,
                [wallet, period],
            );
            accepted += 1;
        } catch (e) {
            // 23505 = unique_violation, which is the claim lock doing its job.
            assert.equal(sqlState(e), '23505', `unexpected error: ${(e as Error).message}`);
            rejected += 1;
        }
    });
    assert.equal(accepted, 1, 'exactly one concurrent claim may be accepted');
    assert.equal(rejected, 7, 'the other seven must be rejected by the unique constraint');

    const check = await connect();
    try {
        const { rows } = await check.query(
            `select count(*)::int n from mission_vouchers
              where wallet_address = $1 and mission_id = 'daily_bonus' and period_id = $2`,
            [wallet, period],
        );
        // This is the SEC-10 claim lock: the unique constraint, not application
        // logic, is what makes concurrent mints collide.
        assert.equal(rows[0].n, 1, 'exactly one voucher row must exist');
    } finally {
        await check.end();
    }
});

test('concurrent escrow bets cannot overdraw: debits are bounded by the balance', { skip }, async () => {
    const setup = await connect();
    const bettor = '0x' + '22'.repeat(20);
    const treasury = '0x' + '33'.repeat(20);
    const matchId = '44444444-4444-4444-4444-444444444444';
    try {
        await setup.query(
            `insert into players(wallet_address) values ($1), ($2) on conflict do nothing`,
            [bettor, treasury],
        );
        await setup.query(
            `insert into matches (id, room_code, game_mode, participants, host_proven)
             values ($1, 'R-CONC', 'classic', array[$2], true)`,
            [matchId, treasury],
        );
        await setup.query(
            `insert into live_matches (match_id, room_code, bet_window_status, window_opened_at,
                                       window_closed_at, current_bet_type)
             values ($1, 'R-CONC', 'open', now(), now() + interval '1 hour', 'dice_roll')`,
            [matchId],
        );
        // Arm with a known rake and a max bet comfortably above one stake.
        await setup.query(
            `update chips_escrow_config
                set enabled = true, treasury_wallet = $1, rake_bps = 1000,
                    max_bet_base = 1000000000000000000000::numeric`,
            [treasury],
        );
        // Balance covers exactly 3 bets of 10 CHIPS, but we will attempt 8.
        await setup.query(`select chips_escrow_deposit($1, 30000000000000000000::numeric, 'conc-seed')`, [
            bettor,
        ]);
    } finally {
        await setup.end();
    }

    const stake = (BigInt(10) * E18).toString();
    await concurrently(8, async (c, i) => {
        try {
            await c.query(`select chips_escrow_place_bet($1, $2, 'dice_roll', '6', $3, $4)`, [
                bettor,
                matchId,
                stake,
                `conc-${i}`,
            ]);
        } catch {
            /* insufficient escrow once the balance is exhausted */
        }
    });

    const check = await connect();
    try {
        const { rows: acct } = await check.query(
            `select balance from chips_escrow_accounts where wallet_address = $1`,
            [bettor],
        );
        const balance = BigInt(acct[0].balance);
        assert.ok(balance >= BigInt(0), 'balance must never go negative');

        const { rows: bets } = await check.query(
            `select count(*)::int n from spectator_bets where player_id = $1 and stake_settled`,
            [bettor],
        );
        // 30 CHIPS of balance, 10 CHIPS per stake => at most 3 stakes.
        assert.ok(bets[0].n <= 3, `at most 3 stakes may settle, got ${bets[0].n}`);
        assert.equal(balance, BigInt(30) * E18 - BigInt(bets[0].n) * BigInt(10) * E18,
            'balance must equal start minus exactly the settled stakes');

        // And the ledger must still reconcile.
        const { rows: solv } = await check.query(`select chips_escrow_solvency() as s`);
        const s = solv[0].s as { delta: string; solvent: boolean };
        assert.equal(s.solvent, true, `escrow must stay solvent, delta=${s.delta}`);
    } finally {
        await check.end();
    }
});

test('concurrent settlement pays out exactly once', { skip }, async () => {
    // Self-contained: does not depend on the overdraw test having run.
    const matchId = '55555555-5555-5555-5555-555555555555';
    const bettor = '0x' + '44'.repeat(20);
    const treasury = '0x' + '55'.repeat(20);

    const setup = await connect();
    try {
        await setup.query(
            `insert into players(wallet_address) values ($1), ($2) on conflict do nothing`,
            [bettor, treasury],
        );
        await setup.query(
            `insert into matches (id, room_code, game_mode, participants, host_proven)
             values ($1, 'R-SETTLE', 'classic', array[$2], true)`,
            [matchId, treasury],
        );
        await setup.query(
            `insert into live_matches (match_id, room_code, bet_window_status, window_opened_at,
                                       window_closed_at, current_bet_type)
             values ($1, 'R-SETTLE', 'open', now(), now() + interval '1 hour', 'dice_roll')`,
            [matchId],
        );
        await setup.query(
            `update chips_escrow_config set enabled = true, treasury_wallet = $1, rake_bps = 1000,
                    max_bet_base = 1000000000000000000000::numeric`,
            [treasury],
        );
        await setup.query(`select chips_escrow_deposit($1, 100000000000000000000::numeric, 'settle-seed')`, [bettor]);
        await setup.query(
            `select chips_escrow_place_bet($1, $2, 'dice_roll', '6', 10000000000000000000::numeric, 'settle-bet')`,
            [bettor, matchId],
        );
        await setup.query(
            `update live_matches set window_closed_at = now() - interval '1 second' where match_id = $1`,
            [matchId],
        );
    } finally {
        await setup.end();
    }

    const check = await connect();
    try {
        // Close the window, then race the settlement.
        await check.query(
            `update live_matches set window_closed_at = now() - interval '1 second' where match_id = $1`,
            [matchId],
        );
        const open = await check.query(
            `select count(*)::int n from spectator_bets where match_id = $1 and status = 'open'`,
            [matchId],
        );
        assert.equal(open.rows[0].n, 1, 'exactly one open bet must exist before the race');
        const ledgerBefore = await check.query(
            `select coalesce(sum(delta),0)::text t from chips_escrow_ledger where reason = 'bet_payout'`,
        );

        await concurrently(6, async (c) => {
            try {
                await c.query(`select chips_escrow_settle_bets($1, '6', 'dice_roll')`, [matchId]);
            } catch {
                /* contention is fine; double-paying is not */
            }
        });

        const after = await check.query(
            `select coalesce(sum(delta),0)::text t from chips_escrow_ledger where reason = 'bet_payout'`,
        );
        const stillOpen = await check.query(
            `select count(*)::int n from spectator_bets where match_id = $1 and status = 'open'`,
            [matchId],
        );
        assert.equal(stillOpen.rows[0].n, 0, 'no bet may remain open after settlement');

        // Each winner is paid at most once: the ledger must not have grown by more
        // than one payout per originally-open bet.
        const paidDelta = BigInt(after.rows[0].t) - BigInt(ledgerBefore.rows[0].t);
        // One 10 CHIPS stake at 5x = 50 gross, minus 10% rake = 45 paid.
        assert.equal(paidDelta, BigInt(45) * E18,
            'exactly one gross-minus-rake payout may be credited, no matter how many racers');

        const { rows: solv } = await check.query(`select chips_escrow_solvency() as s`);
        const s = solv[0].s as { delta: string; solvent: boolean };
        assert.equal(s.solvent, true, `escrow must stay solvent after racing settlement, delta=${s.delta}`);
    } finally {
        await check.end();
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 1 unblock (migration 202609300010): the data-layer invariants that the
// claim lock and the escrow arming interlock depend on.
// ─────────────────────────────────────────────────────────────────────────────

test('arming the escrow cannot re-enable self-betting', { skip }, async () => {
    // allow_self_bets sat OUTSIDE chips_escrow_config_armed, so a single
    // `update ... set enabled = true, allow_self_bets = true` re-opened
    // self-betting while the RPC's own `player_id = any(m.participants)` guard
    // was silently overridden.
    const c = await connect();
    try {
        const treasury = '0x' + 'aa'.repeat(20);
        await assert.rejects(
            c.query(
                `update chips_escrow_config
                    set enabled = true, treasury_wallet = $1, rake_bps = 500, allow_self_bets = true`,
                [treasury],
            ),
            /violates check constraint "chips_escrow_config_armed"/,
            'arming with self-bets allowed must be refused',
        );

        // The same arming without self-bets is accepted, so the interlock is the
        // self-bet clause and not something unrelated.
        await c.query(
            `update chips_escrow_config
                set enabled = true, treasury_wallet = $1, rake_bps = 500, allow_self_bets = false`,
            [treasury],
        );
        const { rows } = await c.query(`select enabled, allow_self_bets from chips_escrow_config`);
        assert.equal(rows[0].enabled, true);
        assert.equal(rows[0].allow_self_bets, false);

        // Disarm again so later runs start from the inert default.
        await c.query(`update chips_escrow_config set enabled = false, treasury_wallet = null, rake_bps = 0`);
    } finally {
        await c.end();
    }
});

test('the mission claim lock is case-insensitive', { skip }, async () => {
    // The unique key was on the raw wallet column. Lowercase was enforced only by
    // an FK to `players` plus a CHECK on that table, so the lock depended on two
    // constraints living somewhere else entirely.
    const c = await connect();
    try {
        const lower = '0x' + 'ab'.repeat(20);
        const mixed = '0x' + 'AB'.repeat(20);
        assert.notEqual(lower, mixed, 'the two spellings must actually differ');

        for (const w of [lower, mixed]) {
            await c.query(
                `insert into players (wallet_address) values ($1) on conflict do nothing`,
                [w.toLowerCase()],
            );
        }
        await c.query(`delete from mission_vouchers where mission_id = 'daily_bonus'`);

        await c.query(
            `insert into mission_vouchers
                (wallet_address, mission_id, period_id, amount, signature, deadline)
             values ($1, 'daily_bonus', 'case-test', 10, '0x', now())`,
            [lower],
        );
        // The mixed-case spelling must collide with the lowercase row.
        await assert.rejects(
            c.query(
                `insert into mission_vouchers
                    (wallet_address, mission_id, period_id, amount, signature, deadline)
                 values ($1, 'daily_bonus', 'case-test', 10, '0x', now())`,
                [mixed],
            ),
            /duplicate key/,
            'a differently-cased wallet must not take a second claim',
        );

        const { rows } = await c.query(
            `select count(*)::int n from mission_vouchers where mission_id = 'daily_bonus'`,
        );
        assert.equal(rows[0].n, 1);
        await c.query(`delete from mission_vouchers where mission_id = 'daily_bonus'`);
    } finally {
        await c.end();
    }
});

test('the voucher nonce comes from a monotonic sequence', { skip }, async () => {
    // Was `Date.now() * 1000 + random`. A clock reading can repeat or go backwards,
    // so the signed payload depended on server time.
    const c = await connect();
    try {
        const vals: bigint[] = [];
        for (let i = 0; i < 5; i++) {
            const { rows } = await c.query(`select public.next_mission_voucher_nonce() as n`);
            vals.push(BigInt(rows[0].n));
        }
        for (let i = 1; i < vals.length; i++) {
            assert.ok(vals[i]! > vals[i - 1]!, `nonce must strictly increase: ${vals[i - 1]} -> ${vals[i]}`);
        }
        // Client-reachability is asserted by check:schema (no anon/authenticated
        // EXECUTE on a security definer function), not here: this harness connects
        // as a superuser, so `set role` always succeeds and would prove nothing.
    } finally {
        await c.end();
    }
});

test('an orphaned pending reservation is identifiable for reclamation', { skip }, async () => {
    // A reservation whose signature step failed used to leave a
    // `signature = 'pending'` row that permanently blocked that wallet's reward
    // for the period: the claim lock saw the slot as taken and every retry 409'd.
    const c = await connect();
    try {
        const { rows: idx } = await c.query(
            `select indexdef from pg_indexes where indexname = 'mission_vouchers_pending_idx'`,
        );
        assert.equal(idx.length, 1, 'a partial index over pending rows must exist');
        assert.match(idx[0].indexdef, /signature = 'pending'::text/);

        const { rows: col } = await c.query(
            `select is_nullable, column_default from information_schema.columns
             where table_name = 'mission_vouchers' and column_name = 'reserved_at'`,
        );
        assert.equal(col[0].is_nullable, 'NO', 'reserved_at must be NOT NULL');
        assert.match(col[0].column_default, /now\(\)/);

        // The route's failure path deletes the row, so a pending row that survives
        // past a grace window is exactly the set a sweep should target.
        const { rows: sel } = await c.query(
            `select count(*)::int n from mission_vouchers
             where signature = 'pending' and reserved_at < now() - interval '1 hour'`,
        );
        assert.equal(typeof sel[0].n, 'number');
    } finally {
        await c.end();
    }
});
