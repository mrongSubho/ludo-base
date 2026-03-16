# Ludo Base

A Next.js 16 Farcaster-ready Ludo game with wallet integration, teamup hooks, social panels, and a glassmorphism dashboard UI.

## Documentation

- [Game Design Document](./GAME_DESIGN_DOCUMENT.md)
- [GDD Visual Asset Guide](./docs/gdd/README.md)

## Current State (March 2026)

The UI and lobby were recently refined across multiple commits and now include:

- Silvery swirly gradient dashboard background with textured glassmorphism styling.
- Refined `GameLobby` setup flow with pill-style section headers.
- Horizontal game mode selection with nested descriptor pills.
- Synced match-type button styling (`1v1`, `2v2`, `4P`) with clearer default/active states.
- Updated wager area using an **Entry Fee** label, large numeric input, stepper controls, and quick-select chips.
- Rounded chips/buttons and horizontal dual CTAs (`QUICK MATCH`, `WITH FRIENDS`).
- Cyan focus ring/active accent behavior for the wager input and key selectable controls.
- Mobile and desktop layout/padding parity updates for lobby sections.
- Footer active nav text/icon/underline treatment aligned to glassmorph white styling.

## Recent Changelog

- `0c61cd2`: Mobile-synced desktop lobby layout/padding updates, default states, cyan input focus ring.
- `e8e5062`: Final lobby refinements with pill headers, synced match-type styles, rounded chips, horizontal CTAs.
- `73508c5`: Wager layout reverted to “Bet Amount” flow, restored quick chips, nested sub-pill styling.
- `8ca28bb`: Reference dashboard replication with silvery swirly gradient and horizontal glass mode pills.
- `627d5da`: Documentation update for grey gradient dashboard verification.
- `d95fcee`: Replaced cosmic-core dashboard background with textured grey gradient glassmorphism.
- `8761d4f`: Footer active nav text/icon/underline switched from cyan to glassmorph white.
- `bd4a98e`: Modal base color corrections, tab focus-ring fixes, footer nav opacity tuning.
- `90aac47`: Global deep-purple panel background pass and footer opacity fixes.
- `8f29db9`: Purple theme finalization and updated footer hover squircle behavior.
- `deb1dca`: Global purple theme alignment across primary panels.
- `b0eafa5`: PlayWithFriendsPanel styling aligned with UserProfilePanel visual system.

## Tech Stack

- Next.js 16 (App Router)
- React 19
- TypeScript 5
- Tailwind CSS 4
- Framer Motion
- Wagmi + Coinbase OnchainKit
- Supabase
- PeerJS

## Main App Areas

- `app/page.tsx`: app shell, tab panel orchestration, routing between lobby and game boards.
- `app/components/GameLobby.tsx`: game setup, matchmaking entry, wager controls, private room flow.
- `app/components/Board.tsx`: core Ludo gameplay.
- `app/components/SnakesBoard.tsx`: snakes-and-ladders variant.
- `app/globals.css`: theme tokens + glass dashboard/background system.
- `hooks/TeamUpContext.tsx`: room host/join + teamup context state.
- `lib/matchRecorder.ts`: match result persistence helpers.

## UI Standards

### Terminal Theme

- Visual direction: dark terminal-glass surface with high-contrast cyan accents for active/focus states.
- Primary background: charcoal/graphite gradients (`#0B0F14` to `#141A22`) with subtle texture noise.
- Accent color: terminal cyan (`#00E5FF`) for focus ring, active pills, and key interactive states.
- Typography: monospaced support text and labels where terminal feel is needed; avoid overusing decorative styles.

### File Pathing System

- Use absolute repo-relative paths in docs and tickets, for example:
  - `app/components/GameLobby.tsx`
  - `app/globals.css`
  - `hooks/TeamUpContext.tsx`
- Keep naming consistent with existing structure (`PascalCase` for React component files, `camelCase` for utilities/hooks where applicable).
- Prefer explicit path references in changelogs and implementation notes so updates are traceable.

### Text Guidelines

- Keep UI copy short and action-first.
- Use uppercase for compact CTA labels where already established (for example `QUICK MATCH`, `WITH FRIENDS`).
- Keep labels consistent across mobile and desktop (same wording, no semantic drift).
- Reserve technical wording for developer-facing surfaces; player-facing text should remain simple and clear.

## Run Locally

Prerequisites:

- Node.js 20+
- npm

Install and start:

```bash
npm install
npm run dev
```

App URL:

- `http://localhost:3000`

Production build:

```bash
npm run build
npm start
```

Lint:

```bash
npm run lint
```

## Environment

Create `.env.local` with required values for your deployment context (wallet/network + Supabase + Farcaster/Neynar integrations).

## Notes

- Some panels still use placeholder/mock data while backend wiring is expanded.
- TeamUp and match persistence flows exist but still need continued hardening for reconnection and edge cases.
