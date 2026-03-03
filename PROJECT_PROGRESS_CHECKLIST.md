# Ludo Base Project Progress Checklist

This document is now organized directory-wise for discussion and planning.

Legend: `🟩 Done` `🟨 Partial` `🟥 Pending`

## app/

### 🟩 layout.tsx
- Key notes:
  - `metadata` defines SEO + OpenGraph + Farcaster Frame metadata.
  - `RootLayout()` wraps the entire app in `Providers`, so wallet/frame/multiplayer/profile sync are globally available.
  - Sets strict mobile viewport behavior for game-like fullscreen UX.
- Key enhancements:
  - Frame/Base metadata is already wired.
  - `og-image.png` asset still needs finalization.

### 🟩 Providers.tsx
- Key notes:
  - Creates wagmi config for `base` + `baseSepolia` and registers connectors (Coinbase wallet + injected).
  - `Providers()` composes `WagmiProvider -> QueryClientProvider -> OnchainKitProvider -> FrameProvider -> MultiplayerProvider`.
  - Mounts `ProfileSyncer` globally so profile data is synced in the background.
- Key enhancements:
  - Excellent central dependency wiring.
  - API key currently hardcoded in provider config and should be moved to env.

### 🟨 page.tsx
- Key notes:
  - `TabPanel()` is a reusable slide-up shell for footer tabs.
  - `SettingsPanel()` reads/writes `ludo-sfx` and `ludo-music` to `localStorage` and controls runtime audio toggles.
  - Main page state orchestrates mode selection, panel visibility, and routing between `Board`, `SnakesBoard`, wallet view, and lobby flow.
  - Uses wagmi identity hooks (`useAccount`, `useDisconnect`) for auth-aware UI branches.
- Key enhancements:
  - Strong app shell and panel UX.
  - File is very large; splitting state/features into smaller modules will improve maintainability.

## app/components/

### 🟨 Board.tsx
- Key notes:
  - `shufflePlayers()` randomizes player templates and supports 2-player diagonal pairing logic.
  - `shuffleColorCorner()` randomizes color-to-corner arrangements while preserving valid diagonals.
  - `buildPlayerPaths()` builds full token routes (shared path + home lane + finish) per color.
  - `buildPathCellsDynamic()` computes board cell classes and lane colors dynamically from current corner mapping.
  - Turn/move flow combines dice roll -> token movement -> capture/safe checks -> extra turns -> winner checks.
  - Calls `recordMatchResult()` to persist outcomes when a wallet-addressed winner is available.
- Key enhancements:
  - Core Ludo rules are functionally rich and replayable.
  - Power-mode effect execution is still partially implemented.

#### Live Discussion: Board.tsx Deep Dive (Section 1)
- What this file is in the system:
  - `Board.tsx` is the main gameplay engine for Classic/Power mode.
  - It is both renderer and rules engine, so UI state and game rules are tightly coupled in one component.

- Core data model and why it matters:
  - `gameState.positions[color][tokenIndex]` stores token progress (`-1` home, `0..57` path/home-lane).
  - `currentPlayer`, `gamePhase`, `diceValue`, `strikes`, and `winner` define the turn-state machine.
  - `colorLayout` (`colorCorner` + `playerPaths`) ensures seat randomization still maps to valid geometric paths.

- Function-by-function behavior notes:
  - `shufflePlayers(playerCount)`:
    - What it does: picks active players and assigns color seats.
    - How it works in game: enforces diagonal-pair fairness for 2-player mode so path geometry remains symmetric.
  - `shuffleColorCorner()`:
    - What it does: picks one valid corner arrangement from a constrained set.
    - How it works in game: avoids impossible/invalid board orientations while still giving variety between matches.
  - `buildPlayerPaths(colorCorner)`:
    - What it does: generates each color’s full traversal route from start to finish.
    - How it works in game: every token movement, capture check, and win check depends on this path map.
  - `buildPathCellsDynamic(colorCorner)`:
    - What it does: assigns CSS lane classes and safe-cell markers for the current layout.
    - How it works in game: board visuals always match gameplay logic after seat/corner shuffles.
  - `getNextPlayer(currentColor)`:
    - What it does: computes next active color based on currently active players.
    - How it works in game: correctly skips absent colors in `2`/`2v2` setups and keeps turns consistent.
  - `handleRoll(value, isRemote)`:
    - What it does: applies dice value, validates move availability, and sets phase.
    - How it works in game: if no token can legally move, turn auto-passes and timer resets.
  - `moveToken(color, tokenIndex, steps, isRemote, targetPosition)`:
    - What it does: executes legal movement, handles overshoot, capture logic, win checks, and turn switching.
    - How it works in game:
      - rejects overshoot beyond `57` and passes turn;
      - grants bonus turn on `6` or capture;
      - applies safe-square immunity via board coordinates;
      - updates team-win logic in `2v2`.
  - `getBestMove(playerId, roll)`:
    - What it does: scores possible token moves and returns best index for bot/auto-play.
    - How it works in game: prioritizes winning, captures, safe entry, home-lane progress, and forward advancement.
  - `recordWin(winnerColor)`:
    - What it does: updates local leaderboard and triggers persistent match recording.
    - How it works in system: calls `recordMatchResult()` once (guarded by `hasRecordedWin`) for connected winner flow.
  - `resetGame()`:
    - What it does: rebuilds players, path layout, and full game state from initial values.
    - How it works in game: creates fresh match conditions including randomized layout and cleared power/trap state.

- Multiplayer action flow inside Board:
  - Incoming actions handled: `ROLL_DICE`, `MOVE_TOKEN`, `NEXT_TURN`, `SYNC_PROFILE`.
  - Outgoing actions emitted: `ROLL_DICE`, `MOVE_TOKEN`, `NEXT_TURN`.
  - Practical effect: host/guest stay synchronized using action replay, but conflict control is still lightweight.

- Timer, AFK, and AI orchestration:
  - Human timer decrements in `rolling/moving` states; timeout adds a strike.
  - At `3+` strikes, player behavior switches into bot-like automation.
  - AI cycle:
    - rolling phase: delayed roll;
    - moving phase: heuristic selection via `getBestMove()` then execution.

- Power-mode status in this file:
  - State exists for `powerTiles`, `playerPowers`, `activeTraps`, `activeShields`, `activeBoost`.
  - `handleUsePower()` currently consumes/invokes power state minimally.
  - Conclusion: data scaffolding is present, but full tactical effect logic is still incomplete.

- Current engineering risks we should discuss next for Board:
  - Multiplayer desync risk:
    - local and remote actions can both trigger turn transitions if ordering drifts.
  - Large component complexity:
    - rules, rendering, AI, sync, audio, and persistence are all in one file.
  - Partial persistence consistency:
    - local leaderboard write + remote DB write are separate paths with different guarantees.

- Suggested immediate next refactor plan (for Board only):
  - Extract pure rules helpers (`canMove`, `applyMove`, `resolveCapture`, `resolveWin`) into a separate module.
  - Move multiplayer action reducer into dedicated sync layer.
  - Keep `Board.tsx` focused on rendering + dispatching intents.

### 🟨 SnakesBoard.tsx
- Key notes:
  - `getGridPos()` converts tile numbers into serpentine 10x10 board coordinates.
  - `handleRoll()` animates step-by-step movement, handles overshoot bounce-back, then applies snake/ladder remap.
  - `checkWin()` completes game at tile `100` and triggers confetti + sound feedback.
  - Includes timer/strike/AI flow similar to the classic board variant.
- Key enhancements:
  - Variant mode is complete for core play.
  - Could share more logic with `Board.tsx` to reduce duplication.

### 🟩 Dice.tsx
- Key notes:
  - Encapsulates dice interaction and animation so both board modes can reuse the same roll UX contract.
- Key enhancements:
  - Keeps roll UI consistent between modes.

### 🟩 ThemeSwitcher.tsx
- Key notes:
  - Initializes theme from `localStorage` on mount.
  - `toggleTheme()` writes selected theme to `localStorage` and updates active button state.
  - Provides four gameplay themes: Pastel, Midnight, Cyberpunk, Classic.
- Key enhancements:
  - Lightweight, predictable UX for theme persistence.

### 🟩 AudioToggle.tsx
- Key notes:
  - Controls persisted SFX/music preference flags that are consumed by the audio hook.
- Key enhancements:
  - Player can mute quickly without leaving the current flow.

### 🟨 ProfileSyncer.tsx
- Key notes:
  - 3-step profile resolution pipeline:
    - 1) Frame SDK user context (if inside Farcaster)
    - 2) `/api/farcaster` fallback via wallet lookup (Neynar)
    - 3) Onchain identity fallback (`useName`, `useAvatar`) then wallet-short form
  - Writes resolved profile into Supabase `players` table with `upsert`.
- Key enhancements:
  - Good identity fallback design across app contexts.
  - Needs stricter error/retry policies and clearer sync status UX.

### 🟨 WalletConnectCard.tsx
- Key notes:
  - Renders OnchainKit `Wallet` + `ConnectWallet` button inside branded card UI.
  - Uses mounted-state guard to avoid hydration mismatch on SSR.
- Key enhancements:
  - Wallet entry UX is polished.
  - Connect action is not yet linked to bet/payment flow.

### 🟨 GameLobby.tsx
- Key notes:
  - `handleHost()` calls `hostGame()` from multiplayer hook and creates sharable room code.
  - `handleJoin()` validates room input then calls `joinGame(roomId)`.
  - Switches to connected loading state once lobby connection is established.
- Key enhancements:
  - Practical prototype for room-based entry.
  - Needs integration with stronger matchmaking/recovery states.

### 🟨 FriendsPanel.tsx
- Key notes:
  - Organizes social UX into `game`, `base`, and `requests` tabs.
  - `renderFriendList()` and `renderRequestList()` centralize list-row rendering.
  - Includes action affordances (DM, accept, reject) and status badges.
- Key enhancements:
  - Clear social structure for future real data.
  - Still mock-data driven.

### 🟨 Leaderboard.tsx
- Key notes:
  - `getStats()` supports multiple ranking strategies (tier hierarchy, daily UTC window, monthly UTC window).
  - Adds scope filtering (`global` vs `friends`) before ranking.
  - Uses quarter tooltip to communicate season-reset concept.
- Key enhancements:
  - Ranking logic contract is well-defined.
  - Still in-memory/mock data.

### 🟨 MissionPanel.tsx
- Key notes:
  - `getMissions()` returns tab-specific mission sets (`daily`, `weekly`).
  - Progress state maps into visual bars, reward tags, and claim/completed CTA states.
- Key enhancements:
  - Mission model is ready for backend sync.
  - Reward claiming is not tied to persistent economy yet.

### 🟨 MarketplacePanel.tsx
- Key notes:
  - Defines robust marketplace data types: `MarketItem`, `MarketTrait`, `MarketActivity`, rarity classes.
  - Represents NFT-style metadata including chain info, collection stats, traits, and activity history.
  - Supports category-based inventory browsing (`items`, `themes`, `dice`).
- Key enhancements:
  - Excellent schema-level groundwork.
  - Real purchase/list/ownership transactions remain pending.

### 🟨 UserProfilePanel.tsx
- Key notes:
  - Local profile editor for avatar cycling, display name updates, and privacy toggles.
  - Animated performance widgets (wins, win-rate donut, streak, matches).
- Key enhancements:
  - Strong visual profile experience.
  - Not fully bound to persistent profile writes yet.

### 🟨 MessagesPanel.tsx / PlayerProfileSheet.tsx
- Key notes:
  - Messages view currently acts as placeholder inbox state.
  - Player profile sheet is an in-match quick action surface (friend/DM/block).
- Key enhancements:
  - Shared slide-panel UI language is consistent.
  - Messaging backend and moderation actions are still pending.

### 🟩 FrameProvider.tsx
- Key notes:
  - Calls `sdk.actions.ready()` on mount so Farcaster frame lifecycle is correctly initialized.
- Key enhancements:
  - Ensures frame-hosted startup reliability.

## app/hooks/

### 🟩 useAudio.ts
- Key notes:
  - `initAudio()` lazily creates/resumes the browser audio context.
  - `playMove`, `playCapture`, `playTurn`, `playStrike`, `playWin` synthesize SFX procedurally.
  - `playAmbient(theme)` builds theme-specific oscillator/filter/LFO chains.
  - `stopAmbient()` tears down active ambient nodes to prevent overlaps/leaks.
- Key enhancements:
  - No external audio assets needed for core signals.
  - Final loudness balancing is still needed.

### 🟨 useMultiplayer.ts (app/hooks)
- Key notes:
  - PeerJS-oriented hook for direct host/guest connection and state broadcast/listen.
  - `connectToPeer()` opens guest connection; `broadcastState()` sends board updates.
- Key enhancements:
  - Useful low-level peer sync helper.
  - Partially overlaps with context-based multiplayer architecture.

## app/api/

### 🟨 farcaster/route.ts
- Key notes:
  - `GET()` resolves Farcaster profile by wallet address using Neynar bulk-by-address endpoint.
  - Returns normalized profile payload (`fid`, `displayName`, `username`, `avatarUrl`) for client syncers.
- Key enhancements:
  - Important fallback when frame context is unavailable.
  - Depends on `NEYNAR_API_KEY` and should include rate-limit handling.

### 🟨 friends/route.ts
- Key notes:
  - `GET()` fetches following list by FID from Neynar.
  - Intersects following wallets with local Supabase `players` to return only in-app registered friends.
- Key enhancements:
  - Smart bridge between social graph and app database.
  - Needs pagination/caching and robust failure handling.

## hooks/

### 🟨 MultiplayerContext.tsx
- Key notes:
  - `hostGame()` creates a custom short room ID and starts Peer host listeners.
  - `joinGame(roomId)` connects to host peer and opens data channel.
  - `sendAction(type, payload)` is the generic network dispatch function.
  - `rollDice()` generates local roll and broadcasts the result to peer.
  - Context state (`roomId`, `connection`, `isLobbyConnected`, `incomingAction`, `lastRoll`) drives lobby + board sync.
- Key enhancements:
  - Clean shared multiplayer state for whole app.
  - Needs stronger anti-desync, reconnection, and message validation.

### 🟩 useMultiplayer.ts (hooks)
- Key notes:
  - Thin wrapper around `useMultiplayerContext()` so UI files consume a simple hook API.
- Key enhancements:
  - Keeps import surface clean and consistent.

### 🟨 useCurrentUser.ts
- Key notes:
  - Fetches player profile by connected wallet from Supabase.
  - Subscribes to realtime `players` updates for immediate profile refresh after sync.
  - Generates fallback display name when username is missing: `Guest <LAST_6_CHARS>`.
- Key enhancements:
  - Strong fallback identity behavior for missing profiles.
  - Should include better error-state exposure for UI.

## lib/

### 🟩 supabase.ts
- Key notes:
  - Creates single Supabase client from public env vars.
  - Uses placeholders + warning logs when env is missing to keep builds from crashing.
- Key enhancements:
  - Stable shared client setup across app/API.

### 🟨 matchRecorder.ts
- Key notes:
  - `recordMatchResult(winnerAddress, roomCode, gameMode, participants)` performs 3 operations:
    - Insert match row into `matches`
    - Increment winner `total_wins` and `total_games`
    - Increment `total_games` for other participants
  - Designed so match record can succeed even if stats update partially fails.
- Key enhancements:
  - Good first pass for post-match persistence.
  - Should be transactional/server-side hardened to avoid partial update drift.

## Styling & Assets

### 🟨 globals.css / page.module.css
- Key notes:
  - Provide app-wide visual system: glass panels, board UI, control states, and theme styling hooks.
- Key enhancements:
  - UI identity is strong and consistent.
  - Further component-level CSS decomposition can reduce global complexity.

### 🟥 public assets (avatars/og/background parity)
- Key notes:
  - Some referenced assets are still incomplete or placeholder in current flow.
- Key enhancements:
  - Final asset pack is needed for fully polished production release.

## Pending Focus (Next Discussion Order)

1. `Board.tsx` and `MultiplayerContext.tsx`: finalize sync-safe turn engine.
2. `matchRecorder.ts` + API routes: move critical writes to hardened server flow.
3. `FriendsPanel.tsx`, `MessagesPanel.tsx`: replace mock social data with real transport.
4. `WalletConnectCard.tsx` + game state: wire real bet/payment lifecycle.
5. Testing layer for rules, sync, and match persistence.
