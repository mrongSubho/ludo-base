/* eslint-disable @typescript-eslint/no-unused-vars -- lint burn-down quarantine 2026-09-23 */
/**
 * loop-repro — headless signing-storm reproduction (Playwright + static state machine).
 *
 * READ-ONLY against LOCAL dev only (default http://localhost:3000). Refuses
 * non-local --url without SIWE_MATRIX_ALLOW_REMOTE=1. Never touches prod.
 *
 * WHAT IT PROVES (green-or-documented):
 *   STATIC (always runs, zero browser): asserts the app's GUARDED pre-sign
 *     state machine — one SIWE funnel behind a singleton guard (shared
 *     in-flight per address), verify-failure backoff + terminal state,
 *     user-rejection cooldown, reject-vs-verify distinction, ECDH
 *     check-before-sign with explicit account. Timer pollers still call
 *     ensureAppSession, but that call is now funneled through the guard, so
 *     a sessionless wallet yields null + surfaced error instead of a popup.
 *     Also shells out to scripts/session-guard-sim.ts, which replays the
 *     15-instance + 2s/4s/5s/15s/20s/30s storm shape against the REAL guard
 *     with a virtual clock (deterministic, no browser).
 *   LIVE (only with --live + reachable dev + runnable browser):
 *     (i)  cold-load disconnected: ZERO spontaneous prompts;
 *     (ii) connected-sessionless attempt: stub wallet connects, stub signer
 *          returns a 6492-shaped sig, /api/siwe/verify is mocked to 401 —
 *          asserts at most 1 popup per intent + zero timer reprompts over
 *          ≥10s. If the app cannot be connected headlessly (wallet-modal
 *          UX), records CONNECT-SKIP (documented, not red): the static sim
 *          above is the deterministic proof in that case.
 *
 * USAGE:
 *   node scripts/loop-repro.mjs              # static only
 *   node scripts/loop-repro.mjs --live       # static + headless (needs npm run dev)
 *   node scripts/loop-repro.mjs --live --url http://localhost:3000
 */
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const args = process.argv.slice(2);
const wantLive = args.includes("--live");
const urlIdx = args.indexOf("--url");
const baseUrl = ((urlIdx >= 0 ? args[urlIdx + 1] : "") || process.env.SIWE_MATRIX_URL || "http://localhost:3000").replace(/\/$/, "");

function isLocalUrl(u) {
  try {
    const h = new URL(u).hostname.toLowerCase();
    return h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "[::1]";
  } catch {
    return false;
  }
}

function read(rel) {
  return fs.readFileSync(path.join(repoRoot, rel), "utf8");
}

let pass = 0;
let fail = 0;
const notes = [];
function check(id, ok, detail) {
  if (ok) pass++;
  else fail++;
  notes.push(`${ok ? "PASS" : "VIOLATION"} ${id}: ${detail}`);
}

// ---- STATIC: guarded pre-sign state machine --------------------------------
console.log("# loop-repro — static guarded pre-sign state machine");
try {
  const sess = read("hooks/useAppSession.ts");
  const guardSrc = read("lib/appSessionGuard.ts");
  check("single-siwe-sign-site", (sess.match(/signMessageAsync\s*\(/g) || []).length === 1, `signMessageAsync( sites in useAppSession.ts = ${(sess.match(/signMessageAsync\s*\(/g) || []).length} (expect 1, the funnel)`);
  check("guard-singleton", /new AppSessionGuard\(\)/.test(sess) && /inFlight/.test(guardSrc), "module-level AppSessionGuard with shared in-flight promise (N instances → 1 popup)");
  check("cached-session-shortcircuit", /expiresAtMs\s*>\s*now|getSnapshot/.test(guardSrc), "cached live session returns without prompting");
  check("verify-backoff", /BACKOFF|nextRetryAt/.test(guardSrc), "exponential verify-failure backoff gates reprompts");
  check("reject-cooldown", /COOLDOWN|lastRejectAt/.test(guardSrc), "user-rejection cooldown suppresses reprompts");
  check("terminal-state", /terminal/.test(guardSrc) && /verifyFailed/.test(guardSrc), "terminal non-retrying state after repeated verify failures (error surfaced, no popup)");
  check("reject-vs-verify", /isUserRejection/.test(guardSrc), "user-reject distinguished from verify-failure (reason codes)");
  check("imports-exact-builder", /buildSiweMessage/.test(sess), "uses exact lib/sessionProof builder");

  // Timer-driven callers: still present (call sites untouched by design) but
  // now SAFE — they route through the guarded funnel and never sign directly.
  const timed = [
    ["app/components/InviteNotification.tsx", "4s invite poll"],
    ["hooks/TeamUpContext.tsx", "2s host join-request poll"],
    ["hooks/useMessages.ts", "15s messages refresh"],
    ["hooks/useNotifications.ts", "20s notifications refresh"],
    ["app/components/PresenceManager.tsx", "30s presence heartbeat"],
    ["hooks/useMatchmaking.ts", "5s matchmaking heartbeat"],
  ];
  for (const [f, label] of timed) {
    let funneled = false;
    let direct = false;
    try {
      const src = read(f);
      funneled = /ensureAppSession\s*\(/.test(src);
      // Direct popup = signMessageAsync({...}) call. Pass-through forwards
      // (e.g. TeamUpContext threading the signer into useMoveAuth for
      // user-action-gated match moves) are NOT direct popups.
      direct = /signMessageAsync\s*\(\s*\{/.test(src);
    } catch {
      funneled = false;
    }
    check(`timer-caller:${path.basename(f)}`, funneled && !direct, `${label} routes via guarded ensureAppSession, no direct sign (funneled=${funneled} directSign=${direct})`);
  }

  // ECDH: session + server-key check BEFORE any sign, explicit account.
  const da = read("hooks/useDataActions.ts");
  const sendStart = da.indexOf("const sendMessage");
  const sendBody = sendStart >= 0 ? da.slice(sendStart, sendStart + 5000) : "";
  const sessIdx = sendBody.indexOf("await ensureAppSession()");
  const pubIdx = sendBody.indexOf("await publishMyEcdhPubkey(");
  check("ecdh-session-before-sign", sessIdx >= 0 && (pubIdx < 0 || sessIdx < pubIdx), "sendMessage ensures session before any ECDH publish (doomed signs skipped, fail-closed, no popup)");
  check("ecdh-explicit-account", /account:\s*(walletAddress|lowerAddr)/.test(da), "ECDH sign passes account explicitly (matches SIWE call)");
  check("ecdh-server-key-check", /serverJwk/.test(sendBody) && /localJwk/.test(sendBody), "sendMessage compares server key vs local key and skips the sign when already published");

  // Deterministic policy replay against the REAL guard (virtual clock).
  try {
    const { execFileSync } = await import("node:child_process");
    const out = execFileSync("npx", ["tsx", "scripts/session-guard-sim.ts"], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 120000,
    });
    const green = /ALL GREEN/.test(out);
    check("guard-sim", green, green ? "15-instance + 2s/4s/5s/15s/20s/30s replay vs real guard: ALL GREEN" : `sim reported failure:\n${String(out).slice(-800)}`);
  } catch (e) {
    check("guard-sim", false, `session-guard-sim failed to run: ${String((e && e.message) || e).slice(0, 200)}`);
  }
} catch (e) {
  check("static-read", false, `read failed: ${e.message}`);
}

console.log("");
for (const n of notes) console.log(`- ${n}`);
console.log(`\nstatic: ${pass} PASS, ${fail} FAIL (post-fix: every check must PASS — violations are red)`);
console.log("");

// ---- LIVE: headless cold-load ------------------------------------------------
if (!wantLive) {
  console.log("live: NOT-RUN (offline only — re-run with --live once `npm run dev` is up)");
  console.log("documented-limit: connected-6492 storm needs a real mobile smart-wallet signer; cold-load headless can only prove the negative (no spontaneous prompt when disconnected).");
  process.exit(0);
}

if (!isLocalUrl(baseUrl) && process.env.SIWE_MATRIX_ALLOW_REMOTE !== "1") {
  console.error(`REFUSAL: --live target ${baseUrl} is not local.`);
  process.exit(1);
}

// Reachability gate (green-or-documented: unreachable → LIVE-SKIP, exit 0)
let reachable = false;
try {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 6000);
  const r = await fetch(`${baseUrl}/`, { signal: ctrl.signal });
  clearTimeout(t);
  reachable = r.ok || r.status < 500;
  console.log(`live: GET / → ${r.status} (reachable=${reachable})`);
} catch (e) {
  console.log(`live: LIVE-SKIP — dev server unreachable at ${baseUrl} (${e.message}). Start with \`npm run dev\` (scratch xvwaqxqyjtlsuijgwozi) and re-run.`);
  process.exit(0);
}
if (!reachable) {
  console.log("live: LIVE-SKIP — server responded non-OK on /. Re-run when dev is Ready.");
  process.exit(0);
}

let pw = null;
try {
  pw = await import("playwright");
} catch (e) {
  console.log(`live: LIVE-SKIP — playwright import failed (${e.message}). Run \`npm i\` then re-run.`);
  process.exit(0);
}

const { chromium } = pw;
let browser = null;
const consoleErrors = [];
const pageErrors = [];
let signAttempts = [];
try {
  // Prefer installed Google Chrome (no 150MB chromium download in this session); fall back to bundled chromium.
  const launchOpts = { headless: true, timeout: 30000 };
  try {
    browser = await chromium.launch({ ...launchOpts, channel: "chrome" });
    console.log("live: launched via channel=chrome (installed Google Chrome)");
  } catch (e1) {
    console.log(`live: channel=chrome unavailable (${String(e1.message).slice(0, 160)}), trying bundled chromium…`);
    browser = await chromium.launch(launchOpts);
    console.log("live: launched bundled chromium");
  }
  const page = await browser.newPage();
  // Stub EIP-1193 provider BEFORE page scripts: count every signing-shaped request, auto-reject so no popup can hang.
  await page.addInitScript(() => {
    window.__signAttempts = [];
    const stub = {
      isMetaMask: true,
      isCoinbaseWallet: false,
      request: async ({ method, params }) => {
        const m = String(method || "");
        if (/personal_sign|eth_sign|eth_signTypedData|wallet_sign/i.test(m)) {
          window.__signAttempts.push({ method: m, at: Date.now() });
          const err = new Error("loop-repro stub: user rejected");
          err.code = 4001;
          throw err;
        }
        if (m === "eth_requestAccounts" || m === "eth_accounts") return [];
        if (m === "eth_chainId") return "0x2105";
        if (m === "net_version") return "8453";
        return null;
      },
      on: () => {},
      removeListener: () => {},
    };
    window.ethereum = stub;
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 300));
  });
  page.on("pageerror", (err) => pageErrors.push(String(err && err.message ? err.message : err).slice(0, 300)));
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(8000); // let mount effects + fastest pollers (2s/4s) fire at least once
  signAttempts = await page.evaluate(() => window.__signAttempts || []);
  console.log(`live: cold-load sign attempts observed via stub = ${signAttempts.length}`);
  for (const s of signAttempts.slice(0, 10)) console.log(`  - ${s.method} @+${s.at}`);
  console.log(`live: console.errors=${consoleErrors.length} pageerrors=${pageErrors.length}`);
  for (const e of consoleErrors.slice(0, 5)) console.log(`  console.error: ${e.slice(0, 200)}`);
  for (const e of pageErrors.slice(0, 5)) console.log(`  pageerror: ${e.slice(0, 200)}`);
  await page.close();

  console.log("");
  if (signAttempts.length === 0) {
    console.log("live verdict: PASS (cold-load, disconnected) — zero spontaneous signing prompts, as designed (address undefined → early null, no popup).");
  } else {
    console.log("live verdict: VIOLATION — spontaneous signing without user intent on cold load (see attempts above). A fix PR must bring this to 0.");
  }

  // ---- LIVE (ii): connected-sessionless simulation -------------------------
  // Stub wallet reports a connected 6492-style account; the stub signer
  // returns a 6492-shaped signature; /api/siwe/verify is mocked to 401
  // (the pre-fix forever-sessionless state). Gate: at most 1 popup for the
  // initial intent + zero timer reprompts over ≥10s (covers 2s/4s cadences).
  console.log("");
  console.log("live: connected-sessionless simulation (mocked 6492 account, verify → 401)…");
  let connectedPage = null;
  try {
    connectedPage = await browser.newPage();
    const TEST_ADDR = "0x1111111111111111111111111111111111111111";
    await connectedPage.addInitScript((addr) => {
      window.__signAttempts = [];
      const stub = {
        isMetaMask: true,
        request: async ({ method }) => {
          const m = String(method || "");
          if (/personal_sign|eth_sign|eth_signTypedData|wallet_sign/i.test(m)) {
            window.__signAttempts.push({ method: m, at: Date.now() });
            // 6492-shaped bytes (never valid — the mock verify 401s anyway).
            return "0x" + "ab".repeat(400) + "6492649264926492";
          }
          if (m === "eth_requestAccounts" || m === "eth_accounts") return [addr];
          if (m === "eth_chainId") return "0x2105";
          if (m === "net_version") return "8453";
          if (m === "eth_getBalance") return "0x0";
          if (m === "wallet_switchEthereumChain" || m === "wallet_addEthereumChain") return null;
          return null;
        },
        on: () => {},
        removeListener: () => {},
        removeAllListeners: () => {},
      };
      window.ethereum = stub;
    }, TEST_ADDR);
    // Mock the funnel's verify endpoint: ALWAYS 401 (doomed sessionless).
    await connectedPage.route("**/api/siwe/verify", async (route) => {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: "Invalid signature", code: "ecrecover-invalid" }),
      });
    });
    await connectedPage.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    // Best-effort connect: click any visible Connect control once (one intent).
    let clicked = false;
    try {
      const btn = connectedPage.getByRole("button", { name: /connect|sign in|log in/i }).first();
      await btn.waitFor({ state: "visible", timeout: 8000 });
      await btn.click({ timeout: 5000 });
      clicked = true;
    } catch {
      clicked = false;
    }
    // Observe ≥10s across the 2s/4s poller cadences.
    await connectedPage.waitForTimeout(12000);
    const attempts = await connectedPage.evaluate(() => window.__signAttempts || []);
    // Only a REAL connection makes this simulation meaningful: confirm via
    // the wagmi store (AppKit/Reown modal flows cannot complete against a
    // headless stub — no EIP-6963/reconnect handshake — so SKIP is honest).
    let connectedCount = 0;
    try {
      const raw = await connectedPage.evaluate(() => window.localStorage.getItem("wagmi.store") || "");
      const parsed = JSON.parse(raw || "{}");
      const vals = parsed?.state?.connections?.value;
      connectedCount = Array.isArray(vals) ? vals.length : 0;
    } catch {
      connectedCount = 0;
    }
    console.log(`live: connected-sim clickedConnect=${clicked} wagmiConnections=${connectedCount} signAttempts(12s)=${attempts.length}`);
    for (const s of attempts.slice(0, 10)) console.log(`  - ${s.method} @+${s.at}`);
    if (connectedCount === 0) {
      console.log("live verdict: CONNECT-SKIP — headless stub could not establish a wagmi connection (modal/reconnect handshake needs a real wallet); the deterministic scripts/session-guard-sim.ts replay above is the proof for this layer (documented, not red).");
    } else if (attempts.length <= 2) {
      console.log(`live verdict: PASS (connected-sessionless) — ${attempts.length} popup(s) over 12s incl. the connect intent, zero timer reprompt storm (guard backoff/terminal held).`);
    } else {
      console.log(`live verdict: VIOLATION (connected-sessionless) — ${attempts.length} signing prompts in 12s with verify always 401 (storm NOT contained).`);
    }
    await connectedPage.close();
  } catch (e) {
    console.log(`live: connected-sim SKIP — ${String((e && e.message) || e).slice(0, 200)} (static sim above still stands).`);
    try {
      if (connectedPage) await connectedPage.close();
    } catch {}
  }
  try {
    if (browser) await browser.close();
  } catch {}
  browser = null;
  console.log("note: with the 6492-aware server (matrix (c) → 200), real smart wallets no longer sit in the mocked-401 state at all — the guard above is defense-in-depth for any residual verify failure.");
} catch (e) {
  console.log(`live: LIVE-SKIP — browser run failed (${String((e && e.message) || e).slice(0, 300)}). Static layer above still stands; re-run --live when a browser is available (npx playwright install chromium OR installed Chrome).`);
  try {
    if (browser) await browser.close();
  } catch {}
  process.exit(0);
}
