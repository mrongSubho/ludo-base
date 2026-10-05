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
