# Ludo Base — Cross-Platform Mobile Application Plan (iOS + Android)

**A planning document for a native-feeling mobile client over the existing web/edge/Supabase system.**

| Field | Value |
|---|---|
| Document status | **Rev 1 — for review.** No decision is final until §10 is signed off. Nothing here is implemented. |
| Date | 2026-10-16 |
| Author roles | Mobile Application Architect · Systems Architect · Product Manager |
| Target platforms | iOS 16+ · Android 9 (API 28)+ — *see Q-6, provisional* |
| Proposed stack | React Native + Expo (managed, prebuilt) · Hermes · TypeScript |
| Backend | **Unchanged** — Next.js API routes on Cloudflare/OpenNext + Supabase (Postgres 17, RLS, Realtime, 4 Deno Edge Functions) |
| Related docs | `AGENTS.md`, `ENGINE_LOGIC.md`, `DESIGN.md`, `docs/ops/IMPLEMENTATION_RECORD.md`, `docs/ops/PENDING_TASKS.md`, `docs/planning/SERVER_AUTHORITY_MIGRATION_PLAN.md` (Rev 3), `docs/architecture/WORKLOAD_PLACEMENT_MATRIX.md` (Rev 2), `docs/ops/NETCODE_DRILLS.md`, `docs/ops/MOTION_AUDIT.md`, `docs/ops/UI_AUDIT_TRACKER.md` |
| Supersedes | Nothing. Proposes `ADR-003` (Appendix D) |
| Companion deliverable | `docs/planning/MOBILE_CROSS_PLATFORM_PLAN.md` (this file) |

### Revision history

| Rev | Date | Change |
|---|---|---|
| 1 | 2026-10-16 | Initial plan. Current-state assessment from a full-tree read; reuse/adapt/rebuild matrix; RN+Expo recommendation with the Flutter/Capacitor/native alternatives costed; target architecture; M0–M7 roadmap; 24-item risk register; dual-store release strategy; 12 gating decisions; 14 open questions. |

---

## 0. How to read this document

- **§1–§2 are the decision.** Read these if you read nothing else.
- **§3** is the evidence-based current-state assessment. Every claim carries a `file:line` or a verified count so it can be re-checked.
- **§4** is the reuse/adapt/rebuild matrix — the single most actionable artefact for estimating work.
- **§5–§6** are the approach and the target design. **§7** is the roadmap. **§8** is risk. **§9** is testing/release. **§10** is what must be decided. **§11** is what we do not know.
- Appendices carry the browser-API replacement table, the file-level reuse inventory, the invariant checklist, the ADR draft, and the backend delta list.

**Terminology.** *Client* = the mobile app. *Core* = the proposed shared TypeScript package. *Authority* = whatever currently holds the truth for a match (today: the host device + Supabase Edge; after `SERVER_AUTHORITY_MIGRATION_PLAN` P4: the room). *Shell* = the app chrome around screens. *Native module* = a platform-specific implementation exposed to JS.

---

## 1. Executive summary

### 1.1 The headline finding

**The system is unusually well-positioned for a shared-code mobile client — because the part that would normally be the blocker, the game rules engine, is already a DOM-free, deterministically-tested TypeScript module that is byte-synced to the server.**

Concretely, verified on 2026-10-16:

- `lib/engine/core.ts` (1,043 lines) is standalone — its own types, its own board geometry, **no `window`/`document` reference**. `scripts/sync-edge-engine.mjs` copies it verbatim into `supabase/functions/_shared/engine.ts`, and `scripts/check-edge-engine.mjs` fails CI if the two are not byte-identical.
- `scripts/golden-replay.ts` replays **≥50 seeded matches** with *"no `Math.random` anywhere, including seating"* and hashes the final state; `scripts/engine-diff.ts` fuzzes `lib/engine/core.ts` against the legacy `lib/gameLogic.ts` and asserts they agree on positions/captures/winner/bonus-roll at every step.
- Offline play (vs-AI, pass-and-play) is already fully client-side: `hooks/useGameEngine.ts:118-133` drives everything locally when `isNetworkedMatch` is false, and `:327-346` explicitly returns early for networked matches.
- The backend is 47 plain-JSON REST route handlers, 4 Deno Edge Functions, and a Postgres schema behind RLS. **There is no SSE, no long-poll, no JWT, and no server-rendered HTML dependency** in the data path.

That combination means the mobile client is **not** a rewrite of the game. It is a rewrite of the *presentation and device layer* around a portable core.

### 1.2 The headline problem

**Three things do not port, and two of them are structural.**

1. **The board.** It is DOM + SVG + two GSAP timelines + framer-motion (`app/components/BoardGrid.tsx`, `BoardTokens.tsx`, `board/TokenPiece.tsx`, `board/TokenVisual.tsx`). There is no canvas, no WebGL, no game loop — which is good — but the token-hop animation is a DOM-transform timeline that must be re-implemented on a GPU canvas.
2. **The device bridge.** `app/components/FrameProvider.tsx` (231 lines) exists solely to *lie about* viewport metrics: it probes `env(safe-area-inset-bottom)` and **clamps it to 0 when the reported inset exceeds 48px** because host webviews inject fake 80–200px insets; it strips `backdrop-filter` below 768px because blur composites too slowly and ghosts; it fakes keyboard insets from `visualViewport` deltas. On native, every one of those hacks is deleted and replaced by truthful platform APIs. This is a *net simplification*, but it is a full rewrite of the layout spine.
3. **The economics, not the code.** This app sells digital goods (marketplace items, CHIPS, mission vouchers) and exposes an on-chain wallet. **Apple's App Store Review Guideline 3.1.1 requires In-App Purchase for digital content consumed in the app**, and both stores have specific crypto/wallet rules. This is the highest-severity risk in the register (§8, RK-01/RK-02) and it is a *product* problem before it is an engineering one. **It must be resolved before M0.**

### 1.3 The recommendation

> **Build the mobile client as React Native + Expo, consuming a new shared TypeScript `core` package extracted from the existing `lib/`, with `react-native-skia` for the board and a real navigation stack replacing the 1,082-line screen state machine in `app/page.tsx`.**

The reasoning is narrow and specific, not "React Native is popular":

- **The engine reuse is only free in a JS runtime.** Flutter would require porting `lib/engine/core.ts` to Dart *and* maintaining the byte-parity gate against the Edge copy in a second language — destroying the "one authority" invariant (`AGENTS.md` security §2/§3) or tripling it.
- **The rules engine is already the tested asset.** `npm test` runs 41 suites including engine, protocol, netcode, concurrency and golden replay. In RN, those tests run unchanged against the shared core. In Flutter, all of them are re-authored.
- **A WebView wrapper (Capacitor) is rejected** because the board's GSAP timelines and the `FrameProvider` blur-strip already show the web layer is fighting mobile GPU compositing, and because WebView gives us none of the native wins we actually need (push, haptics, wallet SDKs, safe areas, biometrics).

Flutter is the credible alternative and is not a bad choice — it is a *second-class* choice here specifically because of the Dart boundary. The full trade-off table is §5.2; the ADR draft is Appendix D.

### 1.4 The one decision that gates everything

**D-1 — Codebase topology.** Do we (a) extract a shared `core` package consumed by *both* the existing Next.js web client and the new RN app, or (b) keep web as-is and fork the portable logic into a mobile-only package, or (c) go further and adopt React Native Web so the *screens* are shared too?

Every other decision's cost changes by a factor depending on this answer. Option (a) is recommended (§6.1); option (c) is the trap — it looks like "write once" and behaves like "debug everywhere", and it would invalidate the committed Playwright visual baselines (`tests/visual/baselines/*.png`) and the 10,657-line `app/globals.css`.

### 1.5 The sequencing constraint

The mobile plan **must not be designed against the current netcode as if it were final.** `docs/planning/SERVER_AUTHORITY_MIGRATION_PLAN.md` (Rev 3) is mid-flight: **Track A is verified NOT started** — `wrangler.jsonc` still has `main=.open-next/worker.js`, no `durable_objects`, no `src/worker.ts` — and P3+ is gated on the P0 Durable Object spike.

This matters because P4 of that plan explicitly includes *"the relocation of validation/minting in-process (+ engine third copy and a `check:engine` third target)"*. **The mobile client would be that third target.** Mobile M0–M2 (core extraction, shell, offline play) can proceed in parallel and safely. **Mobile M3+ (networked play) must be sequenced behind, or co-designed with, P3/P4** — otherwise we ship a client against a transport that is about to be replaced. See §7 and D-6.

---

## 2. Scope, assumptions and non-goals

### 2.1 In scope

- A single codebase producing signed iOS and Android applications.
- Parity of the *product surface* that already exists: lobby, matchmaking, 1v1/2v2/4P, classic/power modes, offline vs-AI and pass-and-play, spectating, social (friends, DMs, pokes, moderation), profile, leaderboard, missions/onboarding, marketplace, wallet.
- Integration with the **existing, unchanged** backend contracts.
- Native capability where the web layer faked it: push, haptics, audio, camera, biometrics, safe areas, orientation, keep-awake.
- A phased roadmap with exit gates, a risk register with mitigations, and a dual-store release strategy.

### 2.2 Explicit non-goals for this document

- **No code.** This is a plan, not an implementation.
- **No timeline estimates.** Sequencing and exit gates are given; calendar time is not, because it depends on D-1 (topology) and D-12 (staffing) which are unanswered (§11).
- **No re-litigation of the web design system.** `DESIGN.md` is the implemented contract and this plan consumes it; §6.10 explains how its tokens cross the boundary, not whether they should change.
- **No backend rewrite.** The backend delta is deliberately minimal and enumerated in Appendix E.

### 2.3 Assumptions carried (each is falsifiable — see §11)

| # | Assumption | Consequence if false |
|---|---|---|
| A-1 | The 47 REST routes and 4 Edge Functions stay the contract. No BFF is introduced for mobile. | A mobile BFF would add a deployment target and duplicate auth; would change §6.5 and §7 substantially. |
| A-2 | `(walletAddress, sessionId)` remains the identity tuple — no JWT/bearer is introduced. | §6.7 is simpler if a bearer token appears; the plan does not assume one. |
| A-3 | The chain stays Base Sepolia (84532) for the planning horizon (`lib/chains.ts:17`). | Mainnet cutover changes the wallet-compliance surface and §8 RK-02. |
| A-4 | Wallet connection remains **required** for the networked/economy paths, and guest mode remains a read-only trial. | If guest play must be fully functional on mobile, §6.7 and store review both change. |
| A-5 | The engine stays the single source of truth and byte-parity with the Edge copy is preserved. | The core-extraction premise (and the golden-replay gate) collapses. |
| A-6 | The team will not adopt React Native Web for the existing screens. | §6.1 and the entire reuse matrix change. |
| A-7 | Realtime gameplay continues to run on Supabase Realtime broadcast + `postgres_changes`. | A WebSocket/Durable-Object transport would change §6.8 and is *expected* after P3 — hence D-6. |
| A-8 | The existing Playwright visual baselines are **not** expected to apply to native. | If someone assumes they do, we will get false "no regression" confidence. §9.3 says so explicitly. |

---

## 3. Current-state architecture assessment

### 3.1 Runtime topology (verified)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ CLIENT — one Next.js 16 route ("/")                                      │
│  app/page.tsx  (1,082 lines) — appState ∈ {dashboard,game,spectating}    │
│                                activeTab ∈ 9 panels                      │
│  10 providers deep: MotionConfig → Wagmi → QueryClient → CdpAuth →       │
│    OnchainKit → Frame → GameData → TeamUp → [shell] → GuestWall          │
│  Board = DOM + inline SVG + 2 GSAP timelines + framer-motion. No canvas. │
│  Data = fetch('/api/*') + supabase-js (REST + Realtime WS) + PeerJS      │
└───────────────┬──────────────────────────────────┬───────────────────────┘
                │ plain JSON (no SSE, no JWT)      │ WS: Realtime broadcast
                ▼                                  │    + postgres_changes
┌──────────────────────────────────┐               │
│ NEXT API — 47 route.ts handlers  │               │
│  on Cloudflare via OpenNext      │               │
│  middleware.ts = edge rate limit │               │
│  Auth = (walletAddress, sessionId)│              │
└───────────────┬──────────────────┘               │
                │ service role                      │
                ▼                                   │
┌──────────────────────────────────────────────────┴───────────────────────┐
│ SUPABASE (Postgres 17)                                                   │
│  ~50 tables · RLS default-deny · 5 anon-readable tables (column-scoped)  │
│  17 callable SECURITY DEFINER RPCs · 3 column-lock triggers              │
│  Realtime published: conversations, matchmaking_queue, live_chat,        │
│                      live_matches                                        │
│  Edge Functions (Deno): move-auth (1,003 ln, the authority), roll-dice,  │
│    resolve-bet, _shared (engine.ts = verbatim copy of lib/engine/core.ts)│
└──────────────────────────────────────────────────────────────────────────┘
```

### 3.2 The layers, and which of them a mobile client touches

| Layer | Artifact | Mobile verdict |
|---|---|---|
| Presentation | `app/components/` — 96 files, 28,426 lines | **Rebuild** (platform) |
| Shell / navigation | `app/page.tsx` (1,082), `middleware.ts` | **Rebuild** (navigation) |
| Client state | `hooks/GameDataContext.tsx` (445), `TeamUpContext.tsx` (**1,522**) | **Adapt** (decompose) |
| Game orchestration | `hooks/useGameEngine.ts` (562), `useAIBrain`, `useGameTimer`, `useMatchStates`, `useSpectatorSync` | **Reuse** (React is React) |
| Rules engine | `lib/engine/core.ts` (1,043), `lib/gameLogic.ts` (687) | **Reuse verbatim** |
| Netcode primitives | `lib/netcode/` (8 files, 673 lines), `lib/matchFsm.ts`, `lib/hostIntent.ts` | **Reuse verbatim** |
| Protocol / validation | `lib/gameProtocol.ts`, `lib/matchProtocol.ts`, `lib/protocol/schemas.ts` | **Reuse verbatim** |
| API client | inline `fetch('/api/*')` calls across components | **Rebuild** (typed shared client) |
| Auth / identity | `lib/sessionProof.ts`, `lib/walletVerify.ts`, `hooks/useAppSession.ts`, `lib/guest.ts` | **Adapt** (storage) |
| Crypto / signing | `lib/encryption.ts` (ECDH), `lib/matchProof.ts`, `lib/walletSigner.ts` | **Adapt** (key store, polyfills) |
| Design tokens | `DESIGN.md` + `app/globals.css` (10,657 lines) | **Adapt** (tokens yes, CSS no) |
| Device bridge | `FrameProvider.tsx`, `useScreenWakeLock.ts`, `useIsMobileView.ts`, `LandscapeGuard.tsx` | **Rebuild** (native APIs) |
| Backend | 47 routes, 4 Edge fns, schema, RLS, RPCs | **Unchanged** (Appendix E delta) |

### 3.3 Core modules — the reuse candidates in detail

**The engine (highest-value reuse).** `lib/engine/core.ts` is standalone: it declares its own types and board geometry and imports nothing from `lib/types.ts`. `lib/engine/index.ts` is the barrel. `lib/gameLogic.ts` re-exports the same implementations (`getStarIndices`, `lcg32`, `rollPowerTypeLcg`, `spawnReplacementTile` at `:113-115`) so there is one authority. `scripts/engine-diff.ts` proves the two agree; `scripts/golden-replay.ts` hashes 50 seeded matches.

*Caveat to carry:* `lib/gameLogic.ts` is pure but not *fully* deterministic — it calls `Date.now()` in `processMove`'s `lastUpdate`, and `Math.random()` in `generateRoomCode` and `rollPowerType`. The deterministic paths (`lcg32`, `powerTileSeed`) exist precisely to avoid those in match-critical code. The core extraction should treat any remaining `Date.now()`/`Math.random()` in a match-critical path as a bug, not a porting task.

**The netcode primitives.** `lib/netcode/authorityGate.ts` (70), `dedup.ts` (147), `resync.ts` (120), `staleSeq.ts` (48), `counters.ts` (72), `abandon.ts` (116), `flushGate.ts` (28), `resyncProof.ts` (73) — 673 lines of pure logic with no DOM. `shouldApplyGameAction` (`authorityGate.ts:44-70`) is the rule that a guest advances only on `source:'match_states'` with a strictly newer seq. This is the security boundary expressed as a pure function, and it ports for free.

**The protocol.** `lib/gameProtocol.ts:7-45` validates intents and **structurally rejects any payload carrying `value`/`diceValue`** — a guest cannot name a face at the type level (`lib/types.ts:32`, `REQUEST_ROLL: Record<string, never>`). `lib/protocol/schemas.ts` holds zod schemas (zod is already a dependency) — these become the shared request/response validators for the mobile API client.

**The AI.** `lib/aiEngine.ts` + `lib/ai/client.ts` + `lib/ai/worker.ts`. The client uses a Web Worker with a **deterministic synchronous fallback when `Worker`/`window` are absent** (`lib/ai/client.ts:107-127`) — so RN works with no change, and only loses off-thread execution. That loss is recoverable later via a JSI worker, but it is not on the critical path: `lib/perf/budget.ts:8-15` budgets a hop at 1,300 ms and 16 ms of compose, which a synchronous AI pass on a modern phone can absorb.

**The economy / chain digests.** `lib/chips.ts` (ABIs + address getters), `lib/chipsSettle.ts` (EIP-712 `lobbyTicketDigest`/`settleDigest`/`abandonDigest`), `lib/merkleClaims.ts` (sorted-pair `hashPair`). These are pure and must stay byte-identical or the on-chain contract rejects them.

### 3.4 Data model

**`GameState` (`lib/types.ts:123-170`) is the authoritative game type** and is the single most important shape to preserve. It carries `positions`, `currentPlayer`, `diceValue`, `gamePhase`, `strikes`, `powerTiles` (authority keeps `type`, wire copies are stripped), `playerPowers`, `activeBoost`, `activeTraps`, `activeShields`, `consecutiveSixes`, `afkStats`, `matchStats`, `participantPeers`, `powerTileSeed`, `lastRollId`.

Wire-safety is a **type-level invariant**: `PowerTilePublic` (`:96-99`) omits `type`, and `lib/wireSanitize.ts` strips it via `sanitizeGameStateForWire`. `/api/match/state` returns the stripped form (`app/api/match/state/route.ts:27`). Mobile must respect the same split — an RN client that types `powerTiles` as `PowerTile[]` everywhere would be a regression.

**Database.** ~50 tables behind **default-deny RLS**, with only **five anon-readable** tables granted by column list (`202609300013:66-83`): `players` (narrow columns only — `coins`, `peer_id`, `ecdh_pubkey`, `current_room_code` are server-only), `live_chat`, `live_matches` (six columns only), `matches`, `tournaments`. Three column-lock triggers protect `players.coins` (frozen, raises `LEGACY_COINS_FROZEN`), server-owned `players` columns, and `messages` identity/content immutability.

**Match state authority.** `match_states` is keyed by `match_id` (text PK) with `seq int default 0` — the **optimistic-concurrency version**. Every authoritative write is `UPDATE … WHERE match_id=? AND seq=?` (`move-auth` at `:626-636`), confirmed by re-read, and a mismatch returns `409 {code:'STALE_SEQ'}`. Clients advance only on a strictly higher seq (`lib/netcode/resync.ts:85-98`).

### 3.5 Transport and authority — what a mobile client must speak

Two transports coexist:

1. **Supabase Realtime broadcast** — the primary gameplay path. Channel `game-room-<roomCode>`, event `game-action`. Sent by `hooks/useSupabaseRelay.ts:55-89`, received at `:100-123`. `move-auth` broadcasts authoritative `ENGINE_STATE` snapshots to the same channel.
2. **PeerJS / WebRTC** — the older P2P path in `lib/teamup/`, with `lib/peerFactory.ts` pinning `peerjs@1.5.5` and STUN config, plus a raw `WebSocket` client in `lib/teamup/edge-server-client.ts` to `NEXT_PUBLIC_EDGE_SERVER_URL`.

Intent flow: player action → `hooks/useMoveAuth.ts` → Edge → `match_states` CAS → `match_moves` audit row → Realtime broadcast → peers apply if `shouldApplyGameAction` permits. Guests who lack authority send `GameIntent`s which the host translates via `hostActionForIntent` (`lib/hostIntent.ts`, wired at `hooks/useGameEngine.ts:428-451`).

**Portability:** `supabase-js` Realtime is React-Native-compatible. WebRTC is not native to RN and would need `react-native-webrtc`. **This is a live decision (D-8): does mobile v1 ship the PeerJS path at all, or Realtime-only?** Recommendation: Realtime-only for v1 — the PeerJS path is the legacy transport that P3 is designed to retire, and shipping it on mobile would mean porting a subsystem with a planned end-of-life.

### 3.6 Platform-dependency audit — the browser APIs we actually depend on

This is the list that determines the native-module budget. Full mapping in Appendix A.

| Capability | Today | Occurrences | Native replacement |
|---|---|---|---|
| Safe area + keyboard insets | `FrameProvider.tsx` probing + JS clamp | 1 file, 231 ln | `react-native-safe-area-context` + `react-native-keyboard-controller` — **hacks deleted** |
| Screen wake lock | `hooks/useScreenWakeLock.ts` | 1 hook | `expo-keep-awake` |
| Web Audio (synthesized SFX + ambient music) | `app/hooks/useAudio.ts` (13.5 KB) | 2 files | `react-native-audio-api` (implements the Web Audio API on native) |
| HTMLAudio clips | `app/hooks/useSoundEffects.ts` | 1 file | `expo-audio` |
| Haptics | `navigator.vibrate` | 2 sites | `expo-haptics` (**iOS Safari ignores `vibrate` today — this is a genuine feature gain**) |
| Camera QR | `html5-qrcode` | 1 component | `expo-camera` |
| QR generation | `qrcode` | 2 components | `react-native-qrcode-svg` |
| Clipboard | `navigator.clipboard` | 9 sites | `expo-clipboard` |
| Biometric gate | `navigator.credentials` (WebAuthn) | `useBiometricGate.ts`, `BootLock.tsx` | `expo-local-authentication` (+ passkeys via `react-native-passkeys` if CDP needs them) |
| Web Push / VAPID | `public/sw.js` + `usePushReady.ts` | 2 files + 1 route | **APNs + FCM** (`expo-notifications`) + **backend change** |
| Orientation lock | `LandscapeGuard.tsx` + manifest | 1 component | `expo-screen-orientation` |
| Board animation | GSAP DOM timelines | `board/TokenPiece.tsx`, `TokenVisual.tsx` | `@shopify/react-native-skia` |
| UI motion | framer-motion | 33 files, 34 total | `react-native-reanimated` (+ `moti` optional) |
| Confetti | `canvas-confetti` | 3 sites | Skia particle system or `react-native-confetti-cannon` |
| Backdrop blur | CSS `backdrop-filter` (stripped on mobile) | pervasive | `expo-blur` — **strip hack deleted** |
| Reduced motion | `prefers-reduced-motion` media query | CSS + `lib/motion.ts` | `AccessibilityInfo.isReduceMotionEnabled()` |
| Secure key storage | IndexedDB (non-extractable `CryptoKey`) | `lib/encryption.ts:48-51` | `expo-secure-store` + `react-native-quick-crypto` / JSI key store |
| `crypto.subtle` | ECDH + `matchProof.ts:237` | 2 files | polyfill / `react-native-quick-crypto` |
| Local persistence | localStorage (≈30 keys) + 1 cookie | across hooks | MMKV (sync, fast) + `expo-secure-store` for secrets |
| Hardware back | manual `popstate` interceptor | `app/page.tsx:451-476` | native back handler / `beforeRemove` |

**Genuine gains to bank:** truthful safe-area insets (deletes the 48px clamp), native blur (deletes the strip), real haptics on iOS, real push, native biometrics, native orientation lock, and **no more `visualViewport` keyboard math**.

### 3.7 What already works in our favour

1. **No server-rendered HTML in the data path.** Every route returns `NextResponse.json(...)`. Nothing needs a browser to parse.
2. **No SSE, no long-poll, no JWT.** Realtime is a WS the RN client can hold natively.
3. **No persistent `requestAnimationFrame` render loop** — rendering is event-driven React + tweens. There is no game loop to port.
4. **The board is not canvas/WebGL today**, so choosing Skia is a *greenfield* decision with no web parity debt — we are not asked to match an existing GPU pipeline.
5. **TanStack Query is already a dependency and already mounted but unused** (`app/Providers.tsx:15,66,81`; zero `useQuery` call sites). It can be *earned* on mobile with zero new dependency cost.
6. **The engine, netcode and protocol are pure and already tested** by 41 suites.

---

## 4. Reuse / Adapt / Rebuild matrix

Legend — **Reuse**: copy into `core`, no logic change. **Adapt**: copy + change an integration seam. **Rebuild**: write new for the platform. **Drop**: do not carry.

### 4.1 `lib/` — the portable core (the good news)

| Path | Lines | Verdict | Note |
|---|---:|---|---|
| `lib/engine/core.ts` | 1,043 | **Reuse verbatim** | Must stay byte-identical to the Edge copy. |
| `lib/engine/index.ts` | — | Reuse | Barrel. |
| `lib/gameLogic.ts` | 687 | Reuse | Audit remaining `Date.now()`/`Math.random()` on match-critical paths. |
| `lib/aiEngine.ts` | — | Reuse | Pure heuristics. |
| `lib/ai/client.ts`, `lib/ai/worker.ts` | — | Adapt | Keep sync fallback; optionally a JSI worker later. |
| `lib/constants.ts` | — | Reuse | `TEAM_PAIRINGS` is an invariant (Green+Blue vs Red+Yellow). |
| `lib/boardLayout.ts`, `lib/snakesLogic.ts` | — | Reuse | Pure geometry. |
| `lib/gameProtocol.ts`, `lib/matchProtocol.ts` | — | Reuse | Intent validation + face-unrepresentable invariant. |
| `lib/protocol/schemas.ts`, `lib/protocol/index.ts` | — | Reuse | zod → the mobile API client's validators. |
| `lib/netcode/*` (8 files) | 673 | **Reuse verbatim** | `authorityGate` is a security boundary. |
| `lib/matchFsm.ts`, `lib/hostIntent.ts` | — | Reuse | Pure state machine + intent translation. |
| `lib/types.ts` | 231 | Reuse | `GameState` is the contract. Keep the `PowerTile`/`PowerTilePublic` split. |
| `lib/types/teamup.types.ts` | — | Reuse | |
| `lib/matchProof.ts`, `lib/sessionProof.ts` | — | Reuse | Canonical signed payloads — digests must not drift. |
| `lib/walletVerify.ts` | — | Reuse (server-side) | 6492/1271-aware, chain-gated to 84532. Unchanged. |
| `lib/chips.ts`, `lib/chipsSettle.ts`, `lib/merkleClaims.ts` | — | Reuse | EIP-712 digests must be byte-identical. |
| `lib/encryption.ts` | — | **Adapt** | ECDH logic is pure; the *key store* (IndexedDB non-extractable key) becomes secure-store/JSI. |
| `lib/progression.ts`, `lib/inventory.ts`, `lib/missionCatalog.ts`, `lib/missionBadge.ts` | — | Reuse | |
| `lib/emotes.ts`, `lib/avatars.ts`, `lib/marketplacePrices.ts`, `lib/chat.ts` | — | Reuse | |
| `lib/payoutPlan.ts`, `lib/poolAuthority.ts`, `lib/purchaseIntent.ts` | — | Reuse | |
| `lib/onboardingShared.ts`, `lib/onboarding.ts` | — | Reuse | |
| `lib/preferencesUtils.ts` | — | **Adapt** | Drop the `document.cookie` mirror; keep the preference shape. |
| `lib/rateLimit.ts`, `lib/rateLimitRoutes.ts`, `lib/serverAuth.ts` | — | Reuse (server) | See RK-09 on IP keying. |
| `lib/appSessionGuard.ts` | — | Reuse | Framework-free state machine — good design, ports directly. |
| `lib/edgeOps.ts` | — | Reuse | `EDGE_API_VERSION` lockstep + `shouldDegrade` load ladder. |
| `lib/motion.ts` | — | **Adapt** | `prefersReducedMotion` → `AccessibilityInfo`. |
| `lib/telemetry.ts`, `lib/telemetryPolicy.ts`, `lib/telemetrySentry.ts` | — | Adapt | Swap Sentry transport for the RN SDK; keep the policy module. |
| `lib/version.ts`, `lib/chains.ts`, `lib/walletMode.ts`, `lib/playerIdentity.ts` | — | Reuse | |
| `lib/walletSigner.ts` | — | **Adapt** | The `{address, signMessageAsync, signTypedDataAsync}` seam is exactly right; add RN implementations. |
| `lib/paymaster.ts` | — | Drop (stub) | Phase-1 interfaces only, no implementation. |
| `lib/chipsIndexer.ts` | — | Drop (skeleton) | In-memory Phase-1 placeholder. |
| `lib/localRoom.ts`, `lib/guest.ts` | — | **Adapt** | Storage + URL building. |
| `lib/peerFactory.ts`, `lib/teamup/*` | — | **Defer** | Legacy transport with a planned end-of-life — see D-8. |
| `lib/wcDecode.ts`, `lib/wcExpiry.ts`, `lib/wcWallet.ts` | — | Adapt | WalletConnect URI handling → RN WC SDK. |

### 4.2 `hooks/` — mostly reusable, one file to decompose

| Path | Lines | Verdict | Note |
|---|---:|---|---|
| `hooks/TeamUpContext.tsx` | **1,522** | **Decompose** | Lobby + P2P + intents + betting + FSM + authority in one context. Split into stores (§6.3). |
| `hooks/useGameEngine.ts` | 562 | **Adapt** | React hooks port; separate engine state from React lifecycle. |
| `hooks/GameDataContext.tsx` | 445 | Adapt | Swap `localStorage` cache for MMKV; keep the memoisation discipline (the 1 Hz presence tick re-render fix at `:387-391`). |
| `hooks/useAIBrain.ts`, `useGameTimer.ts`, `useBoardLayout.ts`, `useStableBoardBox.ts`, `useElementSize.ts` | — | Adapt | `useStableBoardBox`'s IME/vh logic is **replaced** by native insets (§3.6). |
| `hooks/useMatchStates.ts`, `useSpectatorSync.ts`, `useMoveAuth.ts`, `useSupabaseRelay.ts`, `useGamePresence.ts` | — | Adapt | `window.addEventListener('online')` → `@react-native-community/netinfo`. |
| `hooks/useAppSession.ts`, `hooks/useSecurityPrefs.ts`, `hooks/usePreferences.ts` | — | Adapt | Storage seams. |
| `hooks/useBiometricGate.ts`, `hooks/useScreenWakeLock.ts`, `hooks/useIsMobileView.ts` | — | **Rebuild** | Native APIs. |
| `hooks/usePushReady.ts` | — | **Rebuild** | APNs/FCM. |
| `hooks/useWalletSigner.ts`, `useCdpParentSigner.ts`, `useBaseAccountSigner.ts`, `usePlayerSigner.ts` | — | **Rebuild** | RN wallet SDKs behind the same `walletSigner` seam. |
| `hooks/useChipsBalance.ts`, `useChipsPool.ts`, `useSettlePool.ts`, `useWalletActivity.ts`, `useWalletAssets.ts`, `useSendToken.ts`, `useSendNative.ts`, `useMerkleClaim.ts`, `useMissionVoucher.ts` | — | Adapt | Mostly `fetch` + wagmi reads; wagmi's RN story is weaker than its web story (see RK-06). |
| `hooks/useMessages.ts`, `usePeerChat.ts`, `useNotifications.ts`, `useDataSync.ts`, `useDataBoot.ts`, `useDataActions.ts` | — | Adapt | PeerJS chat → Realtime/HTTP (§6.8). |
| `hooks/useLobbyManager.ts`, `useTeamUp.ts`, `useMatchmaking.ts`, `useCompetitiveConnection.ts` | — | Adapt | Absorb into the decomposed stores. |
| `hooks/useAFKManager.ts`, `useBettingController.ts`, `useSignedResolveBet.ts`, `useMfaStepUp.ts`, `useNetworkLabel.ts`, `useOnboarding*` | — | Reuse/Adapt | Mostly pure. |

### 4.3 `app/` — rebuild the shell, port the screens

| Path | Lines | Verdict |
|---|---:|---|
| `app/page.tsx` | 1,082 | **Rebuild** as an `expo-router` navigation tree (§6.4) |
| `app/components/` | 28,426 (96 files) | **Rebuild** — primitives first, then screens (§7) |
| `app/globals.css` | **10,657** | **Drop**; tokens extracted to a shared module (§6.10) |
| `app/layout.tsx` | 71 | Rebuild (cookie theme bootstrap → async MMKV read + splash hold) |
| `app/Providers.tsx` | 109 | Rebuild the tree with fewer, narrower providers |
| `app/components/FrameProvider.tsx` | 231 | **Delete** — replaced by safe-area + keyboard controllers |
| `app/components/LandscapeGuard.tsx` | 73 | Delete — `expo-screen-orientation` |
| `app/components/board/TokenPiece.tsx`, `TokenVisual.tsx` | 379+ | **Rebuild** on Skia |
| `app/components/Board.tsx`, `BoardGrid.tsx`, `BoardTokens.tsx`, `SnakesBoard.tsx`, `BoardHome.tsx`, `BoardOverlays.tsx` | ~2,700 | Rebuild on Skia |
| `app/hooks/useAudio.ts`, `useSoundEffects.ts` | ~15 KB | Rebuild on native audio |
| `app/manifest.ts` | 25 | Drop (PWA) |
| `public/sw.js` | 68 | Drop (service worker) |
| `app/api/**` (47 routes) | — | **Unchanged** |
| `middleware.ts` | 82 | Unchanged (see RK-09) |
| `app/burn`, `app/terms`, `app/privacy`, `app/wc`, `app/spike`, `app/token-*` | small | Port legal pages; drop dev surfaces |

### 4.4 Net reuse estimate (for planning only, not a commitment)

| Bucket | Approx. lines | Share of client code |
|---|---:|---:|
| Reuse verbatim (core, netcode, protocol, engine, AI, economy digests) | ~5,000 | 15% |
| Adapt (hooks, storage seams, wallet seam) | ~4,500 | 14% |
| Rebuild (components 28.4k + shell 1.1k + CSS→tokens + board + device bridge) | ~30,000+ | 71% |

**Read this honestly:** the *logic* is largely free, the *UI* is not. The plan's cost is dominated by §7 phases M1–M2 (design system + shell + board), not by the engine.

---

## 5. Cross-platform approach — options and trade-offs

### 5.1 The four credible options

| | A. React Native + Expo | B. Flutter | C. Capacitor / WebView wrap | D. Fully native (Swift + Kotlin) |
|---|---|---|---|---|
| **Engine reuse** | **Direct** — `core` is TS | **Rewrite in Dart** + maintain byte-parity gate in a 2nd language | Direct (it's the web app) | **Rewrite twice** |
| **Existing tests** | Run unchanged (41 suites) | Re-authored | Run in the WebView's JS context, but not as a gate | Re-authored twice |
| **Board animation** | Skia (new, but greenfield) | Impeller — excellent | GSAP DOM — the thing already fighting mobile GPU | Best possible |
| **Device APIs** | Expo modules + config plugins | Mature | Via Capacitor plugins; some gaps | Best possible |
| **Push / wallet / biometrics** | `expo-notifications`, WC RN SDK, CDP RN SDK, `expo-local-authentication` | Equivalent SDKs exist | Weakest — wallet SDKs assume native | Best possible |
| **Team skill transfer** | React/TS — **same as today** | New language, new idioms | Same as today | Two new languages |
| **Store review risk** | Standard | Standard | **High** — "webview wrapper" rejection risk under Guideline 4.2 | Lowest |
| **Cost to first parity build** | **Lowest** | Medium-high | Lowest to *demo*, highest to *keep* | Highest (2×) |
| **Long-term cost** | Medium | Medium | High (never stops fighting the platform) | Highest (2× forever) |

### 5.2 Why A over B (the real argument, not a preference)

Flutter is a genuinely strong option and would win on raw UI performance and animation consistency. It loses here for one specific, decisive reason:

> **The rules engine is the tested asset, and Dart cannot consume it.**

`lib/engine/core.ts` is byte-synced to the Deno Edge function and gated by `scripts/check-edge-engine.mjs`. Choosing Flutter means either (a) porting the engine to Dart and maintaining a *cross-language* parity gate — which no longer byte-compares, so the gate must become a differential fuzz harness across two runtimes, a much weaker and much more expensive guarantee — or (b) accepting two engines, which `AGENTS.md` security §2/§3 explicitly forbids ("Never fork a second pairing", "always `calculateNextPosition`").

Everything else in Flutter's favour (Impeller, widget consistency, no bridge) is real but secondary: this app's animation surface is *two GSAP token timelines and some panel transitions*, not a 3D scene.

### 5.3 Why A over C (WebView) — and why C is the tempting wrong answer

Capacitor would ship *fastest to demo*: the web app already runs on mobile browsers today (that is what `FrameProvider` is built for). But:

- `FrameProvider` exists because the web layer **already fails** on mobile GPU compositing (blur ghosting, fake insets, IME viewport math). Wrapping it in a WebView does not fix that; it removes the browser's own workarounds.
- The board's GSAP timelines on a WebView on a mid-tier Android device is the exact scenario `lib/perf/budget.ts` was written to measure, and it is not a comfortable one.
- **Guideline 4.2 (Minimum Functionality)**: Apple rejects apps that are "simply a repackaged website". A Capacitor shell around a single-route SPA is a textbook 4.2 target.
- It solves none of the native wins we actually need (push, haptics, wallet SDKs, biometrics).

C is rejected.

### 5.4 Recommendation

**React Native 0.7x + Expo SDK (managed workflow with prebuild / development clients), TypeScript, Hermes.**

Supporting choices:

| Concern | Choice | Why |
|---|---|---|
| Navigation | `expo-router` | File-based; maps cleanly onto the current `appState`/`activeTab` machine; deep links for free (room codes, invites, `wc:` URIs) |
| Board rendering | `@shopify/react-native-skia` | GPU canvas; the only credible way to hit 60fps token-hop with effects. Greenfield — no web parity debt |
| UI motion | `react-native-reanimated` 3 | Replaces 34 framer-motion files; worklet-thread animations |
| Server state | **TanStack Query** | Already a dependency, already mounted, currently unused — mobile is where it pays off |
| Client state | **Zustand** (slices) | Decomposes `TeamUpContext` without a 10-deep provider tree |
| Persistence | **MMKV** + `expo-secure-store` | MMKV is synchronous (matches localStorage ergonomics); secrets in Keychain/Keystore |
| Styling | NativeWind **or** a TS token module + `StyleSheet` | See §6.10 — decided by D-3 |
| Wallet | WalletConnect RN SDK **+** Coinbase CDP RN SDK | Both map onto the existing `walletSigner` seam and the existing identity rule |
| Realtime | `supabase-js` Realtime | RN-compatible today |
| Push | `expo-notifications` → APNs + FCM | Requires a backend change (Appendix E) |
| Testing | `tsx --test` (core) · RNTL (components) · Maestro (E2E) | Reuses the existing harness for the core |
| Build/release | EAS Build + EAS Submit | Managed signing, dual-store submission |

---

## 6. Target architecture

### 6.1 Codebase topology (D-1)

**Recommended: a monorepo with a shared `core` package, web and mobile as sibling apps.**

```
ludo-base/
├─ packages/
│  ├─ core/            ← extracted from lib/: engine, netcode, protocol, types,
│  │                     AI, economy digests, pure helpers. ZERO platform imports.
│  ├─ api-client/      ← typed REST + Edge + Realtime client (zod-validated)
│  └─ tokens/          ← design tokens (single source of truth, §6.10)
├─ apps/
│  ├─ web/             ← the existing Next.js app, now importing @ludo/core
│  └─ mobile/          ← the new Expo app
├─ supabase/           ← unchanged (migrations, functions)
└─ scripts/            ← gates, extended with a third check:engine target
```

**Why extract rather than fork.** `scripts/check-edge-engine.mjs` already enforces a *byte-identical* copy of the engine into the Edge function. Adding a third consumer (mobile) with a *forked* copy would create a third place for the rules to drift, and `AGENTS.md` §3 ("there is one authority") forbids it. A shared package with a `check:engine` target per consumer is the only topology that scales to three consumers without weakening the gate.

**Enforcement:** the byte-parity gate becomes *"`packages/core/engine/core.ts` is byte-identical to `supabase/functions/_shared/engine.ts`"*, and mobile imports `@ludo/core` rather than carrying a copy. This is a strictly better gate than today's two-way comparison.

**Option (c) — React Native Web for the screens — is rejected** for v1: it would invalidate the committed visual baselines, force the 10,657-line stylesheet through a compatibility layer, and trade a bounded mobile rewrite for an unbounded web regression surface. It can be revisited after mobile ships (see Q-9).

### 6.2 Shared vs platform-specific components

**Shared (in `packages/core`, no platform imports — enforced by lint):**

- Rules engine, board geometry, AI heuristics.
- Netcode primitives + `authorityGate` + `matchFsm` + `hostIntent`.
- Protocol validation + zod schemas.
- `GameState` and every type in `lib/types.ts`.
- EIP-712 digests (`matchProof`, `sessionProof`, `chipsSettle`, `merkleClaims`) — **must stay byte-identical or the chain rejects**.
- Progression, inventory, mission catalog, emotes, avatars, pricing.
- `edgeOps` (version lockstep, degradation ladder), `version`, `chains`, `walletMode`, `playerIdentity`.
- Pure UI-adjacent logic: `payoutPlan`, `poolAuthority`, `onboardingShared`, `preferencesUtils` (shape only).

**Shared in spirit but re-expressed per platform:**

- **Design tokens** — one token source, two consumers (CSS custom properties on web; a TS object on mobile). §6.10.
- **Validation** — same zod schemas, but the *client transport* differs (fetch vs `expo/fetch`).

**Platform-specific (mobile only):**

- Navigation, screen composition, all of `app/components/` re-expressed as RN components.
- The board renderer (Skia).
- Safe-area/keyboard/orientation/keep-awake/blur.
- Audio engine, haptics, camera, clipboard, biometrics.
- Push registration and notification handling.
- Wallet SDK bindings (WC RN, CDP RN).
- Persistence adapters (MMKV, secure store).

**Platform-specific *within* mobile (iOS vs Android):**

- Back gesture (iOS swipe-back vs Android hardware/gesture back) — both must map to the same "close drawer → confirm leave match" semantics currently hand-rolled at `app/page.tsx:451-476`.
- Permission prompts (camera, notifications) and their priming UX.
- Push payload shapes and notification channels (Android channels have no iOS analogue).
- Status-bar and navigation-bar insets.
- Store-specific purchase flows if D-4 requires IAP (Appendix E / RK-01).

### 6.3 State management

**Three tiers, each with one owner:**

**Tier 1 — Server state (TanStack Query).** All 47 REST routes and all Edge calls. This is the biggest structural improvement over the web client, where every data path is a hand-rolled `fetch` + `setInterval`. Query gives us caching, deduplication, retry/backoff, and — critically — **`refetchOnReconnect`**, which is exactly the semantics `hooks/useMatchStates.ts:70-115` hand-builds today.

**Tier 2 — Realtime state (event bus → store).** Supabase Realtime (`game-room-<roomCode>` broadcast + `postgres_changes` on the four published tables) feeds a single ingest point that applies `shouldApplyGameAction` / seq-monotonicity **before** touching the store. This preserves the security invariant in one place rather than at every subscriber.

**Tier 3 — Client state (Zustand slices).** Decompose `TeamUpContext.tsx` (1,522 lines) into:

| Store | Owns | Replaces |
|---|---|---|
| `useSessionStore` | wallet address, app session, match sessions, guest id | `useAppSession`, `useMoveAuth` session map |
| `useMatchStore` | `GameState`, `seq`, local vs networked, engine instance | part of `TeamUpContext`, `useGameEngine` |
| `useLobbyStore` | lobby state, slots, invites, host election | `useLobbyManager`, `useTeamUp` |
| `useEconomyStore` | chips balance, pool, escrow, purchases | `useChipsBalance`, `useChipsPool`, `useSettlePool` |
| `useSocialStore` | friends, conversations, unread, blocks | `GameDataContext` |
| `usePrefsStore` | theme, sfx, music, haptics, token/dice style, security prefs | `usePreferences`, `useSecurityPrefs` |

**Why Zustand over Context here:** the current tree is **10 providers deep**, and `GameDataContext` needed explicit memoisation to stop a 1 Hz presence tick from re-rendering 18 consumers (`:387-391`). Selector-based subscriptions remove that class of bug by construction, and the provider tree flattens to ~4 (safe area, query client, theme, navigation).

**Persistence rules.** MMKV for everything currently in localStorage; `expo-secure-store` for anything that is a secret (ECDH private key, session ids). **Never** put a session id in MMKV alongside game preferences — the ECDH key in particular currently lives in IndexedDB *because it is non-extractable* (`lib/encryption.ts:48-51`); that property must be preserved, not lost to a plaintext KV store. See RK-08.

### 6.4 Navigation

Replace the `appState`/`activeTab` state machine with a real navigation tree:

```
Root
├─ (auth)          Splash → Onboarding → Wallet connect → Profile setup
├─ (tabs)
│   ├─ Play        Lobby · Matchmaking · Offline · Arena · Invites
│   ├─ Social      Friends · Messages · Leaderboard · Activity
│   ├─ Missions    Mission list · Claims · Referral
│   ├─ Market      Marketplace · Wallet · Send/Receive/Swap
│   └─ Profile     Profile · Settings · Security · Achievements
└─ (modal)         Match · Spectating · MatchStats · Sheets (send/receive/swap)
```

**Requirements this must satisfy:**

- **Deep links** for everything the web app currently encodes in URLs: `?room=&s=&seat=` pass-play links (`lib/localRoom.ts`), invite links (`/api/lobby/invite`), WalletConnect `wc:` URIs (`lib/wcDecode.ts`), Farcaster frame URLs.
- **Back semantics** must reproduce the intent already encoded at `app/page.tsx:451-476`: back closes an open panel first, and inside a match it raises the quit confirmation rather than leaving. Implement via `beforeRemove` + Android `BackHandler`, not `history.pushState`.
- **Match and spectating are modal, not tabs** — they are entered from many places and must be exitable to the origin.
- **State preservation**: navigating away from a live match must not unmount the engine. The match modal must stay mounted while backgrounded, or the match store must own the engine outside the navigation tree. This is a real design constraint — the current app never unmounts the game because it never navigates.

### 6.5 API and data-layer integration

**The backend contract does not change.** What changes is the client transport.

- **One typed client** in `packages/api-client`, wrapping the 47 routes with zod-validated responses (schemas from `lib/protocol/schemas.ts` + new ones for routes that lack them).
- **Auth header/param:** the existing `(walletAddress, sessionId)` tuple, passed as query params on GET and JSON body on POST — exactly as the routes read them today (`lib/serverAuth.ts:16-25`). No cookie jar is required, which is convenient because RN has none by default.
- **Supabase client:** initialise with a **custom storage adapter** (MMKV/secure-store) instead of `localStorage`, and with `autoRefreshToken`/`persistSession` configured for a long-lived mobile session.
- **Edge functions:** `supabase.functions.invoke('move-auth' | 'roll-dice' | 'resolve-bet')`, or direct `fetch` to `${SUPABASE_URL}/functions/v1/<name>` as `hooks/useMoveAuth.ts:36` does today. Keep the `Authorization: Bearer <anon key>` + 20 s timeout pattern and **keep `checkEdgeVersion` fail-closed** (`lib/edgeOps.ts:19-37`) — mobile becomes a third client that must refuse to act on a version mismatch.
- **Rate limiting — a real risk.** `middleware.ts` keys limits by client IP, and `lib/rateLimit.ts:97-113` prefers `cf-connecting-ip`/`x-forwarded-for`. **Mobile clients behind carrier CGNAT share IPs**, so a busy carrier's users will throttle each other. Mitigation options in RK-09.

### 6.6 Offline behaviour

This section is short because the design constraint is unusually strict, and getting it wrong would break a security invariant.

**What works offline (fully):**

- **vs-AI and pass-and-play.** Already entirely client-side (`hooks/useGameEngine.ts:118-133`), driven by a deterministic engine. Ports directly.
- **Profile, settings, preferences, inventory, mission catalog** — read from MMKV cache.
- **Cached leaderboard / friends / messages** — TanStack Query `persistQueryClient` + MMKV.
- **AI** — synchronous fallback path already exists (`lib/ai/client.ts:107-127`).

**What cannot work offline, by design:**

> **There is no offline queue for networked matches, and there must never be one.** `AGENTS.md` §3: a networked seat that cannot reach `roll-dice` **aborts** the roll; *"a local fallback is a face the client chose."* Queuing a networked roll for later delivery is the same violation with extra steps — the face would have been minted client-side.

So the offline policy is:

| State | Behaviour |
|---|---|
| No network, local match | Full play. Persist in-progress match to MMKV; resume on relaunch. |
| No network, networked match | Show a blocking "reconnecting" state. Never mint locally. `lib/netcode/resync.ts` is the single resync path on reconnect. |
| Network returns | `NetInfo` → immediate `resyncMatch` (replaces `window.addEventListener('online')` at `hooks/useMatchStates.ts:108`). |
| App backgrounded mid-match | Engine stays alive in the store; keep-awake releases; on foreground, resync. |
| App killed mid-match | Match state is server-authoritative → resume from `match_states` snapshot. The *local* match is the only one needing client persistence. |

**Progression parity question (Q-11):** `/api/match/record` **refuses `host_proven=false`** (SEC-06), and requires a wallet signature over `buildMatchRecordMessage`. Offline play therefore cannot mint progression. Whether offline play should count at all is a product decision, and it interacts with store review (RK-01).

### 6.7 Authentication and identity

Three distinct grants exist today and all three must be re-expressed on mobile:

| Grant | Mechanism | TTL | Storage on mobile |
|---|---|---|---|
| **App session** (`app_sessions`) | `POST /api/siwe/verify` after `verifyPersonalSign` over `buildSiweMessage` (`lib/sessionProof.ts:91-116`) | **7 days** (`:15`) | `expo-secure-store` |
| **Match session** (`match_sessions`) | EIP-712 `LudoMatchSession` via `move-auth` `session`/`create-session` | **30 min** (`:14`) | In-memory + secure-store |
| **One-off signature** | `verifyPersonalSign` over a canonical message (`lib/matchProof.ts:6-13`), 10-min freshness (`:16`) | 10 min | n/a |

**Scope discipline is an invariant, not a preference.** `supabase/functions/_shared/matchSession.ts:9-12` states it explicitly: *"SIWE covers chat/profile/settings only and must never authorize an in-match action."* The mobile client must not collapse these into one "logged in" flag. Model them as three separate stores with three separate lifetimes.

**Wallet strategy (D-5):**

| Mode | Mobile SDK | Maps to | Notes |
|---|---|---|---|
| **Embedded smart account** | Coinbase CDP React Native SDK | `hooks/useCdpParentSigner.ts` | **Recommended default** — lowest friction, no extension, non-custodial, signs as the *parent* smart account via ERC-6492 |
| **External wallet** | WalletConnect RN SDK (Reown) | `hooks/useWalletSigner.ts` (wagmi) | Covers Base/MM/Phantom; `@reown/walletkit` is already a dependency |
| **Base Account / SIWE** | Base Account RN or WC fallback | `hooks/useBaseAccountSigner.ts` | The web path is popup-based; RN needs the WC/deep-link route |

**The identity rule must not drift** (`lib/playerIdentity.ts:38-72`): SIWE/Base address wins, else the CDP **parent** smart account; **never** the owner EOA or a sub-account. Getting this wrong produces a different `wallet_address` than the web client and silently orphans the player's profile, chips and progression. This deserves a dedicated test.

**`verifyPersonalSign` is already 6492/1271-aware and chain-gated** (`lib/walletVerify.ts:102-174`) — **no server change is needed** for any of these wallet types. That is a significant, verified win.

**Guest mode.** `lib/guest.ts` is entirely `localStorage`-bound (`guest_<6hex>`, no Supabase row ever created, `:6-7`). On mobile it re-implements on MMKV with the same one-time `migrateGuestStash` behaviour (`:150-187`). **Open product question (Q-5 / D-10):** whether guest mode should exist on mobile at all, given store review implications.

**Biometrics.** `hooks/useBiometricGate.ts` uses `navigator.credentials` (WebAuthn) and `BootLock.tsx` uses CDP passkeys with a 5-attempt lockout. Native: `expo-local-authentication` for the gate; if CDP passkeys are required, `react-native-passkeys`. The lockout policy should be preserved, and preferably hardened (native biometrics are a real security upgrade over the web gate).

### 6.8 Realtime and netcode on mobile

**v1 transport: Supabase Realtime only.** `supabase-js` Realtime is RN-compatible; the `game-room-<roomCode>` broadcast channel and the four `postgres_changes` subscriptions work as-is.

**Explicitly deferred: the PeerJS/WebRTC path** (`lib/teamup/*`, `lib/peerFactory.ts`). Rationale: it is the legacy transport that P3 is designed to retire, and porting it would mean adopting `react-native-webrtc` to maintain a subsystem with a planned end-of-life. **D-8 confirms this**, but note the consequence: if any *currently shipping* feature depends on P2P-only behaviour, v1 loses it.

**Polling must be replaced, not ported.** The current client runs ~15 concurrent `setInterval` pollers, one of them at **100 ms** (`SpectatorHUD.tsx:149`), others at 1 s, 2 s, 4 s, 5 s, 10 s, 15 s, 20 s, 30 s, 45 s. On web this is tolerable; on mobile it is a battery, data and thermals problem, and it is exactly the kind of thing that gets an app killed in the background. Convert to:

- Realtime subscriptions where the data is published.
- Push for notifications (friends, invites, turns).
- `AppState`-aware polling only where a subscription is impossible, paused when backgrounded.

**Background behaviour.** A live match cannot be kept alive in the background indefinitely on either platform. Policy needed (D-7): either (a) matches pause and resync on foreground (recommended — the server is authoritative, so a paused client loses nothing), or (b) a background task for turn notifications only. Android foreground services and iOS background modes have real review costs; do not reach for them casually.

**The P3/P4 dependency.** After `SERVER_AUTHORITY_MIGRATION_PLAN` P3, the room becomes the transport (Durable Object, `seq` fan-out, reconnect) and P4 relocates validation/minting in-process with a **third `check:engine` target**. **Mobile M3+ should be sequenced behind or co-designed with P3/P4** (D-6). Building mobile networked play against today's transport means building it twice.

### 6.9 Rendering and animation

**The board moves to `@shopify/react-native-skia`.** Rationale: the token-hop is a per-token transform timeline with effects (trail, flash, shield, trap) and it must hold 60fps on mid-tier Android. Skia gives a GPU canvas with a React declarative API and Reanimated interop. `lib/perf/budget.ts:8-15` already defines the target: `hopComposeMs: 16`, `longTaskMs: 50`, `hopDurationMs: 1300` — port these budgets to the native build and measure against them.

**Consequence to accept:** the board is **excluded from the token migration on web** (DESIGN.md §8) and will likewise be an island on mobile. Do not attempt to unify board rendering across platforms in v1.

**UI motion:** replace 34 framer-motion files with Reanimated. **The motion policy must be preserved** (`docs/ops/MOTION_AUDIT.md`): every animation respects reduce-motion, new code is compositor-only, and **"reduced motion removes translation, never information."** The `check:motion` allowlist logic (loading-bar, shimmer, 3 framer layout sites) should be re-expressed as an RN lint/gate rather than dropped.

**Confetti (3 sites)** → a Skia particle system, or `react-native-confetti-cannon` if we accept a dependency. Budget the existing caps (1.5 s) rather than the original 2 s/5 s.

**Lists:** the large screens (`ActivityFeed` 1,581 lines, `MarketplacePanel` 1,546, `TeamUpMatchPanel` 1,215, `QuickMatchPanel` 1,047, `MessagesPanel` 859, `FriendsPanel` 851) must use `FlashList`/`FlatList` with `getItemType` — DOM-style mapping of 1,500-line components will produce jank on Android.

### 6.10 Design system and theming

`DESIGN.md` is the implemented contract and it is **consumed, not rewritten**. What changes is the delivery mechanism.

**Token strategy (D-3).** The three token layers (primitives `--ludo-*`, semantic `--surface-*`/`--ink-*`/`--line-*`/`--accent*`, Tailwind registrations) become a **single `packages/tokens` source** with two emitters:

- Web: CSS custom properties (the existing `@theme` / `@theme inline` blocks).
- Mobile: a typed TS object + a theme provider.

**Two load-bearing web gotchas must not be mistaken for mobile requirements:** the `@theme inline` requirement and the `body`-scoped `--surface-page`/`--surface-panel` are artifacts of CSS custom-property resolution. On mobile the theme is a JS object swap — simpler, and it removes a whole class of "utility didn't flip the theme" bugs.

**Type scale.** Seven fluid steps `--text-ludo-xs…3xl` with a **hard 10px floor** (`globals.css:36-42`). Fluid `clamp()`/`vw` units do not exist in RN; the scale must become a function of screen width, and the 10px floor must be enforced in the token module, not by convention.

**Both palettes ship:** `theme-retro-futurism` (default, dark) and `theme-daybreak` (light). Theme currently bootstraps from a **cookie read server-side** (`app/layout.tsx:55-62`) so there is no flash. On mobile there is no server render, so this becomes an **async MMKV read** — meaning a splash-screen hold or a theme-aware splash is required to avoid a flash of the wrong theme. Small, but it is the kind of detail that makes an app feel native or not.

**Chrome contract.** The shell is `max-width: 500px`, mobile-first, single column (`DESIGN.md` §8); `--footer-h` 76px (62px below 430px); `--panel-gap` 8px; `--radius-card` 16px (Daybreak 18). A 500px-max column is a deliberate "arcade cabinet" identity — see §6.12 for the tablet question.

**Accessibility.** `DESIGN.md` §10 applies. Port: minimum tap targets, contrast (the Daybreak status tokens `#92400e/#166534/#b91c1c` at `globals.css:283-285`), screen-reader labels, and reduce-motion. **`scripts/contrast.mjs` should be extended to validate the mobile token module too** — otherwise the token split silently loses the contrast guarantee.

### 6.11 Performance

**Budgets (port and enforce):**

| Metric | Target | Source |
|---|---|---|
| Token hop compose | ≤ 16 ms | `lib/perf/budget.ts:8-15` |
| Long task | ≤ 50 ms | same |
| Hop duration | 1,300 ms | same |
| Cold start → interactive | *to be set* (Q-8) | new |
| Board frame rate | 60 fps sustained on mid-tier Android | new |
| Memory ceiling | *to be set* | new |

**Instrumentation:** `lib/perf/budget.ts` uses `PerformanceObserver({entryTypes:['longtask']})` and installs `window.__ludoPerf` (`lib/perf/report.ts:92-101`). Neither exists in RN. Replace with `react-native-performance` or Android Systrace / iOS Instruments, and keep the p50/p95 `hopSampleSummary` aggregation so `docs/ops/DEVICE_PASS.md` sign-off survives.

**The three real risks:** (1) polling → battery (mitigated in §6.8); (2) board animation on mid-tier Android (mitigated by Skia + measured budgets); (3) JS bundle size and startup — the web critical path is already **0.80 MB gzip / 21 requests** after a deliberate webpack-vs-Turbopack decision (`AGENTS.md`), and the RN bundle is a different animal: measure with `expo export --analyze` and lazy-load the heavy panels (`ActivityFeed`, `MarketplacePanel`, `TeamUpMatchPanel`, `QuickMatchPanel`) behind the navigation boundaries.

**Also:** the 100 ms spectator tick and the 1 Hz presence tick must not survive the port. `GameDataContext`'s memoisation comment (`:387-391`) documents that this was already a re-render problem on web.

### 6.12 Platform-specific UI considerations

**Safe areas and the keyboard — a net simplification.** Delete `FrameProvider`'s probe-and-clamp entirely (including the 48px heuristic for fake host insets) and use `react-native-safe-area-context`. Delete the `visualViewport` keyboard math and use `react-native-keyboard-controller`. **This is the single largest code deletion in the port** and it removes a permanent source of bugs.

**Orientation.** `LandscapeGuard.tsx` and the manifest's `orientation: "portrait"` are replaced by `expo-screen-orientation` locking portrait. The board is a measured square (`aspect-ratio: 1/1`, DESIGN.md §8) and landscape would need a genuinely different layout — out of scope for v1.

**Back navigation.** iOS interactive swipe-back and Android back must both honour the two-stage semantics already encoded at `app/page.tsx:451-476` (close panel → confirm quit match). Do not let a system gesture silently drop a player out of a live match.

**Blur.** `expo-blur` replaces the `backdrop-filter` that `FrameProvider` currently *strips* on mobile (`:171-204`). Native blur is a real visual upgrade — the design's glass panels can finally render as designed.

**Haptics.** `expo-haptics` replaces `navigator.vibrate`, which **iOS Safari ignores entirely** — so haptics are currently a no-op on the platform where they matter most. This is a feature gain, gated by the existing `preferences.haptics` flag.

**Audio.** `app/hooks/useAudio.ts` (13.5 KB) synthesizes SFX *and ambient music* from `AudioContext` oscillators. `react-native-audio-api` implements the Web Audio API on native, which makes this port nearly mechanical — a meaningful saving. Clip playback (`useSoundEffects.ts`, `/sounds/*.mp3`) moves to `expo-audio`.

**Form factor (D-11).** The shell is a 500px-max column. On a tablet or a large foldable that is a letterboxed strip. Options: (a) keep the single-column identity and centre it (recommended for v1 — preserves brand and the visual language, and matches the "game board as object" concept); (b) adaptive layouts for ≥ 600 dp. Do not ship (b) accidentally by using percentage widths.

**System chrome.** Status bar style must follow the theme; Android navigation-bar colour and edge-to-edge behaviour need explicit handling (Android 15+ enforces edge-to-edge).

**iOS vs Android in-app differences to expect:** permission prompt timing and copy, notification channels and importance levels (Android-only), back behaviour, keyboard accessory bars, share-sheet shapes, and store purchase flows.

### 6.13 Push, notifications and lifecycle

**This is the one place where the backend must change.**

- Web push uses VAPID + `public/sw.js` + `push_subscriptions` (`202609280001:6-16`), with SEC-14 scoping unsubscribe to the session wallet (`app/api/push/subscribe/route.ts:22`).
- Native needs **APNs (iOS)** and **FCM (Android)** tokens — a different row shape and a different send path. `lib/pushServer.ts` must gain a provider abstraction, and `push_subscriptions` needs a `platform` discriminator (Appendix E).
- Notification categories to port: invites (`InviteNotification.tsx`), turn-ready, friend requests, DMs, mission completions. Each needs iOS category identifiers and Android channels.
- **Lifecycle:** handle `AppState` transitions explicitly — pause pollers, release keep-awake, flush pending mutations, and resync matches on foreground. iOS will suspend the JS thread; do not assume timers fire.

### 6.14 Observability

`lib/telemetry.ts` + `lib/telemetryPolicy.ts` + `lib/telemetrySentry.ts` already encode a policy (what may be logged, PII boundaries). Keep the **policy module** shared and swap the transport for the Sentry RN SDK. Add: crash reporting, ANR/`Terminating due to uncaught exception` tracking, native performance traces, and a mobile-specific release-health dashboard. `lib/version.ts` and `EDGE_API_VERSION` should be surfaced in the app's About screen and in every telemetry event, so a version-mismatch incident is diagnosable.

---

## 7. Phased implementation roadmap

Each phase has an **exit gate** — a verifiable condition, not a feeling. Phases M0–M2 are independent of the backend migration and can start immediately. **M3+ is gated on D-6.**

### M0 — Foundations and decisions (no product code)

Extract `packages/core` from `lib/`; stand up the monorepo; wire CI; port the engine/netcode/protocol tests against the extracted package.

**Exit gate:** `packages/core` compiles with **zero platform imports**; the existing 41 test suites pass against it unchanged; `check:engine` byte-parity now compares `packages/core/engine/core.ts` ↔ `supabase/functions/_shared/engine.ts` and passes; the web app builds and its gates are green after switching its imports to `@ludo/core`; D-1…D-6 are answered.

### M1 — Shell, design system, navigation skeleton

Token module + theme provider; navigation tree; app shell (header/footer chrome); splash + theme bootstrap from MMKV; the four provider layers; primitives (`Button`, `Chip`, `Switch`, `ListRow`, `PanelTabs`, `EmptyState`, `ErrorCard`) ported to RN; EAS build pipeline producing installable dev builds on both stores' internal tracks.

**Exit gate:** a signed build installs on a physical iOS and Android device; navigation between all top-level tabs works with correct back semantics; both themes render with no flash; the contrast script validates the mobile token module; primitives are documented with a Storybook-equivalent (or a dev gallery screen).

### M2 — Offline play: engine, AI, board

Skia board; token-hop animation against the `hopComposeMs ≤ 16` budget; dice; AI seats; pass-and-play and vs-AI matches; local match persistence and resume; audio and haptics; reduce-motion.

**Exit gate:** a full 4P vs-AI match and a full pass-and-play match are playable end-to-end offline on both platforms; the ported perf budget passes on a mid-tier Android device; golden-replay fixtures still pass against the shared core; no animation ships without a reduce-motion path.

**M2 is the first genuinely shippable milestone** and the best candidate for an early internal dogfood build.

### M3 — Identity, wallet, session, and the read-only backend

Wallet connect (CDP embedded default + WalletConnect); SIWE app session in secure storage; guest mode; the typed API client; profile, leaderboard, missions, marketplace *browse*, social *read*; push registration end-to-end (requires the Appendix E backend delta).

**Exit gate:** a new user can install, create or connect a wallet, sign in, see their profile/leaderboard/missions, browse the marketplace, and receive a push notification; `wallet_address` resolved on mobile is **byte-identical** to the same user on web (the identity-parity test); `checkEdgeVersion` fails closed against a deliberately mismatched Edge version.

> **Gate: D-6 must be resolved before M4.** Do not begin networked play against a transport scheduled for replacement.

### M4 — Networked play

Matchmaking, lobby, invites, 1v1/2v2/4P, classic/power; `move-auth` + `roll-dice` integration; `seq` handling and `STALE_SEQ` retry; reconnect and resync; `authorityGate` enforced at the single ingest point; spectating.

**Exit gate:** a mobile↔web cross-platform match completes end-to-end with no state divergence (the `engine-diff`-style differential check, run live); a forced network drop mid-match recovers via `resync` without a duplicated or lost move; a stale-seq action is rejected and retried exactly once with the same `rollId` (`lib/netcode/staleSeq.ts:36-48`); the P2P transport is either absent or explicitly declared out of scope.

### M5 — Economy, social, and full parity

Chips balance/pool/escrow, marketplace purchase, mission claims, send/receive/swap; DMs with ECDH sealed boxes; friends, pokes, moderation; activity feed; settings and security.

**Exit gate:** ECDH DM round-trip mobile↔web (a message sealed on mobile decrypts on web and vice versa); marketplace purchase completes with the correct `purchaseIntent` signature; mission voucher claim verifies on-chain; a blocked user's content is invisible on mobile.

### M6 — Hardening and store readiness

Performance passes on the device matrix; accessibility audit; offline/error/empty states; crash-free-session baseline; privacy manifests and data-safety declarations; store listing assets; **the D-4 compliance work** (IAP or an approved alternative path); beta programs.

**Exit gate:** crash-free sessions ≥ 99.5% over a closed beta; accessibility audit passed on both platforms; store compliance signed off by whoever owns D-4; privacy/data-safety declarations match what the telemetry policy actually collects.

### M7 — Release and iteration

Phased store rollout; release-health monitoring; OTA update channel for JS-only fixes; a documented rollback path.

**Exit gate:** production release on both stores with staged rollout, a defined rollback, and a monitored crash-free rate.

### Dependency map

```
M0 ──► M1 ──► M2 ──────────────────────────► (internal dogfood)
                 │
                 └──► M3 ──[D-6 gate]──► M4 ──► M5 ──► M6 ──► M7
                                                         ▲
                              backend delta (Appendix E) ─┘  required by M3 (push)
                              P3/P4 of SERVER_AUTHORITY_MIGRATION_PLAN ──► required by M4
```

---

## 8. Risk register

Severity × likelihood. **RK-01 and RK-02 are the two that can kill the project.**

| ID | Risk | Sev | Lik | Mitigation |
|---|---|---|---|---|
| **RK-01** | **App Store Guideline 3.1.1** — marketplace items, CHIPS and mission vouchers are digital goods consumed in-app; Apple requires IAP. Current economics (on-chain CHIPS, custodial escrow ledger) may be non-compliant as-is. | **Critical** | High | **Resolve before M0 (D-4).** Options: (a) IAP for fiat→chips, on-chain for chips→gameplay; (b) geo-restricted feature set; (c) a "companion app" posture (no in-app purchase at all — browse/play only, purchases on web). Requires legal input, not engineering guesswork. |
| **RK-02** | **Store crypto/wallet policy** — guideline 3.1.5 / 5.x on crypto, NFT and wallet features; Google Play's crypto and billing policies differ. Wallet features may need disclosure, geo-gating or a licence position. | **Critical** | High | Same as RK-01: resolve with legal before M0. Prepare the disclosure copy early; it affects the listing and the onboarding flow. |
| **RK-03** | **Building against a transport that is about to change.** P3/P4 of the server-authority plan will replace the room transport and relocate validation/minting. | High | High | **D-6**: sequence M4 behind or co-design with P3/P4. M0–M3 are safe. Do not let mobile M4 start before the P0 spike result is known. |
| **RK-04** | **Identity drift** — the mobile wallet resolves a different `wallet_address` than web (parent smart account vs owner EOA vs sub-account), orphaning profile/chips/progression. | High | Medium | Port `lib/playerIdentity.ts` verbatim; add a **dedicated identity-parity test** asserting the same wallet resolves the same address on both clients (M3 exit gate). |
| **RK-05** | **Board performance on mid-tier Android** — Skia is new, budgets are untested natively. | High | Medium | Prototype the token-hop in M2 *before* committing to the full board; measure against `hopComposeMs ≤ 16` on a real mid-tier device; keep a Reanimated+SVG fallback design sketched. |
| **RK-06** | **wagmi/viem have a weaker React Native story than web.** Several hooks assume a browser provider. | Medium | High | Confine wagmi to reads where possible; use the CDP/WC RN SDKs for signing behind the existing `walletSigner` seam (`lib/walletSigner.ts:22-27`); do not port the wagmi connector stack. |
| **RK-07** | **Polling → battery/thermal/background kills.** ~15 concurrent pollers, one at 100 ms. | Medium | High | §6.8: convert to Realtime + push; pause on `AppState` background; add a battery/thermal measurement to the device pass. |
| **RK-08** | **Key-storage downgrade.** The ECDH private key is a **non-extractable** `CryptoKey` in IndexedDB (`lib/encryption.ts:48-51`); naive porting to a plaintext KV store weakens it. | High | Medium | `expo-secure-store` + a JSI crypto store; **never** MMKV for key material; add a test asserting the key is not readable as a raw value. |
| **RK-09** | **IP-keyed rate limits misfire on carrier NAT.** `middleware.ts` + `lib/rateLimit.ts:97-113` key by client IP; mobile users behind CGNAT throttle each other. | Medium | High | Add a session/wallet-scoped limiter for authenticated routes; raise thresholds for a mobile user-agent class; or issue a device-scoped key. Requires a backend change (Appendix E). |
| **RK-10** | **Push requires a backend change** (APNs/FCM, `push_subscriptions` shape). | Medium | High | Scoped in Appendix E; schedule it inside M3 so it does not block M4. |
| **RK-11** | **Design-token divergence** between the CSS tokens and the mobile token module. | Medium | Medium | Single source (`packages/tokens`) + two emitters; extend `scripts/contrast.mjs` to validate the mobile output; add a token-parity gate. |
| **RK-12** | **The 1,522-line `TeamUpContext` decomposition introduces regressions** in lobby/netcode/betting. | Medium | Medium | Decompose behind the existing behaviour, not by rewriting it; keep the extracted logic in `core` where it is testable; land stores incrementally with the existing tests as the safety net. |
| **RK-13** | **Visual baselines are web-only** — someone assumes native visual parity is covered. | Medium | Medium | State explicitly (§9.3) and stand up a native visual-regression path; do not reuse the Playwright PNGs. |
| **RK-14** | **No physical-device CI.** Today there is no `@playwright/test` runner and no device farm. | Medium | Medium | Adopt EAS Build + a device farm (or Maestro Cloud) for E2E; accept that this is new infrastructure spend. |
| **RK-15** | **Notification/background policy** — a live match cannot be kept alive indefinitely; players may expect it to. | Medium | Medium | **D-7**: pause-and-resync policy; set expectations in the UI; consider a turn-notification push rather than a background service. |
| **RK-16** | **Dual-maintenance of two clients** forever, if D-1 chooses fork over extract. | Medium | Medium | D-1: extract, don't fork. Make the shared package the only place match-critical logic lives. |
| **RK-17** | **`crypto.subtle` / ECDH polyfill gaps** in RN break DM encryption or `matchProof`. | Medium | Low | `react-native-quick-crypto`; add a crypto conformance test in M0 against known vectors. |
| **RK-18** | **App size** — Skia + wallet SDKs + audio is a large binary. | Low | Medium | Measure early with `expo export --analyze`; lazy-load heavy panels; consider Android App Bundle splits. |
| **RK-19** | **Review rejection under Guideline 4.2** (minimum functionality) if v1 ships a thin surface. | Medium | Medium | Ship a genuinely native surface in v1 (offline play + real device features), not a shell over the web app. |
| **RK-20** | **`EDGE_API_VERSION` mismatch** — mobile becomes a third client that must fail closed; a stale mobile build could be bricked by an Edge deploy. | Medium | Medium | Keep `checkEdgeVersion` fail-closed but add a **graceful "update required" screen** rather than a silent failure; coordinate Edge version bumps with mobile releases. |
| **RK-21** | **Legal pages / privacy declarations** (`app/privacy`, `app/terms`) do not cover mobile data collection (device ids, push tokens, crash data). | Medium | High | Update the privacy policy before M6; the data-safety declaration must match the telemetry policy. |
| **RK-22** | **Offline progression expectations** — players expect offline wins to count; `/api/match/record` refuses unproven hosts. | Low | High | Q-11 / product decision; set expectations in the UI rather than weakening SEC-06. |
| **RK-23** | **Farcaster mini-app already covers mobile** — `@farcaster/frame-sdk` / `miniapp-sdk` are dependencies. A native app may duplicate an existing mobile surface. | Medium | Medium | Q-4: confirm the mini-app is *not* the mobile strategy before spending M0–M7. This is a scoping risk, not a technical one. |
| **RK-24** | **Bus factor** — the netcode/authority knowledge is concentrated in a few very large files. | Medium | Medium | The core extraction (M0) *reduces* this by moving logic out of 1,522-line contexts into tested modules; treat it as a knowledge-distribution activity, not just a refactor. |

---

## 9. Testing and release strategy

### 9.1 Test layers

| Layer | Tool | Reuse from today | Notes |
|---|---|---|---|
| **Rules engine / protocol / netcode** | `tsx --test` | **Direct** | The existing 41 suites run against `packages/core` unchanged. This is the strongest asset we have. |
| **Differential engine** | `scripts/engine-diff.ts` | Direct | Extend to assert mobile-applied state matches web-applied state for the same action stream. |
| **Golden replay** | `scripts/golden-replay.ts` | Direct | 50 seeded matches, hashed final state. Must stay green after extraction. |
| **Edge parity** | `check:engine` | **Strengthened** | Now compares `packages/core` ↔ the Edge copy; add a third consumer assertion for mobile. |
| **API contract** | zod schemas + route tests | Partial | The routes have no formal schema for several endpoints; the mobile client forces us to write them (a side benefit). |
| **Component** | `@testing-library/react-native` | New | Port the meaningful component assertions; do not chase 1:1 coverage of 96 files. |
| **E2E** | **Maestro** (recommended) | New | Declarative, cross-platform, works with Expo dev builds. Detox is the fallback if flake becomes a problem. |
| **Visual regression** | Percy-for-RN / device-farm screenshots | **New — not reusable** | See §9.3. |
| **Performance** | `react-native-performance` / Systrace / Instruments | Partial | Keep the `lib/perf/budget.ts` numeric budgets and the p50/p95 aggregation. |
| **Security** | Existing static gates | Partial | `check:rls`, `check:schema`, `check-routes` are server-side and unchanged. Add a mobile check for the identity-parity and key-storage invariants. |

### 9.2 CI

Extend `.github/workflows/ci.yml` with a mobile job **alongside** the existing `engine-tests`, `typecheck`, `lint` and `auth-gate` jobs — do not replace them. The web gates must keep passing throughout the migration, because the web app is the control for every differential test.

Add to CI: `core`-has-no-platform-imports lint, token-parity, identity-parity, engine third-target parity, RN typecheck + lint, and a Maestro smoke suite on an emulator/simulator.

### 9.3 Visual regression — an explicit caveat

The committed Playwright baselines (`tests/visual/baselines/*.png`, 10 scene types incl. `panel-*`) are **web-only**. They must **not** be treated as evidence for the native app, and they must **not** be regenerated to match native. Two separate suites are required. `RK-13` exists because the opposite assumption is easy and expensive.

### 9.4 Release strategy

**Shared:**

- **EAS Build** for both platforms (managed signing, reproducible builds).
- **EAS Submit** for store uploads.
- **EAS Update** for JS-only fixes between store releases. **Caveat:** OTA must not be used to change the app's primary purpose or add un-reviewed features (Apple 3.3.2 / 4.2.3 sensitivity); restrict OTA to bug fixes and content.
- **Version discipline:** `lib/version.ts` + `EDGE_API_VERSION` must be visible in telemetry and in an About screen; the client fails closed on a mismatch (`lib/edgeOps.ts:19-37`) with a **"update required"** screen, not a silent break (RK-20).

**iOS:**

- TestFlight internal → external → App Store review.
- Prepare: privacy manifest (`PrivacyInfo.xcprivacy`), App Privacy "nutrition label" matching the telemetry policy, crypto/wallet disclosure (RK-02), and IAP configuration if D-4 requires it.
- Phased release (7-day ramp) is available and should be used.

**Android:**

- Play internal → closed → open → production, with a **staged rollout** (e.g. 5% → 20% → 50% → 100%).
- Prepare: Data Safety declaration, target-API-level compliance, Android 15+ edge-to-edge handling, notification channels, and Play's crypto/billing policy position.
- App Bundle (AAB) with per-ABI splits to control size (RK-18).

**Both:** define a **rollback path** before M7 — for native binaries that means a previous-version binary plus a server-side feature flag, since you cannot un-ship a binary. **Feature flags on the server are the only real rollback lever for a mobile release** and should be planned in M6, not discovered in M7.

**Beta cohort:** the existing `docs/ops/DEVICE_PASS.md` device sign-off practice is a good template; formalise it into a device matrix and require a pass per release.

---

## 10. Decisions required before development begins

Each decision names what it blocks. **D-1 through D-6 must be answered before M0 exits; D-4 must be answered before M0 starts.**

| ID | Decision | Options | Recommendation | Blocks |
|---|---|---|---|---|
| **D-1** | **Codebase topology** | (a) Extract `packages/core`, two apps · (b) Fork logic into a mobile-only package · (c) Adopt React Native Web and share screens | **(a)** | Everything; §6.1 |
| **D-2** | **Framework** | RN+Expo · Flutter · Capacitor · native×2 | **RN + Expo** (§5) | Everything |
| **D-3** | **Styling/token delivery** | NativeWind · TS token module + StyleSheet · Unistyles | **TS token module** (cleanest parity with `DESIGN.md`'s three layers) | M1 |
| **D-4** | **Store compliance posture** | IAP for digital goods · companion-app (no in-app purchase) · geo-restricted · platform-split feature set | **Needs legal input; cannot be recommended from engineering** | **M0 start** (RK-01/02) |
| **D-5** | **Wallet strategy** | CDP embedded default · WalletConnect-only · both | **Both, CDP as default** (matches the existing in-game mode) | M3 |
| **D-6** | **Sequencing vs the server-authority migration** | Mobile M4 after P3/P4 · co-design · build against today's transport | **M4 after or co-designed with P3/P4**; M0–M3 proceed now | M4 (RK-03) |
| **D-7** | **Background/live-match policy** | Pause + resync on foreground · background task for turns · forbid backgrounding | **Pause + resync** | M4 |
| **D-8** | **PeerJS/WebRTC on mobile** | Realtime-only v1 · port `react-native-webrtc` | **Realtime-only v1** | M4 |
| **D-9** | **v1 feature scope** | Full parity · offline+social first · play-only first | **Offline (M2) → read-only (M3) → full (M4–M5)** — already reflected in §7 | M1 |
| **D-10** | **Guest mode on mobile** | Full guest · read-only guest · no guest | **Read-only guest** (preserves the web model; avoids store-review ambiguity) | M3 |
| **D-11** | **Tablet / large-screen posture** | Single-column identity centred · adaptive layouts | **Single-column centred for v1** | M1 |
| **D-12** | **Team and ownership** | Who owns core extraction, mobile UI, backend delta, store submissions | **Unassigned — must be named** | M0 |

---

## 11. Assumptions and open questions

### 11.1 Assumptions

Listed as A-1…A-8 in §2.3. The load-bearing ones: the backend contract is frozen (A-1), the identity tuple stays `(walletAddress, sessionId)` (A-2), and the chain stays on Base Sepolia (A-3). Each is falsifiable, and each one failing changes the plan materially.

### 11.2 Open questions — where the existing system does not tell us enough

| # | Question | Why it matters | Where the answer lives |
|---|---|---|---|
| **Q-1** | **Is a native app actually wanted, or would a PWA + Farcaster mini-app cover the need?** The repo already ships `@farcaster/frame-sdk` and `@farcaster/miniapp-sdk`. | This is the *cheapest possible* alternative to M0–M7 and must be explicitly rejected before we spend the budget. | Product / RK-23 |
| **Q-2** | **What is the budget, headcount and target date?** No timeline is given in this document because the answer changes it by multiples. | Determines whether v1 is M2-only (offline, ~1 platform team) or M0–M7 (full parity, 2–3 teams). | Owner |
| **Q-3** | **Who owns the backend delta** (push provider, rate-limit keying, any mobile-specific columns)? | The mobile team cannot ship M3 without it (Appendix E). | Engineering leadership |
| **Q-4** | **What is the intended relationship to the web client after mobile ships?** Web-first, mobile-first, or equal? | Determines whether the web client is migrated to `@ludo/core` in M0 or left alone (affects D-1's cost). | Product |
| **Q-5** | **Should guest play be fully functional on mobile?** | `lib/guest.ts` creates no Supabase row; full guest play implies anonymous progression, which has its own abuse and store-review implications. | Product / D-10 |
| **Q-6** | **Minimum OS versions and device matrix?** (This document assumes iOS 16+ / Android 9+, provisionally.) | Drives Skia/Reanimated support, and the perf targets that M2 is gated on. | Product / engineering |
| **Q-7** | **What is the acceptable cold-start time and app size?** No native budget exists. | M6 exit gate needs numbers; `lib/perf/budget.ts` only covers in-match hop metrics. | Product / engineering |
| **Q-8** | **Is on-chain settlement in scope for mobile v1** (chips escrow, mission vouchers, marketplace purchase), or is v1 read-only on chain? | Escrow is currently `enabled=false`; if it stays inert, mobile v1 can ship without the full on-chain surface. | Product / D-9 |
| **Q-9** | **Would React Native Web ever replace the web client?** | Explicitly rejected for v1 (A-6), but if it is the long-term intent, D-1's design should anticipate it. | Architecture |
| **Q-10** | **What is the Farcaster/mini-app parity requirement** — must mobile and the mini-app share feature flags, or can they diverge? | Affects whether mobile needs its own feature-flag surface. | Product |
| **Q-11** | **Should offline play count toward progression?** `/api/match/record` refuses `host_proven=false` (SEC-06), so today it cannot. | A visible product expectation gap (RK-22). | Product |
| **Q-12** | **Is mainnet (Base 8453) planned inside the mobile horizon?** `lib/chains.ts:41-43` already references it but rejects it. | Mainnet changes the wallet-compliance surface and the settlement-risk posture (RK-02). | Owner |
| **Q-13** | **What happens to the ~15 polling loops and the 100 ms spectator tick** — is there a product requirement for that latency, or is it an implementation artifact? | Determines whether §6.8's conversion to Realtime/push is a like-for-like replacement. | Product / engineering |
| **Q-14** | **Is there an existing design for mobile at all** — a Figma, a tablet layout, a native spec? | `DESIGN.md` is web-derived (500px column, `dvh`, `clamp()`); a mobile design language may not exist yet. | Design |

---

## Appendix A — Browser API → native replacement table

| Browser API / feature | Used at | Native replacement | Verdict |
|---|---|---|---|
| `env(safe-area-inset-*)` + JS clamp | `FrameProvider.tsx:29-33,86-87`; `globals.css:1656,5185,5685` | `react-native-safe-area-context` | **Hack deleted** |
| `window.visualViewport` IME math | `FrameProvider.tsx:90-99`; `useStableBoardBox.ts:36-40` | `react-native-keyboard-controller` | **Hack deleted** |
| `backdrop-filter` (stripped < 768px) | `FrameProvider.tsx:171-204` | `expo-blur` | **Hack deleted; feature gained** |
| `100dvh` / `vh` units | `globals.css:472,1137-1138,3234-3244` | flex layout + `useWindowDimensions` | Rebuild |
| `clamp()` fluid type | `globals.css:36-42` | token function of screen width | Rebuild (keep 10px floor) |
| `prefers-reduced-motion` | CSS kill-switches; `lib/motion.ts` | `AccessibilityInfo.isReduceMotionEnabled()` | Adapt |
| `localStorage` (~30 keys) | across hooks | MMKV | Adapt |
| Cookie (`ludo-theme`) | `app/layout.tsx:55-62`; `lib/preferencesUtils.ts:13` | MMKV + splash hold | Rebuild |
| IndexedDB (non-extractable `CryptoKey`) | `lib/encryption.ts:48-51` | `expo-secure-store` + JSI crypto | **Adapt — do not weaken (RK-08)** |
| `navigator.clipboard` | 9 sites | `expo-clipboard` | Rebuild |
| `navigator.vibrate` | `app/hooks/useAudio.ts:78`; `TeamUpMatchPanel.tsx:1193` | `expo-haptics` | **Feature gained on iOS** |
| Web Audio `AudioContext` | `app/hooks/useAudio.ts` (13.5 KB) | `react-native-audio-api` | Adapt (near-mechanical) |
| `HTMLAudioElement` | `app/hooks/useSoundEffects.ts` | `expo-audio` | Rebuild |
| `Notification` + Service Worker + VAPID | `hooks/usePushReady.ts`; `public/sw.js` | `expo-notifications` → APNs/FCM | **Rebuild + backend change** |
| `navigator.wakeLock` | `hooks/useScreenWakeLock.ts:46` | `expo-keep-awake` | Rebuild |
| WebAuthn `navigator.credentials` | `useBiometricGate.ts:39`; `BootLock.tsx` | `expo-local-authentication` | Rebuild (+ passkeys if CDP needs them) |
| `window.history.pushState` / `popstate` | `app/page.tsx:451-476` | `BackHandler` + `beforeRemove` | Rebuild |
| `html5-qrcode` | `QrScanButton.tsx:4,35,62` | `expo-camera` | Rebuild |
| `qrcode` | `ReceiveSheet.tsx:4`; `WcWalletPanel.tsx:5` | `react-native-qrcode-svg` | Rebuild |
| `canvas-confetti` | `app/page.tsx:324`; `useGameEngine.ts:6,233`; `BoardHome.tsx`; `SnakesBoard.tsx` | Skia particles / `react-native-confetti-cannon` | Rebuild |
| GSAP DOM timelines | `board/TokenPiece.tsx`, `TokenVisual.tsx` | Skia | Rebuild |
| framer-motion | 33 files | Reanimated | Rebuild |
| `matchMedia` | `useIsMobileView.ts:…` | `useWindowDimensions` | Rebuild |
| `RTCPeerConnection` (PeerJS) | `lib/peerFactory.ts`; `lib/teamup/*` | `react-native-webrtc` | **Deferred (D-8)** |
| `WebSocket` | `lib/teamup/edge-server-client.ts:110` | RN global WebSocket | Native |
| `crypto.subtle` | `lib/matchProof.ts:237`; `lib/encryption.ts` | `react-native-quick-crypto` | Adapt |
| Web Worker (AI) | `lib/ai/client.ts:46-54` | sync fallback exists (`:107-127`) | Adapt (optionally JSI) |
| `PerformanceObserver` longtask | `lib/perf/budget.ts:32-46` | `react-native-performance` / Systrace | Rebuild |
| `requestAnimationFrame` | `app/page.tsx:338,433` only | n/a (event-driven) | Drop |

## Appendix B — File-level reuse inventory

See §4.1–§4.3 for the annotated tables. Summary counts:

- **Reuse verbatim:** `lib/engine/*`, `lib/netcode/*` (8 files, 673 lines), `lib/gameProtocol.ts`, `lib/matchProtocol.ts`, `lib/protocol/*`, `lib/matchFsm.ts`, `lib/hostIntent.ts`, `lib/types.ts`, `lib/types/teamup.types.ts`, `lib/constants.ts`, `lib/boardLayout.ts`, `lib/snakesLogic.ts`, `lib/aiEngine.ts`, `lib/progression.ts`, `lib/inventory.ts`, `lib/missionCatalog.ts`, `lib/missionBadge.ts`, `lib/emotes.ts`, `lib/avatars.ts`, `lib/marketplacePrices.ts`, `lib/chat.ts`, `lib/payoutPlan.ts`, `lib/poolAuthority.ts`, `lib/purchaseIntent.ts`, `lib/onboardingShared.ts`, `lib/onboarding.ts`, `lib/matchProof.ts`, `lib/sessionProof.ts`, `lib/edgeOps.ts`, `lib/version.ts`, `lib/chains.ts`, `lib/walletMode.ts`, `lib/playerIdentity.ts`, `lib/appSessionGuard.ts`, `lib/chips.ts`, `lib/chipsSettle.ts`, `lib/merkleClaims.ts`.
- **Adapt:** `lib/encryption.ts` (key store), `lib/preferencesUtils.ts` (drop cookie), `lib/motion.ts`, `lib/telemetry*.ts` (transport), `lib/walletSigner.ts` (add RN impls), `lib/localRoom.ts`, `lib/guest.ts`, `lib/wc*.ts`, and the ~25 hooks listed in §4.2.
- **Rebuild:** `app/page.tsx`, `app/components/**` (96 files), `app/globals.css`, `app/layout.tsx`, `app/Providers.tsx`, `FrameProvider.tsx`, `LandscapeGuard.tsx`, the board components, `app/hooks/useAudio.ts`, `useSoundEffects.ts`, `hooks/useBiometricGate.ts`, `hooks/useScreenWakeLock.ts`, `hooks/useIsMobileView.ts`, `hooks/usePushReady.ts`, `hooks/useWalletSigner.ts` + CDP/Base signers, `public/sw.js`, `app/manifest.ts`.
- **Drop:** `lib/paymaster.ts` (stub), `lib/chipsIndexer.ts` (skeleton), `@tanstack/react-query`'s *unused* status on web (it becomes load-bearing on mobile), `ThemeSwitcher.tsx` (already dead).

## Appendix C — Invariant checklist (must not regress)

Carried forward from `AGENTS.md` "Security & trust model" and `SERVER_AUTHORITY_MIGRATION_PLAN` Appendix B. **Every one of these applies to the mobile client.**

- [ ] **C-1** 2v2 teams are Green+Blue vs Red+Yellow, from `TEAM_PAIRINGS` only — never a second pairing.
- [ ] **C-2** Move legality uses `calculateNextPosition` / `getLegalTokenIndices` — never `pos + roll`.
- [ ] **C-3** Networked rolls come from Edge `roll-dice` only. **No client-side fallback, ever** — including no offline queue for networked matches.
- [ ] **C-4** A guest intent may never name a face; `REQUEST_ROLL` stays `Record<string, never>`.
- [ ] **C-5** Power-tile `type` is authority-only; the wire form is `PowerTilePublic`; `sanitizeGameStateForWire` stays in the path.
- [ ] **C-6** `match_states.seq` is the display + rules authority; clients advance only on a strictly higher seq.
- [ ] **C-7** SIWE app sessions authorize chat/profile/settings **only** — never in-match actions.
- [ ] **C-8** `/api/match/record` requires a wallet signature and refuses `host_proven=false`.
- [ ] **C-9** `resolve-bet` requires a host signature; never accept a free-form `result`.
- [ ] **C-10** DMs are ECDH P-256 sealed boxes; no plaintext downgrade; the private key stays non-extractable.
- [ ] **C-11** `check:engine` byte-parity holds across **all** consumers (web, Edge, mobile).
- [ ] **C-12** The player identity rule (SIWE/Base > CDP parent smart account; never owner EOA/sub-account) is identical on mobile and web.
- [ ] **C-13** Reduce-motion removes translation, never information.
- [ ] **C-14** No animation ships without a reduce-motion path; new motion is compositor-only.
- [ ] **C-15** `EDGE_API_VERSION` mismatch fails closed (with a user-facing "update required" path).

## Appendix D — ADR-003 draft

```
ADR-003: Use React Native + Expo for the cross-platform mobile client
Status: Proposed (gated on D-1, D-4)

Context
  The product exists as a single-route Next.js 16 SPA over Supabase + 4 Deno Edge
  Functions. The rules engine (lib/engine/core.ts, 1,043 lines) is DOM-free,
  deterministically tested (50 seeded golden matches, differential fuzz against the
  legacy engine) and byte-synced into the Edge function by a CI gate. Offline play is
  already fully client-side. A mobile client is wanted.

Decision
  Build the mobile client in React Native + Expo, TypeScript, consuming a shared
  packages/core extracted from lib/. Board rendering moves to react-native-skia.
  Navigation becomes expo-router. The backend contract is unchanged except for push.

Rationale
  1. Dart (Flutter) cannot consume the tested engine; a cross-language port would
     weaken the byte-parity gate to a differential fuzz across two runtimes.
  2. A WebView wrapper (Capacitor) does not fix the mobile-GPU problems FrameProvider
     already works around, and risks Guideline 4.2 rejection.
  3. React/TS reuses the team's existing skills and the existing 41 test suites.
  4. React Native Web for shared screens is rejected: it would invalidate the committed
     visual baselines and the 10,657-line stylesheet for a bounded mobile gain.

Consequences
  + Engine, netcode, protocol, AI and economy digests are reused verbatim.
  + Real device capabilities (push, haptics, biometrics, blur, safe areas).
  - The entire UI layer (96 components, 28,426 lines) is re-implemented.
  - A third consumer of the engine must be added to the check:engine gate.
  - Two clients must be maintained; the shared package is the only mitigation.

Alternatives considered
  Flutter (rejected: Dart boundary), Capacitor (rejected: 4.2 + perf), native x2
  (rejected: 2x cost, 2x engine rewrite), PWA + Farcaster mini-app (deferred to Q-1).
```

## Appendix E — Backend delta list (the only server changes this plan requires)

| # | Change | File / object | Required by | Notes |
|---|---|---|---|---|
| E-1 | Add a `platform` discriminator + APNs/FCM token shape | `push_subscriptions` migration; `app/api/push/subscribe/route.ts`; `lib/pushServer.ts` | M3 | Preserve SEC-14 wallet-scoping on unsubscribe. |
| E-2 | Add an APNs + FCM provider behind an abstraction | `lib/pushServer.ts` | M3 | Web VAPID path must keep working. |
| E-3 | Session/wallet-scoped rate limiting for authenticated routes (or a mobile class) | `lib/rateLimit.ts`, `lib/rateLimitRoutes.ts`, `middleware.ts` | M3 | RK-09. Note `lib/rateLimit.ts` is an in-process Map — per-isolate, not distributed; `RATE_LIMIT_SHARED_URL` is reserved but unimplemented. Any real fix implies a shared store. |
| E-4 | Mobile app-version gate (minimum supported version) surfaced to clients | new route or header; `lib/version.ts` | M3 | RK-20; pairs with `checkEdgeVersion` fail-closed behaviour. |
| E-5 | Privacy policy / terms updated for mobile data collection | `app/privacy`, `app/terms` | M6 | RK-21. |
| E-6 | Extend `check:engine` to assert a third consumer | `scripts/check-edge-engine.mjs` | M0 | Strengthens, does not weaken, the existing gate. |
| E-7 | Extend `scripts/contrast.mjs` to validate the mobile token module | `scripts/contrast.mjs` | M1 | RK-11. |
| E-8 | Store compliance: IAP product configuration **if** D-4 requires it | store consoles + purchase route | M6 | RK-01. Scope unknown until D-4. |

**Explicitly NOT changed:** all 47 REST routes' contracts, all 4 Edge functions, the Postgres schema (other than E-1), RLS policies, the 17 SECURITY DEFINER RPCs, the Realtime publication set (`conversations`, `matchmaking_queue`, `live_chat`, `live_matches`), and the auth model.

---

*End of document. Rev 1 — awaiting sign-off on §10.*
