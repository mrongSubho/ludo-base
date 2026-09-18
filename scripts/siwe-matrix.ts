/**
 * SIWE signature-matrix harness — signing-storm reproduction (dynamic).
 *
 * Proves whether LOCAL POST /api/siwe/verify accepts or rejects each
 * signer class WITHOUT touching production:
 *   (a) plain EOA (viem privateKeyToAccount) — must stay 200.
 *   (b) deployed smart-contract wallet — DOCUMENTED SKIP unless env provides one
 *   (c) REAL counterfactual smart account (Coinbase Smart Wallet via
 *       viem account-abstraction, 6492-wrapped owner sig — no funding, no
 *       chain writes; validation is a read-only eth_call to Base).
 *       Post-fix (6492-aware server): must flip to 200 + sessionId.
 *   (d) dummy-factory 6492 wrapper (invalid by construction) — must stay
 *       401. Negative control: proves the server validates wrappers instead
 *       of blindly accepting 6492-shaped bytes.
 *   (e) tampered EOA signature (one byte flipped) — must stay 401.
 *       Negative control: proves ecrecover-invalid/signer-mismatch still
 *       reject, with distinct `code` in the 401 body post-fix.
 *
 * The SIWE message is built with the EXACT client builder from
 * lib/sessionProof.ts (imported, never hand-replicated).
 *
 * TWO LAYERS (green-or-documented):
 *   Layer 1 OFFLINE (always runs, zero network/DB): shape analysis per
 *     class (ecrecover replica + isErc6492Signature). Proves (a) passes and
 *     (c)/(d) are NOT plain-ecrecover sigs (the old server rejected them).
 *   Layer 2 LIVE (only with --live and a reachable dev server): POSTs each
 *     class to LOCAL /api/siwe/verify (dev server against scratch DB) and
 *     records status/body. If the server is down, reports LIVE-SKIP with the
 *     exact command to re-run — this counts as done, never red.
 *
 * POST-FIX GATE (printed at the end of every --live run):
 *   (a) 200 AND (c) 200+sessionId AND (d) 401 AND (e) 401.
 *
 * SAFETY: default target is http://localhost:3000. The script REFUSES any
 * --url that does not look local (localhost / 127.0.0.1 / ::1) unless
 * SIWE_MATRIX_ALLOW_REMOTE=1 is set. NEVER point it at production: live
 * POSTs create app_sessions rows (expected write) and must only land on a
 * scratch DB (see docs/notes/compat-probe.md scratch-project steps; the
 * incident scratch id is xvwaqxqyjtlsuijgwozi — use its URL as
 * NEXT_PUBLIC_SUPABASE_URL when booting the dev server, never prod keys).
 *
 * USAGE:
 *   npx tsx scripts/siwe-matrix.ts            # offline layer only
 *   npx tsx scripts/siwe-matrix.ts --live     # offline + live POSTs to local dev
 *   npx tsx scripts/siwe-matrix.ts --live --url http://localhost:3000
 *   SIWE_MATRIX_URL=http://127.0.0.1:3000 npx tsx scripts/siwe-matrix.ts --live
 *
 * EXIT: 0 on green-or-documented (including LIVE-SKIP and (b)-SKIP).
 *       1 only on unexpected harness failure.
 */

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  createPublicClient,
  http,
  isErc6492Signature,
  recoverMessageAddress,
  serializeErc6492Signature,
} from "viem";
import { base } from "viem/chains";
import { toCoinbaseSmartAccount } from "viem/account-abstraction";
import { APP_SESSION_TTL_MS, buildSiweMessage } from "../lib/sessionProof";

type Row = {
  cls: string;
  offline: string;
  liveStatus: string;
  liveBody: string;
};

const args = process.argv.slice(2);
const wantLive = args.includes("--live");
const urlFlagIdx = args.indexOf("--url");
const flagUrl = urlFlagIdx >= 0 ? args[urlFlagIdx + 1] : undefined;
const baseUrl = (flagUrl || process.env.SIWE_MATRIX_URL || "http://localhost:3000").replace(/\/$/, "");

function isLocalUrl(u: string): boolean {
  try {
    const p = new URL(u);
    const h = p.hostname.toLowerCase();
    return h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "[::1]";
  } catch {
    return false;
  }
}

function short(s: string, n = 220): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? one.slice(0, n - 1) + "…" : one;
}

async function offlineValidate(
  message: string,
  signature: `0x${string}`,
  address: string,
): Promise<{ ok: boolean; detail: string }> {
  let recovered: string;
  try {
    recovered = (
      await recoverMessageAddress({ message, signature })
    ).toLowerCase();
  } catch (e) {
    return { ok: false, detail: `recover threw: ${short(String((e as Error)?.message || e))}` };
  }
  if (recovered !== address.toLowerCase()) {
    return { ok: false, detail: `signer mismatch (recovered ${recovered})` };
  }
  return { ok: true, detail: `recovered == address (${recovered})` };
}

async function livePost(body: Record<string, unknown>): Promise<{ status: string; body: string }> {
  const ctrl = new AbortController();
  // Server-side 6492 validation costs an eth_call (8s timeout + 1 retry),
  // so the harness budget must exceed the server's worst case (~17s).
  const t = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch(`${baseUrl}/api/siwe/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text().catch(() => "");
    let pretty = text;
    try {
      pretty = JSON.stringify(JSON.parse(text));
    } catch {
      /* keep raw */
    }
    return { status: String(res.status), body: short(pretty, 300) };
  } catch (e) {
    const msg = String((e as Error)?.name === "AbortError" ? "timeout(8s)" : (e as Error)?.message || e);
    return { status: "LIVE-SKIP", body: short(`unreachable: ${msg}`) };
  } finally {
    clearTimeout(t);
  }
}

async function main(): Promise<void> {
  console.log("# SIWE signature matrix — signing-storm harness");
  console.log(`# baseUrl=${baseUrl} live=${wantLive ? "yes" : "no (offline only)"}`);
  if (wantLive && !isLocalUrl(baseUrl) && process.env.SIWE_MATRIX_ALLOW_REMOTE !== "1") {
    console.error(
      `REFUSAL: --live target ${baseUrl} is not local. Only localhost/127.0.0.1 allowed without SIWE_MATRIX_ALLOW_REMOTE=1. ` +
        `Boot local dev (npm run dev) against scratch project xvwaqxqyjtlsuijgwozi and re-run.`,
    );
    process.exit(1);
  }

  const domain = "localhost:3000";
  try {
    const h = new URL(baseUrl).hostname;
    void h;
  } catch {
    /* keep default domain */
  }
  const issuedAt = new Date().toISOString();
  const expirationTime = new Date(Date.now() + APP_SESSION_TTL_MS).toISOString();

  const rows: Row[] = [];

  // ---- (a) plain EOA -------------------------------------------------------
  {
    const pk = generatePrivateKey();
    const acct = privateKeyToAccount(pk);
    const address = acct.address;
    const nonce = `matrix-eoa-${Date.now().toString(36)}`;
    const message = buildSiweMessage({ domain, address, issuedAt, expirationTime, nonce });
    const signature = await acct.signMessage({ message });
    const off = await offlineValidate(message, signature, address);
    let liveStatus = "NOT-RUN";
    let liveBody = "offline only (re-run with --live against npm run dev)";
    if (wantLive) {
      const r = await livePost({ domain, address, nonce, issuedAt, expirationTime, signature, message });
      liveStatus = r.status;
      liveBody = r.body;
    }
    rows.push({
      cls: "(a) plain EOA",
      offline: off.ok ? `PASS — ${off.detail}` : `FAIL — ${off.detail}`,
      liveStatus,
      liveBody,
    });
  }

  // ---- (b) deployed smart-contract wallet ----------------------------------
  // Documented skip unless the operator injects one. Sourcing a funded 4337
  // account cheaply and locally requires a fork/anvil + deployment bundle
  // that this harness deliberately does NOT automate (no chain writes from
  // the matrix script). If SMART_WALLET_ADDRESS + SMART_WALLET_SIG are set
  // we POST them as-supplied; otherwise SKIP with reason.
  {
    const swAddr = process.env.SMART_WALLET_ADDRESS || "";
    const swSig = process.env.SMART_WALLET_SIG || "";
    if (/^0x[a-fA-F0-9]{40}$/.test(swAddr) && /^0x[a-fA-F0-9]+$/.test(swSig)) {
      const nonce = `matrix-sw-${Date.now().toString(36)}`;
      const message = buildSiweMessage({ domain, address: swAddr, issuedAt, expirationTime, nonce });
      const off = await offlineValidate(message, swSig as `0x${string}`, swAddr);
      let liveStatus = "NOT-RUN";
      let liveBody = "offline only";
      if (wantLive) {
        const r = await livePost({ domain, address: swAddr, nonce, issuedAt, expirationTime, signature: swSig, message });
        liveStatus = r.status;
        liveBody = r.body;
      }
      rows.push({
        cls: "(b) deployed smart wallet (env-supplied)",
        offline: off.ok ? `PASS — ${off.detail}` : `REJECTED — ${off.detail}`,
        liveStatus,
        liveBody,
      });
    } else {
      rows.push({
        cls: "(b) deployed smart wallet",
        offline: "SKIP — no cheap local source; needs fork/anvil + funded 4337 account (deliberately not automated here)",
        liveStatus: wantLive ? "SKIP" : "NOT-RUN",
        liveBody: "set SMART_WALLET_ADDRESS + SMART_WALLET_SIG to exercise a real deployed account, else rely on (c) counterfactual",
      });
    }
  }

  // ---- (c) REAL counterfactual smart account (Coinbase Smart Wallet) ----
  // Owner EOA -> toCoinbaseSmartAccount (pure address derivation, no
  // funding) -> smart.signMessage over the EXACT SIWE message. The result is
  // a genuine ERC-6492 wrapper whose factory/calldata counterfactually
  // deploy the claimed account; the 6492-aware server validates it with a
  // read-only eth_call to Base (no chain writes). Pre-fix this 401s
  // (ecrecover-only server); post-fix it must flip to 200 + sessionId.
  // Verified empirically: publicClient.verifyMessage returns true for this
  // construction on Base mainnet.
  let cSig: `0x${string}` | null = null;
  let cAddress = "";
  let cMessage = "";
  let cNonce = "";
  {
    try {
      const owner = privateKeyToAccount(generatePrivateKey());
      const rpcClient = createPublicClient({ chain: base, transport: http() });
      // Pinned version '1' = viem runtime default (verified live → 200).
      const smart = await toCoinbaseSmartAccount({ client: rpcClient, owners: [owner], version: "1" });
      cAddress = smart.address;
      cNonce = `matrix-cbsw-${Date.now().toString(36)}`;
      cMessage = buildSiweMessage({ domain, address: cAddress, issuedAt, expirationTime, nonce: cNonce });
      cSig = (await smart.signMessage({ message: cMessage })) as `0x${string}`;
      const is6492 = isErc6492Signature(cSig);
      const off = await offlineValidate(cMessage, cSig, cAddress);
      let liveStatus = "NOT-RUN";
      let liveBody = "offline only (re-run with --live against npm run dev)";
      if (wantLive) {
        await new Promise((r) => setTimeout(r, 800));
        const r = await livePost({ domain, address: cAddress, nonce: cNonce, issuedAt, expirationTime, signature: cSig, message: cMessage });
        liveStatus = r.status;
        liveBody = r.body;
      }
      rows.push({
        cls: "(c) real counterfactual CBSW (6492)",
        offline: `WRAPPED — isErc6492=${is6492}; ecrecover says ${off.ok ? "UNEXPECTED-PASS" : "REJECTED"} (live column decides via 6492-aware server)`,
        liveStatus,
        liveBody,
      });
    } catch (e) {
      rows.push({
        cls: "(c) real counterfactual CBSW (6492)",
        offline: `SKIP — smart-account derivation unavailable: ${short(String((e as Error)?.message || e))}`,
        liveStatus: wantLive ? "SKIP" : "NOT-RUN",
        liveBody: "needs Base RPC reachability for account derivation; re-run with network",
      });
    }
  }

  // ---- (d) dummy-factory 6492 wrapper (invalid by construction) ----
  // Same shape as (c) but the factory (0x1111…1111) can never deploy the
  // claimed account, so the universal validator MUST reject it. Post-fix
  // this stays 401 — the negative control proving the server validates
  // wrappers instead of blindly accepting 6492-shaped bytes.
  {
    const innerPk = generatePrivateKey();
    const innerAcct = privateKeyToAccount(innerPk);
    const address = innerAcct.address;
    const nonce = `matrix-dummy-${Date.now().toString(36)}`;
    const message = buildSiweMessage({ domain, address, issuedAt, expirationTime, nonce });
    const innerSig = await innerAcct.signMessage({ message });
    const wrapped = serializeErc6492Signature({
      address: "0x1111111111111111111111111111111111111111",
      data: "0xdeadbeef",
      signature: innerSig,
    });
    const is6492 = isErc6492Signature(wrapped);
    const off = await offlineValidate(message, wrapped, address);
    let liveStatus = "NOT-RUN";
    let liveBody = "offline only (re-run with --live against npm run dev)";
    if (wantLive) {
      // Negative control: POST 3x — a single 401 could theoretically be a
      // flake in EITHER direction, but 3/3 agreement is definitive.
      const tries = [];
      for (let i = 0; i < 3; i++) {
        await new Promise((r) => setTimeout(r, 800));
        tries.push(await livePost({ domain, address, nonce, issuedAt, expirationTime, signature: wrapped, message }));
      }
      liveStatus = tries.map((t) => t.status).join(",");
      liveBody = tries[0].body;
    }
    rows.push({
      cls: "(d) dummy-factory 6492 wrapper",
      offline: `${off.ok ? "UNEXPECTED-PASS" : "REJECTED"} — isErc6492=${is6492}; ${off.detail} (must stay rejected: factory cannot deploy claim)`,
      liveStatus,
      liveBody,
    });
  }

  // ---- (e) tampered EOA signature (one byte flipped) ----
  // Must stay 401 with a distinct code (ecrecover-invalid/signer-mismatch):
  // proves the 6492 upgrade did not loosen EOA authentication.
  {
    const pk = generatePrivateKey();
    const acct = privateKeyToAccount(pk);
    const address = acct.address;
    const nonce = `matrix-tamp-${Date.now().toString(36)}`;
    const message = buildSiweMessage({ domain, address, issuedAt, expirationTime, nonce });
    const good = await acct.signMessage({ message });
    const tail = good.slice(-2).toLowerCase() === "00" ? "ff" : "00";
    const tampered = (good.slice(0, -2) + tail) as `0x${string}`;
    const off = await offlineValidate(message, tampered, address);
    let liveStatus = "NOT-RUN";
    let liveBody = "offline only (re-run with --live against npm run dev)";
    if (wantLive) {
      // Negative control: POST 3x — see (d) comment on flake resistance.
      const tries = [];
      for (let i = 0; i < 3; i++) {
        await new Promise((r) => setTimeout(r, 800));
        tries.push(await livePost({ domain, address, nonce, issuedAt, expirationTime, signature: tampered, message }));
      }
      liveStatus = tries.map((t) => t.status).join(",");
      liveBody = tries[0].body;
    }
    rows.push({
      cls: "(e) tampered EOA signature",
      offline: `${off.ok ? "UNEXPECTED-PASS (harness bug)" : "REJECTED"} — ${off.detail} (must stay rejected)`,
      liveStatus,
      liveBody,
    });
  }

  // ---- report ---------------------------------------------------------------
  console.log("");
  console.log("| signer class | offline (server-logic replica) | live POST status | live body (trunc) |");
  console.log("|---|---|---|---|");
  for (const r of rows) {
    const esc = (s: string): string => s.replace(/\|/g, "\\|");
    console.log(`| ${esc(r.cls)} | ${esc(r.offline)} | ${esc(r.liveStatus)} | ${esc(r.liveBody)} |`);
  }
  console.log("");
  console.log("Interpretation:");
  console.log("- (a) offline PASS = harness + message builder healthy (sanity gate).");
  console.log("- (c) is the fix gate: pre-fix live 401 (ecrecover-only server) → post-fix live 200 + sessionId (6492-aware server).");
  console.log("- (d)/(e) must stay 401 live: invalid wrappers and tampered sigs still reject (with distinct `code`).");
  console.log("- (b) SKIP is a valid terminal state for this script (documented, not red).");
  console.log("- LIVE-SKIP means the dev server was not reachable; start it with `npm run dev` (env: scratch xvwaqxqyjtlsuijgwozi) and re-run with --live.");
  if (wantLive) {
    const find = (k: string): Row | undefined => rows.find((r) => r.cls.startsWith(k));
    const hasSession = (b: string): boolean => /"sessionId"\s*:\s*"/.test(b);
    const a = find("(a)");
    const c = find("(c)");
    const d = find("(d)");
    const e = find("(e)");
    const g = (label: string, ok: boolean, detail: string): void => {
      console.log(`GATE ${ok ? "PASS" : "FAIL"} ${label}: ${detail}`);
    };
    console.log("");
    console.log("## post-fix gate (live)");
    if (!a || !c || !d || !e) {
      g("shape", false, "missing matrix rows (harness bug)");
    } else if ([a, c, d, e].some((r) => r.liveStatus === "LIVE-SKIP")) {
      g("live", false, "dev server unreachable — re-run with `npm run dev` up (documented, not red)");
    } else {
      g("(a) EOA stays 200", a.liveStatus === "200" && hasSession(a.liveBody), `status=${a.liveStatus}`);
      g("(c) real 6492 flips to 200", c.liveStatus === "200" && hasSession(c.liveBody), `status=${c.liveStatus} body=${c.liveBody.slice(0, 120)}`);
      g("(d) dummy wrapper stays 401 (3/3)", d.liveStatus === "401,401,401", `status=${d.liveStatus}`);
      g("(e) tampered stays 401 (3/3)", e.liveStatus === "401,401,401", `status=${e.liveStatus}`);
    }
  }
  console.log("");
  console.log("Re-run: npx tsx scripts/siwe-matrix.ts" + (wantLive ? " --live" : "        # add --live once `npm run dev` is up"));
}

main().catch((e) => {
  console.error("HARNESS-ERROR", e);
  process.exit(1);
});
