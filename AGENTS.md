# AGENTS.md

Ludo Base — a Next.js 16 (App Router) on-chain Ludo game (Farcaster-ready, wagmi/OnchainKit, Supabase, PeerJS). Single-page app: dashboard lobby ↔ game board ↔ spectating are all states of `app/page.tsx`.

## Commands

- `npm run dev` — dev server (Turbopack) at `http://localhost:3000`. This is the only reliable dev command.
- `npm run build` && `npm start` — production. `next.config.ts` sets `typescript.ignoreBuildErrors: true` and the eslint block is removed, so **build passes even with type errors** — it is NOT a correctness gate.
- `npm run lint` — **BROKEN**. `next lint` was removed in Next 16; it errors with "no such directory: .../lint". `npx eslint .` also currently crashes (circular-structure error from `FlatCompat` around `next/core-web-vitals`). Do not rely on lint.
- `npx tsc --noEmit` — has many pre-existing errors; treat as advisory only.
- No test framework is wired (Playwright is an unused dep, zero `*.test.*` files). Verify changes via `npm run dev` + manual flow, or `npm run build`.
- Antigravity Kit validation: `python .agent/scripts/checklist.py .` / `python .agent/scripts/verify_all.py . --url http://localhost:3000`.

## Environment

- `.env.local` and `.env` are required but gitignored (already present locally). `.env.local` holds: Supabase URL/anon key, `NEYNAR_API_KEY`, `NEXT_PUBLIC_EDGE_SERVER_URL`, `NEXT_PUBLIC_WC_PROJECT_ID`. Without them wallet, Supabase, and matchmaking are dead. Never hardcode/commit keys.
- No CI workflows exist.

## Directory map (non-obvious parts)

- `hooks/` — game engine & data: `useGameEngine.ts`, `useTeamUp.ts` (+ `TeamUpContext.tsx`, `GameDataContext.tsx`), `useMatchmaking.ts`, `useProvablyFairDice.ts`, `useSpectatorSync.ts`, `useGameTimer.ts`, etc. **`app/hooks/` is different — only audio hooks (`useAudio.ts`, `useSoundEffects.ts`).**
- `lib/` — engine logic and shared code: `gameLogic.ts`, `boardLayout.ts`, `aiEngine.ts`, `snakesLogic.ts`, `constants.ts` (all engine params / `AI_SCORES`), `encryption.ts`, `progression.ts`, `matchRecorder.ts`, `supabase.ts` client. Types split across `lib/types.ts` and `lib/types/`.
- `app/components/` — all UI. New component files: `PascalCase.tsx`; hooks/utilities: `camelCase`.
- `supabase/functions/` — **Deno Edge Functions** (`roll-dice`, `resolve-bet`): use `Deno` global + `https://esm.sh/` imports. They are NOT bundled by Next and pollute `npx tsc --noEmit` output; deploy them to Supabase separately. Root `migrations/` SQL is applied manually via the Supabase SQL Editor — `run_migration.js` is only a stub that prints a message.
- `.agent/` — a third-party AI-agent toolkit ("Antigravity Kit"; agents/skills/workflows). Its `ARCHITECTURE.md` describes the kit, **not** this app. Ignore it for app work.

## Conventions & gotchas

- Path alias: `@/*` → repo root (use `@/hooks/...`, `@/lib/...`).
- Themes are class-based on `<body>` (`ludo-theme` cookie, see `app/layout.tsx`): `theme-retro-futurism` (default, dark) and `theme-cosmic-ui` (light). Legacy `dark` cookies auto-migrate to retro. CSS lives in `app/globals.css` + `app/styles/themes/default.css`.
- Token system: `app/components/ChessTokens.tsx` renders pawn pieces with rank toppers; rank is derived from board position via `getTokenRank` (base `-1`=Pawn → `0–17` Knight → `18–34` Bishop → `35–51` Rook → `52–56` Queen → `57` King / `AI_SCORES.PROMOTION`). Opt-in orb style is pure CSS under `body.token-style-orb` (see `app/components/TokenStyleSwitcher.tsx` + `hooks/usePreferences.ts:tokenStyle`); it hides SVGs and turns `.ludo-token` into glossy discs. Preview labs: `/token-preview` (all ranks × colors, all generations) and `/token-move-test` (isolated `TokenPiece` mover). Movement is GSAP-only (see `app/components/BoardTokens.tsx`): FLIP with `offsetWidth` layout units, single-timeline per move (`TOTAL 1.3s` uniform), discrete cell hops, `useLayoutEffect` + immediate `gsap.set` to avoid flash.
- Valid-move highlighting: `BoardTokens.tsx` + `BoardHome.tsx` mark legal tokens via `calculateNextPosition(pos, dice, color, cc) !== pos` (dim invalid, double pulsing ring + bounce arrow on valid, dashed destination marker at `getBoardCoordinate(nextPos)`). Change engine move rules accordingly.
- Offline/bot matches: `app/page.tsx:handlePlayNow` always seeds you + bots (`shufflePlayers(..., true, cc)` + wallet stamping) and seeds `boardSeed` to bypass stale networked `gameState`; `app/components/Board.tsx` prefers `boardSeed` over `gameState`. `hooks/useGameEngine.ts:resetGame` preserves identity. No-valid-move hands turn over instantly (0ms) with a dice toss-in; bots roll `150–1900ms` (`lib/constants.ts:BOT_ROLL_DELAY_*`, `BOT_MOVE_DELAY 900ms`).
- `ENGINE_LOGIC.md` is declared the source of truth for game rules (movement index 0–57, capture/force, safe zones, host authority, betting window ordering: `BET_WINDOW_OPEN` → `BET_WINDOW_CLOSED` → `DICE_COMMIT`). Update it when you change engine behavior.
- Multiplayer uses hybrid mesh: Supabase Realtime broadcast (`game-room-<roomCode>`) is primary; PeerJS is for handshake/`SYNC_PROFILE`. All actions are stamped with `actionId` and deduplicated via `processedActionIds`.
- Stacking/rotation: `hooks/useBoardLayout.ts` rotates board so local player sits BL and counter-rotates pieces; movement hop is screen-space via an upright wrapper — don't reintroduce board-local hops. `.ludo-token-pulse` must wrap draggable pulse, not the rotated root (otherwise `transform` overwrites counter-rotation — see flip bug).
- Style/UI conventions are documented in `README.md` ("UI Standards"): terminal-glass theme, cyan `#00E5FF` accents, uppercase CTAs kept identical on mobile/desktop. Match existing patterns over inventing new ones. Settings panel (`app/components/SettingsPanel.tsx`) hosts `ThemeSwitcher.tsx` + `TokenStyleSwitcher.tsx` with inline SVG icons (no emoji).