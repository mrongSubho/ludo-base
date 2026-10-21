# AGENTS.md

Ludo Base — a Next.js 16 (App Router) on-chain Ludo game (Farcaster-ready, wagmi/OnchainKit, Supabase, PeerJS). Single-page app: dashboard lobby ↔ game board ↔ spectating are all states of `app/page.tsx`.

## Commands

- `npm run dev` — dev server (Turbopack) at `http://localhost:3000`. This is the only reliable dev command. (Note: match room WebSockets in dev use `NEXT_PUBLIC_ROOM_WS_URL` to point to a staging tunnel or dev sidecar; see `docs/dev/LOCAL_DEVELOPMENT.md`).
- `npm run build` && `npm start` — production, built with **webpack** (`next build --webpack`), deliberately not Turbopack: Turbopack's unbundled output duplicated modules across chunks (142 of 278 module ids in >1 chunk) and cost **~20% more gzip on the critical path** than webpack's consolidated vendor chunks (1.00 MB → 0.80 MB, 32 → 21 requests). It also activates the `webpack:` block in `next.config.ts` (the `pino-pretty`/`lokijs`/async-storage fallbacks), which Turbopack ignores. Keep dev on Turbopack for HMR. TypeScript errors **fail the build** (`ignoreBuildErrors: false`).
- `npm run lint` — **ESLint 9** (`eslint.config.mjs`). Rules for unused-vars / prefer-const / no-explicit-any are `error`; a few legacy modules keep file-level disables. Do not reintroduce `next lint`.
- `npm run visual:baseline` / `npm run visual:diff` — the Phase 0 visual gate (`scripts/visual-diff.mjs`, 8 scenes = setup/lobby/offline-panel/board × Retro/Daybreak). Run it against a **production build** (`npm run build && npm start`), not the dev server: the board scene trips Turbopack's known module duplication ("Invalid hook call"), so those scenes skip in dev. `visual:baseline` writes `tests/visual/baselines/*.png` (committed); `visual:diff` fails on >0.2% pixel change and drops `diff` + `current` PNGs in `tests/visual/diffs/` (gitignored). Required before any layout-shifting change — reset layering, the `globals.css` split, fluid board sizing, container queries, type migration.
- `npm test` — engine + foundation + netcode + MP harness tests via `npx tsx --test` (2v2 teams, gate-crossing legality, three sixes, capture, properties, chaos). Run this after any `lib/gameLogic` / `lib/boardLayout` / `lib/constants` change.
- `npx tsc -p tsconfig.json --noEmit` — **must be 0 errors**. Deno edge functions excluded (`supabase/functions` in tsconfig). Do not reintroduce broad `any` on the game surface without a burn-down.
- **CI** (`.github/workflows/ci.yml`): `engine-tests` (incl. the RLS static gate, the schema gate, the route-auth matrix, the motion gate, and the image-dimensions gate) + `typecheck` + `lint` + `auth-gate`. Keep gated files clean.
- Smoke / netcode drills: `docs/ops/NETCODE_DRILLS.md` (invite secret, hybrid fill, matchmaking, Edge RNG, dual-path intents, ECDH DMs, D1–D4). Un-park evidence: `docs/ops/UNPARK_CHECKLIST.md`.

## Environment

- `.env.local` and `.env` are required but gitignored. Holds: Supabase URL/anon key, `NEYNAR_API_KEY`, `NEXT_PUBLIC_EDGE_SERVER_URL`, `NEXT_PUBLIC_WC_PROJECT_ID`. Never hardcode/commit keys.
- Supabase project ref (from URL): use `NEXT_PUBLIC_SUPABASE_URL`. Deploy edge functions with `supabase functions deploy <name> --project-ref <ref>`. Apply SQL via Dashboard SQL Editor or Management API (`db push` can fail on `cli_login_postgres` role).

## Directory map (non-obvious parts)

- `hooks/` — game engine & data: `useGameEngine.ts`, `useTeamUp.ts` (+ `TeamUpContext.tsx`, `GameDataContext.tsx`), `useMatchmaking.ts`, `useProvablyFairDice.ts`, `useSpectatorSync.ts`, `useGameTimer.ts`, etc. **`app/hooks/` is different — only audio hooks (`useAudio.ts`, `useSoundEffects.ts`).**
- `lib/` — engine logic and shared code: `gameLogic.ts`, `boardLayout.ts`, `aiEngine.ts`, `snakesLogic.ts`, `constants.ts` (`TEAM_PAIRINGS` / `TEAM_ID`, `AI_SCORES`, difficulty tiers), `encryption.ts` (ECDH sealed boxes), `matchProof.ts` (canonical signed payloads), `matchRecorder.ts`, `progression.ts`, `supabase.ts`.
- `lib/types.ts` — `GameState` is the authoritative game state type (includes `activeBoost`, `powerTiles`, `BoardPlayer`, `ColorCorner`). Prefer `GameState` / `GameStateSetter` over `any` in game hooks.
- `app/components/` — all UI. New component files: `PascalCase.tsx`; hooks/utilities: `camelCase`. Canvas motion from `thinking-orbs` goes through `app/components/ThinkingOrb.tsx` — never import the package directly: the wrapper pins `theme` (the package's `auto` cannot see our `body.theme-*` classes) and gates `paused` on `lib/motion.ts` (the reduce-motion gate cannot see canvas).
- `src/room/` — **MatchRoom Durable Object** (`MatchRoom.ts`, `engine.ts`): Single authoritative execution context for networked matches, turns, dice RNG, and atomic commits (`match_commit_action`). (Deno edge functions `roll-dice`, `move-auth`, `resolve-bet` were retired in P6).
 - **Migrations:** new SQL goes in `supabase/migrations/` (canonical). Root `migrations/` and `supabase/migrations_archive/` are **frozen archives** (ARCHIVED header on every file, gated by `scripts/archive-guard.test.ts`) — never add new ones there. Apply canonical SQL via `supabase db push` (CLI) or the Dashboard SQL Editor.
- `.agent/` — third-party Antigravity Kit; `.agents/` — third-party installable skills (reproducible via `npx skills add` + `skills-lock.json`); `.commandcode/` — agent tool scaffold. All gitignored; ignore for app work.

## Security & trust model (do not regress)

These landed in commits `565ede5` / `e3cbadf` / server authority migration:

1. **2v2 teams are one source of truth:** `TEAM_PAIRINGS` in `lib/constants.ts` — **Green+Blue vs Red+Yellow**. Seating (`assignCorners2v2`), `getTeammateColor`, `getTeam`, lobby order (`LOBBY_COLORS['2v2']`, derived not hardcoded), trap truce, assist, capture, and win checks must all use it. Never fork a second pairing.
2. **Move legality uses engine math:** always `calculateNextPosition` / `getLegalTokenIndices`. Never `pos + roll` (breaks gate crossing into home stretch 52–57).
3. **Networked rolls & moves (server room authority):** MatchRoom Durable Object (`src/room/MatchRoom.ts`) is the single authoritative source of state, clock, and dice generation. Networked seats send intents via WebSocket (`REQUEST_ROLL`, `REQUEST_MOVE`) authenticated via session v2 (`sessions` table with SHA-256 tokens). Edge functions `roll-dice`, `move-auth`, and `resolve-bet` are retired in P6. State mutations commit atomically via Postgres RPC `match_commit_action`. Offline keeps local `processMove`. `npm run check:engine` verifies `lib/engine/core.ts` ↔ `src/room/engine.ts`.
4. **`/api/match/record`:** derived winner authority verified against `match_states.state.winner`; signer must be authenticated session participant or room owner; no coin pot payout (progression only); replay blocked if match already has a winner.
5. **Settlement authority:** pool settlements and bet resolutions derive results strictly from recorded match outcomes (`match_states.state.winner`), validated server-side.
6. **Power tile types** stay on the authority; strip `type` via `lib/wireSanitize.ts` (`sanitizeGameStateForWire`).
7. **DMs:** ECDH P-256 sealed boxes (`lib/encryption.ts`). Static identity is a non-extractable CryptoKey in IndexedDB (legacy localStorage JWK migrates on load). Pubkeys on `players.ecdh_pubkey`. Legacy wallet-hash is decrypt-only. Recipient without a pubkey → send fails closed (no plaintext downgrade); `POST /api/messages` rejects non-box content structurally.
8. **Messages RLS:** UPDATE is column-locked by trigger (`messages_restrict_columns` in `supabase/migrations/00000000000000_baseline.sql`; the archived `migrations_archive/20260914_messages_rls_lockdown.sql` copy is reduced to a comment) — sender/receiver/content immutable.
9. **The turn cycle is seat-aware (TU-6).** A 1v1 match seats two colours; `assignCornersFFA('1v1')` still draws all four into the corner map so `getBoardCoordinate` stays total, and the unseated colours hold four yard tokens. So a token-shaped "is this colour active?" test puts ghosts in the cycle and the match stalls on a seat nobody can roll. `seatedColorsFor(playerCount)` in `lib/engine/core.ts` is the single seat table; `activeColorsForTurns` filters on it first and `getNextPlayer` clamps its result to it (the clamp is inside the function, not at callers, because `processMove`'s `activeColors?` argument is optional). `LOBBY_COLORS['1v1']` derives from the same table — never fork a second seat list.

`ENGINE_LOGIC.md` is the living rules/spec doc — update it when engine or settlement behavior changes.

**Finding register:** `docs/ops/SYSTEM_REVIEW.md` is the audit that produced the
security/engine/netcode findings above, and
`docs/ops/IMPLEMENTATION_RECORD.md` is the implementation record — the pre-audit
baseline (Part I), how each finding closed with its gate evidence (Part II), the
dated risk acceptances and deferrals (Part III), and the open work (Part IV). Consult both before touching
any invariant above — the record states *why* each rule exists and what test
closes it.

### Wallet locking and authentication boundary

- **CDP in-game wallet only:** passkeys / device biometrics guard app boot when
  the CDP wallet is active and a CDP passkey is enrolled (`BootLock`). CDP
  sensitive transactions can also require a device-unlock step-up; CDP
  background app-session and match-message signing follows the CDP security
  preferences (`autoSign`).
- **External wallets:** MetaMask, Base Account, WalletConnect, and any other
  external/wagmi wallet are never guarded by Ludo's passkey or device-bio
  system. Their native wallet extension/app owns login, biometric/device
  unlock, and transaction confirmation.
- **No cross-wallet lock controls:** do not add or expose Ludo passkey,
  biometric boot-lock, or biometric transaction settings for external wallets.
  Security preferences must not trigger a WebAuthn/device-bio prompt when the
  active signer is external; route authentication through that wallet's native
  signer UI instead.
- `useWalletMode()` is the source of truth for this boundary: `ingame` means
  CDP guards may apply; `external` means native wallet guards apply.
- Authoritative reference: see `docs/architecture/WALLET_SIGNING_POLICY.md` for the full surface matrix, prompt cadences, storm prevention rules, and biometric step-up behavior.

## Conventions & gotchas

- Path alias: `@/*` → repo root.
- Themes: class-based on `<body>` (`ludo-theme` cookie, `app/layout.tsx`): `theme-retro-futurism` (default, dark) and `theme-daybreak`. CSS: `app/globals.css` + `app/styles/themes/default.css`.
- Token system: `ChessTokens.tsx` + `getTokenRank`; orb style opt-in via `TokenStyleSwitcher` / `usePreferences.tokenStyle`. Movement is GSAP-only in `BoardTokens.tsx` (FLIP, 1.3s hops). `.ludo-token-pulse` must wrap the pulse, not the counter-rotated root.
- Valid-move highlight: `calculateNextPosition(pos, dice, color, cc) !== pos` in `BoardTokens` / `BoardHome`.
- Offline/bot: `page.tsx:handlePlayNow` seeds `boardSeed`; `Board.tsx` prefers it. Bots: `DIFFICULTY_PARAMS` clocks in `constants.ts`.
- Multiplayer: Supabase Realtime broadcast (`game-room-<roomCode>`) primary; PeerJS for handshake/`SYNC_PROFILE`. `actionId` + `processedActionIds` dedup. Host/compute-host is authority; guests send intents.
- **Guest intents are dual-path:** `sendIntent` sends PeerJS `GAME_ACTION` **and** Supabase `GAME_INTENT` with a shared `intentId`. Host dedups via `processedIntentIds` so NAT-blocked PeerJS does not mute guests.
- **Lobby seating is dual-path:** guests send Supabase `JOIN_REQUEST` (retried) **and** PeerJS `SYNC_PROFILE`. Host `seatGuestPlayer` accepts either (same room-secret gate).
- Host join gate: matchmaking hosts require the ticket `validation_token`. Invite lobbies mint a **room secret** on `hostGame` (`?s=` in links, `game_invites.validation_token`). Hybrid public fill calls `allowOpenJoins()` so matchmaking-paired guests are not blocked.
- Betting window live path: `TeamUpContext.startBettingWindow` only (`useBettingWindow` module was removed).
- `startQuickMatch` in `TeamUpContext` hits `/api/matchmaking/join` and hosts/joins on match.
- Style/UI: terminal-glass, cyan `#00E5FF`, uppercase CTAs; Settings hosts Theme + Token switchers with inline SVG (no emoji).
