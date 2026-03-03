# Ludo Base Project Progress Checklist

This tracker summarizes what is currently implemented in the codebase and what remains partial/pending.

## 🟨 1) Core Gameplay

- [x] Classic Ludo mode
  - Key changes:
    - Added 15x15 board logic with dynamic path/corner mapping in `Board.tsx`.
    - Implemented token path traversal, safe cells, home lanes, and finish cell flow.
  - Key enhancements:
    - Supports seat/color shuffling for replay variety.
    - Supports multiple player configurations (`2`, `4`, `2v2`).

- [x] Power Ludo mode (partial)
  - Key changes:
    - Added `PowerType` model (`shield`, `boost`, `bomb`, `warp`) and related state plumbing.
    - Integrated power-mode-compatible game state in board logic.
  - Key enhancements:
    - UX prepared for richer power interactions.
    - Full effect resolution and balancing still pending.

- [x] Snakes & Ladders mode
  - Key changes:
    - Added dedicated `SnakesBoard.tsx` with 10x10 serpentine grid math.
    - Implemented 8 ladders + 8 snakes with position remapping.
  - Key enhancements:
    - Added bounce-back behavior on overshoot.
    - Added event messaging for snake/ladder encounters.

- [x] Turn, dice, and win flow
  - Key changes:
    - Added dice-driven movement phases (`rolling` -> `moving`) with animated step progression.
    - Added turn switching, winner detection, and win-trigger handling.
  - Key enhancements:
    - Added confetti celebration for wins.
    - Added clearer feedback for overshoot and slide events.

- [x] AI and timer/strike automation
  - Key changes:
    - Added AI player templates and auto-turn integration.
    - Added turn timer (`15s`) and strike counter state.
  - Key enhancements:
    - Added auto-play fallback when timer limits are hit.
    - Reduced stalled games in local/AI matches.

## 🟩 2) UI Components

- [x] Board component set
  - Key changes:
    - Implemented `Board.tsx` (Ludo) and `SnakesBoard.tsx` (variant mode).
    - Added reusable `Dice` component with motion-based interaction.
  - Key enhancements:
    - Improved visual readability with lane highlights/safe markers.
    - Added animated token transitions using Framer Motion.

- [x] Theme and audio controls
  - Key changes:
    - Added `ThemeSwitcher` and `AudioToggle` controls.
    - Added persisted preferences via `localStorage` (`ludo-theme`, `ludo-sfx`, `ludo-music`).
  - Key enhancements:
    - Theme-aware ambient sound profiles through Web Audio API.
    - User-level control for sound without leaving gameplay.

## 🟨 3) Dashboard and Social Panels

- [x] User profile panel
  - Key changes:
    - Added editable profile name/avatar flow and stats widgets.
    - Added privacy toggles (public profile, allow requests).
  - Key enhancements:
    - Improved player identity layer before backend integration.
    - Ready for future real profile sync.

- [x] Friends panel (mock)
  - Key changes:
    - Added tabbed lists for game friends, base friends, and requests.
    - Added DM/accept/reject interaction controls.
  - Key enhancements:
    - Better social UX scaffolding using realistic states (`Online`, `In Match`, `Offline`).
    - API/data persistence integration remains pending.

- [x] Leaderboard panel (mock)
  - Key changes:
    - Added tier/daily/monthly tabs and global/friends scope switch.
    - Added ranking logic with tier/stage sorting and time-window filtering.
  - Key enhancements:
    - Supports seasonal framing (quarter marker UX).
    - Real backend ranking pipeline still pending.

- [x] Mission panel (mock)
  - Key changes:
    - Added daily/weekly mission tabs with progress and rewards.
    - Added completion-aware UI and progress bars.
  - Key enhancements:
    - Prepared mission structure (`type`, `target`, `reward`) for backend syncing.
    - Claim/reward economy not yet connected to real state.

- [x] Marketplace panel (mock-rich)
  - Key changes:
    - Added multi-category market model (`items`, `themes`, `dice`) with rarity and metadata.
    - Added NFT-like fields (collection, traits, activity, chain info).
  - Key enhancements:
    - Strong data model foundation for onchain inventory.
    - Real purchase/listing/ownership verification pending.

- [x] Messaging and player sheets
  - Key changes:
    - Added `MessagesPanel` placeholder and in-game `PlayerProfileSheet`.
    - Added panelized mobile-first overlays and transitions.
  - Key enhancements:
    - Shared panel system improves navigation consistency.
    - Real DM/message transport is still pending.

## 🟨 4) Multiplayer and Connectivity

- [x] PeerJS multiplayer core
  - Key changes:
    - Added `useMultiplayer` hook with host/guest roles and state broadcasting.
    - Added message schema for state updates and basic signaling structures.
  - Key enhancements:
    - Enables direct session-based multiplayer prototype.
    - Reliability, reconnection, and richer sync validation still pending.

- [x] Lobby UI for room-based sessions
  - Key changes:
    - Added `GameLobby` host/join flow with room ID input and status UI.
    - Added room-share UX and connection state handoff.
  - Key enhancements:
    - Improves usability of multiplayer setup from manual testing.
    - Needs deeper integration into main play flow and error handling.

## 🟨 5) Web3 and Base/Farcaster Setup

- [x] Wallet UI and dependencies present
  - Key changes:
    - Added `WalletConnectCard` using OnchainKit wallet components.
    - Added Web3 dependencies (`wagmi`, `viem`, `@coinbase/onchainkit`).
  - Key enhancements:
    - UI path exists for wallet onboarding.
    - Full transaction and bet settlement flow remains pending.

- [x] Base/Farcaster ecosystem setup present
  - Key changes:
    - Added Farcaster SDK dependencies and app metadata scaffolding.
    - Added provider scaffolding files (`Providers.tsx`, `FrameProvider.tsx`, `lib/supabase.ts`).
  - Key enhancements:
    - Positions app for Frame/Base ecosystem compatibility.
    - End-to-end runtime wiring is partial and needs final integration validation.

## 🟨 6) UX, Visual, and Technical Polish

- [x] Multi-theme visual system
  - Key changes:
    - Added 4 theme options and background assets structure.
    - Added glassmorphism-based panel style consistency across feature panels.
  - Key enhancements:
    - Better visual variety and personalization.
    - Some expected static assets still missing (avatars/extra backgrounds/OG image).

- [x] Audio system with ambient + SFX
  - Key changes:
    - Implemented audio hook with move/capture/win/turn/strike effects.
    - Implemented theme-driven ambient synthesis with fade/filter/LFO behavior.
  - Key enhancements:
    - Strong feedback loop during gameplay.
    - Needs final balancing for loudness and mobile/browser edge cases.

- [x] App foundation and deployment readiness
  - Key changes:
    - Next.js app scaffolded with TypeScript, Tailwind, ESLint, and build scripts.
    - Deployment target documented in README (`ludo-base.vercel.app`).
  - Key enhancements:
    - Stable development baseline for rapid iteration.
    - Test coverage and production monitoring are still missing.

## 🟥 7) Pending / Partial Checklist (Vice Versa)

- [ ] Real wallet-to-game transaction loop
  - Key changes done so far:
    - Wallet connect UI and dependencies are in place.
  - Key enhancements pending:
    - Bet escrow, entry fee transfer, payout distribution, and failure handling.

- [ ] Backend/data persistence
  - Key changes done so far:
    - Frontend state models exist across profile/friends/missions/leaderboard/marketplace.
  - Key enhancements pending:
    - API routes, Supabase schema usage, auth-bound records, and sync.

- [ ] Social systems (real)
  - Key changes done so far:
    - Requests/DM UI and player profile actions are implemented.
  - Key enhancements pending:
    - Real friend graph, invite flow, block/report enforcement, and DM transport.

- [ ] Power-mode completion
  - Key changes done so far:
    - Power types and partial gameplay hooks exist.
  - Key enhancements pending:
    - Finalized effect mechanics (shield/bomb/warp interactions), balancing, and tests.

- [ ] Multiplayer hardening
  - Key changes done so far:
    - Peer session prototype, host/join lobby, and state broadcast flow.
  - Key enhancements pending:
    - Match recovery, anti-desync strategy, retry logic, and richer connection UX.

- [ ] QA and tests
  - Key changes done so far:
    - Lint/build scripts configured.
  - Key enhancements pending:
    - Unit/integration/e2e test coverage and CI gates.
