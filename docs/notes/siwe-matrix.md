# SIWE signature matrix — observed results (signing-storm dynamic track)

> Harness: `scripts/siwe-matrix.ts` (imports exact `buildSiweMessage` from `lib/sessionProof.ts`; never hand-replicates).
> Target: LOCAL dev `http://localhost:3000` against scratch `xvwaqxqyjtlsuijgwozi.supabase.co` (per `.env.local`; NEVER production).
> Date: 2026-09-17. Re-run any time with the commands below.

## Live matrix (with `npm run dev` up)

```
# SIWE signature matrix — signing-storm harness
# baseUrl=http://localhost:3000 live=yes

| signer class | offline (server-logic replica) | live POST status | live body (trunc) |
|---|---|---|---|
| (a) plain EOA | PASS — recovered == address (0x7f597ebe5413bed048047e1c417b005dbd8cf509) | 200 | {"success":true,"sessionId":"6b162dbc-6c8d-4c47-86ae-224323a730e8","expiresAt":"2026-09-24T23:37:51.217+00:00","wallet":"0x7f597ebe5413bed048047e1c417b005dbd8cf509"} |
| (b) deployed smart wallet | SKIP — no cheap local source; needs fork/anvil + funded 4337 account (deliberately not automated here) | SKIP | set SMART_WALLET_ADDRESS + SMART_WALLET_SIG to exercise a real deployed account, else rely on (c) counterfactual |
| (c) counterfactual 6492-wrapped | REJECTED — isErc6492=true; recover threw: invalid signature length (expected: server rejects; proves 6492 unsupported) | 401 | {"error":"Invalid signature"} |
```

Notes:

- (a) 200 + `sessionId` reproduces the incident report's "synthetic EOA SIWE succeeds".
- (c) 401 `Invalid signature` BOTH offline (`recoverMessageAddress` throws on the wrapper) AND live
  (route `app/api/siwe/verify/route.ts:50-56` catch → 401). The 6492 wrapper was built manually via
  `viem.serializeErc6492Signature({ address: 0x1111…1111, data: 0xdeadbeef, signature: innerSig })`
  (`isErc6492Signature === true`); no on-chain account was needed because the point is the server's
  validation path, which is 6492-unaware by construction.
- (b) SKIP is a valid terminal state (documented, not red): sourcing a funded 4337 account cheaply
  needs a fork/anvil bundle the harness deliberately does not automate. (c) covers the server path.
- Without dev up, live columns read `LIVE-SKIP / unreachable: fetch failed` (exit 0, documented).

## Offline matrix (no server)

`npx tsx scripts/siwe-matrix.ts` → same offline column, live columns `NOT-RUN`. Always green.

## Re-run

```bash
npx tsx scripts/siwe-matrix.ts            # offline only (zero network/DB)
npx tsx scripts/siwe-matrix.ts --live     # offline + live POSTs to local dev (needs npm run dev)
SIWE_MATRIX_URL=http://127.0.0.1:3000 npx tsx scripts/siwe-matrix.ts --live
# Deployed-wallet override (optional, else SKIP stands):
SMART_WALLET_ADDRESS=0x… SMART_WALLET_SIG=0x… npx tsx scripts/siwe-matrix.ts --live
```

Safety: `--live` refuses non-local URLs unless `SIWE_MATRIX_ALLOW_REMOTE=1`. Live POSTs create
`app_sessions` rows on the SCRATCH DB only (expected write); never point at production.

## What a fix PR must show here

- (a) stays 200 (no EOA regression).
- If the fix adds 6492 verification (e.g. `verifyHash` / 1271 / validator contract), (c) must flip to
  200 with a session; if it does NOT add 6492 support, (c) stays 401 AND the client must enter a
  terminal non-retrying state (see `docs/notes/loop-repro.md` gate section 2–3) instead of the 2s/4s storm.
