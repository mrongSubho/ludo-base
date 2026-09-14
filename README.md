# Ludo Base

Ludo Base is a Next.js 16 App Router game with wallet authentication, offline
bot matches, team play, Supabase-backed multiplayer, PeerJS handshakes, and
Farcaster-ready presentation. The lobby, board, and spectator views are
states of the single-page shell in `app/page.tsx`.

## Documentation

- [Engine and rules reference](./ENGINE_LOGIC.md)
- [Game Design Document](./docs/gdd/GAME_DESIGN_DOCUMENT.md)
- [Multiplayer smoke checklist](./docs/SMOKE_MULTIPLAYER.md)
- [Betting-window protocol ADR](./docs/architecture/adr-001-betting-window-protocol.md)
- [GDD visual asset guide](./docs/gdd/README.md)

## Architecture

| Area | Location | Responsibility |
| --- | --- | --- |
| App shell | `app/page.tsx` | Lobby, board, spectating, and top-level state transitions |
| UI | `app/components/` | Lobby, board, token, chat, settings, and status surfaces |
| Game hooks | `hooks/` | Engine orchestration, matchmaking, realtime sync, timers, and data loading |
| Pure rules | `lib/gameLogic.ts`, `lib/engine/core.ts` | Movement, capture, teams, powers, and server-validatable transitions |
| Board geometry | `lib/boardLayout.ts` | Shared path, corner assignment, home lanes, and grid metadata |
| Match trust | `lib/matchProof.ts`, `lib/matchRecorder.ts` | Canonical signed payloads and progression-only match records |
| Secure DMs | `lib/encryption.ts` | ECDH P-256 sealed boxes with decrypt-only legacy support |
| Edge functions | `supabase/functions/` | Server-side dice, move authorization, power actions, and bet settlement |

The host (or compute host) is authoritative for networked game state. Guest
intents travel over both PeerJS and Supabase Broadcast and are deduplicated by
intent/action IDs. Networked dice and moves are server-validated; offline
matches keep the local engine path.

## UI themes

Themes are applied as classes on `<body>`:

- `theme-retro-futurism` — default dark terminal-glass theme with cyan accents.
- `theme-daybreak` — light soft-UI theme.

The preference cookie is `ludo-theme`; theme tokens live in
`app/styles/themes/default.css` and shared styles live in `app/globals.css`.

## Run locally

Requirements: Node.js 20+ and npm.

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

Production validation:

```bash
npm test
npx tsc -p tsconfig.json --noEmit
npm run build
npm start
```

`npm run lint` is not currently supported because Next.js 16 removed
`next lint`; use the TypeScript check and build as the validation gate.

## Environment

Create a local, untracked `.env.local` with the values required by the
deployment environment, including Supabase, wallet-connect, Farcaster/Neynar,
and (when enabled) the Edge Server URL. Never commit credentials or keys.

## Development notes

- Keep `TEAM_PAIRINGS` in `lib/constants.ts` as the single source of truth for
  2v2 teams.
- Use `calculateNextPosition` and `getLegalTokenIndices` for move legality;
  do not replace gate-crossing logic with `position + roll`.
- Power tile types are authority-only and must be stripped with
  `lib/wireSanitize.ts` before state is sent to guests.
- New migrations belong in `supabase/migrations/`; older root-level
  `migrations/` files are retained for historical compatibility.
- Run the [multiplayer smoke checklist](./docs/SMOKE_MULTIPLAYER.md) after
  changing networking, settlement, encryption, or server-authority code.
