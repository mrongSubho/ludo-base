# Loop repro — headless verdict (signing-storm dynamic track)

> Harness: `scripts/loop-repro.mjs` (static always + headless cold-load with `--live`).
> Precedent followed: serve app via `npm run dev`, drive with Playwright, capture console/pageerrors.
> Dev server used: LOCAL `http://localhost:3000` against scratch `xvwaqxqyjtlsuijgwozi.supabase.co`
> (matches `.env.local`; NEVER production). Browser: installed Google Chrome via
> `channel="chrome"` (no `npx playwright install chromium` download needed in this session).

## Verdict

| layer | result (2026-09-17) | evidence |
|---|---|---|
| static pre-sign state machine | 15/15 recorded, 0 hard-failures | `node scripts/loop-repro.mjs` — single SIWE funnel, per-instance guard, reject≡verify-fail→`null`, no backoff, 6 timer callers present, ECDH-before-SIWE |
| headless cold-load (disconnected, stub `window.ethereum` counting `personal_sign`/`eth_signTypedData`) | PASS — 0 spontaneous prompts, 0 console.errors, 0 pageerrors over 8s (covers 2s/4s pollers) | `node scripts/loop-repro.mjs --live` → `GET / 200`, `launched via channel=chrome`, `sign attempts = 0` |
| connected-wallet storm (the incident: MetaMask + Coinbase Smart Wallet on iPhone, constant popups) | **COULD NOT be reproduced headlessly** (documented limit, not red) | needs a real connected 6492 smart-wallet signer + mobile popup UX; headless stub is disconnected by design (`eth_accounts → []` → `ensureAppSession` early-`null` with no popup) |

## What could be reproduced

- **Cold-load negative:** with no wallet connected the app never prompts (correct). Proves the
  "no timer-driven signing without prior failure" ideal HOLDS when `address` is undefined —
  the violation only appears once a wallet is connected but sessionless.
- **Static violations (the storm proxy):** the six timer callers in `docs/notes/signing-triggers.md §2a`
  (2s host poll, 4s invite poll, 5s matchmaking heartbeat, 15s messages, 20s notifications, 30s presence)
  all call the funnel unconditionally. Combined with the matrix result
  (`npx tsx scripts/siwe-matrix.ts --live`: **(a) 200** vs **(c) 401 `{"error":"Invalid signature"}`**),
  a 6492 wallet is *provably* sessionless forever, so the next tick ALWAYS reprompts.
  That chain — `6492-401 → null → 2s/4s reprompt → iPhone popup` — IS the reproducible storm,
  even though the popup itself needs a phone to be seen.
- **Per-instance multiplier:** `sessionId` + `signingRef` are per-`useAppSession()` instance
  (`hooks/useAppSession.ts:18-20`); N mounts → N prompts for one intent (see trigger graph §0).
- **Double-popup DM:** `sendMessage` signs ECDH (`useDataActions.ts:134`) before SIWE (`:135`),
  so one sessionless DM intent = 2 popups.

## What could NOT be reproduced (and why that is fine)

1. **Real 6492 popup loop on iPhone** — requires a funded/deployed or counterfactual smart account
   paired to MetaMask-Mobile / Coinbase Smart Wallet on iOS, plus manual tap-through of each popup.
   Headless Chrome cannot emulate the mobile wallet switch or the OS popup queue. The harness
   substitutes the server-side observable (401) + client-side observable (timer callers) for the
   phone-side observable (popup count).
2. **Deployed smart-wallet (b) class live** — documented SKIP in the matrix (no cheap local 4337
   account; deliberately not automated). The counterfactual (c) wrapper exercises the same server
   code path (`recoverMessageAddress`-only) so (b)-SKIP does not weaken the conclusion.
3. **Multi-tab / multi-instance race timing** — static analysis proves the race exists; headless
   timing of N concurrent `ensureAppSession()` calls across tabs was not attempted (flaky, low signal).

## Exact re-run

```bash
# static only (always green, zero browser/server):
node scripts/loop-repro.mjs

# full headless (needs dev server on scratch env):
npm run dev -- --port 3000 &   # .env.local already points at xvwaqxqyjtlsuijgwozi (scratch)
node scripts/loop-repro.mjs --live
node scripts/signing-triggers-scan.mjs
npx tsx scripts/siwe-matrix.ts --live
```

## What a fix PR must demonstrate against THIS harness (acceptance gate)

1. `npx tsx scripts/siwe-matrix.ts --live` still shows **(a) 200** (no EOA regression) and documents
   (b)/(c) disposition; if the fix ADDS 6492 support, (c) must flip to 200 with a `sessionId`,
   otherwise (c) must stay 401 AND the client must stop retrying it (see 2).
2. `node scripts/loop-repro.mjs` static must flip the six timer callers from
   "PRESENT (violates ideal)" to guarded (e.g. pollers skip `ensureAppSession` when a terminal
   `verifyFailed`/`unsupportedWallet` flag is set, with backoff + reason codes distinguishing
   reject from verify-fail).
3. `node scripts/loop-repro.mjs --live` must stay at **0 spontaneous prompts** AND a new
   connected-sessionless simulation (stub `eth_accounts → [6492addr]`, stub sign → wrapped sig,
   mock `/api/siwe/verify → 401`) must show **at most 1 popup per intent + zero timer reprompts**
   (assert via `window.__signAttempts` length over ≥10s covering the 2s/4s cadences).
4. `npx tsc --noEmit` = 0, `npm test` green, `npm run build` green (harness files are additive only).
