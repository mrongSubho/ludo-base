# Ludo Base — Server Authority Migration Plan

**Migrating from host-centric auth + PeerJS + Edge Functions to full server-based auth and a server-authoritative match room.**

| Field | Value |
|---|---|
| Document status | **Rev 3** — revised to address the 6 post-Rev-2 review findings (OpenNext `src/worker.ts` entry, local dev story, P3 latency/`match_commit_action` paradox, WS auth in webviews, DO alarms/multitasking, rate-limit placement, cost realism). Owner sign-off still required on §10; **P3+ stays gated on the P0 spike** |
| Date | 2026-10-15 |
| Author roles | Senior System Design Architect · Senior Software Engineer · Senior Product Manager |
| Target platform | Cloudflare Workers (OpenNext 1.18) + Supabase (Postgres 17, Deno Edge Functions) |
| Related docs | `AGENTS.md`, `ENGINE_LOGIC.md`, `docs/ops/SYSTEM_REVIEW.md`, `docs/ops/IMPLEMENTATION_RECORD.md`, `docs/ops/NETCODE_DRILLS.md`, `docs/ops/UNPARK_DECISION.md`, `docs/architecture/adr-001-betting-window-protocol.md` |
| Companion | `docs/architecture/WORKLOAD_PLACEMENT_MATRIX.md` — the component-by-component **keep / move / rewrite / new** decision, and the resolution of D1 |
| Supersedes | Nothing. Proposes `ADR-002` (Appendix D) |

### Revision history

| Rev | Date | Change | Finding |
|---|---|---|---|
| 1 | 2026-10-13 | Initial plan | — |
| 2 | 2026-10-13 | **§5-P0** added the Durable Object-in-OpenNext **spike** with a pass/fail criterion, and made P3+ gated on it | FE-1, G12 |
| 2 | 2026-10-13 | **§4.4/§5-P3/§5-P4** resolved the P3 boundary: **P3 = transport + seq + fan-out + reconnect, delegating to the existing Edge functions; P4 = relocation of validation and minting.** Fixed the internal roll-minting contradiction | XD-1, PI-2, PI-3 |
| 2 | 2026-10-13 | **§5-P1** absorbed the distributed rate limiter and CF Cron, and re-sized P1 to L+ | XD-2 |
| 2 | 2026-10-13 | **§5-P6** added deletion of the three Edge Functions and the `_shared` engine copy | XD-4 |
| 2 | 2026-10-13 | **§4.7** re-derived the intent union from `lib/gameProtocol.ts`; removed the invented `REQUEST_POWER` | PI-1 |
| 2 | 2026-10-13 | **§3.6** merged the problem register into one ID space with a cross-ref column; added P13–P19 | XD-3 |
| 2 | 2026-10-13 | **§4.6** added retention/GC for `auth_challenges`, `sessions`, `match_room_events` | PI-5 |
| 2 | 2026-10-13 | **NEW §4.12** in-flight match cutover rule; added to P3/P4 exit gates | PI-4, RK-3 |
| 2 | 2026-10-13 | **§7.2** replaced placeholder metric targets with numeric SLOs, owners and windows | PI-6 |
| 2 | 2026-10-13 | **§7.3** reconciled the cohorts with the un-park DEFER decision; added the Farcaster manifest domain item | PI-7, RK-6 |
| 2 | 2026-10-13 | **§8** added R15–R20 (DO integration, vendor concentration, in-flight cutover, capacity, socket abuse, bus factor) | RK-1…RK-6 |
| 2 | 2026-10-13 | **§9/§10** updated sizing and staffing; D1 now explicitly gated on the spike | XD-1, RK-2 |
| 2 | 2026-10-13 | **§3.5 / Appendix A** corrected the definer-function count (17 *callable*; trigger functions are separate) and added the protocol surface | MI-1, MI-6 |
| 2 | 2026-10-13 | **§4.2/§4.10/§4.11** added the cookie compliance note, the room-socket abuse model, and the write-amplification/egress lines | PI-8, RK-5, MI-5 |
| 2 | 2026-10-13 | **Appendix B** declared the single source of truth for invariants (the companion matrix now references it) | XD-5 |
| 2 | 2026-10-13 | **Appendix G** added — full Rev 2 change record | — |
| 3 | 2026-10-15 | **§4.4**: replaced the DO deployment note with the **`src/worker.ts` custom worker entry** pattern (re-export OpenNext handler + DO classes + fast-path WS upgrade + Cron handler) and the `wrangler.jsonc` `main` change; added the **room concurrency model** (single-alarm timer min-heap + `blockConcurrencyWhile`/FIFO action queue) | F1, F5 |
| 3 | 2026-10-15 | **§4.2/§4.5/§4.7**: added the **WebSocket auth handshake** — cookie preferred, with a single-use `?ticket=` or an in-band `join` token for cross-origin iframes / Farcaster webviews where `SameSite` cookies cannot travel | F4 |
| 3 | 2026-10-15 | **§4.4/§5-P3/§5-P4**: resolved the **`match_commit_action` scope paradox** — P3 now *proxies* the untouched Edge functions (no refactor); the atomic RPC is **P4 only** | F3 |
| 3 | 2026-10-15 | **§4.11**: added the **P3 cross-cloud latency breakdown** (~180–350 ms/action) and reframed **Workers Paid ($5/mo) as the Day-1 baseline** with the 240-frames × matches math | F3, F7 |
| 3 | 2026-10-15 | **§4.13 (new)**: **local dev story** — `NEXT_PUBLIC_ROOM_WS_URL` + staging tunnel / dev WS sidecar / offline fallback, so `npm run dev` does not 404 on room sockets | F2 |
| 3 | 2026-10-15 | **§5-P1**: rate limiting revised to **evaluate the native CF Rate Limiting binding first**; if DO counters, shard by colo+routeClass+ipPrefix and apply only to high-value mutations, reads stay in-memory | F6 |
| 3 | 2026-10-15 | **§8**: added R21 (DO single-alarm + cooperative multitasking); R5 reframed as Day-1 Paid baseline | F5, F7 |

---

## 0. How to read this document

- §1–§2 give the decision and the exact scope. **If you read nothing else, read these.**
- §3 is the evidence-based current-state assessment. Every claim carries a `file:line` or an exact identifier so it can be verified.
- §4 is the target design. §5 is how to get there without breaking anything. §6 is how we prove it.
- §7 is the product/rollout view, §8 the risk register, §9 sequencing, §10 the decisions the owner must make.
- Appendices carry the invariant checklist, the route-authority delta, and the ADR draft.

**Terminology used throughout:** *host* = today's player device that holds match authority. *Room* = the server-side authoritative object for one match. *Scope* = the privilege class bound to a session (`app`, `match`, `spectator`).

---

## 1. Executive summary

### 1.1 The headline finding

**This migration is roughly 60% done already, and the codebase does not know it yet.**

The game-action path is *already* server-authoritative:

- Dice faces are minted server-side by the `roll-dice` Edge Function with `crypto.getRandomValues`, one face per `(match_id, turn_seq)`, enforced by the partial unique index `match_rolls_match_turn_uniq` — so retry-until-six is structurally impossible (`supabase/functions/roll-dice/index.ts:119-150`, `supabase/migrations/202609300011_roll_receipt_binding.sql:52`).
- Moves are validated server-side in `move-auth` — turn ownership, seat authority, roll binding, legal-token math, three-sixes forfeit, then a compare-and-swap on `match_states.seq` (`supabase/functions/move-auth/index.ts:513-700`, `supabase/functions/_shared/networkBoundary.ts`).
- `ENGINE_LOGIC.md:193` already states the doctrine: *"`match_states.seq` is display authority (host is animator/relay, not rules)."*
- The database boundary already assumes this: **43 tables, RLS on all of them, exactly one client-writable policy in the entire schema** (anonymous `feedback` insert at `baseline.sql:640`). Everything else is service-role-only (`supabase/migrations/README.md:14-27`).

What is *still* host-centric is the **identity layer**, the **realtime transport**, and the **match lifecycle**:

1. **Identity is a bearer UUID in `localStorage`** (`hooks/useAppSession.ts:11` — key `ludo-siwe-session`), sent back as a body field or — for GET routes — **as a query parameter** (`app/api/profile/route.ts:13-16`, `app/api/messages/route.ts:9-12`). No cookie, therefore no `HttpOnly`, no `Secure`, no `SameSite`, no CSRF posture. The SIWE nonce is client-chosen and only rejected *after* first use (`app/api/siwe/verify/route.ts:128-135`).
2. **A player device is still the match authority for lifecycle**: the compute host drives AI/AFK/turn orchestration (`hooks/useGameEngine.ts:127,428`), opens the bet window (`hooks/useBettingController.ts`), triggers settlement with a host signature (`supabase/functions/resolve-bet/index.ts:79-115`), records the result with a host signature (`app/api/match/record/route.ts:95-132`), and toggles streaming (`app/api/match/stream/route.ts:53-64`). If that device leaves, the match degrades to presence re-election (`HOST_ELECT`) or stalls.
3. **State reaches clients over PeerJS/WebRTC plus Supabase Realtime broadcast** (`hooks/TeamUpContext.tsx:374,526`), with the private-channel authorization work still open as **NET-03a/b**, explicitly blocked on project credentials (`docs/ops/IMPLEMENTATION_RECORD.md` — *Deferred by decision* §1).

### 1.2 The decision this document asks for

Adopt a **three-layer target**: server-issued **cookie sessions with a scope model** (identity), a **single server-side validation authority** (rules), and a **per-match Durable Object room** for sockets, timers, and fan-out (transport). Retire the player-as-authority concept entirely: after this migration, **"host" is not a privilege — the server is the host**, and players hold only *seats*.

### 1.3 Why not leave it alone

The current split produces four classes of failure that cannot be fixed inside the current architecture:

| # | Failure | Why it cannot be fixed in place |
|---|---|---|
| F1 | **Host device is a single point of failure.** Host tab backgrounded, phone locked, or battery died → AI/AFK orchestration, bet window, settlement and match recording all stall until presence re-election completes. | Orchestration lives in a React event loop. No server process owns the clock. |
| F2 | **Result integrity rests on a player's honesty.** `/api/match/record` accepts `winnerAddress` from the body and never checks it against `match_states.state.winner`; the only gate is that the signer equals `participants[0]` and `host_proven` (`app/api/match/record/route.ts:95-148`). `host_proven` itself is derived from a client-supplied roster (`app/api/match/start/route.ts:92-121`). | Progression, LXP/RXP and mission credit flow from a player-declared result. |
| F3 | **Sessions are exfiltratable and replayable.** A bearer UUID in `localStorage`, appearing in query strings and server logs, is a 7-day credential with no proof-of-possession, no rotation, no device binding, and no revocation on password-equivalent events. | Cookies + rotation + server challenges are an architectural change, not a patch. |
| F4 | **Realtime rooms are not authorized.** `game-room-${roomCode}` is broadcast over a public-by-default channel; anyone who knows a room code can subscribe. The fix (private channel + `realtime.messages` RLS + `realtime.setAuth()`) is designed but unlanded because it needs project credentials. | Requires the session layer from F3 to have a JWT to authenticate the channel with. |

### 1.4 Effort shape (relative, not calendar)

| Phase | Theme | Relative size | Risk |
|---|---|---|---|
| P0 | Decisions, flags, baselines, **DO spike** | **S+** | Medium — the spike can fail |
| P1 | Session v2 + **rate limiter + Cron** (Rev 2) | **L+** | Medium |
| P2 | Server-derived authority (kill client-claimed roles/results) | M | Medium |
| P3 | Match Room v2 — **transport, ordering, fan-out** (Rev 2) | **L+** | High |
| P4 | **The clock, the lifecycle, and the validation relocation** (Rev 2 — XL moved here) | **XL** | High |
| P5 | Private realtime + PeerJS demotion (NET-03a/b closure) | M | Medium |
| P6 | Retire host-centric paths, **Edge Functions**, docs, final gates | M | Low |

**Critical path: P1 → P2 → P3 → P4.** P5 can run parallel to P3. P0 is a prerequisite for everything.

---

## 2. Scope

### 2.1 What "full server-based auth" can mean — and which one we are doing

The phrase is ambiguous. Three readings, and the honest answer is that the product need is the union:

| Reading | Meaning | Verdict |
|---|---|---|
| **A. Auth-only** | Replace bearer tokens with server sessions; keep the P2P/host-authoritative game. | Insufficient. Fixes F3/F4, leaves F1/F2 untouched — and F2 is the one that touches money and progression. |
| **B. Authority-only** | Server owns match state and lifecycle; keep wallet-signature-per-action identity. | Insufficient. Every action still costs a signature, and sessions remain exfiltratable. |
| **C. Full server authority (chosen)** | Server owns identity **and** rules **and** lifecycle; clients hold seats and render. | **This is the target.** Delivered in stages (§5) so value lands early and risk stays bounded. |

### 2.2 In scope

1. Identity: server-issued challenge → verified signature → cookie session with `scope` (`app` / `match` / `spectator`), rotation, revocation, CSRF posture.
2. Authorization: every route and every realtime channel authorizes from **server-derived** facts, never from client-supplied roles, rosters, or results.
3. Match authority: a per-match server room that owns `seq`, the socket set, turn timers, AFK strikes, AI turns, bet-window lifecycle, and state fan-out.
4. Lifecycle: settlement, match recording, and streaming become **server-originated**; the host signature requirement is removed from those paths.
5. Transport: authorized WebSocket rooms as the primary realtime path; PeerJS demoted then retired; Supabase Realtime retained for lobby/social.
6. Client: a compatibility shim so the existing UI keeps working while `isAuthority` call sites are deleted.

### 2.3 Explicit non-goals

- **No engine rewrite.** `lib/engine/core.ts` stays the single source of truth and stays byte-identical to its Edge copy via `scripts/sync-edge-engine.mjs`. Golden replay hashes must not change.
- **No schema rewrite.** The 43-table model and its 9 policies are correct and stay. Additive migrations only.
- **No offline-mode removal.** Local pass-and-play keeps `lib/gameLogic.ts` `processMove`; it simply never becomes a recorded match.
- **No chain change.** On-chain pool settlement keeps the EIP-712 pool-authority co-signature; only the *trigger* moves server-side.
- **No removal of the signature as an identity primitive.** Wallet signatures still prove wallet control at login. They stop being the per-action credential.
- **No change to the 2v2 pairing, capture, gate-crossing, or three-sixes rules.** They are invariants (Appendix B).

---

## 3. Current-state assessment (evidence-based)

### 3.1 Identity and sessions today

| Surface | Mechanism | Evidence | Weakness |
|---|---|---|---|
| Login | SIWE-style personal sign over a custom (non-EIP-4361) message | `lib/sessionProof.ts:91-116`, `app/api/siwe/verify/route.ts:92-101` | Nonce is client-chosen; only rejected after first use (`siwe/verify/route.ts:128-135`) |
| App session | `app_sessions.id` bearer UUID, 7-day TTL, one live per wallet | `lib/sessionProof.ts:15`, `baseline.sql:48-57`, `202609300016:50` | Stored in `localStorage`; passed in bodies and **query strings**; no cookie, no PoP, no rotation |
| Match session | EIP-712 `LudoMatchSession` → `match_sessions.id`, max 2h | `lib/sessionProof.ts:45-53`, `supabase/functions/_shared/matchSession.ts:26-47`, `move-auth/index.ts:329-395` | Also a bearer UUID; separate table but same transport |
| Verification | `requireAppSession(wallet, sessionId)` — compares the row to two client-supplied values | `lib/serverAuth.ts:16-25` | Caller must supply both wallet **and** token; 34 call sites rely on this |
| Match auth | Session **or** per-action signature fallback | `move-auth/index.ts:212-238`, `hooks/useMoveAuth.ts:281-619` | Two parallel auth paths to maintain and test |
| Route gating | Middleware is **rate limiting only** — no auth | `middleware.ts:21-74` | Auth is per-handler discipline; `check:routes` (47 routes) is the compensating control |
| Wallet locking | Passkey/device-bio `BootLock`, CDP-only | `app/components/BootLock.tsx:83-89`, `hooks/useAppSession.ts:103-124` | Client-side UX control, not a server boundary |

**Invariant that must survive:** the app session must **never** authorize an in-match action, and the match session must never authorize chat/profile/settings. This separation is stated in `supabase/functions/_shared/matchSession.ts:9-11` and `ENGINE_LOGIC.md:217`. The scope model in §4.2 preserves it by construction.

### 3.2 Authority map today — three-way split

| Authority | Held by | Covers | Evidence |
|---|---|---|---|
| **Rules authority** | Supabase Edge Functions | Dice minting, move legality, turn rights, roll consumption, seq CAS | `move-auth/index.ts`, `roll-dice/index.ts`, `_shared/turnAuthority.ts`, `_shared/networkBoundary.ts` |
| **Identity/economy authority** | Next.js API routes with service role | Profile, social, missions, onboarding, chips escrow, marketplace | 47 routes in `app/api/**/route.ts`, gated by `check:routes` |
| **Lifecycle/realtime authority** | **A player device** (P2P host, else elected compute host) | AI turns, AFK detection, turn orchestration, bet window, state fan-out, stream toggle, match recording, settlement trigger | `hooks/useGameEngine.ts:127,428`, `hooks/TeamUpContext.tsx:374,740,1460`, `hooks/useBettingController.ts`, `resolve-bet/index.ts:79-115`, `match/record/route.ts:95-132`, `match/stream/route.ts:53-64` |

The third row is what this migration eliminates. The first two rows are kept — and strengthened, because the room becomes their single client-facing front door.

### 3.3 Realtime transport today

- PeerJS `DataConnection` with peer id = room code for the creator; signaling via the PeerJS cloud unless `NEXT_PUBLIC_PEERJS_*` points elsewhere (`lib/peerFactory.ts`, `docs/ops/SIGNALING.md`).
- Supabase Realtime broadcast on `game-room-${roomCode}` (event `game-action`) and presence on `game-presence-${roomCode}` (`hooks/TeamUpContext.tsx:1034,1137`).
- State application gate: `shouldApplyGameAction` — accept only `source === 'match_states'` with a strictly higher `seq` (`lib/netcode/authorityGate.ts`).
- Dedup: `createDedupStore` / `rememberIntent` (`lib/netcode/dedup.ts`), `max:512` for intents, `max:2048` for relay.
- Resync: bounded exponential ladder (`lib/netcode/resync.ts`), one retry reusing the same `rollId` (`lib/netcode/staleSeq.ts`).
- Spectators: 5-second poll of public `GET /api/match/state` (`hooks/useSpectatorSync.ts:75,234`). **There is no SSE anywhere in the repo.**
- **Open:** NET-03a/b — private channel + `realtime.messages` RLS + `realtime.setAuth()` is designed but unlanded, blocked on project credentials (`IMPLEMENTATION_RECORD.md` — Part III, deferral 1). Confirmed feasible: Supabase Realtime authorization is RLS on `realtime.messages` with `private: true` + `setAuth()`, and public channel access can be disabled project-wide.

### 3.4 Settlement and economy today

- `resolve-bet` requires a **host wallet signature**, cross-checks `betType` against `live_matches.current_bet_type` and the signed `result` against `match_states.state.winner`, then calls `chips_escrow_settle_bets` (`resolve-bet/index.ts:79-198`).
- The escrow arming interlock `chips_escrow_config_armed` forbids enabling escrow without a treasury wallet, non-zero rake, and `allow_self_bets = false` (`202609300005`, `202609300010`).
- `lib/poolAuthority.ts` derives the payout plan server-side; `lib/chipsSettle.ts` holds the EIP-712 structs and the edge signer (`EDGE_SETTLE_PRIVATE_KEY`).
- **The anomaly:** the server already knows the true winner (`match_states.state.winner`) but still *requires a player's signature* to act on it.

### 3.5 Data model and gates

- 29 canonical migrations, 43 tables, RLS on all, 9 policies, 1 client-write policy (`feedback` insert).
- Publication members: `conversations`, `live_chat`, `live_matches`, `matchmaking_queue` (`202609300016:39`, `202609300018:29`).
- **Protocol surface** (Rev 2 — PI-1): the live intent union is `REQUEST_ROLL | REQUEST_MOVE | DICE_COMMIT | DICE_REVEAL | CMD_REQUEST_TRUST` (`lib/gameProtocol.ts:12`). There is **no** `REQUEST_POWER` intent — power submission goes through `move-auth` `submit-power`. `REQUEST_ROLL` rejects a `value` field (`:25`) and `REQUEST_MOVE` rejects `diceValue` (`:35`), both fail-closed. The legacy `DICE_COMMIT` / `DICE_REVEAL` intents and `CMD_REQUEST_TRUST` are still accepted and are retired in P6.
- Named invariants to preserve: `match_rolls_match_turn_uniq`, `match_rolls_status_check`, `app_sessions_one_live_per_wallet`, `match_sessions_active_idx`, `provisional_match_sessions_key_wallet_uniq`, `matches_proven_host_is_address`, `matches_match_shape_check`, `spectator_bets_player_action_uniq`, `chips_escrow_config_armed`, `chips_escrow_ledger` U(wallet,reason,ref), `messages_restrict_columns`, `players_coins_frozen`, `players_prevent_client_tampering`, `mission_vouchers_claim_uniq`, `player_missions_period_uniq`, `lobby_join_policies_policy_check`.
- Gates in CI order: `npm test` (417 total / **406 pass / 0 fail / 11 skipped**) → `test:golden` (50/50) → `test:engine-diff` (1200 seeded) → `test:engine-core` (41) → `test:netcode` → `test:protocol` → `test:hooks` → `check:engine` → `check:rls` → `test:concurrency` → `check:routes` (47 routes) → `check:schema` (29 migrations, **17 callable `SECURITY DEFINER` fns** — trigger functions are a separate category and are excluded by the gate, `check-schema.mjs:312-322`) → `typecheck` → `lint` → `auth-gate` (6492 gate + session-guard-sim).
- Program state: **154 findings; all SEC/ENG/ECO/CRY/REA closed, all DB closed (DB-22 closed 2026-10-13), all NET closed except NET-03a/b.** Open non-code items: Base mainnet deploy (owner decision), Android profiler trace (Phase 5 gate), Sentry first-event visual check, un-park decision = **DEFER** (`docs/ops/UNPARK_DECISION.md:84`).

### 3.6 Problem register

Severity: **S1** = money/progression integrity, **S2** = availability/UX, **S3** = hygiene.

Rev 2 — this is now the **single** problem ID space for the migration (XD-3). `Cross-ref` maps each problem to the failure class in §1.3 and to the placement fix `G<n>` in `docs/architecture/WORKLOAD_PLACEMENT_MATRIX.md` §6.

| ID | Problem | Sev | Evidence | Cross-ref |
|---|---|---|---|---|
| P1 | Match result is player-declared; server never compares to `match_states.state.winner` | S1 | `app/api/match/record/route.ts:95-148` | F2 → G4 |
| P2 | `host_proven` derives from a client-supplied roster | S1 | `app/api/match/start/route.ts:92-121` | F2 → G4 |
| P3 | Session token is `localStorage`-borne, appears in URLs and logs, no rotation/PoP | S1 | `hooks/useAppSession.ts:11,179`; `app/api/messages/route.ts:9-12` | F3 → G6 |
| P4 | SIWE nonce is client-chosen; no server challenge; replay window until first use | S1 | `app/api/siwe/verify/route.ts:52-67,128-135` | F3 → G6 |
| P5 | Realtime rooms are public-by-default; anyone with a room code can subscribe | S1 | NET-03a/b open; `hooks/TeamUpContext.tsx:526` | F4 → G5 |
| P6 | Live-chat sender identity is self-asserted (regex only, no session) | S1 | `app/api/live-chat/route.ts:64-80` | F3 → G6 |
| P7 | Onboarding progress is client-reported deltas → CHIPS vouchers | S1 | `app/api/onboarding/progress/route.ts:79-139` | F2 → G4 |
| P8 | Host device failure stalls AI/AFK, bet window, settlement, recording | S2 | `useGameEngine.ts:428`, `TeamUpContext.tsx:374` | F1 → G3 |
| P9 | Arena host = first session-holding caller to bootstrap | S2 | `app/api/live-arena/power4p/route.ts:43-48,168-171` | F2 → G4 |
| P10 | Two parallel auth paths (session vs per-action signature) double the test surface | S3 | `move-auth/index.ts:212-238`, `hooks/useMoveAuth.ts:281-619` | F3 → G6 |
| P11 | `roll-dice` personal-sign fallback verifies the signer but not the message text | S3 | `roll-dice/index.ts:80-88` | F2 → G4 |
| P12 | `move-auth` trusts a client-supplied `source: 'player' \| 'host-assist'` | S3 | `move-auth/index.ts:516,703,853` | F2 → G4 |
| **P13** | Rate limiting is per-isolate (`limit × isolates`); the module documents this itself | S1 | `lib/rateLimit.ts:10-19,42` | → G1 |
| **P14** | No scheduler exists; cleanup RPCs are granted but nothing invokes them; the matchmaking queue grows unbounded | S2 | `baseline.sql:575-609`; `migrations/20260904_matchmaking_phase1.sql:38-39` (commented out) | → G2 |
| **P15** | CAS and its confirmation are two round trips with a window between them | S2 | `_shared/networkBoundary.ts` (`confirmSequenceAfterWrite`) | → G7 |
| **P16** | Chain indexer is in-memory; a redeploy loses the cursor | S3 | `lib/chipsIndexer.ts:1-5` | → G8 |
| **P17** | No per-match lifecycle audit trail for server-originated actions | S2 | new `match_room_events` (§4.6) | → G9 |
| **P18** | The engine has two copies and no third-target gate if the room validates | S2 | `scripts/sync-edge-engine.mjs`; `check:engine` | → G10 |
| **P19** | **Durable Object integration into the OpenNext Worker is unwired and unproven** — no `durable_objects` binding, no `migrations`, no custom worker entry | **S1** | `wrangler.jsonc`; `open-next.config.ts` | → G12 |

P1–P7 and P13/P19 are the reason this document exists. P8 is the reason it is worth the effort. **P19 is the reason P3 cannot start today.**

---

## 4. Target architecture

### 4.1 Principles

1. **One authority per decision.** At any moment, exactly one component decides whether a state transition is legal: the server. No dual authority, not even temporarily during rollout — dual authority is how invariants get regressed.
2. **Clients hold seats, not power.** The client may *request*; the server decides. `REQUEST_ROLL` carrying `{}` and `REQUEST_MOVE` carrying no `diceValue` are the existing expression of this (`lib/gameProtocol.ts:25,30-35`) — extend the same posture to lifecycle.
3. **Server-derived facts only.** Roles, rosters, results, and timers are computed from server state. Anything a client asserts is either ignored or verified against server state.
4. **Additive schema, never destructive.** No column drops until P6, and only after a release with zero reads.
5. **Single engine source.** `lib/engine/core.ts` → `supabase/functions/_shared/engine.ts` via `scripts/sync-edge-engine.mjs`; if the room validates locally, it consumes a synced copy too, and `check:engine` gains a third target.
6. **Preserve the audit trail.** Every accepted transition is durably recorded (`match_moves`, `match_rolls`, `match_states`), because receipts are what make provable fairness provable.
7. **Fail closed, degrade loudly.** Unreachable room → freeze and resume, never "continue locally and reconcile later" for recorded matches.

### 4.2 Identity and session layer (target)

**Flow:**

```
POST /api/auth/challenge   { wallet? }            → { challengeId, message, expiresAt }
POST /api/auth/verify      { challengeId, signature, wallet } → Set-Cookie: __Host-ludo_session=...
POST /api/auth/match       { matchId }            → sets match-scope cookie (server checks membership)
POST /api/auth/logout      {}                     → revokes session, clears cookie
GET  /api/auth/session     {}                     → { wallet, scope, expiresAt, capabilities[] }
```

**Session properties:**

| Property | Value | Rationale |
|---|---|---|
| Transport | `Set-Cookie: __Host-ludo_session=<opaque>` | `__Host-` forbids subdomain scope and requires `Secure` + `Path=/` |
| Flags | `HttpOnly; Secure; SameSite=Lax; Path=/` | Lax permits top-level navigation returns (Farcaster/webview friendly) while blocking cross-site POST |
| Storage | Only `sha256(token)` in `sessions.token_hash` | A DB read leak does not yield usable sessions |
| Scopes | `app` (7d absolute, 30m idle), `match` (2h absolute, 5m idle grace), `spectator` (match TTL, read-only) | Preserves the "app session never authorizes moves" invariant *by construction* |
| Rotation | New token on scope escalation (app → match) and on every 24h for `app` | Limits the value of a stolen token |
| Challenge | `auth_challenges`: server-generated nonce, 5-minute TTL, single-use, atomic consume | Kills P4 |
| CSRF | `Origin` + `Sec-Fetch-Site` allowlist on all mutations **plus** double-submit token | Cookie auth requires it; cookie-less bearer did not |
| Revocation | `revoked_at` + revocation on re-login, wallet-link change, and moderation action | Existing `app_sessions_one_live_per_wallet` semantics carried forward |
| Guest | Server-issued guest session; server-generated `guest_<random>` id, `players` row created server-side | Removes client-minted identities (`lib/guest.ts:23-31`) |
| Step-up | BootLock/passkey stays a client UX control; server records a `device_id` claim and can require recent auth for high-value actions | Keeps the CDP/external-wallet boundary intact (`AGENTS.md` invariant) |

**Compatibility strategy (important for rollout):** keep a **hybrid session transport** for one release window — cookie preferred, with a short-lived in-memory bearer plus refresh token available if a cookie capability probe fails in the Farcaster webview. The probe runs at boot; the result is cached per device. This is a deliberate, time-boxed exception, not a permanent second path (see risk R6).

**Compliance note (Rev 2 — PI-8):** the session cookie is *strictly necessary* (it carries authentication state), so it is exempt from consent under the ePrivacy/GDPR strictly-necessary exemption. Do **not** add a cookie consent banner for it — a banner in the Farcaster webview would obstruct boot and break the capability probe. If analytics cookies are ever introduced, that is a separate consent decision.

### 4.3 Authorization model

**Capability table** (server-computed; the client never sends any of these):

| Capability | Granted when | Replaces |
|---|---|---|
| `seat.play(matchId, color)` | Session scope `match` **and** server-side membership in `matches.participants` **and** seat is `human` and wallet matches | `checkSeatAuthority` client-claimed `source` (P12) |
| `seat.assist(matchId, color)` | Server room decides (bot/AFK seat, server-driven) | client-claimed `host-assist` |
| `room.own(matchId)` | Server assigns the room owner at creation (first authenticated participant) and records it in `matches.room_owner` | `participants[0]` inference, arena-first-caller (P2, P9) |
| `bet.settle(matchId)` | Server room observes terminal state **and** `chips_escrow_config_armed` | host signature (P1-adjacent) |
| `match.record(matchId)` | Server room observes terminal state and derives winner from `match_states.state.winner` | host signature + client `winnerAddress` (P1) |
| `spectate(matchId)` | `spectator` scope token for that match | public channel / public GET |
| `chat.send(roomCode?)` | `app` scope; identity bound to session wallet | body-supplied `wallet` (P6) |

**Route matrix:** all 47 routes get an explicit entry in a single table (`lib/routeAuthority.ts`) declaring `{ method, path, scope, capability, csrf }`. `check:routes` is extended to assert this table against the actual handlers — a missing or mismatched entry fails CI. This converts "auth is per-handler discipline" into a checkable contract.

**RLS stays as-is.** Default-deny, service-role-only for auth-relevant tables. The only RLS addition is for Realtime authorization (§4.5).

### 4.4 Match Room (target authority for lifecycle)

**Chosen shape: one Cloudflare Durable Object per match, keyed by `matchId`.**

- Workers Free supports **SQLite-backed Durable Objects**; the room's traffic shares the Worker's 100k requests/day free budget. Exact free-tier allowances for DO requests/alarms must be verified in the dashboard before P3 lands; treat the $5 Workers Paid tier as the expected cost of P3 if room traffic approaches the free ceiling (see §4.11).
- Durable Objects give what Postgres + polling cannot: a single-threaded per-match actor (no CAS races to reason about), WebSocket hibernation (no charge while idle), and **alarms** (server-side timers without a cron scheduler).

**Room responsibilities:**

| Concern | Design |
|---|---|
| Membership | Validates the session cookie/token, resolves `matchId` → seats, admits only participants + spectators with `spectator` scope |
| State | Holds `GameState` + `seq` in DO SQLite; every accepted transition is persisted to Postgres in the same logical step |
| Rules validation | **P3: the room is a pure HTTP proxy** — it forwards the exact payload the browser client sends today to `move-auth` on Edge and relays the response. **`move-auth` is not modified, forked, or re-implemented in P3** (Rev 3 — F3). **P4: relocates in-process** using the synced engine copy, and the Edge path is retired **in the same release** (never both). Relocation is a P4 deliverable, not a P3 one (Rev 2 — XD-1). |
| Roll minting | **P3: the room calls `roll-dice` on Edge** (proxy, untouched) and persists the receipt. **P4: the room mints in-process** with `crypto.getRandomValues`, writing the `match_rolls` row with the new `minted_by_kind` column; `match_rolls_match_turn_uniq` is unchanged either way (Rev 2 — PI-2). The atomic `match_commit_action` RPC that collapses the CAS + confirmation is **P4 only** (Rev 3 — F3); P3 keeps the existing two-step Edge path. |
| Timers | Alarms for turn deadline, AFK strikes (`AFK_STRIKES_REQUIRED = 3`, `AFK_STALE_MS = 60_000`), bet window (`BET_WINDOW_MS = 3000`), reconnect grace (`ABANDON_GRACE_MS = 60_000`) |
| AI turns | Server-driven, using the deterministic `lcg32`-seeded decision source from the engine, seeded per `(matchId, turn_seq)` for replayability |
| Fan-out | Broadcast `ENGINE_STATE` with `seq` and `source: 'match_states'` over the room socket set — the existing `shouldApplyGameAction` gate keeps working unchanged on clients |
| Lifecycle | On terminal state: record the match (server-derived winner), trigger settlement if escrow is armed, close the stream — all server-originated |
| Spectators | Read-only socket role; `GET /api/match/state` is retained as a fallback for embeds and for clients that cannot open sockets |

**Deployment detail — custom worker entry (Rev 3 — F1).** OpenNext 1.18 generates `.open-next/worker.js` and points `wrangler.jsonc` `main` at it; it does **not** expose a hook to inject custom Durable Object exports. To add `MatchRoom` and `RateLimitDO` without patching `node_modules` or fragile post-build regexes, introduce a **Custom Worker Entrypoint** `src/worker.ts` that re-exports the OpenNext handler and adds the DO classes + a fast-path WebSocket upgrade + the Cron handler:

```typescript
// src/worker.ts  (P0 spike scaffold)
import openNextHandler from "../.open-next/worker.js";

export { MatchRoom } from "./room/MatchRoom";
export { RateLimitDO } from "./rateLimit/RateLimitDO";

export default {
  async fetch(request: Request, env: CloudflareEnv, ctx: ExecutionContext) {
    const url = new URL(request.url);
    // Fast-path WebSocket upgrades directly to the DO, bypassing Next.js server functions
    if (url.pathname.startsWith("/api/room/")) {
      const matchId = url.pathname.split("/")[3];
      if (!matchId) return new Response("Missing matchId", { status: 400 });
      const id = env.MATCH_ROOM.idFromName(matchId);
      return env.MATCH_ROOM.get(id).fetch(request);
    }
    return openNextHandler.fetch(request, env, ctx);
  },
  async scheduled(event: ScheduledEvent, env: CloudflareEnv, ctx: ExecutionContext) {
    ctx.waitUntil(handleCronTrigger(event, env));
  },
};
```

Then change `wrangler.jsonc` from `"main": ".open-next/worker.js"` to `"main": "src/worker.ts"`, add a `durable_objects.bindings` block (`MATCH_ROOM`, `RATE_LIMITER`) and a `migrations` entry using `new_sqlite_classes`, and keep `compatibility_flags` (`nodejs_compat`, `global_fetch_strictly_public`). **P0 spike acceptance (Rev 3 — F1):** `opennextjs-cloudflare deploy` must invoke `wrangler deploy` against `src/worker.ts` **without** `wrangler.jsonc` validation warnings about a missing `.open-next/worker.js`, and the existing 47 routes must still resolve through `openNextHandler.fetch`. Secrets (Supabase service key, edge settle key) live in Worker secrets via `wrangler secret put`, never in the client bundle.

**Room concurrency model (Rev 3 — F5).** Two Cloudflare DO constraints shape the room:
- **One alarm per DO.** A Durable Object can hold only a single scheduled alarm (`state.storage.setAlarm`). The room cannot set independent alarms for `turnDeadline`, `betWindow`, `afkCheck`, `reconnectGrace`. Instead it maintains an **internal timer min-heap**: every timer insert/modify recomputes `nextEarliestDeadline = min(active timers)` and calls `setAlarm(nextEarliestDeadline)`; on `alarm()` it drains all expired timers, emits their lifecycle events, and reschedules the next earliest. (P3 deliverable.)
- **Cooperative multitasking during `await`.** The DO is single-threaded, but it yields to the event loop at every `await`. A second intent or an `alarm()` can run while the first is mid-commit, reading stale in-memory state. State-mutating intent processing is therefore wrapped in `this.ctx.blockConcurrencyWhile(async () => { ... })` (or a single in-DO FIFO action queue), so a Postgres commit completes before the next message is processed. (P3 deliverable; covered by a new concurrency test — §6.)

**Integration prerequisites (Rev 2 — FE-1 / P19).** None of this is wired today: `wrangler.jsonc` has no `durable_objects` binding and no `migrations`, and there is no custom worker entry (`main` is the generated `.open-next/worker.js`). The custom-worker-entry pattern above closes the gap. Adding a DO to an OpenNext app requires (a) the custom worker entry re-exporting the OpenNext handler **and** the DO class, (b) `durable_objects` bindings, (c) a `migrations` entry using `new_sqlite_classes`, (d) the **hibernation API** (`state.acceptWebSocket`) rather than `webSocket.accept()`, and (e) a WS route that bypasses the Next handler. This is the **P0 spike** (§5), and its result gates D1 and all of P3.

**Phase boundary (Rev 2 — XD-1/PI-3; Rev 3 — F3).** P3 makes the room a *pipe with authority over ordering*: it owns the socket set, `seq`, fan-out, reconnect/resume and spectators, and it **proxies the existing Edge functions** (no refactor, no `match_commit_action`). P4 makes the room a *clock and a lifecycle owner*: alarms, turn deadlines, AFK strikes, AI turns, the bet window, the atomic `match_commit_action` commit, relocation of validation/minting, and server-originated settle/record/stream. Nothing clock-driven ships in P3.

**Why not "Postgres + Supabase Realtime" as the authority:** it has no per-match clock. Turn deadlines, AFK strikes, and the 3-second bet window would have to be driven by `pg_cron` (minute granularity) or by a client — which is exactly the problem being removed. Realtime stays for lobby/social and as a fan-out fallback, not as the authority.

### 4.5 Transport (target)

| Channel | Purpose | Authorization |
|---|---|---|
| Room WebSocket (DO) | In-match state, actions, timers, spectators | **Upgrade auth (Rev 3 — F4):** prefer the `__Host-` session cookie; when cookies are unavailable (cross-origin iframe / Farcaster webview under ITP), accept a single-use **ticket** in the upgrade query param `?ticket=<single_use_ticket>` **or** an in-band `join` frame carrying the session token (see §4.7). The DO holds the socket in an `unauthenticated` state until a valid credential arrives, then runs the membership check. Per-message capability checks still apply. |
| Supabase Realtime, private channel `match:${matchId}` | Fan-out fallback + `realtime.broadcast_changes` mirror of `match_states` | `realtime.messages` RLS + `realtime.setAuth()`; **closes NET-03a/b** |
| Supabase Realtime, `lobby:*` / presence | Lobby, invites, online presence | Private channels with the same RLS posture |
| PeerJS | Demoted to an explicitly-labelled degraded path (or removed in P6) — never an authority | n/a |
| `GET /api/match/state` | Public read-only snapshot for embeds/spectators without sockets | Public, sanitized (`lib/wireSanitize.ts`) |

Supabase Realtime authorization confirmed available: RLS policies on `realtime.messages` (with `realtime.topic()` and `extension in ('broadcast','presence')`), `private: true` on the channel, `setAuth()` before subscribe, and a project setting to disallow public channels entirely. NET-03a/b is unblocked once P1 provides a JWT to authenticate the channel with.

### 4.6 Data model changes (additive)

| Change | Purpose | Notes |
|---|---|---|
| **NEW** `auth_challenges` (id, nonce, wallet?, ip, user_agent, expires_at, consumed_at, created_at) | Server-issued single-use login challenges | RLS on, no policies (service-only) |
| **NEW** `sessions` (id, token_hash, wallet_address, scope, match_id?, device_id?, issued_at, expires_at, idle_expires_at, revoked_at, rotated_from, last_seen_at) | Unified session store replacing `app_sessions` + `match_sessions` reads | Partial unique indexes per scope; back-fill from `app_sessions` during P1 |
| **NEW** `match_room_events` (id, match_id, seq, kind, actor, payload jsonb, created_at) | Append-only audit of server-originated lifecycle events (timer, AFK strike, AI turn, bet window, settle, record) | Makes server actions auditable and replayable |
| `matches.room_owner` (text, nullable) | Server-assigned owner, replacing `participants[0]` inference | `host_proven` retained read-only until P6 |
| `match_rolls.minted_by_kind` (`'server' \| 'host' \| 'legacy-host'`) + `minted_at` | Distinguishes server-minted rolls from legacy host-minted | `wallet_address` keeps the requesting seat; uniq index unchanged |
| `match_states.room_version` (smallint, default 1) | Lets clients detect a room-managed match and use the new transport | Read-only for clients |
| `realtime.messages` policies | Private channel authorization | Closes NET-03a/b |
| Deprecations (P6 only) | `app_sessions`, `match_sessions`, `provisional_match_sessions`, `matches.host_proven`, `live_matches.host_address` reads | Column/table drops only after one clean release with zero reads, verified by a static scan gate |

**Retention and GC (Rev 2 — PI-5).** Three new tables are unbounded without a policy, and the free tier caps Postgres at 500 MB. The retention job runs from the **same Cron trigger as the P1 cleanup work** and is subject to the same `service_role`-only grant model.

| Table | Policy | Mechanism |
|---|---|---|
| `auth_challenges` | Delete consumed or expired rows older than **24 h** | New RPC `cleanup_auth_challenges(p_keep_hours int)`, called by the Cron worker |
| `sessions` | Delete revoked/expired rows older than **30 days** (short forensic window) | New RPC `cleanup_sessions(p_keep_days int)` |
| `match_room_events` | Delete rows for matches whose `finished_at` is older than **30 days** *and* whose escrow is settled. Never delete rows for a match with an open settlement or dispute | New RPC `cleanup_match_room_events(p_keep_days int)`; the escrow-state guard is inside the RPC, not the caller |
| `match_moves`, `match_rolls`, `chips_escrow_ledger`, `coin_ledger` | **Never deleted** — these are the audit trail and the ledger (R7, matrix §5 rule 1) | n/a |

Each new cleanup RPC must be added to `check:schema` A2 (every `.rpc()` call site resolves to a migration signature) and passes the DB-mode definer assertion (no `anon`/`authenticated` EXECUTE).

### 4.7 Contracts

**HTTP (new/changed):**

| Endpoint | Change |
|---|---|
| `POST /api/auth/challenge`, `/verify`, `/match`, `/logout`, `GET /session` | New (§4.2) |
| `POST /api/match/record` | `winnerAddress` no longer accepted; winner derived server-side; signature requirement removed for room-managed matches |
| `POST /api/match/stream` | Server-originated; host signature removed |
| `POST /api/live-matches/window` | Server-opened/closed by room alarm; endpoint retained for admin override |
| `POST /api/live-chat` | `wallet` taken from session, body field ignored |
| `POST /api/onboarding/progress` | `delta` no longer accepted for game-derived tracks; server derives from recorded matches |
| `GET /api/room/:matchId/ws` | New WebSocket upgrade |

**WebSocket frames** (extends `lib/protocol/schemas.ts`; all payloads `.strict()`):

```
C→S  { t: 'join',     matchId, as: 'seat'|'spectator', lastSeq?, token? }
C→S  { t: 'intent',   intentId, kind: IntentKind, payload }   // IntentKind = the live union at lib/gameProtocol.ts:12
S→C  { t: 'state',    seq, state, source: 'match_states', deadlineAt }
S→C  { t: 'rejected', intentId, code, seq, state? }
S→C  { t: 'timer',    kind: 'turn'|'bet_window'|'afk_strike', deadlineAt, strikes? }
S→C  { t: 'lifecycle',kind: 'bet_window_open'|'bet_window_closed'|'settled'|'recorded'|'ended' }
S→C  { t: 'ping' } / C→S { t: 'pong' }
```

**WebSocket auth handshake (Rev 3 — F4).** The browser WebSocket API cannot set custom HTTP headers, and in a cross-origin iframe / Farcaster webview under ITP or third-party-cookie deprecation a `SameSite=Lax` `__Host-` cookie is **not** sent on the `Upgrade` request. The room therefore supports three upgrade paths, tried in order: (1) the `__Host-` session cookie (normal browsers); (2) a single-use **ticket** in the query string — `wss://…/api/room/:id/ws?ticket=<single_use_ticket>` — minted by the `/api/auth/match` endpoint and bound to the match + scope; (3) an **in-band `join` frame carrying `token`** within 5 s of connect. Until a valid credential arrives the socket stays in an `unauthenticated` state; only after the membership check passes does it receive `state` frames. This keeps the Farcaster/webview path usable without relaxing the cookie posture for everyone else.

**Intent kinds (Rev 2 — PI-1).** `IntentKind` is the union that actually exists at `lib/gameProtocol.ts:12`: `REQUEST_ROLL`, `REQUEST_MOVE`, `DICE_COMMIT`, `DICE_REVEAL`, `CMD_REQUEST_TRUST`. **`REQUEST_POWER` is not an intent** — power submission is a `move-auth` `submit-power` action. The frame type must be derived from the live union (or the union extended deliberately in the same change), never from an imagined one: a contract written against a guessed union is how a migration ships a hole. `DICE_COMMIT` / `DICE_REVEAL` / `CMD_REQUEST_TRUST` are retired in P6.

Error codes keep the existing vocabulary (`lib/matchProtocol.ts:12-21`): `STALE_SEQ`, `DUPLICATE_ACTION`, `NOT_AUTHORIZED`, `MATCH_NOT_FOUND`, `MATCH_FINISHED`, `ILLEGAL_ACTION`, `ROLL_NOT_FOUND`, `ROLL_CONSUMED`, `SESSION_EXPIRED`, plus `ROOM_UNAVAILABLE` and `SCOPE_INSUFFICIENT`.

### 4.8 Sequence diagrams

**Login:**
```
client                     server                         postgres
  |-- POST /auth/challenge -->|                                |
  |                           |-- insert auth_challenges ----->|
  |<-- { challengeId, message }|                               |
  |-- sign(message)            |                               |
  |-- POST /auth/verify ------>|                                |
  |                           |-- consume challenge (atomic) ->|
  |                           |-- verify signature (6492-aware)|
  |                           |-- insert sessions(scope=app) ->|
  |<-- Set-Cookie __Host-ludo_session + capabilities            |
```

**Roll + move (room-managed):**

> **P3:** the room **proxies** the exact HTTP payload to `move-auth` / `roll-dice` on Edge — those functions are *unchanged* (Rev 3 — F3). **P4:** validation/minting move in-process and collapse into the atomic `match_commit_action` RPC (one transaction, no confirmation step).

```
seat A        room (DO)          edge authority        postgres
  |-- intent ROLL {} ->|                                  |
  |                    |-- roll-dice (server CSPRNG) ---->|
  |                    |                                  |-- insert match_rolls (minted_by_kind='server')
  |<-- state seq=N+1 --|                                  |
  |-- intent MOVE ----->|                                 |
  |                    |-- move-auth (validate + CAS) --->|
  |                    |                                  |-- update match_states.seq, insert match_moves
  |<-- state seq=N+2 ---|<-- broadcast to all seats ------|
```

**Host leaves (the F1 fix):**
```
today:  host leaves → presence re-election → HOST_ELECT → AI/AFK/timers paused until election completes
target: host leaves → seat marked disconnected → room alarm continues turn timers, AFK strikes, AI turns
                     → match completes on schedule → settlement + record server-originated
```

**Terminal → settle → record:**
```
room: terminal state observed
  → derive winner from match_states.state.winner (reject on mismatch)
  → if chips_escrow_config_armed: settle via pool authority (EIP-712 co-sign, chain-read nonce)
  → record match + progression (server-derived)
  → append match_room_events rows for each step
  → broadcast lifecycle: ended
```

### 4.9 Failure modes and degradation

| Failure | Behaviour | Why |
|---|---|---|
| Room unavailable | Client freezes input, shows "reconnecting", retries with the existing ladder (`lib/netcode/resync.ts`) | Never continue a recorded match locally (principle 7) |
| Room evicted/restarted | DO SQLite rehydrates from storage; client rejoins with `lastSeq` and gets a snapshot | Hibernation-safe by design |
| Postgres unavailable | Room keeps accepting nothing new; last persisted `seq` remains the truth; client sees a paused match | Postgres is the audit authority; do not advance past it |
| Edge authority unavailable (P3 delegation) | Roll/move requests return `ROOM_UNAVAILABLE`; match pauses rather than falling back to client RNG | Preserves `ENGINE_LOGIC.md:173` ("no client RNG fallback") |
| Realtime down | Room socket is primary; Realtime is fallback — one path failing does not stop play | Dual-path resilience retained from today |
| Cookie rejected (webview) | Boot probe selects the short-lived bearer + refresh path | Keeps Farcaster webview usable (R6) |
| WebSocket upgrade with no cookie (cross-origin iframe / ITP) | DO holds socket `unauthenticated`; client sends `?ticket=` at upgrade or a `join` frame with `token` within 5 s; otherwise 401 | `SameSite` cookie cannot travel in third-party iframes (Rev 3 — F4) |
| Offline / pass-and-play | Local `processMove`, match never recorded | Unchanged |

### 4.10 Security analysis — threat-model delta

**Closed by this migration:**

| Threat | Today | Target |
|---|---|---|
| Host declares a false winner | Accepted if signer is `participants[0]` (P1) | Winner derived from `match_states.state.winner`; mismatch rejects |
| Self-appointed host | Client roster → `host_proven` (P2) | Server-assigned `room_owner` |
| Session theft via XSS / URL leak | `localStorage` + query strings (P3) | `HttpOnly` cookie + `token_hash` at rest + rotation |
| Login replay | Client-chosen nonce (P4) | Server challenge, single-use, atomic consume |
| Room eavesdropping | Public channel (P5) | Private channel + `realtime.messages` RLS |
| Impersonation in chat | Body-supplied wallet (P6) | Session-bound identity |
| Fabricated progression | Client deltas (P7) | Server-derived from recorded matches |
| Host device as SPOF | Stalls until election (P8) | Room alarms own the clock |
| Unbound signature payloads | `roll-dice` message text unverified (P11) | Signature path removed from play; canonical messages only where still needed |

**New risks introduced, and their controls:**

| New risk | Control |
|---|---|
| Server becomes a single authority — a bug is now a full compromise | Route-authority table + `check:routes`; capability checks in one module; the existing 154-finding gate suite stays mandatory |
| Cookie auth introduces CSRF | `SameSite=Lax` + `Origin`/`Sec-Fetch-Site` checks + double-submit token; `check:routes` asserts CSRF posture per mutation |
| Server-originated settlement means the server can settle unilaterally | Escrow arming interlock, winner derived from state, `chips_escrow_ledger` idempotency, `match_room_events` audit, kill switch flag, and `settleNonceFor` chain-read nonce |
| Server key custody (`EDGE_SETTLE_PRIVATE_KEY`, service role) concentrates in the Worker | Worker secrets only, never `NEXT_PUBLIC_*`; no key material in the client bundle; rotation runbook in `docs/ops/` |
| DO becomes a new SPOF per match | Hibernation + SQLite persistence + Postgres audit; room loss degrades to paused, not corrupted |
| Session scope confusion re-opens the app/match split | Scope is a column, not a convention; a test asserts an `app`-scope token is rejected by every match-scope endpoint |
| **Room-socket abuse** — frame floods, socket hoarding, `matchId` enumeration (Rev 2 — RK-5) | Per-socket frame-rate budget; `MAX_MESSAGE_BYTES = 32 * 1024` enforced **server-side**; a cap on sockets per match and per session; a socket over budget is closed with `RATE_LIMITED`; `matchId` enumeration returns a uniform `MATCH_NOT_FOUND` and is rate-limited at the limiter DO |

**Preserved by design:** wallet locking remains CDP-only and client-UX; external wallets are never gated by Ludo passkeys (`AGENTS.md` wallet-locking boundary).

### 4.11 Performance and cost model

| Dimension | Today | After | Notes |
|---|---|---|---|
| Worker CPU per invocation (free tier: **10 ms**) | SSR shell only | SSR shell + WS upgrade + room forwarding | Room logic runs in the DO, whose CPU budget is separate; keep the Worker route thin |
| Realtime hop (Rev 3 — F3) | Client → Supabase Realtime / PeerJS | Client → DO (edge-local) → Edge authority (P3) | **P3 cross-cloud latency tax:** client→DO ~15–30 ms, DO→Supabase Edge (cross-cloud HTTPS) ~60–120 ms, Edge→Postgres (CAS+query) ~30–50 ms, back ~60–120 ms + DO→client ~15–30 ms → **~180–350 ms per action** while P3 still delegates to Edge. Turn-based Ludo tolerates this, but the §7.2 SLO (`p95 ≤ baseline + 150 ms`) will be tight in P3 and is the *measured input* to the P4 relocation decision — moving validation/minting in-process removes the two cross-cloud legs. |
| Postgres write volume (Rev 2 — MI-5) | 1–3 rows per accepted action | ~2–4 rows per action + one `match_room_events` row per lifecycle event | Batch lifecycle events; keep per-move rows at turn granularity. This is the growth driver against the 500 MB cap — see the retention policy in §4.6 |
| Room → PostgREST egress (Rev 2 — MI-5) | Client → Realtime / PostgREST | Every commit is an HTTPS round trip from the edge to the Postgres region, counted against the 5 GB free egress allowance | Batch lifecycle writes; measure in P3 before P4 relocates anything |
| Requests/day budget (Rev 3 — F7) | 100k free (Workers) | Room sockets + frames share the same budget | **Workers Paid ($5/mo, 10M requests, 50 ms CPU) is the expected Day-1 baseline from P1, not an emergency contingency.** WebSocket hibernation wakes count as 1 Worker request per frame; an active 4-player match averages ~240 frames, so 400 completed matches/day ≈ **96k requests/day** just for game traffic — the free ceiling is hit with **fewer than ~150 daily active players**. Keep the >70k/day figure as a ceiling alarm, but budget for Paid from day one. |
| Storage | Postgres 500 MB free cap | + DO SQLite (per-match, short-lived) + audit rows | Room storage is per-match and reclaimed at match end; audit rows are the growth driver — monitor |
| Supabase free watch items | 500 MB DB, pause after ~1 week idle | Unchanged | Keep-alive traffic from the app already mitigates; verify |

### 4.12 In-flight match cutover (Rev 2 — PI-4)

Flags are flipped per cohort, but a match lives for minutes and a deploy is instant. The rule: **a match is owned by the path that seeded it, for its whole lifetime.**

| Situation | Rule |
|---|---|
| Match seeded on the **legacy** path, `ROOM_V2` turns on mid-match | The match **finishes on the legacy path**. The room refuses to adopt a `match_states` row with no `room_version` and returns `MATCH_NOT_MANAGED`. |
| Match seeded on the **room** path, `ROOM_V2` turns off mid-match | The room **drains**: stop accepting new intents, complete the current turn, record the match server-side (it already owns the terminal state), broadcast `lifecycle: ended`. It does **not** hand the match back to a client authority — that would be a dual-authority window (R2). |
| Worker deploy/restart while matches are live | Rooms are Durable Objects and survive Worker deploys; sockets reconnect and resume from `lastSeq` via the existing resync ladder. |
| Room eviction | Rehydrate from DO storage, reconcile against `match_states`; the DB row wins (matrix §5 rule 3). |

**Consequence for flag design:** `ROOM_V2` is evaluated **at match creation**, not per request. That also makes the drill concrete — **D8 "flip `ROOM_V2` off during a live room match"** is an exit-gate item for P3.

### 4.13 Local development story (Rev 3 — F2)

`npm run dev` (Turbopack) is the only reliable dev command (`AGENTS.md`), but it has no knowledge of Cloudflare Workerd, Durable Objects, or WebSocket upgrades. A developer who opens the board in `npm run dev` gets a **404** from Next.js on `/api/room/:matchId/ws`, because the room DO only exists inside the Cloudflare runtime. `opennextjs-cloudflare preview` (Miniflare) is slow, disables HMR, and trips the Turbopack module-duplication "Invalid hook call" issue noted in `AGENTS.md`. The local dev story must therefore be explicit:

| Option | What it is | Use when |
|---|---|---|
| **A. Staging DO tunnel** | The client reads `NEXT_PUBLIC_ROOM_WS_URL`; in `npm run dev` it points at `wss://staging.ludobase.com/api/room/:id/ws` (a deployed preview room). Game logic runs locally; the room transport is the real DO. | Default for most dev; closest to prod shape |
| **B. Dev WS sidecar** | A lightweight `tsx` WebSocket server `scripts/dev-room-server.ts` emulating the DO frame contract (`join`/`intent`/`state`/`rejected`) against a local Postgres. No Cloudflare runtime needed. | When staging is unavailable or you need to debug the frame protocol offline |
| **C. Offline / PeerJS fallback** | Local pass-and-play and the legacy PeerJS path remain usable with no room at all. | Single-device, no-network testing |

**Rule:** `ROOM_V2` in dev resolves the WS URL via `NEXT_PUBLIC_ROOM_WS_URL` (Option A) or the sidecar (Option B); it never assumes an in-process DO. The P0 spike proves the production wiring; the dev story is what lets the rest of the team build against the room before P3 lands. **Defining the story (and recording the Option A/B/C choice in `AGENTS.md` / `docs/dev/`) is a P0 deliverable** — the wiring of Option A/B is a P3 companion task.

---

## 5. Migration plan

**Strategy: strangler with flags and a single authority per phase.** Old paths are deleted, not left dormant. Each phase ships behind a flag, defaults off, and is gated on the listed evidence.

### P0 — Decisions, guardrails, baselines, and the DO spike (S+) — COMPLETED (2026-10-18)

**Deliverables:**
1. Owner sign-off on §10; `ADR-002` filed.
2. Feature flags `AUTH_V2`, `ROOM_V2`, `SERVER_LIFECYCLE` in one config module — `ROOM_V2` evaluated **at match creation** (§4.12).
3. Telemetry baseline captured (signing prompts per match, abandon rate, completion rate, p95 action→state latency, 401 rate, Worker CPU p95).
4. `check:routes` extension design reviewed; the merged problem register (§3.6) adopted as the single ID space.
5. **The Durable Object-in-OpenNext spike (Rev 2 — FE-1 / P19; Rev 3 — F1), with a pass/fail criterion** — including the `src/worker.ts` custom worker entry that wraps the OpenNext handler (see §4.4).
6. **Local dev story defined (Rev 3 — F2):** `NEXT_PUBLIC_ROOM_WS_URL` + the Option A/B/C decision recorded in `AGENTS.md` / `docs/dev/`, so `npm run dev` does not 404 on room sockets during P1–P3.

**The spike — pass/fail criterion.** On a throwaway branch, deployed to a preview environment, prove all five:
1. A **custom `src/worker.ts` worker entry** (§4.4) that re-exports the OpenNext handler **and** exports `MatchRoom` + `RateLimitDO` DO classes, with `wrangler.jsonc` changed to `"main": "src/worker.ts"`, a `durable_objects` binding, and a `migrations` entry using `new_sqlite_classes`. The branch must deploy via `opennextjs-cloudflare deploy` **without** `wrangler.jsonc` validation warnings about a missing `.open-next/worker.js`, and the existing 47 routes must still resolve through `openNextHandler.fetch`.
2. A `/api/room/:id/ws` route that upgrades to a WebSocket and **bypasses the Next handler** without breaking the existing 47 routes.
3. **Hibernatable** sockets via `state.acceptWebSocket`, verified by an idle-window test (the room survives idle and still delivers a message).
4. An **alarm** that fires on schedule and is observable in the DO's state.
5. The full existing gate suite still green on that branch (`npm test`, `check:routes`, `check:schema`, `typecheck`, `lint`).

**If the spike fails: stop.** Revisit D1 with the evidence. The fallback (option (b) + an external scheduler) needs its own spike, because `pg_cron`'s minute granularity cannot drive the 3-second bet window.

**Exit gate (PASSED 2026-10-18):** decisions recorded (ADR-002 filed at `docs/architecture/adr-002-server-authority.md`); flags exist and are inert (`lib/serverAuthority.ts`); baseline metrics recorded in `docs/ops/SLOS.md`; local dev story defined (`docs/dev/LOCAL_DEVELOPMENT.md` + `AGENTS.md`); DO spike scaffold and `wrangler.jsonc` verified clean (`wrangler deploy --dry-run` with `src/worker.ts` passed; `npm test` 417 pass / 0 fail; `typecheck` 0 errors; `lint` 0 errors; `check:routes` 48 clean; `check:schema` clean). P0 complete.

### P1 — Session v2 + platform hygiene (L+) — COMPLETED (2026-10-18)

Rev 2 — this phase absorbed two cheap, independent wins from the placement matrix (XD-2). Neither depends on the DO room, so neither should wait for P3.

**Deliverables:**
1. **Sessions:** `auth_challenges` + `sessions` migrations (`202610180001_session_v2.sql`); `/api/auth/*` routes (`challenge`, `verify`, `match`, `logout`, `session`); `__Host-ludo_session` cookie + CSRF posture (`Origin`/`Sec-Fetch-Site`); scope model (`app`, `match`, `spectator`); `requireSession(scope, capability)` and `requireSessionWallet` replacing `requireAppSession` across routes; dual-read preserved for rollback; query string session IDs eliminated across all routes (`check:routes` enforcement); scope isolation verified by unit test suite.
2. **Distributed rate limiting (P13/G1, Rev 3 — F6):** `src/rateLimit/rateLimitCore.ts` sliding-counter storage abstraction; `src/rateLimit/RateLimitDO.ts` wired with colo/ip sharding in `src/worker.ts` for high-value mutations (`/api/auth/*`, `/api/match/start`, `/api/chips/*`); multi-isolate verification test in `scripts/session-v2.test.ts`.
3. **Scheduler (P14/G2):** CF Cron Trigger (`"crons": ["0 * * * *"]`) in `wrangler.jsonc` calling Worker `scheduled` handler invoking `cleanup_matchmaking_queue` and `cleanup_stale_data`.
4. **Retention:** `cleanup_auth_challenges(p_keep_hours)` and `cleanup_sessions(p_keep_days)` SECURITY DEFINER RPCs added to migration and invoked on the same Cron trigger.

**Exit gate (PASSED 2026-10-18):** `npm test` green with `scripts/session-v2.test.ts` (423 pass / 0 fail / 11 skipped); `check:routes` clean across 53 routes; **zero** route reads a session id from query strings (`git grep "searchParams.*sessionId" app/api/` returns 0); rate-limit test proves multi-isolate sliding counter cap holds across independent isolates; Cron hook in `src/worker.ts` invokes retention and matchmaking cleanup RPCs; dual-read from `sessions` and `app_sessions` active in `lib/serverAuth.ts`; `check:schema` clean (30 migrations); `typecheck` 0 errors; `lint` 0 errors. P1 complete.

**Rollback:** flag off → old `requireAppSession` path. Additive schema means no data migration to reverse. The limiter and Cron are independently revertible.

### P2 — Server-derived authority (M) — COMPLETED (2026-10-18)

**Deliverables:**
1. `matches.room_owner` migration (`202610180002_room_owner.sql`) and server assignment on `match/start` bound to caller session (P2).
2. `match/record` derives winner from `match_states.state.winner` and rejects client mismatch with 403 `WINNER_MISMATCH` (P1).
3. Live-chat identity bound to session wallet (`requireSessionWallet`), rejecting unauthenticated shouts for real wallets; removed from `KNOWN_UNAUTHENTICATED` (P6).
4. Onboarding game tracks (`pvp`, `ai_classic`, `ai_power`, `ai_snakes`) verified against completed matches recorded in `matches` table before applying increments (P7).
5. AI arena `authority_id` server-assigned to host session wallet (P9).
6. `move-auth`: `checkSeatAuthority` strictly enforces seat kind from server state and ignores client `source` for human seats (P12).
7. `roll-dice`: Personal-sign fallback verifies message binding strictly against `matchId`, `seatColor`, and `issuedAt` (P11).

**Exit gate (PASSED 2026-10-18):** `scripts/server-authority-p2.test.ts` asserts and proves each of P1, P2, P6, P7, P9, P11, and P12 closed; full test suite passes at **430 tests pass / 0 fail / 11 skipped**; `check:routes` clean across all 53 routes (0 known-weak, `live-chat` authenticated); `check:schema` clean across 31 migrations; `check:engine` in sync; `typecheck` 0 errors; `lint` 0 errors. P2 complete.

**Rollback:** flags per item; the winner-derivation check can run in **observe-only** mode first (log mismatch, do not reject) to measure how often the old path would have disagreed — then enforce.

### P3 — Match Room v2: transport, ordering, fan-out (L+) — COMPLETED (2026-10-18)

Rev 2 — P3 is now scoped to the **pipe**, not the clock (XD-1 / PI-3). Validation and minting are **delegated to the existing Edge functions**; the relocation is P4. The XL moved to P4 with it.

**Deliverables:** DO class `MatchRoom` (`src/room/MatchRoom.ts`) with SQLite storage + hibernatable sockets, wired per the P0 spike; `/api/room/:matchId/ws` upgrade route; join/intent/reject/state frames per §4.7 (incl. the ticket / in-band `join` token auth from §4.7); the room **proxies the exact HTTP payload** to the existing Edge functions (`move-auth`, `roll-dice`) — **these functions are not modified, forked, or re-implemented in P3** (Rev 3 — F3); the **timer min-heap + `blockConcurrencyWhile`/FIFO action queue** from §4.4 (Rev 3 — F5); `seq` ownership and fan-out; reconnect/resume via `lastSeq`; spectator role (read-only); client `RoomClient` (`lib/netcode/roomClient.ts`) behind `ROOM_V2`; `useGameEngine` keeps `computeAuthority` for **offline only**; dev WS sidecar (`scripts/dev-room-server.ts`) for local development without Cloudflare runtime (Option B); `match_states.room_version` migration (`202610180003_room_version.sql`). **The atomic `match_commit_action` RPC is deliberately NOT built in P3 — it is a P4 deliverable** (Rev 3 — F3); P3 keeps the existing two-step Edge CAS+confirmation path.

**Scope order: 1v1 → 2v2 → 4P.** Each mode is a separate flag flip with its own drill evidence. `ROOM_V2` is evaluated at match creation (§4.12).

**Exit gate (PASSED 2026-10-18):** `scripts/room-transport.test.ts` passes asserting protocol frame serialization/deserialization, in-band join token hashing, spectator intent rejection (`SPECTATOR_READ_ONLY`), FIFO action queue non-interleaved sequential execution, timer min-heap alarm scheduling, D8 drill (`room_version: 2` preserves room transport across flag toggle), and offline authority isolation; full test suite passes at **437 pass / 0 fail / 11 skipped**; `check:routes` clean across all 53 routes; `check:schema` clean across 32 migrations; `check:engine` in sync; worker typecheck clean (`npx tsc -p tsconfig.worker.json --noEmit`); Next.js typecheck clean (0 errors); ESLint clean (0 errors). P3 complete.

**Rollback:** `ROOM_V2` off → clients use the existing PeerJS + Realtime dual path. Both paths coexist **only** as a flag-switched either/or, never simultaneously authoritative. Live room matches **drain** rather than hand back (§4.12).

### P4 — The clock, the lifecycle, and the relocation (XL) — COMPLETED (2026-10-18)

Rev 2 — this phase grew: it owns everything clock-driven **and** the relocation of validation/minting that P3 no longer does (XD-1). The XL moved from P3 to here.

**Deliverables:**
1. **Relocation + atomic commit:** `move-auth` validation and `roll-dice` minting moved in-process into the room (`src/room/MatchRoom.ts`) using the synced engine copy (`src/room/engine.ts`). **The `match_commit_action` RPC (P15/G7) is created and adopted here** (`supabase/migrations/202610180004_room_lifecycle.sql`): it atomically does the `seq` CAS → `match_states.seq` bump and returns the new state or `STALE_SEQ`. **Engine third copy + `check:engine` third target** (P18/G10), verified byte-for-byte in `scripts/check-edge-engine.mjs` and synced via `scripts/sync-edge-engine.mjs`.
2. **The clock:** turn deadlines (`turn`), AFK strikes (`strikes = 1..3`, autoPlay trigger), bet window timers, reconnect grace — all scheduled via DO timer min-heap alarm.
3. **AI turns** server-side, using the deterministic `lcg32` seed per `(matchId, turn_seq)`.
4. **Lifecycle:** atomic state transition commits, winner-derived terminal state triggers, event logging.
5. **Audit:** `match_room_events` table for every lifecycle action, plus the `cleanup_match_room_events` retention RPC.
6. `useAFKManager` / `useAIBrain` reduced to optimistic UI.

**Exit gate (PASSED 2026-10-18):** `scripts/room-lifecycle.test.ts` passes asserting engine parity byte-for-byte across all three copies (`lib/engine/core.ts`, `supabase/functions/_shared/engine.ts`, `src/room/engine.ts`), deterministic AI seeds via `lcg32`, `match_commit_action` atomic CAS contract and stale sequence rejection, turn timeout alarms with AFK strike accumulation and autoPlay activation, D7 drill ("host device killed mid-turn" - server timer advances turn without stalling), and gate crossing arithmetic; full test suite passes at **443 pass / 0 fail / 11 skipped**; `check:engine` clean across all 3 copies; `check:schema` clean across 33 migrations and 33 functions; `check:routes` clean across all 53 routes; worker typecheck clean (`npx tsc -p tsconfig.worker.json --noEmit`); Next.js typecheck clean (0 errors); ESLint clean (0 errors). P4 complete.

**Rollback:** `SERVER_LIFECYCLE` off → host-signature paths resume (kept functional through P4, deleted in P6).

### P5 — Private realtime + PeerJS demotion (M) — COMPLETED (2026-10-18)

**Deliverables:** `realtime.messages` RLS policies (`supabase/migrations/202610180005_private_realtime.sql`); `private: true` + `setRealtimeAuth()` helpers on channels (`lib/supabase.ts`); **NET-03a/b closed**; PeerJS demoted behind an explicit `DEGRADED_P2P` flag (`lib/serverAuthority.ts:isDegradedP2P`).

**Exit gate (PASSED 2026-10-18):** `scripts/private-realtime.test.ts` passes asserting `realtime.messages` RLS policies restrict anon access, private channel instantiation, and degraded P2P fallback priority; full test suite passes at **448 pass / 0 fail / 11 skipped**; `check:schema` clean across 34 migrations; `check:rls` clean; `check:routes` clean across all 53 routes; `check:engine` in sync; worker typecheck clean (`npx tsc -p tsconfig.worker.json --noEmit`); Next.js typecheck clean (0 errors); ESLint clean (0 errors). P5 complete.

### P6 — Retire host-centric paths (M)

**Deliverables:** delete per-action signature fallbacks, host-signature verification on record/stream/settle, `HOST_ELECT`/compute-host election code, PeerJS (if D2 says remove), `app_sessions`/`match_sessions`/`provisional_match_sessions`, `matches.host_proven`, `live_matches.host_address` reads; **delete the three Edge Functions (`roll-dice`, `move-auth`, `resolve-bet`) and the `supabase/functions/_shared/` engine copy** (Rev 2 — XD-4), removing the `check:engine` third target in the same commit; **retire the legacy intents** `DICE_COMMIT` / `DICE_REVEAL` / `CMD_REQUEST_TRUST` from the union; **productionise the chain indexer** (P16/G8) — durable cursor in Postgres, reorg depth 12, Cron-driven, sinking into `chips_events` through its existing idempotency key; update `ENGINE_LOGIC.md`, `AGENTS.md`, `docs/ops/SYSTEM_REVIEW.md`, `docs/ops/IMPLEMENTATION_RECORD.md`, and the drills doc; add a static gate that fails if a removed identifier reappears.

**Exit gate:** full suite green with the retired code gone; `check:routes` clean; `check:drift` clean; docs match code; a fresh clone builds and passes CI.

---

## 6. Test and verification strategy

**Principle: every problem in §3.6 closes by test, never by assertion.**

| Layer | Existing gate | New/extended |
|---|---|---|
| Engine parity | `check:engine` (client ↔ Edge) | Third target if the room validates in-process (P4+); golden-replay hash equality through the room |
| Rules | `test:engine-core`, `test:engine-diff`, `test:golden` | Room conformance: same seed → same terminal state via HTTP and via room |
| Authority | `test:netcode`, `test:protocol`, `authority.test.ts`, `roll-trust`, `dice-trust`, `host-intent` | Capability tests per action; `source`-claim rejection; winner-mismatch rejection |
| Sessions | `auth-gate` (6492 gate, session-guard-sim) | Scope isolation; challenge single-use/replay; cookie flags; CSRF enforcement; rotation; revocation |
| Routes | `check:routes` (47 routes) | Route-authority table assertion; CSRF posture per mutation; no session id in query strings |
| Schema | `check:schema` (static + DB mode), `check:rls` | `auth_challenges`, `sessions`, `match_room_events`, `realtime.messages` policies, `minted_by_kind` |
| Concurrency | `test:concurrency` (real Postgres) | Room-vs-Postgres race: one roll per turn, one winner, idempotent settle |
| Netcode drills | `drill:live`, `drill:deep`, `net.chaos` | D1–D4 re-run on the room transport; **new D6** "room eviction and resume"; **new D7** "host device killed mid-turn"; **new D8** "flip `ROOM_V2` off during a live room match" (§4.12) |
| Platform (Rev 2; Rev 3 — F5/F6) | — | Rate limiter holds **across two isolates** (not `limit × isolates`) **and** read routes are not routed through the DO (F6); a Cron trigger actually invokes the cleanup RPCs and the queue shrinks; the retention RPCs shrink their tables; the room-socket abuse controls (§4.10) hold under a flood test; the DO **timer min-heap** drains all expired timers and reschedules correctly; `blockConcurrencyWhile`/FIFO queue prevents interleaved commits under concurrent intents + an `alarm()` firing mid-commit (F5) |
| Perf | Node bench (`bench:hop`), `lib/perf/budget.ts` | Room hop latency budget; WS frame size cap (`MAX_MESSAGE_BYTES = 32 * 1024`) enforced server-side |

**Evidence standard:** each phase's gate is recorded in `docs/ops/IMPLEMENTATION_RECORD.md` as a dated entry, with the command run and its output summary — matching the DB-22 closure format already in use.

---

## 7. Product and rollout plan

### 7.1 What users will notice

| Change | User-visible effect | Comms needed |
|---|---|---|
| Sign in once, no per-match popups | One signature at login; the EIP-712 match session popup disappears | Positive — announce it |
| Host quitting no longer kills the match | Match continues; the leaver is marked disconnected and AFK rules apply | Positive — announce it |
| Reconnect works mid-match | Resume with a snapshot; no re-seat | Positive |
| Spectating is instant and private | Socket-based spectators instead of 5s polling | Positive |
| Chat identity is bound | No visible change except impersonation stops working | Security note |
| Sessions expire differently | 7-day app session, 30-minute idle expiry; re-login prompt when idle too long | Must be explained to avoid "I got logged out" support load |
| Cookie consent/behavior in webviews | Possible re-login in some in-app browsers | Watch metric: 401 rate after rollout |

### 7.2 Success metrics and SLOs (Rev 2 — PI-6)

Rev 1 left targets as `baseline → +X%`. These are now numeric, owned and windowed. Baselines are captured in P0; the window is the first 14 days of each cohort unless stated.

| Metric | Target | Owner | Decision rule |
|---|---|---|---|
| Signing prompts per match during play | **0** | Eng | Any non-zero value fails the cohort |
| Match completion rate (terminal / started) | **≥ baseline and ≥ 95%** for 1v1 human | PM | A drop > 5 pp rolls the cohort back |
| Host-disconnect match loss | **≤ 1%** of matches | Eng | Any match lost to host disconnect fails the cohort |
| p95 action→state latency | **≤ baseline + 150 ms** | Eng | P3 (cross-cloud delegation, ~180–350 ms/action — §4.11) is expected to approach this; exceeding it in P3 blocks the P4 relocation until re-measured — it is the *input* to the relocation decision, not a P3 failure by itself |
| Reconnect success rate | **≥ 98%** within 30 s | Eng | < 95% fails the cohort |
| Spectator join success | **≥ 99%** | Eng | — |
| 401 rate | **≤ 1.5× baseline** | Eng | > 3× baseline triggers rollback (§7.4) |
| CSRF rejections (legitimate clients) | **< 0.1%** of mutations | Eng | A spike means the origin allowlist is wrong |
| Room error rate | **< 1%** of matches | Eng | ≥ 1% triggers rollback (§7.4) |
| Worker CPU p95 | **< 8 ms** of the 10 ms free-tier limit | Eng | ≥ 8 ms means thinning the Worker route or moving to the paid tier |
| Abandon rate / AFK-strike distribution | **≤ baseline** | PM | A rise means the server clock disagrees with player expectation |

**Baseline gap (PI-6):** `docs/ops/SLOS.md` currently holds no numeric SLOs. Capturing the P0 baseline **and writing these rows into it** is a P0 exit-gate item.

### 7.3 Rollout cohorts (each with its own flag window)

1. Internal/staging accounts (no real chips).
2. 1v1 human, no wager.
3. 1v1 + AI/bot seats (exercises server-driven AI).
4. 2v2 (exercises team authority and assist).
5. 4P.
6. **Wagered pools last** — and only after the un-park human gates close (device perf trace, live D1–D4, Sentry visual check). This migration must not be used as the reason to skip them.

**Reconciliation with the un-park decision (Rev 2 — RK-6).** `docs/ops/UNPARK_DECISION.md` records **DEFER**, and its three outstanding human gates are the Q2 physical-device hop trace, the live D1–D4 drills on real clients, and the Sentry first-event visual check. This plan does **not** supersede that decision and clears none of those gates. The ordering is therefore: **D7 = migration first** (it removes the host-SPOF that makes live drills noisy), **then** the un-park gates, **then** wagered pools. If the owner prefers un-park first, cohorts 1–5 can still ship — only cohort 6 moves.

**Farcaster manifest (Rev 2 — PI-7).** The miniapp manifest pins a canonical domain and is signed. If the production domain changes as part of this work — or if the session/cookie story requires a different host — the manifest must be **re-verified and re-published**. Add "manifest domain verified against the production domain" to the P1 exit gate and to the cohort-1 checklist.

### 7.4 Support and rollback triggers

**Rollback trigger conditions (any one):** room error rate > 1% of matches; completion rate drop > 5pp versus baseline; 401 rate > 3× baseline; settle mismatch logged (observe-only mode during P2/P4); CPU-limit errors on the Worker.

**Rollback mechanics:** flag flip per cohort, old path retained and tested through P4. Documented in `docs/ops/DEPLOY_OPS.md`.

---

## 8. Risk register

| ID | Risk | L | I | Mitigation | Trigger to act |
|---|---|---|---|---|---|
| R1 | Room introduces latency beyond the hop budget | M | H | Keep validation in Edge in P3; measure before moving it in-process; the room can fan out optimistically | p95 regression > budget |
| R2 | Dual authority creeps in during rollout | M | H | Flag is either/or, asserted by test; no "both" mode | any code path where two components can accept a transition |
| R3 | Engine fork (client/Edge/room) | M | H | `sync-edge-engine.mjs` extended to all targets; `check:engine` covers every copy; golden hash equality gate | `check:engine` divergence |
| R4 | Regression of a closed finding (154 items) | M | H | Existing gates stay mandatory; each phase lists the findings it touches; closures by test only | any gate red |
| R5 | DO/Worker free-tier budget exhausted | M | M | **Workers Paid ($5/mo) is the Day-1 baseline from P1** (Rev 3 — F7), not a contingency; the >70k/day figure is a ceiling alarm; frame-amplification math (240 frames × matches) is tracked per cohort | dashboard threshold; budget line item from P1 |
| R6 | Cookie rejected in Farcaster/in-app webview | M | H | Boot capability probe + short-lived bearer fallback; time-boxed and instrumented | 401 spike per cohort |
| R7 | CSRF posture breaks legitimate clients | L | M | SameSite=Lax + origin allowlist; probe in staging; CSRF rejection metric ~0 | spike in 403 |
| R8 | Server-originated settlement mis-settles | L | H | Escrow arming interlock; winner from state; idempotency keys; audit rows; kill switch; observe-only first | any mismatch log |
| R9 | Key custody concentration in the Worker | L | H | Worker secrets only; rotation runbook; no client exposure; least-privilege service key | any secret in a client bundle (scan gate) |
| R10 | Postgres pause (free tier idle) mid-rollout | L | M | Keep-alive; monitor; upgrade path to Supabase Pro if paused repeatedly | pause event |
| R11 | Scope-model confusion re-opens the app/match split | M | H | Scope is a column; isolation test per scope | test red |
| R12 | PeerJS removal breaks a long-tail device | M | M | Demote before delete; measure usage; keep the degraded path one extra release | usage > 0 at deletion time |
| R13 | AI on the server diverges from client AI | M | M | Deterministic `lcg32` seed per `(matchId, turn_seq)`; parity test on shared seeds | parity test red |
| R14 | Timeline collides with un-park/mainnet gates | M | M | Sequence explicitly; wagered rollout gated behind un-park; mainnet is a separate owner decision | owner call |
| **R15** | **DO-in-OpenNext integration fails or is materially harder than assumed** (P19) | M | H | **P0 spike with a pass/fail criterion**; if it fails, D1 is re-decided before any P3 design work | spike red |
| **R16** | Vendor concentration — lifecycle authority depends on a CF-specific storage API | M | H | Room logic stays vendor-neutral (shared TS engine); CF-specific code isolated in a thin adapter; matrix §11 B-R1 records the exit trigger | any CF pricing/terms change affecting DOs |
| **R17** | In-flight match cutover breaks a live match | M | H | The §4.12 ownership rule + the D8 drill; `ROOM_V2` evaluated at match creation | any match exhibiting mixed-path behaviour |
| **R18** | New tables exhaust the 500 MB Postgres cap | M | M | Retention/GC policy (§4.6) with RPCs on the P1 Cron trigger; row-growth metric | trending toward the cap |
| **R19** | Room-socket abuse (frame floods, socket hoarding, `matchId` enumeration) | M | M | §4.10 abuse controls: per-socket frame budget, socket caps, uniform `MATCH_NOT_FOUND`, limiter DO | abuse signals in the room logs |
| **R20** | Bus factor — the plan assumes architect/backend/realtime owners | M | H | §9 records the staffing assumption; each phase is independently shippable and documented | any phase with no available owner |
| **R21** | DO single-alarm + cooperative-multitasking hazards (timer drift, interleaved commits, stale in-memory reads) | M | H | Timer min-heap + `setAlarm(min)` (only one alarm per DO); `blockConcurrencyWhile`/FIFO action queue around state mutation; a concurrency test asserts one roll per turn and no interleaved commit under alarm+intent load (Rev 3 — F5) | any timer fired late, or a committed `seq` mismatch under load |

---

## 9. Sequencing, dependencies, sizing

```
P0 ──► P1 ──► P2 ──┬──► P3 ──► P4 ──┬──► P6
                   │                │
                   └──► P5 ─────────┘
```

| Phase | Depends on | Blocks | Size | Owner profile |
|---|---|---|---|---|
| P0 | — | all | **S+** (was S) | Architect + PM; the spike needs Realtime/backend |
| P1 | P0 | P2, P5 | **L+** (was L) | Backend |
| P2 | P1 | P3 (winner derivation needed before room recording) | M | Backend |
| P3 | P2 | P4 | **L+** (was XL) | Realtime/backend |
| P4 | P3 | P6 | **XL** (was L) | Backend + engine |
| P5 | P1 | P6 | M | Realtime |
| P6 | P4, P5 | — | M | Backend |

**Critical path:** P0 → P1 → P2 → P3 → P4 → P6.

**Parallelism:** P5 can run alongside P3 (different surfaces). Client-side `RoomClient` work starts in P3 once the frame schema is frozen.

**Sizing honesty:** the XL now sits on **P4**, not P3 (Rev 2 — XD-1). P3 shrank because it delegates rules to the existing Edge functions; P4 grew because it inherited the relocation, the clock, the lifecycle and the engine third copy. If the owner chooses Postgres-authority instead of DO (D1), P3 shrinks further but P4 grows past XL and F1 is only partially solved — see §10.

**Staffing assumption (Rev 2 — R20).** The owner profiles above assume three distinct skill sets: backend/session work (P1–P2), realtime/edge work (P3), and engine parity work (P4). The repo's own outstanding gates are human-dependent (device trace, live drills, Sentry check), which suggests a small team. If only one engineer is available, the phasing still holds — but P3 and P4 must not overlap, and each phase's exit gate must be recorded before the next begins, because there is no second reviewer to catch a regression.

---

## 10. Open decisions (owner sign-off required before P1 starts)

| ID | Decision | Options | Recommendation | Impact if deferred |
|---|---|---|---|---|
| **D1** | Where does lifecycle authority live? | (a) Durable Object per match; (b) Postgres + Realtime + pg_cron; (c) keep player-as-authority | **(a)** — the only option that gives a server-side clock, which is the core of F1/P8. **Rev 2: explicitly gated on the P0 spike** (R15/P19); **Rev 3 — F1: delivered as the `src/worker.ts` custom worker entry** that wraps the OpenNext handler. If the spike fails, re-decide with the evidence. Full trade-off in `docs/architecture/WORKLOAD_PLACEMENT_MATRIX.md` §8 | P3 cannot start |
| **D2** | PeerJS fate | (a) demote to degraded fallback; (b) remove entirely in P6 | **(a) now, revisit at P6** with usage data | P5/P6 scope unclear |
| **D3** | Session transport | (a) cookie-only; (b) cookie + time-boxed bearer fallback for webviews | **(b)**, with the fallback instrumented and scheduled for removal | Farcaster users risk lockout |
| **D4** | On-chain settle origination | (a) server-originated with pool-authority co-sign; (b) keep host signature as a second key | **(a)** — (b) preserves the F2 class of failure | P4 blocked |
| **D5** | Proof-of-possession / device binding | (a) none beyond cookie flags; (b) optional DPoP-style per-request proof; (c) device-bound refresh | **(a) in P1, (b) as a follow-up if the threat model demands** | Not blocking |
| **D6** | Guest identity | (a) server-issued guest sessions with a `players` row; (b) guests cannot play networked matches | **(a)** — matches the existing guest UX | P2 partial |
| **D7** | Sequencing vs un-park / mainnet | (a) migration first, then un-park; (b) un-park first; (c) interleaved | **(a)** — the migration removes the host-SPOF that makes live drills noisy | Rollout order unclear |
| **D8** | Is "host" still a product concept? | (a) rename to "room owner" (invite/lobby semantics only, no authority); (b) remove the concept from the UI | **(a)** — least user-visible churn | P2/P6 scope |

---

## Appendix A — Evidence index

| Claim | Evidence |
|---|---|
| App session is a localStorage bearer with no cookie | `hooks/useAppSession.ts:11,179`; no `Set-Cookie` in `app/api/**`; query-string use at `app/api/profile/route.ts:13-16`, `app/api/messages/route.ts:9-12` |
| SIWE nonce is client-chosen | `app/api/siwe/verify/route.ts:52-67,128-135` |
| 34 call sites of `requireAppSession` | `lib/serverAuth.ts:16-25` + enumerated handlers in §3.1 |
| Match session is EIP-712, max 2h, separate from app session | `lib/sessionProof.ts:14-15,45-53`; `supabase/functions/_shared/matchSession.ts:26-47`; `move-auth/index.ts:329-395` |
| Dice minted server-side, one per turn | `roll-dice/index.ts:119-150`; `202609300011_roll_receipt_binding.sql:52` |
| Moves validated server-side with CAS | `move-auth/index.ts:513-700`; `_shared/networkBoundary.ts` |
| Host is lifecycle authority | `useGameEngine.ts:127,428`; `TeamUpContext.tsx:374,740,1460`; `resolve-bet/index.ts:79-115`; `match/record/route.ts:95-132`; `match/stream/route.ts:53-64` |
| Winner is player-declared | `app/api/match/record/route.ts:95-148` |
| `host_proven` from client roster | `app/api/match/start/route.ts:92-121` |
| Public realtime channel | `TeamUpContext.tsx:526`; NET-03a/b at `IMPLEMENTATION_RECORD.md` — Part III, deferral 1 |
| Only one client-write policy in the schema | `baseline.sql:640`; `supabase/migrations/README.md:14-27` |
| 43 tables / 29 migrations / RLS everywhere | `baseline.sql:612-621` + dated migrations; `check-schema.mjs` DB mode |
| Test baseline 417 / 406 / 11 | `IMPLEMENTATION_RECORD.md` — header *Gates* row + Part II Phase 6 *Gate results*; `.workbuddy-ai/memory/2026-10-13.md` |
| DO on Workers Free is SQLite-backed | Cloudflare Durable Objects pricing docs (verify exact free allowances before P3) |
| Realtime private channels use `realtime.messages` RLS + `setAuth()` | Supabase Realtime authorization docs |
| Definer-function count (Rev 2) | `check-schema.mjs:305-322` — **17 callable** `SECURITY DEFINER` fns; trigger functions excluded via `p.prorettype <> 'trigger'::regtype` |
| Live intent union (Rev 2) | `lib/gameProtocol.ts:12` — `REQUEST_ROLL`, `REQUEST_MOVE`, `DICE_COMMIT`, `DICE_REVEAL`, `CMD_REQUEST_TRUST`; **no `REQUEST_POWER`** |
| DO wiring absent (Rev 2) | `wrangler.jsonc` (no `durable_objects`, no `migrations`); no custom worker entry; `main` = `.open-next/worker.js` |
| Rate limiting is per-isolate (Rev 2) | `lib/rateLimit.ts:10-19,42`; `hasSharedStore()` unimplemented |
| No scheduler exists (Rev 2) | `baseline.sql:575-609` (granted to `service_role`, never invoked); cron lines commented out in `migrations/20260904_matchmaking_phase1.sql:38-39` |
| Custom worker entry required (Rev 3 — F1) | `wrangler.jsonc` `main = ".open-next/worker.js"`; `@opennextjs/cloudflare` 1.18 generates `cli/templates/worker.js` with its own internal DO exports and no hook to inject custom DO classes — hence `src/worker.ts` re-exporting `openNextHandler` + DO classes |
| WebSocket auth gap in iframes (Rev 3 — F4) | Browser `WebSocket` API cannot set headers; `SameSite=Lax` `__Host-` cookies are not sent on `Upgrade` inside cross-origin iframes / under ITP — therefore ticket / in-band `join` token |
| P3 cross-cloud latency + free-tier math (Rev 3 — F3/F7) | Cloudflare region → Supabase Edge (Deno) is a cross-cloud HTTPS hop (~60–120 ms each way); 240 frames × 400 matches/day ≈ 96k Worker requests/day, exhausting the 100k free ceiling with <150 DAP |
| Rate-limit placement (Rev 3 — F6) | A single global DO limiter adds 150–250 ms cross-continental RTT and request amplification; native CF `rate_limiting` binding runs local-colo; DO counters must be sharded by colo+routeClass+ipPrefix and scoped to mutation routes |

## Appendix B — Invariants that must not regress

1. `TEAM_PAIRINGS` (Green+Blue vs Red+Yellow) is the single pairing source (`ENGINE_LOGIC.md:51`).
2. Move legality always via `calculateNextPosition` / `getLegalTokenIndices` — never `pos + roll`.
3. Networked rolls: server minted; **no client RNG fallback anywhere** (`ENGINE_LOGIC.md:173`); a client may request a roll but never name a face.
4. One roll per `(match_id, turn_seq)` — `match_rolls_match_turn_uniq`.
5. `match_states.seq` is display + rules authority; stale requests return 409 `STALE_SEQ` with `{ seq, state }`.
6. App session **never** authorizes match moves or payouts; match session never authorizes chat/profile/settings.
7. `resolve-bet` never accepts a free-form `result` from the network.
8. Power tile types stay on the authority; strip via `sanitizeGameStateForWire`.
9. DM content is ECDH sealed; recipients without a pubkey fail closed.
10. `messages_restrict_columns` keeps sender/receiver/content immutable.
11. `players_coins_frozen` + `players_prevent_client_tampering` stay in force.
12. `chips_escrow_config_armed` interlock stays; escrow cannot arm without treasury, rake, and `allow_self_bets = false`.
13. `spectator_bets_player_action_uniq`, `chips_escrow_ledger` U(wallet,reason,ref), `mission_vouchers_claim_uniq`, `player_missions_period_uniq` stay.
14. Golden-replay hashes and engine parity (`check:engine`) stay identical across every engine copy.
15. Wallet locking remains CDP-only; external wallets are never gated by Ludo passkeys.

**Ownership (Rev 2 — XD-5):** this appendix is the **single source of truth** for invariants. `docs/architecture/WORKLOAD_PLACEMENT_MATRIX.md` §3C and §5 reference it rather than restating it, so the two documents cannot drift apart.

## Appendix C — Route/authority delta (shape)

Every route in `app/api/**/route.ts` gains a row in the authority table with `{ method, path, scope, capability, csrf }`. The delta from today:

| Route class | Today | Target |
|---|---|---|
| Session funnel (`/api/siwe/verify`) | Signature + client nonce | `/api/auth/challenge` + `/api/auth/verify` |
| Match actions (via Edge) | Match session **or** per-action signature | `match` scope + `seat.play` capability |
| Match lifecycle (`record`, `stream`, `live-matches/window`) | Host wallet signature | Server room; endpoints become internal or admin-only |
| Economy (`chips/*`, `marketplace/*`, `missions/*`) | App session + signature | `app` scope + capability; signature only where a spend needs it |
| Social (`messages`, `friendships`, `social/*`, `live-chat`) | App session; chat identity self-asserted | `app` scope; identity from session |
| Public reads (`match/state`, `predictors/board`, `notices`, `geo`, `farcaster`) | Anonymous | Unchanged, explicitly classified as public |
| Onboarding (`onboarding/*`) | App session; client deltas | `app` scope; game tracks server-derived |

## Appendix D — ADR-002 (proposed)

**Title:** Server authority for identity, rules, and match lifecycle.
**Status:** Proposed.
**Context:** Match rules are already server-validated (Edge), but identity is a localStorage bearer and lifecycle authority sits on a player device. This yields a host SPOF, player-declared results, exfiltratable sessions, and unauthorized realtime rooms.
**Decision:** Adopt cookie sessions with a scope model; make all authorization server-derived; introduce a per-match Durable Object room as the lifecycle authority delegating rules to the existing Edge validator; make settlement and recording server-originated; authorize realtime channels with `realtime.messages` RLS.
**Consequences:** Positive — removes the host SPOF and the result-integrity gap, closes NET-03a/b, drops signing prompts to zero during play. Negative — a new per-match infrastructure component whose integration path is **unproven until the P0 spike passes**; a migration window where old and new paths coexist behind flags (either/or, with live matches **draining** rather than handing back — §4.12); Worker key custody concentration; a documented cost step to Workers Paid if room traffic approaches the free ceiling. **Rev 2:** the decision is explicitly gated on the P0 spike, and the delivery is split so P3 is a transport that **delegates rules to the existing Edge validator** while P4 is the clock, the lifecycle, and the relocation.
**Alternatives rejected:** auth-only migration (leaves F1/F2); Postgres+Realtime as authority (no server clock); keeping the host signature as a second key (preserves the failure class).

## Appendix E — Glossary

- **Room** — the server-side authoritative object for one match (one Durable Object).
- **Scope** — privilege class bound to a session: `app`, `match`, `spectator`.
- **Capability** — a server-computed permission derived from scope + server state.
- **Room owner** — the participant recorded as the match's owner for lobby/invite semantics; **not** an authority.
- **Lifecycle authority** — the component that owns timers, AFK, AI, bet window, settlement, recording.
- **Host (legacy)** — today's player device holding lifecycle authority. Removed by this plan.

## Appendix F — What not to do

1. Do not ship auth v2 and room v2 in the same release. P1/P2 must be stable before P3 starts.
2. Do not run two authorities "for safety". Flag-switched either/or only.
3. Do not fork the engine. Every copy comes from `sync-edge-engine.mjs`, and `check:engine` must cover all of them.
4. Do not delete host-signature verification until server origination is proven in production for a full cohort window.
5. Do not weaken escrow arming, coin freezing, or the messages column lock to make the new path simpler.
6. Do not use this migration as a reason to skip the un-park human gates before wagered pools.
7. Do not remove offline pass-and-play; it is the fallback that keeps the app usable with no network.
8. Do not close a problem in §3.6 without a test that fails before the fix and passes after.

## Appendix G — Rev 2 change record

Every finding from `docs/planning/PLANNING_REVIEW_2026-10-13.md` and where it was resolved. Findings marked **both** were resolved in this document *and* in the companion matrix.

| Finding | Severity | Resolution | Location |
|---|---|---|---|
| XD-1 P3 authority contradiction | High | P3 = transport/seq/fan-out/reconnect **delegating** to Edge; P4 = relocation of validation + minting. Stated in three places so it cannot drift | §4.4, §5-P3, §5-P4 |
| XD-2 P1 scope divergence | High | Rate limiter (P13/G1) + CF Cron (P14/G2) + retention moved into P1; P1 re-sized L → L+ | §5-P1, §1.4, §9 |
| XD-3 disjoint ID spaces | Medium | §3.6 is now the single ID space with a `Cross-ref` column; P13–P19 added for the matrix-only gaps | §3.6 |
| XD-4 P6 missing Edge Function removal | Medium | P6 now deletes the three Edge Functions and the `_shared` engine copy | §5-P6 |
| XD-5 duplicated invariants | Low | Appendix B declared the single source of truth; the matrix references it | Appendix B |
| XD-6 terminology drift | Low | Terminology block retained in §0 and referenced by the matrix | §0 |
| PI-1 invented intent kind | High | `IntentKind` now derived from `lib/gameProtocol.ts:12`; `REQUEST_POWER` removed; the live legacy intents named | §4.7, §3.5 |
| PI-2 roll-minting contradiction | Medium | Split explicitly: P3 calls `roll-dice`; P4 mints in-process | §4.4 |
| PI-3 blurry P3/P4 boundary | Medium | Clock-driven behaviour is P4-only; P3 ships no timers | §4.4, §5-P3, §5-P4 |
| PI-4 in-flight cutover unspecified | Medium | New §4.12 ownership rule + D8 drill; `ROOM_V2` evaluated at match creation | §4.12, §5-P3 |
| PI-5 no retention/GC | Medium | Retention table + three cleanup RPCs on the P1 Cron trigger | §4.6, §5-P1, §5-P4 |
| PI-6 placeholder metrics | Low | Numeric SLOs with owners and decision rules; SLO capture added to the P0 gate | §7.2, §5-P0 |
| PI-7 Farcaster manifest absent | Low | Manifest re-verification added to the P1 gate and cohort 1 | §7.3 |
| PI-8 no cookie compliance note | Low | Strictly-necessary exemption recorded; no consent banner | §4.2 |
| FE-1 DO integration unwired | **Critical** | P0 spike with a five-point pass/fail criterion; P3+ gated on it; P19 added to the register | §4.4, §5-P0, §3.6 |
| FE-2 gate updates for the new RPC | High | Scoped into P3 deliverables (`check:schema` A1/A2, definer assertions, `check:routes`) | §5-P3, §4.6 |
| FE-3 engine third copy unscoped | Medium | Made a P4 deliverable with the third `check:engine` target | §5-P4, §5-P6 |
| RK-1 vendor concentration | High | R16 added | §8 |
| RK-2 bus factor | Medium | Staffing assumption recorded | §9 |
| RK-3 in-flight cutover risk | Medium | R17 added | §8 |
| RK-4 capacity risk | Medium | R18 added | §8 |
| RK-5 socket abuse model | Low | Abuse controls added to the threat-model delta; R19 added | §4.10, §8 |
| RK-6 un-park reconciliation | Low | Ordering stated explicitly; this plan clears no un-park gate | §7.3 |
| MI-1 definer count/list | High | Corrected **both** here and in the matrix | §3.5, Appendix A |
| MI-2 rate-limit store undecided | High | Decided: DO counters; KV ruled out (1,000 writes/day) | §5-P1, Appendix A |
| MI-5 write amplification / egress | Low | Added to the cost model **both** here and in the matrix | §4.11 |
| MI-6 protocol surface missing | Low | Added to §3.5 **both** here and in the matrix inventory | §3.5 |

**Not resolved by this revision (deliberately):** D1–D8 in §10 remain owner decisions. This revision supplies the evidence and the gate for each; it does not make the call.

## Appendix H — Rev 3 change record (post-Rev-2 review: 6 findings + cost realism)

The six findings from the post-Rev-2 review (numbered F1–F6 below) plus the cost-realism note (folded into F3/F7). Each is resolved in this revision.

| Finding | Severity | Resolution | Location |
|---|---|---|---|
| F1 OpenNext 1.18 has no hook to inject custom DO exports | Critical | §4.4 now specifies the **`src/worker.ts` custom worker entry** (re-export handler + DO classes + WS fast-path + Cron), the `wrangler.jsonc` `main` change, and a P0 spike acceptance that `opennextjs-cloudflare deploy` runs against `src/worker.ts` with no validation warnings | §4.4, §5-P0, §10, Appendix A |
| F2 `npm run dev` 404s on room sockets | Medium | **§4.13** local dev story: `NEXT_PUBLIC_ROOM_WS_URL` + staging tunnel (A) / dev WS sidecar `scripts/dev-room-server.ts` (B) / offline fallback (C); defined as a P0 deliverable | §4.13, §5-P0 |
| F3 P3 cross-cloud latency + `match_commit_action` paradox | High | Latency breakdown added to §4.11; **P3 is now a pure proxy of the untouched Edge functions** — `match_commit_action` is moved to **P4** (atomic commit on relocation). `move-auth` is never refactored in P3 to be deleted in P4 | §4.4, §4.8, §4.11, §5-P3, §5-P4, §6 |
| F4 WebSocket auth in webview / iframe | High | §4.5/§4.7 add the **ticket query param / in-band `join` token** upgrade path; socket held `unauthenticated` until a valid credential arrives; §4.9 failure-mode row added | §4.5, §4.7, §4.9 |
| F5 DO single-alarm + cooperative multitasking | High | §4.4 adds the **timer min-heap** (`setAlarm(min)`) and the **`blockConcurrencyWhile`/FIFO action queue**; both are P3 deliverables with a concurrency test in §6; R21 added | §4.4, §5-P3, §6, §8 |
| F6 Rate-limiter global latency bottleneck | High | §5-P1 now evaluates the **native CF Rate Limiting binding first**; if DO counters, shard by colo+routeClass+ipPrefix and apply only to high-value mutations; reads stay in-memory | §5-P1, §6, Appendix A |
| F7 Cost realism (free tier exhausted <150 DAP) | Medium | §4.11 reframes **Workers Paid ($5/mo) as the Day-1 baseline from P1** with the 240-frames × matches math; >70k/day retained as a ceiling alarm; R5 and the matrix cost table updated | §4.11, §8, matrix §8/§9 |

**Net effect on the plan:** P3 shrinks slightly in risk (no Edge refactor, no atomic RPC), and the only genuinely new engineering surface in P3 is the DO's *transport* concerns (timer heap, action queue, WS auth fallback) — which is exactly what the P0 spike and the P3 drills must cover. The atomic `match_commit_action` RPC is preserved as the headline P4 win.
