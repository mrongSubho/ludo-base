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

### 2.1 Matchmaking & Lifecycle (`join_matchmaking` RPC)
The matchmaking system uses PostgreSQL advisory locks to prevent race conditions during player pairing.
- **Search (0-15s):** Exact match search via RPC.
- **Expansion (16-29s):** Optional wager range expansion (+/- 20%, +/- 50%, or any lower).
- **Match Found:** The RPC returns a `match_id`, a stable `room_code`, and a `role` (`host` or `guest`).
- **Handover:** 
    - The **Host** (the player already in the queue) calls `hostGame(roomCode)`.
    - The **Guest** (the searcher who found the match) calls `joinGame(roomCode)`.
- **Robustness (Phase 7):**
    - **Guest Retries:** Guests now attempt to connect to the Host up to **5 times** with exponential backoff if the host room isn't ready.
    - **Sync Delay:** Guests wait **800ms** before the first connection attempt to allow Host initialization.
    - **Clean Handshake:** PeerJS connection logic is strictly synchronized to prevent "stuck" reveal screens.

### 2.2 Hybrid Communication Model
- **Primary:** PeerJS (WebRTC) for low-latency turns, dice sync, and movement.
- **Secondary (Relay):** Supabase Realtime Broadcast acts as a fallback or global relay for:
    - Lobby events and invites.
    - Mirroring gameplay intents (`broadcastAction`) to ensure all participants stay in sync.
- **Audit:** All actions are signed with an `actionId` to prevent double-processing.
- **Cleanup:** Automatically clears searching tickets upon component unmount to prevent ghost matches.

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
- **Home Exit:** Requires a `6` to move from home base (-1) to start tile (0).
- **Exact Finish:** Tokens land exactly on tile 57; over-roll results in no movement.
- **The Force System:** Multiple tokens from the same team on one square increase that square's "Force."
- **Capture Rule:** To capture an opponent, your team's Force on that square must be >= their Force.
- **Safe Zones:** 8 "Star" squares provide immunity to capture regardless of Force.

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
- **Path:** 52 shared perimeter cells.
- **Dynamic Perspective:** The board and its path are dynamically rotated (via `rotatePath()`) based on the client's assigned corner, ensuring the player always sees their tokens starting from their perspective.

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
Bots prioritize actions based on a calculated score:
1.  **Finish Zone (+150):** Safely bringing a token home.
2.  **Power Tile Hunting (+120):** Aggressive targeting of power-up squares.
3.  **Capture (+100):** Aggressive hunting of opponent tokens.
4.  **Reinforcement (+60):** Building Force on a square with an ally.
5.  **Safe Zone (+50)::** Moving to defensive star squares.
6.  **Home Exit (+40):** Bringing tokens out of the base.
7.  **Safe Lane (+30):** Prioritizing entries to the home stretch.

### 5.3 Strategic Power Usage
AI evaluates power usage independently of movement:
- **Shield:** Triggered if an opponent is within 6 steps of any ally token.
- **Bomb:** Triggered if an opponent token is within range and currently on a non-safe square.
- **Boost/Warp:** Triggered when a token is in the final quadrant to accelerate the finish.

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
- **Match Optimizer Dock**: Redesigned bottom-anchored HUD for search expansion options, replacing intrusive central popups.

### Technical Guardrails
- **Profile-Sync Guard**: The game transitions to the board **only after** all participants have synchronized their real usernames and avatars. This prevents "Guest" placeholders from persisting on the final board.
- **Atomic Ticket Purging**: Initiating a new search (`startSearch`) triggers an immediate purge of all stale `searching` records for that player's wallet, preventing "Shadow Matches" with orphaned sessions.
- **Safe Match Cancellation**: Users can safely exit the "Match Found" screen before the P2P synchronization finishes without losing coins or rating points.
- **P2P Synchronization**: The game only starts once all PeerJS slots are occupied, ensuring all participants are connected before the board loads.
- **State Synchronization**: Strictly synced `roomCode` and `matchId` state across `useMatchmaking` and `QuickMatchPanel` to prevent UI stalls.
- **Matchmaking Realtime**: The `matchmaking_queue` table must be enrolled in the `supabase_realtime` publication with `REPLICA IDENTITY FULL`. This ensures "Waiters" (Hosts) are notified immediately when an opponent joins via the RPC.
- **Joiner Synchronization Delay**: Joiners wait for joined **1500ms** to allow Host P2P ID registration.
- **Diagnostic Slot Monitoring**: Real-time logging of slot synchronization status to identify which peer is blocking the match start.
- **Sandwich Layout**: All panels are vertically centered with fixed top/bottom gutters (`top-64`, `bottom-80`).
- **Presence**: Realtime tracking of online friends via the `PresenceManager`.

---

## 7. Technical Guardrails [Quality of Service]

### 7.1 Provably Fair Dice
To prevent Host cheating, a hash commitment scheme is used:
1. Both host and guest commit to a `sha256(nonce)`.
2. Once both commitment hashes are received, both reveal their `nonce`.
3. The nonces are combined and hashed to derive the 1-6 result.

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
*Created by Antigravity AI for Ludo Base.*
