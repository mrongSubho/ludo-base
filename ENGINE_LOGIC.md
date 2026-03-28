# Ludo Base: Project Brain & Engine Logic

This document serves as the primary technical reference for all core systems, game rules, and architectural decisions implemented in the Ludo Base project. **Consider this the definitive "Source of Truth" for engine logic.**

---

## 1. Vision & Core Pillars
- **Onchain Arena:** A high-end competitive Ludo game for the Base ecosystem.
- **Fair Play First:** All dice rolls are provably fair and outcomes are verifiable.
- **Mesh-Multiplayer:** A hybrid P2P/Realtime architecture for low-latency gameplay.
- **Farcaster First:** Optimized for Farcaster Frames and mini-apps.

---

## 2. Architecture [The Network Layer]

### 2.1 Matchmaking & Lifecycle (`EdgeServerClient` & `join_matchmaking` RPC)
The matchmaking system is a **Hybrid Hub** that prioritizes the high-performance **Edge Server (Render)** with a resilient **Supabase Failover**.
- **Phase 1: Edge Match (0-5s):** The client attempts a WebSocket connection to the Edge Server (`find_match`).
    - **WebSocket handshakes** provide sub-second latency for pairing.
    - **Instant Reveals:** The Edge server returns participant metadata (usernames, XP, levels) immediately, allowing for a premium "Match!" screen before P2P sync.
- **Phase 2: Supabase Fallback (5s+):** If the Edge Server is offline or slow, the client falls back to the `join_matchmaking` RPC.
    - **Advisory Locks:** Prevents race conditions during pairing.
    - **Expansion (15s+):** Optional wager range expansion (+/- 20%, +/- 50%).
- **Verification Token:** Both paths generate a `validation_token`. This token is required for the P2P handshake, ensuring only authorized participants can join a specific match ID.
- **Handover:** 
    - The **Host** calls `hostGame(roomCode, validationToken)`.
    - The **Guest** calls `joinGame(roomCode, validationToken)`.
- **Robustness (Phase 27):**
    - **Guest Retries:** Guests attempt to connect to the Host up to **5 times** with exponential backoff.
    - **Edge Verified UDP:** Matches identified by the Edge server are marked with a diagnostic badge in the UI.
    - **Sync Delay:** Guests wait **800ms** before the first connection attempt to allow Host initialization.

### 2.2 Hybrid Mesh Communication Model
- **Reliability Layer (Supabase Broadcast):** The primary channel for high-frequency game actions (dice rolls, token moves, turns). Subscribing to `game-room-<roomCode>` ensures low-latency delivery across the Supabase global mesh.
- **P2P Identity & Initial Handshake (PeerJS):** Still strictly utilized for initial peer discovery, identity validation (`validation_token`), and specialized profile synchronization (`SYNC_PROFILE`). 
- **Mesh Redundancy:** Actions are signed with a unique `actionId`. The engine implements a processed actions Set (`processedActionsRef`) to deduplicate payloads received via both PeerJS and Supabase.
- **Cleanup:** Automatically clears searching tickets upon component unmount and forces immediate termination of stale sessions to prevent ghost matches.

---

## 3. Gameplay [The Rules of War]

### 3.1 Classic & Power Modes
- **Classic:** Standard Ludo rules with tokens, capture, and bonus turns.
- **Power:** Inclusion of special power tiles (Shield, Bomb, Warp, Boost) placed randomly on the board.

### 3.2 Seating & Turn Order
- **Seating Axis:** Players are assigned to corners: `Bottom-Left (BL)`, `Bottom-Right (BR)`, `Top-Right (TR)`, or `Top-Left (TL)`.
- **Turns:** Anti-clockwise rotation.
- **Diagonal Partnership (2v2):** Partners always sit diagonally opposite (`BL+TR` or `BR+TL`).

### 3.3 Movement & Capture (Force Mechanics)
- **Home Exit:** Requires a `DICE_MAX` (6) to move from base (`BASE_INDEX: -1`) to start tile (0).
- **Exact Finish:** Tokens land exactly on `BOARD_FINISH_INDEX` (57); over-roll results in no movement.
- **The Force System:** Multiple tokens from the same team on one square increase that square's "Force."
- **Capture Rule:** To capture an opponent, your team's Force on that square must be >= their Force.
- **Safe Zones:** 8 "Star" squares provide immunity to capture regardless of Force.
- **Home Lane:** Tokens enter the protected home lane at `HOME_LANE_START_INDEX` (52).

### 3.4 2v2 Teammate Assist
- Once a player has finished all 4 of their own tokens, they can move their teammate's tokens during their own turn. 
- **Victory:** A team wins only when all 8 tokens (4 per player) have reached the Finish square.

### 3.5 Rule Exceptions
- **Three Sixes:** Rolling three consecutive `6`s skips the third roll and passes the turn.
- **Bonus Turn:** Received for rolling a `6`, capturing an opponent, or reaching the finish tile.

---

## 4. Board Intelligence [Spatial Systems]

### 4.1 Grid & Perimeter 
- **Grid:** 15x15 pixel-perfect layout.
- **Pathing System:** Tokens move around a global parity index map (0 to 51). The `getBoardCoordinate(pos, color, colorCorner)` calculates raw row/col rendering coordinates on the fly.
- **Home Lane System:** Tokens enter their designated colored Home stretch at positions 52 through 57.
- **Deprecation:** The legacy static `playerPaths` array map has been structurally ripped out in favor of purely mathematical parity calculations, drastically reducing state bloat.

### 4.2 Safe Positioning
Standardized star positions: `{r:2, c:9}, {r:7, c:2}, {r:9, c:14}, {r:14, c:7}` (and their 4 rotations).

---

## 5. Human Integrity [Behavioral Guardrails]

### 5.1 AFK & Kick System
- **Turn Timer:** 15 seconds.
- **Strikes:** Failing to act on time results in a "Strike" and an auto-move.
- **Expulsion:** 3 strikes total throughout the match results in an immediate kick. The player is replaced by a Bot, and their rewards are forfeited.
- **Ultimatum:** A 10s "Are you still there?" screen appears after 4 consecutive missed actions.

### 5.2 Bot Heuristics (`aiEngine.ts`)
Bots prioritize actions via `calculateMoveScore` using configurable `AI_SCORES`:
1.  **Reach Finish Zone (+200):** Safely bringing a token home.
2.  **Power Tile Hunting (+120):** Aggressive targeting of power-up squares.
3.  **Capture Token (+100):** Aggressive hunting of opponent tokens.
4.  **Reinforce Ally (+60):** Building Force on a square with an ally.
5.  **Enter Safe Zone (+50):** Moving to defensive star squares.
6.  **Exit Base (+40):** Bringing tokens out of the base.
7.  **Enter Home Lane (+25):** Prioritizing entries to the protected home stretch.
8.  **Progression (+1x):** Small reward for each step moved towards the finish.

### 5.3 Authority Logic (`isAuthority`)
In multiplayer networked matches, turn orchestration (AI moves, AFK detection, state transitions) is strictly limited to the **P2P Host** (or the designated `isComputeHost` if the original host leaves). 
- **Authority Calculation**: `isHost || isComputeHost` in networked matches; `true` for all local matches.
- **Conflicts**: Guests explicitly reset `isBotMatch` to `false` upon joining to prevent redundant or conflicting AI turn orchestration in the same match ID.
- **Start-Game Sync**: The Host broadcasts the definitive `isBotMatch` state and `initialBoardConfig` to all Guests via the `START_GAME` signal.

### 5.4 Strategic Power Usage
AI evaluates power usage via `getBestPowerUsage` (`aiEngine.ts`) independently of movement:
- **Shield:** Triggered if any ally token is vulnerable to an opponent within 6 steps.
- **Bomb:** Triggered if an opponent token is within landing range of a multi-token capture.
- **Boost/Warp:** Used strategically to accelerate finishing or clear dangerous zones.

---

## 6. UI & UX Aesthetics [app/components/Board.tsx, etc.]
### UI/UX Aesthetics
- **Token Pulse**: Active player tokens pulse to indicate they are ready for action.
- **Screen Shake**: Capturing an opponent triggers a subtle board-wide vibration.
- **Diagonal Seating (1v1 & 2v2):** 
    - Partners and 1v1 opponents are **physically enforced** to be diagonally opposite (`BL+TR` or `BR+TL`).
    - Color assignments are secondary to physical position; the engine ensures the two active players are always opposite in the game loop.
- **Celebration Glow**: The central Finish Zone emits a cyan/purple glow when a player wins.
- **Match Reveal Overlay**: High-intensity "MATCH!" screen with glassmorphism, rival profile fetching (username/avatar), and match criteria (1v1, mode, wager).
- **Edge Diagnostic HUD**: Redesigned bottom-anchored HUD showing `📡 EDGE PRIMARY` or `SUPABASE FALLBACK` status, ensuring users are aware of the connection engine.

### Technical Guardrails
- **Identity & Naming Guard**: 
    - **Convention**: Players without a resolved social identity default to **`Guest [Last 6 Uppercase]`** (e.g., `Guest D1F23A`) derived from their wallet address.
    - **Resolution**: The `ProfileSyncer` component attempts to resolve decentralized profiles via Farcaster Frame SDK, Neynar API, and OnchainKit (Base Names/ENS).
    - **Sync**: Once resolved, the profile is broadcast via a specialized `SYNC_PROFILE` event in `TeamUpContext.tsx`, updating the lobby's `participants` list in real-time.
- **Atomic Ticket Purging**: Initiating a new search (`startSearch`) triggers an immediate purge of all stale `searching` records for that player's wallet, preventing "Shadow Matches" with orphaned sessions.
- **Safe Match Cancellation**: Users can safely exit the "Match Found" screen before the P2P synchronization finishes without losing coins or rating points.
- **Hybrid P2P Synchronization**: The game only starts once all PeerJS slots are occupied *and* the Host signals `START_GAME` via Supabase, ensuring all participants are connected before the board loads.
- **State Synchronization**: Strictly synced `roomCode` and `matchId` state across `useMatchmaking` and `QuickMatchPanel` to prevent UI stalls.
- **Matchmaking Realtime**: The `matchmaking_queue` table must be enrolled in the `supabase_realtime` publication with `REPLICA IDENTITY FULL`. This ensures "Waiters" (Hosts) are notified immediately when an opponent joins via the RPC.
- **Joiner Synchronization Delay**: Joiners wait for joined **1500ms** to allow Host P2P ID registration.
- **Diagnostic Slot Monitoring**: Real-time logging of slot synchronization status to identify which peer is blocking the match start.
- **Strict-Mode Stability**: Core engine files (`useGameActions.ts`) strictly isolate state-mutating side effects (like `setTimeout` for turn switching and AI moves) outside of `setLocalGameState` updater callbacks to prevent Concurrent React double-invocation from launching "spinning turn" loops.
- **Modular Game Logic**: Core logic is decoupled from hooks. `processMove`, `calculateNextPosition`, and `getBoardCoordinate` handle discrete, testable game rules.
- **Centralized Constants**: All engine parameters (delays, indices, scores) are imported from `lib/constants.ts` to ensure consistency.
- **Sandwich Layout**: All panels are vertically centered with fixed top/bottom gutters (`top-64`, `bottom-80`).
- **Presence**: Realtime tracking of online friends via the `PresenceManager`.

---

## 7. Technical Guardrails [Quality of Service]

### 7.1 Provably Fair Dice (Edge Function)
To prevent front-end cheating and to replace the overly-complex hash commitment scheme, all dice rolls are executed via a Supabase Edge Function (`/functions/v1/roll-dice`):
1. Client broadcasts a `REQUEST_ROLL` intent (`isRolling`, UI spins).
2. Client queries the `roll-dice` Edge Function, returning a cryptographically secure 1-6 result.
3. Client broadcasts `ROLL_RESULT` with the fetched value.
4. **Anti-Drop Security:** If a player receives a bad Edge Function roll and drops the payload instead of broadcasting it, the engine's built-in 15s turn timer (`useGameTimer.ts`) will eventually expire, hitting the user with an AFK strike and forcing an auto-move.

### 7.2 End-to-End Encryption
Gameplay intents and lobby chats are encrypted using `AES-GCM` 256-bit keys derived from the shared secrets of the participants' wallet addresses.

### 7.3 Player Progression
- **Level:** `floor(sqrt(xp / 100)) + 1`.
- **Rank Tiers:** Bronze (0) -> Silver (301) -> Gold (901) -> Platinum (1801) -> Diamond (3001) -> Arena Master (5001+).

---

## 7. UI & UX Aesthetics [app/components/HeaderNavPanel.tsx, etc.]
- **Sandwich Layout:** All panels are vertically centered with fixed top/bottom gutters (`top-64`, `bottom-80`).
- **Dynamic Design:** Use of glassmorphism, pulse animations, and interactive "Pill" headers.
- **Presence:** Realtime tracking of online friends via the `PresenceManager`.

---

## 8. GambleFi Spectator System [hooks/, supabase/functions/resolve-bet/]

> Added: 2026-03-23 | Status: Phase 1–3 complete, Phase 4 (UI) in progress

### 8.1 Architecture: State-Sync Streaming ("Zero-Video")

Spectators do **not** watch a video stream. Instead, they subscribe to the same Supabase Realtime Broadcast channel as players (`game-room-${roomCode}`) via the `useSpectatorSync` hook. Their browser receives the same `GameAction` payloads and re-renders `Board.tsx` locally in `spectatorMode`.

This approach costs zero additional bandwidth per spectator and scales horizontally with Supabase infrastructure.

```
[Host] → broadcastAction() → Supabase Broadcast Channel → [Players] + [Spectators]
                                                                          ↓
                                                             useSpectatorSync() applies
                                                             game state locally → Board.tsx renders
```

### 8.2 Betting Window Protocol (V2 Hardened)

The host broadcasts a `BET_WINDOW_OPEN` event **before** initiating the dice commit. After 3 seconds, the host broadcasts `BET_WINDOW_CLOSED` with an ISO timestamp. **DICE_COMMIT is only sent after BET_WINDOW_CLOSED.** 

**Security V2:** The `settle_match_bets` RPC on Supabase performs a server-side check ensuring `NOW() > window_closed_at`. This prevents front-running even if the client-side Edge Function trigger is spoofed.

**State machine:** `Idle → WindowOpen → WindowClosed → DiceReveal → Resolution (RPC V2) → Idle`

### 8.3 New Game Action Types

Added to `GameActionType` in `lib/types.ts`:

| Event | Sender | Payload |
|-------|--------|---------|
| `BET_WINDOW_OPEN` | Host | `{ windowId, betType, expiresAt, matchId }` |
| `BET_WINDOW_CLOSED` | Host | `{ windowId, windowClosedAt }` |

### 8.4 New Hooks

| Hook | File | Purpose |
|------|------|---------|
| `useBettingWindow` | `hooks/useBettingWindow.ts` | Host-side: opens/closes betting windows, fires callback for dice proceed |
| `useSpectatorSync` | `hooks/useSpectatorSync.ts` | Spectator-side: subscribes to broadcast, applies game state locally |
| `useSpectatorPresence` | `hooks/useSpectatorPresence.ts` | Live spectator count via Supabase Presence on `spectators-${roomCode}` |

### 8.5 Edge Function: `resolve-bet`

Deployed to Supabase (slug: `resolve-bet`, JWT-protected). Acts as a secure relay to the `settle_match_bets` RPC. It handles the mapping of game events (dice roll values, winner addresses) to the database resolution logic. Idempotent via `WHERE status = 'pending'`. 

**Tokenomics split (5% of total spectator bet volume):**
- 3% → match players (split equally)
- 2% → protocol treasury

### 8.6 New Database Tables

| Table | Purpose |
|-------|---------|
| `live_matches` | Betting window lifecycle per match (open/closed/resolving) |
| `spectator_bets` | All spectator wagers with timing guard + idempotency columns |

See `supabase/schema_list.md` Phase 4 for full DDL and RLS policies.

---
*Created by Antigravity AI for Ludo Base.*
