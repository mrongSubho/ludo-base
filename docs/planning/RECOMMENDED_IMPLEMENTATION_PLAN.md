# Recommended Implementation Plan — Ludo Base

| Field | Value |
| --- | --- |
| **Project** | Ludo Base |
| **Document type** | **Completed capabilities + remaining checklist** |
| **Status** | Stable-build engineering **complete** · residual checklist in §2 |
| **Companions** | [`docs/planning/SMART_WALLET_PLANNING.md`](./SMART_WALLET_PLANNING.md) (**wrapped / implemented** W0–W5 + R0–R5) · [`docs/ops/UNPARK_CHECKLIST.md`](../ops/UNPARK_CHECKLIST.md) · [`docs/tokenomics/CHIPS_PLANNING.md`](../tokenomics/CHIPS_PLANNING.md) · [`ENGINE_LOGIC.md`](../../ENGINE_LOGIC.md) |
| **Last updated** | 2026-09-28 |

> **Scope note:** growth/media surfaces are **out of this plan**. Track engine, netcode, quality, gameplay, wallet, and CHIPS progress here only.

---

## 1. Completed functionality

### 1.1 Game engine (deterministic core)

| Capability | Where |
| --- | --- |
| Pure rules: gate-crossing, exact-57, 3×six, captures, 2v2 `TEAM_PAIRINGS` | `lib/gameLogic.ts` · `lib/engine/core.ts` · `lib/constants.ts` |
| Board geometry + corners / safe stars | `lib/boardLayout.ts` |
| Property tests (fast-check) in CI | `scripts/engine.props.test.ts` |
| Replay log + canonical `hashGameState` | `lib/replay/` · `npm run replay` |
| **≥50 golden-match corpus** (double-run hash CI) | `scripts/golden-replay.ts` · `npm run test:golden` |
| Match lifecycle FSM (illegal transitions metered) | `lib/matchFsm.ts` + `TeamUpContext` |
| AI off main thread (Web Worker + sync fallback) | `lib/ai/worker.ts` · `lib/ai/client.ts` |
| Difficulty calibration bench | `npm run bench:ai` |
| Snakes mode engine | `lib/snakesLogic.ts` |

### 1.2 Netcode & multiplayer

| Capability | Where |
| --- | --- |
| Host authority + dual-path intents/seating (PeerJS + Supabase) | `hooks/TeamUpContext.tsx` · `useSupabaseRelay` · `usePeerManager` |
| Named `net_*` counters (heartbeat, reconnect, seq-gap, authority, schema) | `lib/netcode/counters.ts` |
| Single `resyncMatch()` snapshot path | `lib/netcode/resync.ts` |
| **Session-proofed resync** (no unauthenticated player resume) | `lib/netcode/resyncProof.ts` · Edge `move-auth` `resync` |
| PeerJS **npm-pinned** (no CDN) + optional self-hosted PeerServer env | `lib/peerFactory.ts` · [`docs/ops/SIGNALING.md`](../ops/SIGNALING.md) |
| Zod wire schemas + `protocolVersion` + size cap + **TTL/LRU dedup** | `lib/protocol/` · `lib/netcode/dedup.ts` |
| Spectator listen-only parity (schema + resync + counters) | `hooks/useSpectatorSync.ts` |
| Connection badge (LIVE / DEGRADED / RESYNC) | `app/components/ConnectionBadge.tsx` |
| Chaos + deep drills (intent flood, drop Peer/Realtime, host elect, grace) | `npm run test:chaos` · `npm run drill:deep` · [`docs/ops/NETCODE_DRILLS.md`](../ops/NETCODE_DRILLS.md) |
| **2–4 client MP harness** (seat → capture → resync → end) | `npm run test:mp` |
| Abandon grace + HIGH-2 classification (burn split flag-gated) | `lib/netcode/abandon.ts` |

### 1.3 Quality, ops & observability

| Capability | Where |
| --- | --- |
| Telemetry funnel + secret scrub + sampling policy | `lib/telemetry.ts` · `lib/telemetryPolicy.ts` |
| Sentry transport (DSN auto-bind) | `lib/telemetrySentry.ts` · `NEXT_PUBLIC_SENTRY_DSN` **configured** |
| Standing SLOs | [`docs/ops/SLOS.md`](../ops/SLOS.md) |
| Edge calver + `x-ludo-edge-version` + client version check | `lib/edgeOps.ts` · [`docs/ops/DEPLOY_OPS.md`](../ops/DEPLOY_OPS.md) |
| Realtime load targets + degrade order | `lib/edgeOps.ts` |
| Migration **RLS static gate** in CI | `npm run check:rls` |
| Honest lint/CI (ESLint 9, rules=`error`) | `eslint.config.mjs` · CI `lint` + `typecheck` + `auth-gate` |
| Typed player error copy + error boundaries | `lib/errorCopy.ts` · `PanelErrorBoundary` · `app/error.tsx` |
| Perf hop budget + `__ludoPerf` hook on Board + `/token-move-test` | `lib/perf/` · `app/token-move-test` |
| Device-pass / un-park runbooks | [`docs/ops/DEVICE_PASS.md`](../ops/DEVICE_PASS.md) · [`docs/ops/UNPARK_DECISION.md`](../ops/UNPARK_DECISION.md) |

### 1.4 Gameplay product surfaces

| Capability | Where |
| --- | --- |
| Match receipt / post-mortem (hash, rolls, net, AFK) | `lib/receipt/` · `MatchStatsOverlay` |
| Pass & Play (hot-seat) + share-link room | `OfflineMatchPanel` · `lib/localRoom.ts` |
| Live-ops notice strip (`/api/notices`) | `app/components/NoticeStrip.tsx` |
| Emotes (preset, no free-text) | `lib/emotes.ts` · `EmoteTray` |
| Offline vs AI · Classic / Power / Snakes | existing game shell |
| Themes + token styles | `ThemeSwitcher` · `TokenStyleSwitcher` |

### 1.5 Identity & wallet — **plan wrapped**

See **[`docs/planning/SMART_WALLET_PLANNING.md`](./SMART_WALLET_PLANNING.md)** (status: **Implemented**, residual in its §12) and [`PHASE_0A_SPIKE_CHECKLIST.md`](./PHASE_0A_SPIKE_CHECKLIST.md).

| Capability | Notes |
| --- | --- |
| Dual-path auth: External (Base Account / injected) **and** In-game CDP Smart Account | One active `wallet_address` per session |
| `siwe:base` / Base Account identity (`0x221A…`) | Same account as Base app |
| SIWE app session + EIP-712 `LudoMatchSession` | Match moves never use SIWE-only session |
| Passkey MFA · WC as Ludo wallet · send/receive/activity | Real-wallet product path |
| App on **Base Sepolia (84532)** until mainnet | Network pin |
| Phase 0a spike | `/spike/cdp` |

### 1.6 CHIPS / on-chain (scaffold + freeze pack)

| Capability | Notes |
| --- | --- |
| `MatchPool` / `ClaimHub` / `MissionClaim` / `SeasonClaim` / `LegacyClaim` | `contracts/` + Foundry tests (suffix / pause-delta / host 1271 / transitions) |
| Deploy / bootstrap / role / smoke scripts | `contracts/script/*` · `scripts/foundry-deploy.sh` · `smoke-sepolia.sh` · `b20-smoke.sh` |
| Burn / supply dashboard | `app/burn` |
| Pool join/settle hooks + settle button | `hooks/useChipsPool.ts` · `useSettlePool` · `SettlePoolButton` |
| Mission vouchers · merkle/legacy claims · Galxe callback | `lib/missionVoucher.ts` · `lib/merkleClaims.ts` · `app/api/onboarding/*` |
| Indexer worker + watcher runbook | `scripts/chips-indexer-worker.ts` · [`docs/ops/CHIPS_WATCHER_RUNBOOK.md`](../ops/CHIPS_WATCHER_RUNBOOK.md) |
| TOKEN_PARAMS / PHASE0 gates / SYBIL draft | `docs/tokenomics/` |
| Builder-code attribution helpers | `lib/builderCode.ts` · `lib/builderCode` wiring |

---

## 2. Undone checklist

### 2.1 Un-park / stable sign-off (human)

- [ ] **Q2 phone hop pass** — [`DEVICE_PASS.md`](../ops/DEVICE_PASS.md) → [`UNPARK_DECISION.md` §1.1](../ops/UNPARK_DECISION.md)
- [ ] **N3 live D1–D4** (two real clients) — [`NETCODE_DRILLS.md`](../ops/NETCODE_DRILLS.md) → [`UNPARK_DECISION.md` §1.2](../ops/UNPARK_DECISION.md)
- [ ] Confirm **Sentry `session_start`** once in UI (DSN already set) → [`UNPARK_DECISION.md` §1.3](../ops/UNPARK_DECISION.md)
- [ ] Flip **`UNPARK_DECISION.md`** to DECIDED and mirror here

### 2.2 Quality residuals (small)

- [ ] FSM illegal-transition **soak week** recorded (counters already metered)
- [ ] Live **`net_*` dashboard** (Grafana/Sentry) + forced-reconnect drill sign-off
- [ ] Optional: remove remaining file-level eslint disables in legacy modules

### 2.3 CHIPS value track

- [ ] Full **Foundry suite green** in CI (`forge test`) + gas snapshot gate
- [ ] **Sepolia** deploy + `isActivated(ASSET)` recorded in TOKEN_PARAMS
- [ ] Paid join / claim **value** UI on Sepolia (production-quality paths)
- [ ] **M11** B20 + ERC-8021 trailing-suffix assertion
- [ ] Settlement signer custody runbook + timeout-refund watcher live

### 2.4 C0 / economic freeze (external)

- [ ] Sybil spreadsheet **published + signed** ([`C0_FREEZE_PACK.md`](../tokenomics/C0_FREEZE_PACK.md) §1)
- [ ] Counsel **L1–L6** written issue-spot + geo table
- [ ] Welcome-grant ship/no-ship + liquidity owner/date in TOKEN_PARAMS

### 2.5 Later product (after checklist 2.1)

- [ ] Tournaments economy · spectator predict (own legal gate) · marketplace CHIPS catalog
- [ ] Paymaster **funding** (interface only until then)

---

## 3. Invariants (never regress)

1. `TEAM_PAIRINGS` single truth (Green+Yellow vs Red+Blue) — `lib/constants.ts`
2. Engine-math legality only (`calculateNextPosition` / `getLegalTokenIndices`)
3. Networked rolls/moves via Edge; `match_states.seq` display + rules authority
4. Pull-only CHIPS claims; no hot-wallet gameplay push
5. Scorer on mission/season/partner only — never match prizes/refunds
6. Power `type` stripped on wire; ECDH DMs fail-closed
7. SIWE app session never authorizes match moves

---

## 4. Quick commands

| Command | Purpose |
| --- | --- |
| `npm test` | Full node suite (engine, netcode, MP, golden, onboarding…) |
| `npm run test:golden` | ≥50 deterministic golden matches |
| `npm run test:mp` | Multiplayer harness |
| `npm run test:chaos` / `drill:deep` | Netcode drills (sim) |
| `npm run bench:ai` | AI calibration |
| `npm run check:rls` | Migration RLS static gate |
| `npm run lint` / `typecheck` | Quality gates |
| `npm run unpark:evidence` | Auto evidence for un-park note |

---

*Update this file when a §2 checklist item lands. Engine/settle rule changes still require `ENGINE_LOGIC.md`. Tokenomics remain in `docs/tokenomics/CHIPS_PLANNING.md`.*
