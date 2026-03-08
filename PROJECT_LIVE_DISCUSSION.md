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

#### Live Discussion: SnakesBoard.tsx Deep Dive (Section 2)
- What this file is in the system:
  - `SnakesBoard.tsx` is the alternate rules engine for Snakes & Ladders mode.
  - It keeps the same app-level UX patterns (turns, timer, AI, effects) while switching movement rules to linear 1..100 progression.

- Core data model and gameplay mapping:
  - `positions[color]` stores each player’s single token tile position (`0` start, `100` finish).
  - `displayPositions[color]` is used for animation-friendly visual stepping, separated from final logic position.
  - `gamePhase`, `currentPlayer`, `diceValue`, `timeLeft`, `strikes`, and `winner` define the mode state machine.

- Function-by-function behavior notes:
  - `shufflePlayers(playerCount)`:
    - What it does: selects active players and assigns fixed color seats.
    - How it works in game: preserves balanced color layout while reducing players for 2-player mode.
  - `getNextPlayer(current, players)`:
    - What it does: computes the next valid active color based on fixed turn order.
    - How it works in game: skips non-participating colors cleanly in reduced player modes.
  - `getGridPos(n)`:
    - What it does: maps numeric board position to rendered row/column on a serpentine grid.
    - How it works in game: ensures visual token location exactly follows Snakes & Ladders board numbering logic.
  - `checkWin(positions, color)`:
    - What it does: checks whether a player reached tile `100`.
    - How it works in game: triggers final win state and blocks further turns.
  - `showMessage(msg)`:
    - What it does: displays short-lived event text and auto-clears it.
    - How it works in game: communicates bounce, snake bite, ladder climb, and win-adjacent events.
  - `handleRoll(val)`:
    - What it does:
      - validates phase;
      - builds step-by-step path;
      - handles overshoot bounce-back;
      - applies ladder/snake remap after movement;
      - advances turn or grants continuation by rule.
    - How it works in game: this is the central turn executor for Snakes mode.
  - `triggerWinConfetti()`:
    - What it does: runs timed confetti bursts from both sides.
    - How it works in game: creates strong win feedback consistent with Classic mode.

- Snakes/Ladders rule execution:
  - Ladders and snakes are represented as static start/end pairs.
  - Post-roll resolution order:
    - animate movement to target tile;
    - then check ladder or snake start;
    - then animate/commit jump to mapped end tile.
  - Practical effect: players feel both movement and trap/boost transitions, not instant teleport only.

- AI, timer, and AFK behavior in this mode:
  - Turn timer decrements for human turns; timeout can force roll/move behavior.
  - Strike count escalates toward auto-play behavior similar to the classic board.
  - AI uses staged delays to simulate thinking and avoid instant robotic turns.

- Current engineering risks for SnakesBoard:
  - Logic duplication:
    - timer, strike, AI orchestration duplicates patterns already in `Board.tsx`.
  - State complexity:
    - `positions` and `displayPositions` can drift if updates are not sequenced carefully.
  - Testability gap:
    - snake/ladder remap, overshoot bounce, and turn transitions are mostly untested.

- Suggested immediate next refactor plan (for SnakesBoard only):
  - Extract pure helpers (`resolveBounce`, `resolveSnakeLadder`, `nextTurn`) into reusable rule utilities.
  - Standardize turn/timer orchestration with the Classic board through shared hooks.
  - Add deterministic tests for edge cases:
    - overshoot at `97+`,
    - ladder/snake collisions after bounce,
    - timeout during `moving` phase.

### 🟩 Dice.tsx
- Key notes:
  - Encapsulates dice interaction and animation so both board modes can reuse the same roll UX contract.
- Key enhancements:
  - Keeps roll UI consistent between modes.

#### Live Discussion: Dice.tsx Deep Dive (Section 3)
- What this file is in the system:
  - Shared interaction component that emits dice values to board engines.
- How it works in game:
  - Accepts roll triggers from the active player and visually communicates random roll outcome.
  - Keeps roll UX consistent so Classic and Snakes modes feel like one product.
- Why it matters:
  - Decouples roll presentation from rules logic, so we can iterate animation without rewriting turn rules.
- Next improvements:
  - Add disabled/locked state contract so illegal rolls are impossible at component level.
  - Add deterministic test hook for replay/testing scenarios.

### 🟩 ThemeSwitcher.tsx
- Key notes:
  - Initializes theme from `localStorage` on mount.
  - `toggleTheme()` writes selected theme to `localStorage` and updates active button state.
  - Provides four gameplay themes: Pastel, Midnight, Cyberpunk, Classic.
- Key enhancements:
  - Lightweight, predictable UX for theme persistence.

#### Live Discussion: ThemeSwitcher.tsx Deep Dive (Section 4)
- What this file is in the system:
  - Theme state controller for user personalization.
- Function behavior:
  - On mount, loads persisted choice from `localStorage`.
  - `toggleTheme(newTheme)` updates local state and persistence store.
- How it affects gameplay/system:
  - Changes visual environment without disrupting current match state.
  - Works as the source of truth for UI theme preference across sessions.
- Next improvements:
  - Introduce explicit theme context to avoid scattered reads of `localStorage`.
  - Add server-side profile persistence for cross-device theme sync.

### 🟩 AudioToggle.tsx
- Key notes:
  - Controls persisted SFX/music preference flags that are consumed by the audio hook.
- Key enhancements:
  - Player can mute quickly without leaving the current flow.

#### Live Discussion: AudioToggle.tsx Deep Dive (Section 5)
- What this file is in the system:
  - User-facing control surface for runtime audio flags.
- How it works:
  - Writes `ludo-sfx` and `ludo-music` preferences to `localStorage`.
  - `useAudio.ts` reads these flags before emitting effects/ambient audio.
- How it affects gameplay/system:
  - Provides immediate accessibility control during active turns.
  - Keeps audio experience predictable across reloads.
- Next improvements:
  - Add explicit “muted” UI indicator in board HUD.
  - Unify toggle logic with settings drawer to avoid duplicate state behavior.

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

#### Live Discussion: ProfileSyncer.tsx Deep Dive (Section 6)
- What this file is in the system:
  - Background profile identity resolver + persistence bridge.
- Function behavior:
  - Pulls wallet state from wagmi.
  - Tries identity sources in priority order:
    - Frame SDK user context
    - `/api/farcaster` wallet lookup
    - Onchain name/avatar fallback
  - Upserts normalized identity into Supabase `players`.
- How it affects gameplay/system:
  - Keeps player identity coherent across social panels, profile UI, and multiplayer context.
  - Reduces anonymous-user edge cases by always producing fallback identity.
- Next improvements:
  - Add debounce and retry/backoff to reduce repeated network writes.
  - Add sync status event to UI so players can see success/failure state.

### 🟨 WalletConnectCard.tsx
- Key notes:
  - Renders OnchainKit `Wallet` + `ConnectWallet` button inside branded card UI.
  - Uses mounted-state guard to avoid hydration mismatch on SSR.
- Key enhancements:
  - Wallet entry UX is polished.
  - Connect action is not yet linked to bet/payment flow.

#### Live Discussion: WalletConnectCard.tsx Deep Dive (Section 7)
- What this file is in the system:
  - Front door for authentication/onchain session entry.
- How it works:
  - Delays render until mount, then exposes OnchainKit wallet connect CTA.
  - Keeps onboarding UI isolated from game rule components.
- How it affects gameplay/system:
  - Gates identity-aware features (profile sync, stats persistence, social).
  - Currently connect-only, not transaction lifecycle-aware.
- Next improvements:
  - Emit post-connect callbacks with wallet metadata for match setup.
  - Integrate wager eligibility checks before entering paid modes.

### 🟨 GameLobby.tsx
- Key notes:
  - `handleHost()` calls `hostGame()` from multiplayer hook and creates sharable room code.
  - `handleJoin()` validates room input then calls `joinGame(roomId)`.
  - Switches to connected loading state once lobby connection is established.
- Key enhancements:
  - Practical prototype for room-based entry.
  - Needs integration with stronger matchmaking/recovery states.

#### Live Discussion: GameLobby.tsx Deep Dive (Section 8)
- What this file is in the system:
  - Match entry coordinator for peer room sessions.
- Function behavior:
  - `handleHost()` starts host peer and exposes room code.
  - `handleJoin()` validates input and attempts guest connection.
- How it affects gameplay/system:
  - Converts manual peer setup into a user-facing flow.
  - Controls transition from pre-game state to connected board state.
- Next improvements:
  - Add reconnect and timeout states for failed/jittery joins.
  - Add copy/share actions and lightweight room validation UX.

### 🟨 FriendsPanel.tsx
- Key notes:
  - Organizes social UX into `game`, `base`, and `requests` tabs.
  - `renderFriendList()` and `renderRequestList()` centralize list-row rendering.
  - Includes action affordances (DM, accept, reject) and status badges.
- Key enhancements:
  - Clear social structure for future real data.
  - Still mock-data driven.

#### Live Discussion: FriendsPanel.tsx Deep Dive (Section 9)
- What this file is in the system:
  - Social graph surface for discovery, requests, and direct interactions.
- Function behavior:
  - `renderFriendList()` renders active friend rows with status and DM action.
  - `renderRequestList()` handles incoming/sent request states.
- How it affects gameplay/system:
  - Defines social interaction model before backend wiring.
  - Establishes expected status vocabulary used elsewhere (`Online`, `In Match`, `Offline`).
- Next improvements:
  - Replace mock arrays with API-driven state from friends endpoints.
  - Wire accept/reject/DM actions to real mutations and optimistic UI.

### 🟨 Leaderboard.tsx
- Key notes:
  - `getStats()` supports multiple ranking strategies (tier hierarchy, daily UTC window, monthly UTC window).
  - Adds scope filtering (`global` vs `friends`) before ranking.
  - Uses quarter tooltip to communicate season-reset concept.
- Key enhancements:
  - Ranking logic contract is well-defined.
  - Still in-memory/mock data.

#### Live Discussion: Leaderboard.tsx Deep Dive (Section 10)
- What this file is in the system:
  - Competitive ranking presentation layer.
- Function behavior:
  - `getStats(tab, scope)` filters and sorts entries by ranking mode.
  - Tier mode applies tier-stage hierarchy weights.
  - Daily/monthly modes use UTC boundary filters.
- How it affects gameplay/system:
  - Encodes ranking semantics that backend must match exactly.
  - Sets seasonal expectations via quarter reset messaging.
- Next improvements:
  - Move ranking computation to server for consistency/trust.
  - Add pagination and rank-change deltas for heavy datasets.

### 🟨 MissionPanel.tsx
- Key notes:
  - `getMissions()` returns tab-specific mission sets (`daily`, `weekly`).
  - Progress state maps into visual bars, reward tags, and claim/completed CTA states.
- Key enhancements:
  - Mission model is ready for backend sync.
  - Reward claiming is not tied to persistent economy yet.

#### Live Discussion: MissionPanel.tsx Deep Dive (Section 11)
- What this file is in the system:
  - Progression/reward panel for retention loops.
- Function behavior:
  - `getMissions(tab)` selects mission set by cadence.
  - UI computes completion and progress percentage per mission.
- How it affects gameplay/system:
  - Provides clear mission schema (`type`, `target`, `current`, `reward`) for backend contracts.
  - Encourages repeat sessions through visible progression.
- Next improvements:
  - Add server-side claim validation and anti-double-claim protection.
  - Sync mission timers with canonical UTC reset windows.

### 🟨 MarketplacePanel.tsx
- Key notes:
  - Defines robust marketplace data types: `MarketItem`, `MarketTrait`, `MarketActivity`, rarity classes.
  - Represents NFT-style metadata including chain info, collection stats, traits, and activity history.
  - Supports category-based inventory browsing (`items`, `themes`, `dice`).
- Key enhancements:
  - Excellent schema-level groundwork.
  - Real purchase/list/ownership transactions remain pending.

#### Live Discussion: MarketplacePanel.tsx Deep Dive (Section 12)
- What this file is in the system:
  - Economy/catalog UI for cosmetic and collectible assets.
- Function behavior:
  - Uses rich typed models for item metadata, rarity, chain info, and trade history.
  - Supports category filtering for themes/items/dice.
- How it affects gameplay/system:
  - Establishes contract for future onchain/offchain inventory fusion.
  - Separates presentation-ready asset metadata from transaction plumbing.
- Next improvements:
  - Connect listing/purchase state to wallet + contract transaction status.
  - Add ownership verification and cache strategy for inventory reads.

### 🟨 UserProfilePanel.tsx
- Key notes:
  - Local profile editor for avatar cycling, display name updates, and privacy toggles.
  - Animated performance widgets (wins, win-rate donut, streak, matches).
- Key enhancements:
  - Strong visual profile experience.
  - Not fully bound to persistent profile writes yet.

#### Live Discussion: UserProfilePanel.tsx Deep Dive (Section 13)
- What this file is in the system:
  - Player identity and personal stats presentation surface.
- Function behavior:
  - Local state handles name edits, avatar cycling, and privacy toggle state.
  - Animated stat cards visualize engagement and performance.
- How it affects gameplay/system:
  - Provides user-facing profile controls before full account settings backend.
  - Creates target schema for eventual profile mutation endpoints.
- Next improvements:
  - Bind editable fields to persisted profile mutations.
  - Pull stats from authoritative match history rather than static values.

### 🟨 MessagesPanel.tsx / PlayerProfileSheet.tsx
- Key notes:
  - Messages view currently acts as placeholder inbox state.
  - Player profile sheet is an in-match quick action surface (friend/DM/block).
- Key enhancements:
  - Shared slide-panel UI language is consistent.
  - Messaging backend and moderation actions are still pending.

#### Live Discussion: MessagesPanel.tsx + PlayerProfileSheet.tsx Deep Dive (Section 14)
- What these files are in the system:
  - Communication placeholder (`MessagesPanel.tsx`) + contextual in-match action sheet (`PlayerProfileSheet.tsx`).
- Function behavior:
  - Messages panel currently returns empty-state UX.
  - Profile sheet exposes social moderation actions at point-of-play.
- How they affect gameplay/system:
  - Define future chat/moderation workflow and contextual social actions.
  - Keep social actions close to gameplay for lower friction.
- Next improvements:
  - Add real conversation threads, unread counts, and send pipeline.
  - Add block/report persistence and moderation state enforcement.

### 🟩 FrameProvider.tsx
- Key notes:
  - Calls `sdk.actions.ready()` on mount so Farcaster frame lifecycle is correctly initialized.
- Key enhancements:
  - Ensures frame-hosted startup reliability.

#### Live Discussion: FrameProvider.tsx Deep Dive (Section 15)
- What this file is in the system:
  - Environment bootstrapper for Farcaster-hosted runtime.
- Function behavior:
  - Executes frame readiness handshake in `useEffect`.
  - Wraps child tree so frame init runs once at app boot.
- How it affects gameplay/system:
  - Prevents frame-only APIs from being used before host is ready.
  - Stabilizes cross-context behavior between browser and frame environments.
- Next improvements:
  - Add explicit fallback state when frame init fails.
  - Emit frame readiness status to analytics/debug tooling.

### 🟨 HeaderNavPanel.tsx
- Key notes:
  - Renders top dashboard nav with token pill, user identity, unread DM badge, and settings trigger.
  - Accepts `unreadCount`, `finalName`, and `finalAvatar` from parent state/hooks.
- Key enhancements:
  - Separates header responsibilities from page orchestration.
  - Token balance and level are currently hardcoded UI values.

#### Live Discussion: HeaderNavPanel.tsx Deep Dive (Section 16)
- What this file is in the system:
  - Top navigation and status surface for dashboard mode.
- Function behavior:
  - Displays user identity snapshot and unread messages signal.
  - Emits `onMessagesClick` and `onSettingsClick` to parent orchestrator.
- How it affects gameplay/system:
  - Centralizes “global attention” indicators before entering match flow.
  - Keeps notification UX stable regardless of active tab.
- Next improvements:
  - Bind token/level values to real backend stats.
  - Add optimistic unread reset behavior when opening messages.

### 🟨 FooterNavPanel.tsx
- Key notes:
  - Hosts bottom navigation tabs and opens slide panels for profile/friends/leaderboard/mission/market/messages.
  - Polls pending friendship count every 15s for badge updates.
- Key enhancements:
  - Unified tab-to-panel routing logic.
  - Could switch from polling to realtime channel for lower latency.

#### Live Discussion: FooterNavPanel.tsx Deep Dive (Section 17)
- What this file is in the system:
  - Primary dashboard tab router.
- Function behavior:
  - Tracks active tab state from parent props and mounts corresponding panel components.
  - Executes friend request badge query against `friendships`.
- How it affects gameplay/system:
  - Keeps social/navigation surfaces modular and centrally controlled.
  - Makes dashboard extensible without bloating page-level render logic.
- Next improvements:
  - Replace pending-count polling with Supabase realtime subscriptions.
  - Add centralized panel registry to reduce switch-case growth.

### 🟨 SettingsPanel.tsx
- Key notes:
  - Dedicated full settings surface with audio toggles, theme switcher, support/about links, and sign out action.
  - Reads/writes same audio preference keys (`ludo-sfx`, `ludo-music`).
- Key enhancements:
  - Better long-form settings UX than inline drawer.
  - Some options are presentational placeholders (help/about links).

#### Live Discussion: SettingsPanel.tsx Deep Dive (Section 18)
- What this file is in the system:
  - Expanded control center for account and preference management.
- Function behavior:
  - Maintains local UI state for SFX/music and persists to storage.
  - Uses wagmi `disconnect()` for sign-out flow.
- How it affects gameplay/system:
  - Provides high-visibility preference controls outside active gameplay.
  - Reduces friction for audio/theme adjustments and account exit.
- Next improvements:
  - Connect support/about actions to routed pages.
  - Add account/session diagnostics in settings surface.

### 🟨 PlayWithFriendsPanel.tsx
- Key notes:
  - Private lobby UX for host/join flows with room code generation, copy, and invite list.
  - Fetches `onchainFriends` and `gameFriends` from `/api/friends?wallet=...`.
- Key enhancements:
  - Rich social-first lobby flow for private sessions.
  - Uses permissive `any` props and should be fully typed.

#### Live Discussion: PlayWithFriendsPanel.tsx Deep Dive (Section 19)
- What this file is in the system:
  - Friend-centric private-match orchestration panel.
- Function behavior:
  - Host tab: create/share room code and launch match when guest joins.
  - Join tab: accept external room code and connect as guest.
  - Nested friend tabs: switch between onchain and in-game friend lists.
- How it affects gameplay/system:
  - Bridges multiplayer transport with social discovery.
  - Makes room-based invites understandable for non-technical users.
- Next improvements:
  - Strongly type panel props and friend payloads.
  - Add invite tracking and delivery acknowledgement.

### 🟨 QuickMatchPanel.tsx
- Key notes:
  - Quick matchmaking UI with searching/expanding/timeout/matched states.
  - Integrates with `useMatchmaking` and starts search automatically on mount.
- Key enhancements:
  - Clear lifecycle UX for queue search and timeout fallback to AI.
  - Search strategy depends heavily on backend queue health.

#### Live Discussion: QuickMatchPanel.tsx Deep Dive (Section 20)
- What this file is in the system:
  - Real-time queue search experience for public matchmaking.
- Function behavior:
  - Starts queue join call, rotates tips, displays elapsed search time.
  - On match found: countdown, join room, then start game.
  - On timeout: offers AI fallback and retry.
- How it affects gameplay/system:
  - Converts backend queue status into user-readable flow.
  - Directly influences retention during wait periods.
- Next improvements:
  - Add explicit network failure state recovery path.
  - Expose queue bucket info (`mode/type/wager`) for debugging.

### 🟨 PublicProfileModal.tsx
- Key notes:
  - Global user profile modal with friend request, block/unblock, report, and DM actions.
  - Loads profile + friend validation + block status + pending request state.
- Key enhancements:
  - Consolidates user-to-user moderation and relationship actions.
  - Contains heavy multi-query logic that can be modularized.

#### Live Discussion: PublicProfileModal.tsx Deep Dive (Section 21)
- What this file is in the system:
  - Public-facing profile inspection and action center.
- Function behavior:
  - Fetches target player data from `players`.
  - Cross-checks friendship via `/api/friends` and `friendships`.
  - Handles `Add Friend`, `Unfriend`, `Block`, `Unblock`, and `Report` mutations.
- How it affects gameplay/system:
  - Enables social trust/safety controls inside game UX.
  - Supports immediate DM and relationship decisions without page navigation.
- Next improvements:
  - Split data-loading and action-mutation logic into dedicated hooks/services.
  - Add stronger optimistic rollback and action error states.

### 🟨 PresenceManager.tsx
- Key notes:
  - Syncs player presence (`Online`, `In Match`, `Offline`) to Supabase.
  - Uses 30s heartbeat and `beforeunload` best-effort offline update.
- Key enhancements:
  - Gives social panels near-realtime status signal.
  - Presence cleanup still relies on DB-side timeout job for stale sessions.

#### Live Discussion: PresenceManager.tsx Deep Dive (Section 22)
- What this file is in the system:
  - Presence heartbeat controller for user status freshness.
- Function behavior:
  - Derives status from current multiplayer/game state and writes into `players`.
  - Sends periodic heartbeat and unload cleanup writes.
- How it affects gameplay/system:
  - Powers friend/message online indicators.
  - Prevents “ghost online” states when paired with cleanup SQL.
- Next improvements:
  - Move heartbeat to channel-based presence if scaling beyond simple polling.
  - Add throttling and backoff on transient write failures.

### 🟨 GameLobbyTest.tsx / app/uitest/page.tsx
- Key notes:
  - UITest flow composes the new modular dashboard stack (`HeaderNavPanel`, `FooterNavPanel`, `SettingsPanel`, `PresenceManager`, lobby panels).
  - Acts as active integration playground for new matchmaking/private-lobby UX.
- Key enhancements:
  - Useful staging area for iterative UI/flow testing.
  - Divergence risk if test page behavior drifts from main app route.

#### Live Discussion: UITest pages Deep Dive (Section 23)
- What these files are in the system:
  - Sandbox integration harness for live UX iteration.
- Function behavior:
  - Orchestrates updated dashboard state machine and panel interactions.
  - Exercises matchmaking, private lobby, public profile modal, and settings flows together.
- How they affect gameplay/system:
  - Speed up validation of composite UX before full merge into main route.
  - Can hide regressions if not kept synchronized with production entrypoint.
- Next improvements:
  - Define explicit parity checklist between UITest and main page.
  - Use feature flags to reduce duplicate orchestration logic.

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

#### Live Discussion: useAudio.ts Deep Dive (Section 24)
- What this file is in the system:
  - Core audio engine hook used by board components.
- Function behavior:
  - `initAudio()` ensures the audio context exists and is resumed when required.
  - Effect methods generate procedural SFX per event type.
  - `playAmbient(theme)` builds theme-specific synth graphs and `stopAmbient()` safely disposes nodes.
- How it affects gameplay/system:
  - Binds feedback timing directly to turn/capture/win events.
  - Keeps game responsive without shipping external audio files.
- Next improvements:
  - Add master gain normalization and dynamic compression.
  - Add reduced-motion/reduced-audio accessibility preferences.

### 🟨 useMultiplayer.ts (app/hooks)
- Key notes:
  - PeerJS-oriented hook for direct host/guest connection and state broadcast/listen.
  - `connectToPeer()` opens guest connection; `broadcastState()` sends board updates.
- Key enhancements:
  - Useful low-level peer sync helper.
  - Partially overlaps with context-based multiplayer architecture.

#### Live Discussion: useMultiplayer.ts (app/hooks) Deep Dive (Section 25)
- What this file is in the system:
  - Lightweight PeerJS adapter for direct state-sync experiments.
- Function behavior:
  - Creates peer instance, exposes local ID, connects as host or guest, and forwards `STATE_UPDATE` messages.
- How it affects gameplay/system:
  - Enables fast multiplayer prototyping.
  - Overlaps with context-based multiplayer flow, which can create architecture ambiguity.
- Next improvements:
  - Merge with `MultiplayerContext.tsx` or clearly split responsibilities.
  - Add message schema validation and reconnect semantics.

### 🟨 useMessages.ts
- Key notes:
  - Messaging hook handling conversations, messages, unread counts, profile hydration, and realtime subscriptions.
  - Applies visibility filtering for per-user soft deletion flags.
- Key enhancements:
  - Strong foundation for realtime chat.
  - Complex state flow would benefit from reducer-based architecture.

#### Live Discussion: useMessages.ts Deep Dive (Section 26)
- What this file is in the system:
  - End-to-end messaging state engine for chat UI.
- Function behavior:
  - Loads initial conversation/message snapshots.
  - Subscribes to realtime inserts/updates for messages and conversations.
  - Hydrates participant profiles and computes sidebar/unread presentation model.
- How it affects gameplay/system:
  - Enables persistent social communication channels.
  - Keeps conversation lists fresh without full refreshes.
- Next improvements:
  - Add message pagination/windowing for large histories.
  - Add delivery/read receipts and retry workflow for failed sends.

## app/api/

### 🟨 farcaster/route.ts
- Key notes:
  - `GET()` resolves Farcaster profile by wallet address using Neynar bulk-by-address endpoint.
  - Returns normalized profile payload (`fid`, `displayName`, `username`, `avatarUrl`) for client syncers.
- Key enhancements:
  - Important fallback when frame context is unavailable.
  - Depends on `NEYNAR_API_KEY` and should include rate-limit handling.

#### Live Discussion: farcaster/route.ts Deep Dive (Section 27)
- What this file is in the system:
  - Server fallback identity endpoint.
- Function behavior:
  - Accepts wallet query param, calls Neynar bulk lookup, returns normalized profile fields.
- How it affects gameplay/system:
  - Supports profile sync outside native frame context.
  - Makes identity enrichment deterministic for wallet users.
- Next improvements:
  - Add strict input validation and standardized error body schema.
  - Add server caching/rate-limit protections for repeated wallet lookups.

### 🟨 friends/route.ts
- Key notes:
  - `GET()` accepts `wallet` and resolves user's Farcaster profile + following graph from Neynar.
  - Returns two datasets: `onchainFriends` (social graph intersection) and `gameFriends` (recent active players).
- Key enhancements:
  - Smart bridge between social graph and app database.
  - Includes status self-healing from `last_played_at`.
  - Needs pagination/caching and robust failure handling.

#### Live Discussion: friends/route.ts Deep Dive (Section 28)
- What this file is in the system:
  - Social graph bridge endpoint.
- Function behavior:
  - Resolves FID from wallet, fetches following users, then extracts verified wallets.
  - Intersects with local `players` table and separately fetches `gameFriends`.
  - Applies “online status drift” correction from `last_played_at`.
- How it affects gameplay/system:
  - Converts external social graph into in-app friend candidates.
  - Reduces noise by returning only users who already exist in our ecosystem.
- Next improvements:
  - Add paging support and response caching.
  - Add retry strategy and partial-failure semantics for downstream API instability.

### 🟨 match/record/route.ts
- Key notes:
  - Server route for recording match outcome and updating player stats.
  - Mirrors logic from `matchRecorder.ts` but executed via API boundary.
- Key enhancements:
  - Allows server-side authorized writes with service role.
  - Still multi-step and non-transactional.

#### Live Discussion: match/record/route.ts Deep Dive (Section 29)
- What this file is in the system:
  - Backend endpoint for post-match persistence.
- Function behavior:
  - Validates payload.
  - Inserts `matches` row.
  - Updates winner and participants aggregate stats.
- How it affects gameplay/system:
  - Decouples client from direct DB mutation for sensitive write path.
  - Currently vulnerable to partial-update drift under failure.
- Next improvements:
  - Move all updates into a single DB transaction/RPC.
  - Add idempotency and request authentication checks.

### 🟨 matchmaking/join/route.ts
- Key notes:
  - Enqueues player into matchmaking bucket through `join_matchmaking` RPC.
  - Supports immediate matched response or search ticket response.
- Key enhancements:
  - Atomic join path via RPC reduces race conditions.
  - Depends on migration/RPC availability.

#### Live Discussion: matchmaking/join/route.ts Deep Dive (Section 30)
- What this file is in the system:
  - Queue entrypoint for quick-match lifecycle.
- Function behavior:
  - Validates join request and calls `join_matchmaking`.
  - Returns matched/searching payload to UI.
- How it affects gameplay/system:
  - Core backend trigger for public matchmaking.
  - If RPC missing/misaligned, quick match fully fails (observed in runtime logs).
- Next improvements:
  - Add schema-version check and friendly fallback errors.
  - Add join throttling and abuse controls.

### 🟨 matchmaking/status/route.ts
- Key notes:
  - Poll endpoint that returns queue ticket state (`status`, `match_id`).
- Key enhancements:
  - Lightweight and compatible with client polling.
  - Should evolve to push/realtime for large-scale efficiency.

#### Live Discussion: matchmaking/status/route.ts Deep Dive (Section 31)
- What this file is in the system:
  - Matchmaking progress lookup API.
- Function behavior:
  - Reads queue row by `ticketId` and returns current state.
- How it affects gameplay/system:
  - Powers searching->matched transition in `useMatchmaking`.
- Next improvements:
  - Add strict ownership validation on ticket reads.
  - Add short-term caching headers for poll efficiency.

### 🟨 matchmaking/cancel/route.ts
- Key notes:
  - Cancellation endpoint marks searching ticket as `cancelled`.
  - Used on timeout, manual cancel, unmount, and visibility changes.
- Key enhancements:
  - Prevents stale search tickets from accumulating.
  - Could include broader cleanup semantics for abandoned sessions.

#### Live Discussion: matchmaking/cancel/route.ts Deep Dive (Section 32)
- What this file is in the system:
  - Queue cancellation API for matchmaking lifecycle cleanup.
- Function behavior:
  - Validates `ticketId` and updates queue row conditionally (`status='searching'`).
- How it affects gameplay/system:
  - Keeps queue quality healthy by pruning abandoned search entries.
- Next improvements:
  - Add cancellation reason tracking for analytics.
  - Add background job to expire stale tickets defensively.

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

#### Live Discussion: MultiplayerContext.tsx Deep Dive (Section 33)
- What this file is in the system:
  - Primary multiplayer state store for UI + board coordination.
- Function behavior:
  - `hostGame()` creates room, initializes host listeners, and syncs profile messages.
  - `joinGame(roomId)` attaches as guest and mirrors incoming action stream.
  - `sendAction()` is the generic outbound transport layer.
  - `rollDice()` demonstrates an example authoritative action message.
- How it affects gameplay/system:
  - Central point of truth for room lifecycle and peer connectivity.
  - Drives lobby-ready state and board event propagation.
- Next improvements:
  - Add ack/sequence IDs to prevent action reordering issues.
  - Add reconnect + stale-connection cleanup policies.

### 🟩 useMultiplayer.ts (hooks)
- Key notes:
  - Thin wrapper around `useMultiplayerContext()` so UI files consume a simple hook API.
- Key enhancements:
  - Keeps import surface clean and consistent.

#### Live Discussion: useMultiplayer.ts (hooks) Deep Dive (Section 34)
- What this file is in the system:
  - Convenience hook adapter over context API.
- Function behavior:
  - Returns `useMultiplayerContext()` directly to keep callers clean.
- How it affects gameplay/system:
  - Standardizes multiplayer imports throughout UI files.
- Next improvements:
  - Keep as-is unless context API becomes large enough to warrant segmented hooks.

### 🟨 useCurrentUser.ts
- Key notes:
  - Fetches player profile by connected wallet from Supabase.
  - Subscribes to realtime `players` updates for immediate profile refresh after sync.
  - Generates fallback display name when username is missing: `Guest <LAST_6_CHARS>`.
- Key enhancements:
  - Strong fallback identity behavior for missing profiles.
  - Should include better error-state exposure for UI.

#### Live Discussion: useCurrentUser.ts Deep Dive (Section 35)
- What this file is in the system:
  - Current user profile query + realtime subscription hook.
- Function behavior:
  - Reads profile once for connected wallet.
  - Subscribes to player-row updates and refreshes local state on change.
  - Computes fallback display name `Guest <LAST_6_CHARS>` when username is absent.
- How it affects gameplay/system:
  - Gives stable identity for headers/profile/social rows.
  - Enables near-instant profile sync reflection after updates.
- Next improvements:
  - Add explicit loading/error states for better UI control.
  - Add request cancellation guards for fast wallet switching.

### 🟨 useGameEngine.ts
- Key notes:
  - New orchestration hook extracted from board component.
  - Integrates pure logic modules (`gameLogic`, `aiEngine`, `boardLayout`) with multiplayer context and audio.
- Key enhancements:
  - Major architecture improvement toward modular gameplay engine.
  - Still needs complete migration to avoid old/new logic overlap.

#### Live Discussion: useGameEngine.ts Deep Dive (Section 36)
- What this file is in the system:
  - Central game state orchestration layer for classic/power multiplayer flow.
- Function behavior:
  - Owns local game state.
  - Syncs guest state from context host updates.
  - Delegates deterministic move logic to `processMove`.
  - Delegates bot decisions to `getBestMove`.
  - Coordinates persistence, effects, and network broadcasts.
- How it affects gameplay/system:
  - Reduces monolithic burden in `Board.tsx`.
  - Enables reusable engine logic for future UI variants.
- Next improvements:
  - Finish migrating all board-side logic into this hook.
  - Add state-machine tests for engine transitions.

### 🟨 useMatchmaking.ts
- Key notes:
  - Client queue lifecycle hook for quick match flow.
  - Manages search status state, timers, polling, timeout, and cancellation.
- Key enhancements:
  - Clear staged lifecycle model (`searching -> expanding -> timeout/matched`).
  - Relies on polling instead of push events.

#### Live Discussion: useMatchmaking.ts Deep Dive (Section 37)
- What this file is in the system:
  - Frontend state machine for matchmaking queue UX.
- Function behavior:
  - `startSearch()` joins queue and begins elapsed timer + status polling.
  - `cancelSearch()` terminates queue ticket and resets local state.
  - Auto-cancels on unmount and visibility loss.
- How it affects gameplay/system:
  - Keeps queue interactions deterministic from user perspective.
  - Prevents ghost queue entries when users navigate away.
- Next improvements:
  - Replace polling with realtime subscriptions.
  - Add exponential backoff for status fetch failures.

## lib/

### 🟩 supabase.ts
- Key notes:
  - Creates single Supabase client from public env vars.
  - Uses placeholders + warning logs when env is missing to keep builds from crashing.
- Key enhancements:
  - Stable shared client setup across app/API.

#### Live Discussion: supabase.ts Deep Dive (Section 38)
- What this file is in the system:
  - Shared Supabase client bootstrap module.
- Function behavior:
  - Reads env config and creates singleton client used across app and APIs.
  - Falls back to placeholders with warning to avoid hard crash in misconfigured dev environments.
- How it affects gameplay/system:
  - Centralizes backend connectivity contract.
  - Prevents repeated client creation and inconsistent config usage.
- Next improvements:
  - Fail fast in production when env vars are missing.
  - Add environment health check utility for startup diagnostics.

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

#### Live Discussion: matchRecorder.ts Deep Dive (Section 39)
- What this file is in the system:
  - Match result persistence helper.
- Function behavior:
  - Inserts match record.
  - Updates winner wins/games.
  - Updates other participants' games.
- How it affects gameplay/system:
  - Connects gameplay outcomes to progression and leaderboard-ready stats.
  - Current multi-step write flow can partially succeed and drift stats.
- Next improvements:
  - Move to single RPC/transaction in database.
  - Add idempotency key by room + winner to prevent duplicate writes.

### 🟨 boardLayout.ts
- Key notes:
  - Pure board geometry module for path generation, safe-cell definitions, and dynamic lane mapping.
  - Exports reusable types and helpers used by engine/logic layers.
- Key enhancements:
  - Strong separation of board math from UI rendering.
  - Reduces geometry regressions by centralizing rules.

#### Live Discussion: boardLayout.ts Deep Dive (Section 40)
- What this file is in the system:
  - Source of truth for classic-board coordinate system.
- Function behavior:
  - Generates shared path, corner slots, player paths, and cell classification.
  - Provides `shufflePlayers()` and arrangement helpers for session setup.
- How it affects gameplay/system:
  - Keeps engine logic and UI aligned on geometry.
  - Enables future board skins without rewriting movement math.
- Next improvements:
  - Add snapshot tests for generated path/cell maps.
  - Separate player template data from geometry constants.

### 🟨 gameLogic.ts
- Key notes:
  - Deterministic core move processor (`processMove`) with capture/trap/team-win logic.
  - Includes utility functions for turn flow and three-sixes handling.
- Key enhancements:
  - Critical step toward testable pure rules engine.
  - Some behaviors still coupled to broader `GameState` shape.

#### Live Discussion: gameLogic.ts Deep Dive (Section 41)
- What this file is in the system:
  - Rule engine for classic/power move resolution.
- Function behavior:
  - Validates movement.
  - Resolves traps and multi-capture with team-force logic.
  - Computes bonus roll and next player.
  - Handles win conditions for FFA and 2v2.
- How it affects gameplay/system:
  - Creates deterministic move outcomes independent of UI.
  - Simplifies debugging and future automated testing.
- Next improvements:
  - Add exhaustive tests for capture/force/truce edge cases.
  - Decouple from context-level `GameState` typing.

### 🟨 aiEngine.ts
- Key notes:
  - Heuristic decision module selecting optimal token move.
  - Scores by win potential, capture value, safety, reinforcement, and progress.
- Key enhancements:
  - Reusable AI strategy independent from component lifecycle.
  - Can be extended with difficulty levels.

#### Live Discussion: aiEngine.ts Deep Dive (Section 42)
- What this file is in the system:
  - Bot move selection engine.
- Function behavior:
  - Enumerates valid move options for roll.
  - Computes weighted score per move.
  - Returns highest-scoring token index.
- How it affects gameplay/system:
  - Controls automated player behavior and timeout auto-play quality.
  - Directly affects match pacing and perceived fairness.
- Next improvements:
  - Add configurable difficulty profiles.
  - Add deterministic seed mode for repeatable tests.

### 🟨 snakesLogic.ts
- Key notes:
  - Deterministic Snakes & Ladders rules (ladders, snakes, bounce-back, bonus turn).
  - Includes next-player helper for active color set.
- Key enhancements:
  - Moves variant logic out of component UI code.
  - Improves consistency and testability for snakes mode.

#### Live Discussion: snakesLogic.ts Deep Dive (Section 43)
- What this file is in the system:
  - Pure rule module for Snakes & Ladders movement resolution.
- Function behavior:
  - `calculateSnakesMove()` resolves overshoot bounce and snake/ladder slide in deterministic order.
  - `getNextPlayerSnakes()` rotates turns among active participants.
- How it affects gameplay/system:
  - Guarantees predictable results for each roll state.
  - Supports cleaner component refactors in `SnakesBoard.tsx`.
- Next improvements:
  - Add detailed tests for chained edge scenarios near `100`.
  - Add optional hooks for animation-step generation.

## migrations/

### 🟨 add_status_columns.sql
- Key notes:
  - Adds `status` and `last_seen_at` to `players` for presence features.
  - Adds indexes for status and last-seen lookup performance.
- Key enhancements:
  - Enables online/offline/in-match UX surfaces.
  - Requires migration parity across environments.

#### Live Discussion: add_status_columns.sql Deep Dive (Section 44)
- What this file is in the system:
  - Presence schema migration.
- Function behavior:
  - Extends `players` table with status heartbeat fields.
  - Adds query indexes to support friend/message panels.
- How it affects gameplay/system:
  - Foundation for realtime social presence indicators.
- Next improvements:
  - Add explicit enum/check constraints for status values.

### 🟨 status_cleanup_job.sql
- Key notes:
  - Defines `update_offline_status()` function for idle-status cleanup.
  - Designed for minute-level scheduling (for example via `pg_cron`).
- Key enhancements:
  - Prevents “forever online” ghost presence.
  - Scheduling setup must be validated per deployment.

#### Live Discussion: status_cleanup_job.sql Deep Dive (Section 45)
- What this file is in the system:
  - DB-side presence self-healing routine.
- Function behavior:
  - Marks stale active users as `Offline` when `last_seen_at` exceeds threshold.
- How it affects gameplay/system:
  - Keeps social status trustworthy even when unload writes fail.
- Next improvements:
  - Align threshold with heartbeat cadence and product expectations.

## supabase/migrations/

### 🟨 20240304_matchmaking_queue.sql
- Key notes:
  - Creates `matchmaking_queue` table and `join_matchmaking` RPC.
  - RPC uses advisory lock + row locking to reduce race conditions in bucket matching.
- Key enhancements:
  - Core backend primitive for quick-match flow.
  - Must be present in DB, otherwise `/api/matchmaking/join` fails.

#### Live Discussion: 20240304_matchmaking_queue.sql Deep Dive (Section 46)
- What this file is in the system:
  - Matchmaking schema + atomic matching procedure.
- Function behavior:
  - Places or matches users within same queue bucket (`mode/type/wager`).
  - Returns JSON payload for searching or matched state.
- How it affects gameplay/system:
  - Central dependency for quick-match viability.
  - Missing migration immediately breaks queue joining.
- Next improvements:
  - Add queue cleanup for expired tickets and stale matched rows.
  - Add telemetry fields for queue-time analytics.

## Styling & Assets

### 🟨 globals.css / page.module.css
- Key notes:
  - Provide app-wide visual system: glass panels, board UI, control states, and theme styling hooks.
- Key enhancements:
  - UI identity is strong and consistent.
  - Further component-level CSS decomposition can reduce global complexity.

#### Live Discussion: globals.css / page.module.css Deep Dive (Section 47)
- What these files are in the system:
  - Global and page-scoped visual contract.
- Function behavior:
  - Define reusable panel, board, typography, and motion styles.
  - Implement theme-affectable style layers used by multiple components.
- How they affect gameplay/system:
  - Ensure UI consistency across game, social, and dashboard surfaces.
  - Large global style surface can increase regression risk during redesign.
- Next improvements:
  - Migrate repeated patterns into smaller design tokens/util classes.
  - Add visual regression checks for board and panel states.

### 🟥 public assets (avatars/og/background parity)
- Key notes:
  - Some referenced assets are still incomplete or placeholder in current flow.
- Key enhancements:
  - Final asset pack is needed for fully polished production release.

#### Live Discussion: public assets Deep Dive (Section 48)
- What this area is in the system:
  - Static visual resources for profile, branding, and environment themes.
- Current behavior:
  - Missing avatar files produce runtime 404s in friend/profile surfaces.
  - Missing/inconsistent OG/background assets reduce share and first-load polish.
- How it affects gameplay/system:
  - Does not break game logic, but directly impacts perceived quality.
  - Creates noisy logs and degraded social/panel presentation.
- Next improvements:
  - Add complete avatar set and align all referenced filenames.
  - Add finalized OG image and validate all theme background mappings.

## Pending Focus (Next Discussion Order)

1. `Board.tsx` and `MultiplayerContext.tsx`: finalize sync-safe turn engine.
2. `matchRecorder.ts` + API routes: move critical writes to hardened server flow.
3. `FriendsPanel.tsx`, `MessagesPanel.tsx`: replace mock social data with real transport.
4. `WalletConnectCard.tsx` + game state: wire real bet/payment lifecycle.
5. Testing layer for rules, sync, and match persistence.
