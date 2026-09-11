# AGENTS.md

Ludo Base — a Next.js 16 (App Router) on-chain Ludo game (Farcaster-ready, wagmi/OnchainKit, Supabase, PeerJS). Single-page app: dashboard lobby ↔ game board ↔ spectating are all states of `app/page.tsx`.

## Commands

- `npm run dev` — dev server (Turbopack) at `http://localhost:3000`. This is the only reliable dev command.
- `npm run build` && `npm start` — production. TypeScript errors **fail the build** (`ignoreBuildErrors: false`).
- `npm run lint` — **BROKEN**. `next lint` was removed in Next 16; it errors with "no such directory: .../lint". Do not rely on lint.
- `npm test` — engine unit tests via `npx tsx --test scripts/engine.test.ts` (2v2 teams, gate-crossing legality, three sixes, capture). Run this after any `lib/gameLogic` / `lib/boardLayout` / `lib/constants` change.
- `npx tsc -p tsconfig.json --noEmit` — **must be 0 errors**. Deno edge functions excluded (`supabase/functions` in tsconfig). Do not reintroduce broad `any` on the game surface without a burn-down.
- **CI** (`.github/workflows/ci.yml`): `engine-tests` + `typecheck-core`. Keep gated files clean.
- Smoke tests: `docs/SMOKE_MULTIPLAYER.md` (invite secret, hybrid fill, matchmaking, Edge RNG, dual-path intents, ECDH DMs).

## Environment

- `.env.local` and `.env` are required but gitignored. Holds: Supabase URL/anon key, `NEYNAR_API_KEY`, `NEXT_PUBLIC_EDGE_SERVER_URL`, `NEXT_PUBLIC_WC_PROJECT_ID`. Never hardcode/commit keys.
- Supabase project ref (from URL): use `NEXT_PUBLIC_SUPABASE_URL`. Deploy edge functions with `supabase functions deploy <name> --project-ref <ref>`. Apply SQL via Dashboard SQL Editor or Management API (`db push` can fail on `cli_login_postgres` role).

## Directory map (non-obvious parts)

- `hooks/` — game engine & data: `useGameEngine.ts`, `useTeamUp.ts` (+ `TeamUpContext.tsx`, `GameDataContext.tsx`), `useMatchmaking.ts`, `useProvablyFairDice.ts`, `useSpectatorSync.ts`, `useGameTimer.ts`, etc. **`app/hooks/` is different — only audio hooks (`useAudio.ts`, `useSoundEffects.ts`).**
- `lib/` — engine logic and shared code: `gameLogic.ts`, `boardLayout.ts`, `aiEngine.ts`, `snakesLogic.ts`, `constants.ts` (`TEAM_PAIRINGS` / `TEAM_ID`, `AI_SCORES`, difficulty tiers), `encryption.ts` (ECDH sealed boxes), `matchProof.ts` (canonical signed payloads), `matchRecorder.ts`, `progression.ts`, `supabase.ts`.
- `lib/types.ts` — `GameState` is the authoritative game state type (includes `activeBoost`, `powerTiles`, `BoardPlayer`, `ColorCorner`). Prefer `GameState` / `GameStateSetter` over `any` in game hooks.
- `app/components/` — all UI. New component files: `PascalCase.tsx`; hooks/utilities: `camelCase`.
- `supabase/functions/` — **Deno Edge Functions** (`roll-dice`, `resolve-bet`): `Deno` global + `https://esm.sh/` imports. Not bundled by Next; deploy separately. `resolve-bet` requires a host-signed payload (`lib/matchProof.ts` + `live_matches.host_address`).
- **Migrations:** new SQL goes in `supabase/migrations/` (canonical). Root `migrations/` still has older files — do not add new ones there. Apply manually (SQL Editor or Management API).
- `.agent/` — third-party Antigravity Kit; ignore for app work.

## Security & trust model (do not regress)

These landed in commits `565ede5` / `e3cbadf`. Treat as invariants:

1. **2v2 teams are one source of truth:** `TEAM_PAIRINGS` in `lib/constants.ts` — **Green+Yellow vs Red+Blue**. Seating (`assignCorners2v2`), `getTeammateColor`, `getTeam`, assist, capture, and win checks must all use it. Never fork a second pairing.
2. **Move legality uses engine math:** always `calculateNextPosition` / `getLegalTokenIndices`. Never `pos + roll` (breaks gate crossing into home stretch 52–57).
3. **Networked rolls:** Edge `roll-dice` only; receipts in `match_rolls` (unique `action_id`). **Networked moves (v2):** Edge `move-auth` (seed / `submit-move` / `pass-turn` / `submit-power`). **Match session (A/C):** one EIP-712 `LudoMatchSession` sign per match → `match_sessions.sessionId` for in-match actions (no per-move popup). Fallback = per-action signature. **SIWE app session (B):** `/api/siwe/verify` + `app_sessions` for chat/profile/settings only — never match moves. `match_states.seq` is display + rules authority. Offline keeps local `processMove`. `npm run check:engine` must pass.
4. **`/api/match/record`:** requires wallet signature over `buildMatchRecordMessage`; signer must be a listed participant; no coin pot payout (progression only); replay blocked if match already has a winner.
5. **`resolve-bet`:** host wallet-signs `buildBetResolveMessage`; Edge verifies signature + `live_matches.host_address`. Do not accept free-form `result` from the network.
6. **Power tile types** stay on the authority; strip `type` via `lib/wireSanitize.ts` (`sanitizeGameStateForWire`).
7. **DMs:** ECDH P-256 sealed boxes (`lib/encryption.ts`). Pubkeys on `players.ecdh_pubkey`. Legacy wallet-hash is decrypt-only. Recipient without a pubkey → send fails closed (no plaintext downgrade).
8. **Messages RLS:** UPDATE is column-locked by trigger (`messages_restrict_columns`) — sender/receiver/content immutable.

`ENGINE_LOGIC.md` is the living rules/spec doc — update it when engine or settlement behavior changes.

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
