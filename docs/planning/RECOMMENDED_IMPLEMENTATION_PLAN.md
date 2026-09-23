# Recommended Implementation Plan — Ludo Base

| Field | Value |
| --- | --- |
| **Project** | Ludo Base |
| **Document type** | Execution plan — **stable, industry-grade game build first** |
| **Inputs** | `docs/research/COMPETITIVE_LUDO_WORLD_LUDO_KING.md` §§5–13 · `AGENTS.md` · `ENGINE_LOGIC.md` · current `hooks/` + `lib/` + `app/` + `supabase/` |
| **Focus** | Close operational/game-engine gaps with modern industry-grade tech |
| **Parked (until stable build)** | **Voice · i18n · ads** — and any growth stack that depends on them |
| **CHIPS posture** | Design + freeze-pack only during this plan; contracts/value UI **after** the stable-build gate |
| **Status** | Recommended plan (supersedes CHIPS-primary sequencing in v1 of this file) |
| **Last updated** | 2026-09-22 |

---

## Table of contents

- [0. Verdict](#0-verdict)
- [1. Scope lock](#1-scope-lock)
- [2. What “industry-grade engine” means for this repo](#2-what-industry-grade-engine-means-for-this-repo)
- [3. Existing system map](#3-existing-system-map)
- [4. Workstreams](#4-workstreams)
- [5. Modern tech choices (adopt now)](#5-modern-tech-choices-adopt-now)
- [6. Sequencing — Foundation → Hardening → Stable](#6-sequencing--foundation--hardening--stable)
- [7. Week-by-week (first 10 weeks)](#7-week-by-week-first-10-weeks)
- [8. Parked until after stable build](#8-parked-until-after-stable-build)
- [9. CHIPS during this plan (narrow lane)](#9-chips-during-this-plan-narrow-lane)
- [10. Stable-build exit criteria](#10-stable-build-exit-criteria)
- [11. Immediate next actions](#11-immediate-next-actions)

---

## 0. Verdict

**Get to a stable, industry-grade game core first. Do not touch voice, i18n, or ads in this plan.**

| Priority | Track | Goal |
| --- | --- | --- |
| **1 (now)** | **E — Engine core** | Deterministic, typed, tested, replayable rules + AI off the render thread |
| **2 (now)** | **N — Netcode** | Heartbeat/reconnect ladder, schema-safe wire, resync, authority clarity |
| **3 (now)** | **Q — Quality & observability** | Telemetry, perf budgets, honest CI, chaos/reconnect tests |
| **4 (now)** | **G — Gameplay gaps** | Session-quality items that need no media/ad/i18n stack |
| **5 (parallel, thin)** | **C0 — CHIPS pre-work** | Freeze pack + optional M11 spike only — **no** MatchPool/ClaimHub build yet |
| **Parked** | Voice, i18n, ads, ad-monetization seams | After stable build + explicit un-park decision |

**One-line:** *Harden the engine and the netcode to production standards; when the loop is stable and measurable, then (and only then) re-open growth/monetization tracks.*

Previous mix plan (CHIPS Phase 1 as primary after Spine) is **superseded**. CHIPS remains the long-term thesis (`docs/tokenomics/CHIPS_PLANNING.md`) but is **not** the critical path to a stable build.

---

## 1. Scope lock

### 1.1 In scope (this plan)

- Game engine correctness, determinism, performance, testability
- Multiplayer reliability and protocol hygiene
- Observability (crash, vitals, netcode metrics, funnels for *play* — not ads)
- Playback/replay/debug tooling
- Session gaps that improve play without new platform dependencies (emotes, local room, notice strip, abandon/AFK honesty, match receipt as a *debug/trust* artifact)
- CI truthfulness and API boundary typing
- CHIPS **documentation/freeze** only (narrow lane in §9)

### 1.2 Out of scope (do not open tickets)

| Parked | Un-park when |
| --- | --- |
| Voice (LiveKit/Agora/WebRTC voice) | Stable-build gate green **and** session-length data says we need it |
| i18n / locale pipeline / RTL | Stable-build gate green **and** a distribution plan that needs locales |
| Ads (MAX / rewarded / any mediation) | Stable-build gate green **and** a free-tier revenue decision |
| Ad-driven RXP / `FreeAdSurface` | Same as ads |
| Native shell / store packaging | Separate distribution decision |
| Predict pools, tournaments economy, marketplace CHIPS | After CHIPS value track resumes |

### 1.3 Invariants (never regress)

1. `TEAM_PAIRINGS` single truth (Green+Yellow vs Red+Blue) — `lib/constants.ts`.
2. Engine-math legality only — `calculateNextPosition` / `getLegalTokenIndices`, never `pos + roll`.
3. Networked rolls/moves via Edge (`roll-dice` / `move-auth`); `match_states.seq` authority.
4. Dual-path intents (`intentId` dedup) and dual-path seating stay.
5. Power-`type` stripped on the wire (`lib/wireSanitize.ts`); DMs fail-closed (`lib/encryption.ts`).
6. SIWE app session never authorizes match moves.
7. Offline/AI remains off-chain, zero CHIPS.

---

## 2. What “industry-grade engine” means for this repo

Not a Unity/Cocos rewrite. It means the **web game core** meets the same production bar those engines assume:

| Bar | Today | Target |
| --- | --- | --- |
| **Deterministic rules** | Good: pure `lib/gameLogic.ts` + `lib/engine/core.ts` | Same + **replayable action log** and golden replays in CI |
| **Property safety** | Table tests in `scripts/engine.test.ts` | + **fast-check** properties (no illegal jumps, capture set consistency, 3×six, exact-57, gate crossing) |
| **Typed wire** | Hand types + `wireSanitize` | **Zod (or Valibot) schemas** on every PeerJS / Supabase / Edge payload; parse-or-drop |
| **Explicit match lifecycle** | Implicit flags across hooks | **Typed match FSM** (states: lobby → seating → live → ended / reconnecting) — one authority for legal transitions |
| **AI isolation** | `lib/aiEngine.ts` on main thread | **Web Worker** (or deferred idle) so Master bots never jank GSAP hops |
| **Render budget** | DOM + GSAP FLIP 1.3s (smooth desktop, weak low-end mobile) | **Frame budget** (≤16ms compose during hop) + composite-only motion; optional canvas token layer only if budget fails |
| **Net resilience** | Dual-path intents + snapshot refresh | Named **heartbeat / reconnect / seq-gap** ladder, resync protocol, connection SLOs |
| **Chaos-tested multiplayer** | Manual smoke (`docs/SMOKE_MULTIPLAYER.md` was deleted — recreate) | Scripted **reconnect / NAT-flap / host-fail** scenarios in CI or a weekly drill script |
| **Observability** | Console + `console.warn` in TeamUp | Sentry + Web-Vitals + netcode metrics + play funnel |
| **CI honesty** | `npm test` + `tsc` green; `npm run lint` broken | Lint real; engine tests + property tests + typecheck + multiplayer integration job |

**Non-goals for “modern engine”:** ECS framework cosplay, full rollback netcode (turn-based), custom WebGL engine before a measured budget failure, replacing Supabase/PeerJS wholesale.

---

## 3. Existing system map

### 3.1 Build on these (do not rewrite)

| Seam | Files | Role in this plan |
| --- | --- | --- |
| Pure rules | `lib/gameLogic.ts`, `lib/engine/core.ts`, `lib/boardLayout.ts`, `lib/constants.ts`, `lib/snakesLogic.ts` | Track E center; wrap with properties + replay |
| Engine tests | `scripts/engine.test.ts`, `npm run check:engine` / `npm test` | Expand; add `scripts/engine.props.test.ts` |
| Match orchestration | `hooks/useGameEngine.ts`, `hooks/useGameActions.ts`, `hooks/useMatchStates.ts`, `hooks/useGameTimer.ts` | Feed the match FSM; keep UI dumb |
| Multiplayer | `hooks/useSupabaseRelay.ts`, `hooks/usePeerManager.ts`, `hooks/usePeerChat.ts`, `hooks/TeamUpContext.tsx`, `hooks/useMatchmaking.ts`, `hooks/useCompetitiveConnection.ts` | Track N; counters + schema + resync |
| Edge authority | `supabase/functions/roll-dice`, `move-auth`, `_shared/{engine,networkBoundary,walletVerify}` | Shared Zod schemas with client; fail closed |
| Proof/session split | `lib/matchProof.ts`, `lib/sessionProof.ts`, `hooks/useMoveAuth.ts`, `hooks/useAppSession.ts` | Unchanged trust split |
| Sanitize / secrets | `lib/wireSanitize.ts`, `lib/encryption.ts` | Keep; extend to full schema parse |
| Bots | `lib/aiEngine.ts`, `DIFFICULTY_PARAMS` | Worker isolation + strength calibration tests |
| Presentation | `BoardTokens.tsx`, `Board.tsx`, `LudoDice.tsx`, GSAP FLIP | Perf budget; optional canvas layer |
| Spectators | `hooks/useSpectatorSync.ts`, `hooks/useSpectatorPresence.ts` | Schema + resync parity with players |
| Tooling | `lib/teamup/*`, `scripts/*` tests | Reuse for chaos drills |

### 3.2 Gaps this plan closes (from competitive §10, minus parked)

| Gap class | Closed by |
| --- | --- |
| No client crash/telemetry | **Q1** |
| No web-vitals / jank budget | **Q2** |
| No named netcode ops ladder | **N1** |
| Broken lint / thin CI | **Q3** |
| No reconnect chaos tests | **N3** / **Q4** |
| Engine under-specified under fuzz | **E2** |
| No replay/debug story | **E3** |
| AI on main thread | **E4** |
| Implicit match states / flappy authority | **E5** + **N2** |
| Wire trust is partial | **N4** |
| Local/party play weak | **G2** |
| Abandon/AFK honesty | **G3** |
| Live-ops notice | **G4** |
| Weak in-match connection UX | **N5** |

---

## 4. Workstreams

### Track E — Engine core (industry-grade)

| ID | Work | Where | Detail |
| --- | --- | --- | --- |
| **E1** | Golden **replay log** format | new `lib/replay/` | Append-only action events (`{ actionId, seq, actor, intent, diceReceipt?, resultHash }`) matching live authority order. Record from `useGameActions` / host apply path; replay into pure `processMove`-style reducer. |
| **E2** | **Property-based tests** | `scripts/engine.props.test.ts` + `fast-check` | Invariants: legal move ⊆ board; `calculateNextPosition` never teleports across gates; capture list ↔ board occupancy; 3×six skip; exact finish 57; home-lane 52–57; 2v2 TEAM_PAIRINGS assist/capture; snakes mode node degree. |
| **E3** | **Replay debugger** | `scripts/replay.ts` + optional `app/token-move-test` panel | CLI: `replay apply <file>` asserts final `GameState` hash. Dev UI already has `app/token-move-test` — extend to load a replay. |
| **E4** | **AI in a Web Worker** | new `lib/ai/worker.ts` | Move `aiEngine` + difficulty clocks off main thread; structured message `AiRequest`/`AiResponse` (Zod). Timeout → deterministic fallback move (never freeze turn). |
| **E5** | **Match FSM** | new `lib/matchFsm.ts` | Explicit states/transitions for lobby/seating/live/ended/reconnecting/compute-host-elect. Replace scattered booleans gradually (`TeamUpContext`, `useMatchStates`, `useGameTimer`). Illegal transition → telemetry, not silent divergence. |
| **E6** | **Engine hash / snapshot digest** | `lib/engine` helper | `hashGameState(state)` for replay assertions and host/guest diff (debug). Must ignore ephemeral UI fields. |
| **E7** | **Difficulty calibration suite** | `scripts/ai.bench.ts` | Fixed seeds; Rookie/Pro/Master win-rate and blunder-rate targets from `AI_SCORES` / `DIFFICULTY_PARAMS`. Fail CI on wild drift. |

### Track N — Netcode reliability

| ID | Work | Where | Detail |
| --- | --- | --- | --- |
| **N1** | **Heartbeat / reconnect / seq-gap ladder** | `useSupabaseRelay`, `usePeerManager`, `useMatchStates`, `TeamUpContext` | Named counters (TSDK-style): `net_heartbeat_ok/timeout`, `net_reconnect_attempt/success`, `net_seq_gap`, `net_authority_switch`, `net_resync_applied`. Exponential backoff with jitter. |
| **N2** | **Resync protocol** | host + guest apply path | On seq-gap or reconnect: request `match_states` snapshot → apply → resume timers only after snapshot (already sketched in `ENGINE_LOGIC.md` §12 — **implement as a single `resyncMatch()`**, don’t leave it tribal). |
| **N3** | **Chaos drills** | `scripts/net.chaos.ts` + doc `docs/ops/NETCODE_DRILLS.md` | Scripted: drop PeerJS 10s, drop Supabase broadcast, delay intents, duplicate `intentId`, kill host / compute-host elect, clock skew on timers. Record pass/fail + counters. |
| **N4** | **Zod wire schemas** | new `lib/protocol/` | One schema module shared by client + Deno `_shared` (keep Deno-safe). Every inbound PeerJS/Realtime/Edge payload `parse` → typed or drop+meter. Apply on `GAME_ACTION`, `GAME_INTENT`, `JOIN_REQUEST`, `SYNC_PROFILE`, `match_states`, Edge responses. |
| **N5** | **Connection state UX** | board chrome | Visible badge: `live` / `degraded` / `resyncing` / `host-elect`. No silent “frozen” games. |
| **N6** | **Spectator parity** | `useSpectatorSync` | Same schema + resync path as players (listen-only). |

### Track Q — Quality & observability

| ID | Work | Where | Detail |
| --- | --- | --- | --- |
| **Q1** | **Crash + product telemetry** | new `lib/telemetry.ts`, init in `app/layout.tsx` | Sentry (or equiv) + `track()` funnel: `session_start`, `lobby_open`, `seat_confirmed`, `roll_ok`, `move_ok`, `match_end`, `resync_ok`. **Never** log signatures/keys/DM plaintext. |
| **Q2** | **Perf budget** | `BoardTokens` / dice / GSAP | Document budget: hop compose ≤16ms, long-task ≤50ms during move; measure with Web-Vitals + `performance.measure` around GSAP timelines. Fix regressions before new board skins. |
| **Q3** | **Honest CI** | `package.json`, `.github/workflows/ci.yml` | Replace broken `next lint` with `eslint` (or Biome). Jobs: `lint`, `typecheck`, `engine-tests`, `engine-props`, `ai-bench` (soft), `net-chaos` (nightly). |
| **Q4** | **Multiplayer integration tests** | `scripts/mp.it.ts` or Playwright | 2–4 client harness against local/edge stub: seat → roll → move → capture → end. Prefer Node harness before browser E2E. |
| **Q5** | **Error boundaries + player-facing failure copy** | `app/components` shell | Typed error codes from N4; recoverable vs fatal. |

### Track G — Gameplay gaps (no voice / i18n / ads)

| ID | Work | Where | Detail |
| --- | --- | --- | --- |
| **G1** | **Match receipt / post-mortem** | `MatchStatsOverlay` + optional route | Rolls, `actionId`s, seq history, disconnects, final `hashGameState`. Debug + trust artifact (also future CHIPS receipt spine). |
| **G2** | **Local pass-and-play** | invite `?s=`, `lib/guest.ts` | One-device hot-seat + QR share-link room. No extra SDKs. |
| **G3** | **Abandon / AFK honesty UI** | `useAFKManager`, `useCompetitiveConnection` | Grace timer, strike counter, dual-path abandon **without** CHIPS burn logic (feature-flag the burn split for later). |
| **G4** | **Notice strip (live-ops)** | lobby/footer | Signed server-driven notices (maintenance, rules, drills). No CMS. |
| **G5** | **Emotes / preset chat expand** | `usePeerChat` | Cheap session warmth **without** voice. Keep ECDH DMs as-is. |

### Track C0 — CHIPS narrow lane (not the critical path)

See §9. Do not staff MatchPool/ClaimHub/contracts implementation until §10 is green.

---

## 5. Modern tech choices (adopt now)

| Concern | Choice | Why this, now |
| --- | --- | --- |
| Schema / wire | **Zod** (already in the dependency tree via wagmi/onchainkit) or **Valibot** if bundle size matters | One source of truth client + Edge; parse-or-drop |
| Property tests | **fast-check** + existing `node:test` via `tsx --test` | Stays in current runner; no Jest migration required |
| Match control | **Hand-rolled typed FSM** (`lib/matchFsm.ts`) first | XState is fine later; a 10-state explicit machine is clearer than a new runtime dependency on day one |
| AI concurrency | **Web Worker** + structured clone messages | Zero network; isolates Master cost |
| Replay | JSONL action log + canonical `hashGameState` | Diffable, CI-friendly, no binary formats |
| Render | **Measure first** (Q2). Default path: keep GSAP FLIP + `transform`/`opacity` only. Escalate to **PixiJS/canvas token layer** only if hop frame budget fails on low-end mobile | Avoid a rewrite while the core is still hardening |
| Multiplayer transport | Keep **PeerJS + Supabase Realtime dual-path**; optionally prototype WebTransport matchmaking later from `docs/superpowers/specs/2024-03-15-competitive-multiplayer-webtransport-design.md` | Spec exists; do not replace transport during stabilization |
| Integration tests | Node harness for engine+host protocol; Playwright only for 1 golden 4P path | Fast feedback in PR |
| Lint | **ESLint** flat config or **Biome** | Unbreak CI (L14) |
| Telemetry | Sentry + Web-Vitals | Industry default for web games/apps |

**Explicitly rejected for this phase:** Unity/Cocos rewrite · Colyseus/Socket.io migration · full rollback netcode · XState-at-all-costs · i18n frameworks · ad SDKs · voice SFUs.

---

## 6. Sequencing — Foundation → Hardening → Stable

```text
┌─────────────────────────────────────────────────────────────────┐
│ FOUNDATION (weeks 1–3)                                          │
│  Q3 CI honest · Q1 telemetry · N4 Zod wire · E1 replay log      │
│  E5 Match FSM skeleton · N1 counters · E2 property tests        │
└────────────────────────────┬────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ HARDENING (weeks 4–7)                                           │
│  N2 resync · N3 chaos drills · E4 AI worker · E3 replay CLI     │
│  E6 state hash · N5 connection UX · G3 abandon/AFK · G1 receipt │
│  Q2 perf budget · Q4 mp tests · E7 AI calibration               │
└────────────────────────────┬────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ STABLE (weeks 8–10)                                             │
│  G2 local room · G4 notice · G5 emotes · N6 spectators          │
│  Bug burn-down · drill sign-off · STABLE-BUILD checklist §10    │
└────────────────────────────┬────────────────────────────────────┘
                             ▼
              ┌──────────────┴──────────────┐
              ▼                             ▼
     Un-park growth?                 Resume CHIPS value track
     (voice / i18n / ads)            (contracts → Sepolia loop)
     — separate decision             per CHIPS_PLANNING + old plan
```

**Parallel thin lane (any time, max ~0.5 FTE):** C0 freeze pack + optional M11 Foundry spike (§9).

---

## 7. Week-by-week (first 10 weeks)

| Week | Engine (E) | Netcode (N) | Quality (Q) | Gameplay (G) | C0 thin |
| --- | --- | --- | --- | --- | --- |
| 1 | E1 replay log schema | — | Q3 lint/CI + Q1 telemetry init | — | TOKEN_PARAMS skeleton |
| 2 | E2 fast-check properties | N4 Zod protocol module | Q1 funnel events | — | — |
| 3 | E5 FSM + E6 hash | N1 counters | — | G1 receipt (debug) | Optional M11 spike |
| 4 | E4 AI worker | N2 `resyncMatch()` | Q2 budget harness | G3 AFK/abandon UX | Sybil model draft |
| 5 | E3 replay CLI | N5 connection badge | Q4 mp harness | — | Legal issue-spot brief |
| 6 | E7 AI bench | N3 chaos script v1 | — | G5 emotes | — |
| 7 | Property bugfix | N3 + N6 spectators | Perf fixes from Q2 | G1 wire history | — |
| 8 | FSM cleanup | Chaos v2 (host fail) | Q5 error copy | G2 local room | — |
| 9 | — | — | Nightly chaos in CI | G4 notice strip | — |
| 10 | **Stable burn-down** | Drill sign-off | Metrics review | Polish | Un-park decision meeting |

Order is load-bearing: **schemas and CI before large refactors; FSM before more multiplayer features; chaos before calling it stable.**

---

## 8. Parked until after stable build

These stay in the competitive gap register as *known* gaps. **No implementation, no design spikes, no dependency adds** until the §10 gate is green and we explicitly un-park.

| Item | Notes when un-parked |
| --- | --- |
| **Voice** | Push-to-talk (LiveKit or WebRTC) only after session-length data demands it |
| **i18n** | Pipeline + few locales only after a real distribution need |
| **Ads / mediation / rewarded** | Any ad stack, including “RXP for ads”, including `FreeAdSurface` |
| Native/store shell | Separate distribution decision |
| Frames / predict / paymaster funding | Belong to post-stable growth or CHIPS tracks |

Record un-park as a dated decision in this file’s decision table — do not sneak them into Track G.

---

## 9. CHIPS during this plan (narrow lane)

Tokenomics remains authoritative (`docs/tokenomics/CHIPS_PLANNING.md`). During the stable-build push:

**Allowed (≤0.5 FTE):**

1. `docs/tokenomics/TOKEN_PARAMS.md` skeleton (addresses/TBD, freeze-gate checklist).
2. Phase-0 freeze pack drafts: Sybil-profitability model outline, legal issue-spot brief, welcome-grant ship/no-ship, stall-path already elected.
3. **Optional:** M11 Foundry spike (`B20+ERC-8021` trailing suffix on `base-anvil`) — cheap kill/confirm of a thesis assumption. Record pass/fallback only.

**Not allowed until stable-build gate:**

- `MatchPool` / `ClaimHub` / `MissionClaim` implementation
- Settlement signer service
- Paid join/claim UI
- Indexer
- Any Sepolia value playtest

Rationale: money code on an unstable multiplayer core multiplies incident surface (dispute windows, abandon burns, co-sign queues) before the game is operationally boring.

---

## 10. Stable-build exit criteria

All must be true (checkbox list for the un-park meeting):

### Engine

- [ ] Replay log records and replays to identical `hashGameState` for ≥50 golden matches (CI sample)
- [ ] fast-check properties green in CI (E2 invariant list)
- [ ] Match FSM is the only transition authority; illegal transitions metered at 0 in a soak week
- [ ] AI Master runs in a worker; main-thread long tasks during bot turns &lt; 50ms
- [ ] AI calibration within published blunder/win bands (E7)

### Netcode

- [ ] Named `net_*` counters on a dashboard; forced reconnect drill documented
- [ ] All inbound PeerJS/Realtime/Edge payloads schema-parsed (N4) with drop metrics
- [ ] `resyncMatch()` path covered by chaos: drop PeerJS, drop broadcast, host fail
- [ ] Connection badge states observed correctly in drills (N5)

### Quality

- [ ] Lint + typecheck + engine tests + properties green on main
- [ ] Telemetry: crash-free sessions measured; play funnel visible (lobby → end)
- [ ] Hop frame budget met on a low-end reference device **or** canvas escalation ticket filed with data
- [ ] Multiplayer harness (Q4) green on main
- [ ] Recreated smoke doc: `docs/ops/NETCODE_DRILLS.md` signed off

### Gameplay (this plan’s G set)

- [ ] Receipt/post-mortem usable after a match (G1)
- [ ] Abandon/AFK grace visible and tested (G3)
- [ ] Local pass-and-play works offline (G2)
- [ ] Notice strip live (G4)

### Explicitly **not** required for stable

Voice · i18n · ads · CHIPS contracts · Sepolia value · store listing

---

## 11. Immediate next actions

1. **Scope lock agreement** — voice/i18n/ads parked (this doc §1.2 / §8).
2. **Q3** — fix lint/CI this week so every later PR is honestly gated.
3. **Q1** — telemetry + `lib/telemetry.ts` funnels on the play path.
4. **N4** — create `lib/protocol/` Zod schemas for the five hottest message types; parse-or-drop.
5. **E1 + E2** — replay JSONL + fast-check properties against `scripts/engine.test.ts` fixtures.
6. **E5** — draft `lib/matchFsm.ts` state table (implement incrementally).
7. Optional C0: M11 spike + TOKEN_PARAMS skeleton (no contracts build).
8. Un-park meeting only after §10 checklist is green.

---

## Decision record

| Decision | Choice |
| --- | --- |
| Primary goal of this plan | **Stable, industry-grade engine + gap closure** |
| Voice / i18n / ads | **Parked** until after stable build + explicit un-park |
| CHIPS implementation | **After** stable-build gate; pre-work only during this plan |
| CHIPS vs gaps first | **Gaps + engine first** (this rev); tokenomics unchanged |
| Wire safety | Zod/Valibot schemas + parse-or-drop |
| Rules testing | fast-check properties + golden replays + existing table tests |
| Match control | Typed hand-rolled FSM first |
| Render | Measure GSAP budget; canvas/Pixi only on proven failure |
| Transport | Keep PeerJS + Supabase dual-path during stabilization |
| Trust model | AGENTS.md invariants unchanged |

---

*Update this file when the un-park decision changes or the stable-build gate flips. Keep `COMPETITIVE_LUDO_WORLD_LUDO_KING.md` gap register in sync as Q/N/E items close. Engine/settle rule changes still require `ENGINE_LOGIC.md`.*
