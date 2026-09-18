/**
 * session-guard-sim — deterministic reprompt-policy simulation.
 *
 * Imports the REAL AppSessionGuard from lib/appSessionGuard.ts (never a
 * reimplementation) with an injected virtual clock, then replays the
 * signing-storm shape: 15 concurrent hook instances + 2s/4s/5s/15s/20s/30s
 * timer pollers against a wallet that can never verify (HTTP 401), a
 * rejecting wallet (code 4001), and a healthy wallet.
 *
 * ASSERTS (exit 1 on violation):
 *   T1 storm-silence: 15 concurrent sessionless ensures → exactly 1 sign;
 *      2s/4s/5s/15s/20s/30s pollers over 120s virtual → bounded signs
 *      (backoff), terminal reached, and post-terminal ticks sign ZERO.
 *   T2 reject-cooldown: 1 reject → 0 reprompts over 60s of 2s/4s ticks.
 *   T3 success-caches: verify ok → later ensures sign 0 times.
 *   T4 force-escapes-terminal: forced retry signs once after terminal.
 *
 * USAGE: npx tsx scripts/session-guard-sim.ts
 * EXIT: 0 all green; 1 on any assertion failure or harness error.
 */

import { AppSessionGuard } from "../lib/appSessionGuard";

const ADDR = "0x7f597ebe5413bed048047e1c417b005dbd8cf509";
const POLLERS = [2000, 4000, 5000, 15000, 20000, 30000];

let failures = 0;
function check(id: string, ok: boolean, detail: string): void {
    if (!ok) failures++;
    console.log(`${ok ? "PASS" : "FAIL"} ${id}: ${detail}`);
}

function makeDeps(opts: {
    now: () => number;
    signCalls: { n: number };
    signBehavior: "ok" | "reject" | "flaky-sign-error";
    verifyBehavior: "ok-401" | "ok-200";
}) {
    return {
        sign: async () => {
            opts.signCalls.n++;
            if (opts.signBehavior === "reject") {
                const err = new Error("User rejected the request") as Error & { code: number };
                err.code = 4001;
                throw err;
            }
            if (opts.signBehavior === "flaky-sign-error") {
                throw new Error("transport reset");
            }
            return { signature: `0xsig-${opts.signCalls.n}`, body: { n: opts.signCalls.n } };
        },
        verify: async (_signed: { signature: string; body: unknown }) => {
            if (opts.verifyBehavior === "ok-200") {
                return {
                    ok: true as const,
                    sessionId: "sess-1",
                    expiresAt: new Date(opts.now() + 7 * 24 * 3600 * 1000).toISOString(),
                };
            }
            return { ok: false as const, code: "signer-mismatch" };
        },
        persist: () => undefined,
    };
}

async function main(): Promise<void> {
    console.log("# session-guard-sim — reprompt policy vs storm shape");

    // ---- T1: storm silence -------------------------------------------------
    {
        let t = 0;
        const guard = new AppSessionGuard({ now: () => t });
        const signCalls = { n: 0 };
        const deps = makeDeps({ now: () => t, signCalls, signBehavior: "ok", verifyBehavior: "ok-401" });

        // 15 hook instances fire at once (mount burst) — must share 1 popup.
        await Promise.all(Array.from({ length: 15 }, () => guard.ensure(ADDR, deps)));
        check("T1-burst-dedup", signCalls.n === 1, `15 concurrent ensures → ${signCalls.n} sign(s) (expect 1)`);

        // Timer pollers for 120s virtual (one ensure per poller per tick).
        for (let tick = 1000; tick <= 120_000; tick += 1000) {
            t = tick;
            for (const cadence of POLLERS) {
                if (tick % cadence === 0) {
                    await guard.ensure(ADDR, deps);
                }
            }
        }
        const snap = guard.getSnapshot(ADDR);
        check("T1-bounded-signs", signCalls.n <= 3, `120s of 2s/4s/5s/15s/20s/30s polls → ${signCalls.n} total signs (expect ≤3: initial + 2 backoff retries)`);
        check("T1-terminal", snap.verifyFailed === true, `terminal flag set after repeated 401s (verifyFailed=${snap.verifyFailed}, lastError=${snap.lastError})`);

        // Post-terminal: 60 more seconds of the hottest pollers → zero signs.
        const before = signCalls.n;
        for (let tick = 121_000; tick <= 180_000; tick += 1000) {
            t = tick;
            for (const cadence of [2000, 4000]) {
                if (tick % cadence === 0) {
                    const r = await guard.ensure(ADDR, deps);
                    if (r.reason !== "terminal-verify-failed" && r.sessionId !== null) {
                        check("T1-post-terminal-reason", false, `unexpected reason ${r.reason} after terminal`);
                    }
                }
            }
        }
        check("T1-post-terminal-silence", signCalls.n === before, `60s post-terminal 2s/4s polls → ${signCalls.n - before} new signs (expect 0)`);
    }

    // ---- T2: reject cooldown ------------------------------------------------
    {
        let t = 0;
        const guard = new AppSessionGuard({ now: () => t });
        const signCalls = { n: 0 };
        const deps = makeDeps({ now: () => t, signCalls, signBehavior: "reject", verifyBehavior: "ok-401" });
        const first = await guard.ensure(ADDR, deps);
        check("T2-first-reject", signCalls.n === 1 && first.reason === "rejected", `first intent signs once then maps reject→null (signs=${signCalls.n}, reason=${first.reason})`);
        for (let tick = 1000; tick <= 59_000; tick += 1000) {
            t = tick;
            for (const cadence of [2000, 4000]) {
                if (tick % cadence === 0) await guard.ensure(ADDR, deps);
            }
        }
        check("T2-cooldown-silence", signCalls.n === 1, `59s of 2s/4s polls after reject → ${signCalls.n - 1} reprompts (expect 0)`);
        // Cooldown must EXPIRE (no permanent lockout): a tick past 60s retries.
        t = 61_000;
        const after = await guard.ensure(ADDR, deps);
        check("T2-cooldown-expiry", signCalls.n === 2 && after.reason === "rejected", `post-cooldown tick retries once (signs=${signCalls.n}, reason=${after.reason})`);
    }

    // ---- T3: success caches --------------------------------------------------
    {
        let t = 0;
        const guard = new AppSessionGuard({ now: () => t });
        const signCalls = { n: 0 };
        const deps = makeDeps({ now: () => t, signCalls, signBehavior: "ok", verifyBehavior: "ok-200" });
        const first = await guard.ensure(ADDR, deps);
        await guard.ensure(ADDR, deps);
        await guard.ensure(ADDR, deps);
        check("T3-cached", signCalls.n === 1 && first.sessionId === "sess-1", `healthy wallet signs once then caches (signs=${signCalls.n}, session=${first.sessionId})`);
    }

    // ---- T4: force escapes terminal ------------------------------------------
    {
        let t = 0;
        const guard = new AppSessionGuard({ now: () => t });
        const signCalls = { n: 0 };
        const deps = makeDeps({ now: () => t, signCalls, signBehavior: "ok", verifyBehavior: "ok-401" });
        // Drive to terminal quickly: fail, jump past backoffs, fail, fail.
        await guard.ensure(ADDR, deps); // fail 1 → +15s
        t = 16_000;
        await guard.ensure(ADDR, deps); // fail 2 → +60s
        t = 77_000;
        await guard.ensure(ADDR, deps); // fail 3 → terminal
        const term = guard.getSnapshot(ADDR);
        const before = signCalls.n;
        const forced = await guard.ensure(ADDR, deps, { force: true });
        check(
            "T4-force",
            term.verifyFailed === true && signCalls.n === before + 1 && forced.reason === "verify-failed",
            `terminal=${term.verifyFailed}, forced retry signs once (signs ${before}→${signCalls.n}, reason=${forced.reason})`,
        );
    }

    console.log(failures === 0 ? "\nsession-guard-sim: ALL GREEN" : `\nsession-guard-sim: ${failures} FAILURE(S)`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
    console.error("HARNESS-ERROR", e);
    process.exit(1);
});
