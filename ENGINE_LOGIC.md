# Ludo Base: Project Brain & Engine Logic

This document serves as the primary technical reference for all core systems, game rules, and architectural decisions implemented in the Ludo Base project. **Consider this the "Source of Truth" for all logic.**

---

## 1. Matchmaking & Search Lifecycle [lib/gameLogic.ts, app/page.tsx, hooks/TeamUpContext.tsx] ✅ **Fully Implemented**

The matchmaking system is designed for high-end competitive play with automated expansion and fallback mechanisms.

### 1.1 Search Phases
- **0s - 15s (Initial Search):** Search for an exact wager match using the `join_matchmaking` RPC.
- **16s - 29s (Expanding State):** An **Expansion Options Popup** appears.
    - **Options:** +/- 20% wager, +/- 50% wager, or "Any Lower Match Fee".
    - **Background:** The original search continues if no selection is made.
- **30s+ (Timeout State):** Search cancels and transitions to the **"Server is Quiet"** screen.

### 1.2 Fallback Logic
- **Non-Automatic AI:** The system *never* forces an AI match automatically. The user must manually select "Play with AI" from the timeout screen.
- **Retry:** Selecting "Retry" resets the timer and triggers a fresh `join_matchmaking` call.

### 1.3 Database RPC (`join_matchmaking`)
- **Signature:** `join_matchmaking(p_player_id, p_game_mode, p_match_type, p_wager, p_wager_min, p_wager_max)`
- **Logic:** Uses an advisory lock on `(mode, type)` buckets. Priority is given to the oldest searching ticket (`created_at ASC`).

---

## 2. Unified Layout System ("Sandwich") [app/page.tsx, app/components/*.tsx] ✅ **Fully Implemented**

To ensure a premium, centered look across all devices, the app uses a global "Sandwich Layout" for panels.

### 2.1 Spatial Constraints
- **Vertical Gaps:** `top-[64px]` (for Header) and `bottom-[80px]` (for Footer).
- **Z-Index Strategy:** Panels reside in a `fixed inset-0 z-[110]` container.

### 2.2 Panel Centering Logic
1.  **Outer Container:** `fixed inset-0 flex justify-center pointer-events-none`.
2.  **Middle Container:** `w-full max-w-[500px] relative h-full`.
3.  **Content Layer:** `flex-1 overflow-hidden flex flex-col items-center justify-center`.

---

## 3. Action Dice & Randomization [app/components/ActionDice.tsx, app/components/Dice.tsx] ✅ **Fully Implemented**

The dice system is engineered to prevent "roll frustration" while maintaining fair distribution.

### 3.1 Shuffle Bag Implementation
- **Pool Size:** 6 faces (2x Team Up, 2x Quick Match, 2x Offline Match).
- **Behavior:** The deck is shuffled and exhausted before re-pooling. This guarantees a variety of results every 3-4 spins.
- **Initial Bias:** The very first spin after app load is internally weighted to favor "Quick Match" to provide a faster entry path for new sessions.

---

## 4. Game Logic: Classic/Power Ludo [lib/gameLogic.ts, lib/boardLayout.ts] ✅ **Fully Implemented**

### 4.1 Turn Order & Seating
- **Rotation:** Always anti-clockwise following physical corners: `Bottom-Left (BL)` → `Bottom-Right (BR)` → `Top-Right (TR)` → `Top-Left (TL)`.
- **Corner Assignment:**
    - **2v2:** Partners are always diagonally opposite (`BL+TR` or `BR+TL`).
    - **FFA/1v1:** Full horizontal/vertical/diagonal shuffle.

### 4.2 Truce & Multi-Capture
- **Force Mechanics:** A square displays the "Force" (number of tokens) of the occupying team.
- **Capture Rule:** `Acting Team Force >= Defending Team Force`.
- **Safe Zones:** 8 specific "Star" squares where tokens can stack safely without being captured, regardless of force.
- **Shields:** Active power-up that makes a specific token immune to capture even outside safe zones.

### 4.3 Specialty Rules
- **Starting:** Must roll a `6` to move a token from Home Base (-1) to Start (0).
- **Exact Finish:** Tokens must land exactly on tile 57. If a roll exceeds the required steps, the token remains stationary.
- **Three Sixes:** Rolling three consecutive `6`s invalidates the third roll and passes the turn immediately.
- **Bonus Turns:** Awarded for (a) rolling a `6`, (b) capturing an opponent token, or (c) reaching the Finish square.
- **Traps:** Landing on an opponent's trap triggers an immediate teleport back to the home base.

### 4.4 2v2 Teammate Assist
- A player can move their teammate's token during their own turn, but **only after** all 4 of their own tokens have reached the Finish square.
- **Winning:** Both teammates must finish all 4 tokens (8 total per team) to win.

---

## 5. Automation & AFK Management [hooks/useGameEngine.ts, lib/gameLogic.ts] ✅ **Fully Implemented**

### 5.1 AFK Strike System
- **Turn Timer:** 15 seconds per turn.
- **Strikes:** Failing to act triggers "Auto-Play" (1 strike).
- **Ultimatum:** 4 consecutive strikes trigger a 10s "Are you still there?" ultimatum.
- **Kick Condition:** 3 total strikes across the match or failing the ultimatum results in an instant kick and conversion to a Bot. Kicked players forfeit rewards.

### 5.2 Auto-Move Mechanics (1.5s Delay)
- **Forced Single Move:** Automatically executes if only one move is valid.
- **Auto-Start:** Automatically brings a token out on a `6` if all others are at home.
- **Final Actor:** Automatically moves the last remaining token if the other 3 are finished.
- **Manual Override:** Clicking during the 1.5s delay cancels the auto-timer and moves the token instantly.
- **Anti-Exploit:** AFK Auto-Play uses strictly random moves instead of the AI priority system to prevent idling advantages.

---

## 7. AI Heuristics ("The Bot Brain") [lib/aiEngine.ts, hooks/useGameEngine.ts] ✅ **Fully Implemented**

The `aiEngine.ts` uses priority-based heuristic scoring:
1.  **Finish Zone (+150):** Highest priority is to bring a token home.
2.  **Capture (+100):** Aggressive hunting of opponent tokens.
3.  **Reinforcement (+60):** Adding force to a square occupied by an ally.
4.  **Safe Zone (+50):** Moving into a star square.
5.  **Home Exit (+40):** Moving a token out of the base when rolling a `6`.
6.  **Progress (+Distance):** Small incremental points based on tiles covered.

---

## 8. Competitive Integrity & Synchronization [hooks/TeamUpContext.tsx, hooks/useGameEngine.ts, lib/types.ts] ✅ **Fully Implemented**

### 8.1 Host-Guest Architecture
- **Host Authority:** The Host is the source of truth for dice rolls, AI decisions, and state resolution.
- **Guest Intent:** Guests send "Intents" (Request Roll/Move) which the Host validates before broadcasting the final action.

### 8.2 Relay & Sync (Hybrid Model)
- **Primary:** Supabase Realtime Broadcast for global state relay and lobby events.
- **Secondary:** PeerJS P2P for low-latency movement and dice sync.
- **De-duplication:** All incoming actions follow a non-clashing lock to prevent double-processing.

### 8.3 Verification Status
- **Validation Tokens:** Cryptographically signed tokens exchanged during lobby setup.
- **Edge Verified UDP:** WebRTC-based matchmaking ensures the lowest possible latency and sub-20ms search times.

---

## 9. Board Layout & Path System [lib/boardLayout.ts, hooks/useGameEngine.ts] ✅ **Fully Implemented**

### 9.1 Shared Perimeter Path
- **52-cell shared perimeter path** around a 15x15 grid
- Standardized path starting from Green entry point (r: 6, c: 7)
- Clock-wise flow: Top-Middle column → Top crossover → Top-Middle column → Right-Middle row → Right crossover → Bottom-Middle column → Bottom crossover → Left-Middle row → Left crossover → Back to start

### 9.2 Corner Slot Definitions
- **BL (Bottom-Left):** Start index 34, home cells at rows 14-10, col 8
- **TR (Top-Right):** Start index 8, home cells at rows 2-6, col 8
- **BR (Bottom-Right):** Start index 21, home cells at row 8, cols 14-10
- **TL (Top-Left):** Start index 47, home cells at row 8, cols 2-6

### 9.3 Safe Positions
- **8 Star Squares:** `{ r: 7, c: 2 }, { r: 2, c: 9 }, { r: 9, c: 14 }, { r: 14, c: 7 }, { r: 3, c: 7 }, { r: 7, c: 13 }, { r: 13, c: 9 }, { r: 9, c: 3 }`
- Tokens at these positions are protected from capture regardless of force

### 9.4 2v2 Corner Assignment
- **Diagonal Pairings:** Green+Blue vs Red+Yellow teams always placed on diagonally opposite corners
- **Random Axis Selection:** Two valid diagonal axes: `[BL, TR] vs [BR, TL]` or `[BR, TL] vs [BL, TR]`

---

## 10. Game State Management [lib/types.ts, hooks/useGameEngine.ts, lib/gameLogic.ts] ✅ **Fully Implemented**

### 10.1 Core Game State Structure
- **Positions:** Token positions for each player (green, red, yellow, blue) as arrays of 4 integers
- **Current Player:** Color of player whose turn it is
- **Dice Value:** Current dice value (null when not rolled)
- **Game Phase:** 'rolling' or 'moving'
- **Status:** 'waiting', 'playing', or 'finished'
- **Winner:** String identifying winner (color or team)
- **Consecutive Sixes:** Counter for tracking three consecutive sixes
- **AFK Stats:** Tracking for each player's auto-play status and strikes

### 10.2 Game Actions & Intents
- **Actions:** `ROLL_DICE`, `MOVE_TOKEN`, `SYNC_STATE`, `TURN_SWITCH`, `START_GAME`, etc.
- **Intents:** `REQUEST_ROLL`, `REQUEST_MOVE`, `DICE_COMMIT`, `DICE_REVEAL`

---

## 11. Power-Up System (Power Mode) [hooks/useGameEngine.ts, app/components/Board.tsx] ⚠️ **Partially Implemented**

### 11.1 Power Types
- **Shield:** Makes a specific token immune to capture
- **Boost:** Provides movement advantages
- **Bomb:** Damages opponent tokens
- **Warp:** Teleports tokens to strategic positions

### 11.2 Power Tile Placement
- **4 Power Tiles** randomly placed on standard board cells at game start
- Power-ups activated when a player's token lands on the tile

---

## 12. Player Progression System [lib/progression.ts, app/page.tsx] ✅ **Fully Implemented**

### 12.1 Level Calculation
- **Formula:** `level = floor(sqrt(xp / 100)) + 1`
- **XP Required:** `(level - 1)^2 * 100` for level start, `level^2 * 100` for next level

### 12.2 Tier System
- **Arena Master:** Rating 5001+
- **Diamond:** Rating 3001-5000
- **Platinum:** Rating 1801-3000
- **Gold:** Rating 901-1800
- **Silver:** Rating 301-900
- **Bronze:** Rating 0-300

---

## 13. End-to-End Encryption [lib/encryption.ts, hooks/useGameEngine.ts] ✅ **Fully Implemented**

### 13.1 Key Generation
- **Algorithm:** AES-GCM 256-bit keys
- **Derivation:** Deterministic shared secret from wallet addresses using SHA-256

### 13.2 Message Handling
- **Encryption:** Uses Web Crypto API with random IVs
- **Format:** `{iv: base64, content: base64}`

---

## 14. TeamUp Integration [hooks/TeamUpContext.tsx, app/page.tsx, lib/gameLogic.ts] ✅ **Fully Implemented**

### 14.1 Lobby Management
- **Slots:** 4 total (0=host, 1-3=guests) with roles: host, teammate, opponent
- **Quick Match:** Hybrid matchmaking that fills empty slots after teammates join
- **Swap Mechanism:** Host privilege to rearrange player positions

### 14.2 Matchmaking Logic
- **Room Codes:** 6-character uppercase alphanumeric codes
- **Race Condition Prevention:** Synchronous slot assignment before accepting PeerJS connections
- **Fill Priority:** In 2v2, teammate slot first, then opponents

---

## 15. Audio System [app/hooks/useAudio.ts, hooks/useGameEngine.ts] ✅ **Fully Implemented**

### 15.1 Sound Events
- **Move:** Played when a token is moved
- **Capture:** Played when a token is captured
- **Win:** Played when a player wins
- **Turn:** Notification beep when it's the player's turn

---

## 16. Winner Recording & Rewards [lib/matchRecorder.ts, hooks/useGameEngine.ts, lib/progression.ts] ✅ **Fully Implemented**

### 16.1 Win Condition Detection
- **Individual:** All 4 tokens reach finish position (57)
- **Team (2v2):** Both teammates finish all tokens (8 total per team)

### 16.2 Reward Integrity
- **Kicked Players:** Forfeit all stats and rewards regardless of AI/win status
- **2v2 Exception:** Active human teammate still gets rewards if their AI replacement finishes after the other teammate was kicked

### 16.3 Local Storage
- **Leaderboard:** Stored in localStorage with wins and last win timestamp
- **Format:** `{name: {name, color, wins, lastWin}}`

---

## 17. Confetti Animation System [hooks/useGameEngine.ts, app/page.tsx] ✅ **Fully Implemented**

### 17.1 Win Celebration
- **Duration:** 5-second animation
- **Colors:** `#A8E6CF`, `#FFD3B6`, `#D4F1F4`, `#FFEFBA`
- **Origin Points:** Random positions on both sides of the screen

---

## 18. Game Reset & Initialization [hooks/useGameEngine.ts, lib/boardLayout.ts, app/page.tsx] ✅ **Fully Implemented**

### 18.1 New Game Setup
- **Corner Assignment:** Fresh random assignment based on player count
- **Token Positions:** All tokens start at home base (-1)
- **Game State:** Reset to initial conditions with rolling phase

### 18.2 Player Shuffling
- **FFA Modes:** Full Fisher-Yates shuffle of corners
- **2v2:** Preserves diagonal team pairings with random axis selection

---

## 19. Matchmaking Strategy & Flow [lib/gameLogic.ts, app/page.tsx, hooks/TeamUpContext.tsx] ✅ **Fully Implemented**

### 19.1 Matchmaking Process
- **Initial Search:** Begins with exact wager match search using `join_matchmaking` RPC
- **Expansion Logic:** Expands search parameters progressively if no matches found within 15 seconds
- **Fallback Options:** Manual selection required for AI matches (no automatic assignment)
- **Retry Mechanism:** Full reset of search parameters when user selects retry option

### 19.2 Search Parameter Expansion
- **Phase 1 (0-15s):** Exact match search
- **Phase 2 (16-29s):** User-selectable expansion options (+/- 20%, +/- 50%, or "Any Lower Match Fee")
- **Phase 3 (30s+):** Timeout to "Server is Quiet" screen

### 19.3 Hybrid Quick Match
- **Trigger Condition:** Available in 2v2/4P modes when minimum players met (teammate joined for 2v2, 2+ players for 4P)
- **Fill Priority:** In 2v2, teammate slot filled first, then opponent slots
- **Race Condition Prevention:** Synchronous slot assignment before accepting PeerJS connections

---

## 20. Client-Side Board Orientation & Perspective [lib/boardLayout.ts, hooks/useGameEngine.ts, app/components/Board.tsx] ✅ **Fully Implemented**

### 20.1 Dynamic Corner Assignment
- **2v2 Mode:** Fixed team pairings (Green+Blue vs Red+Yellow) with diagonal placement
- **FFA Modes:** Complete shuffle of all four corners using Fisher-Yates algorithm
- **Visual Perspective:** Board rotates dynamically based on assigned corner to maintain consistent player orientation

### 20.2 Grid Cell Information System
- **Cell Classification:** Each cell categorized as `home-base`, `finish`, `path`, `home-lane`, or `empty`
- **Dynamic Mapping:** Cell types determined at runtime based on corner assignments
- **Path Generation:** Player-specific paths calculated using `rotatePath()` function with corner-specific start indices

### 20.3 Visual Consistency
- **Arrow Directions:** Adjust dynamically based on corner assignment (up/down/left/right)
- **Player Positioning:** Maintains consistent relative positioning regardless of physical corner location

---

## 21. Board Color & Player Spawning Logic [lib/boardLayout.ts, lib/gameLogic.ts, hooks/useGameEngine.ts] ✅ **Fully Implemented**

### 21.1 Color-Corner Mapping
- **Fixed Template:** Predefined mapping of colors to physical corners (Green-BL, Red-BR, Yellow-TL, Blue-TR)
- **Shuffle Mechanism:** Corner assignments shuffled while maintaining color identity
- **Dynamic Assignment:** Runtime assignment based on match type and player count

### 21.2 Player Spawning Sequence
- **Host Priority:** Slot 0 always reserved for host player
- **Joiner Assignment:** Strict synchronous assignment preventing race conditions
- **Role-Based Spawning:** Different roles (host, teammate, opponent) determine spawn location and behavior

### 21.3 Team Assignment Logic
- **2v2 Teams:** Green/Yellow and Red/Blue always paired regardless of corner placement
- **FFA Independence:** Each player on individual team (teams 1-4 respectively)
- **Teammate Identification:** Dynamic lookup using `getTeammateColor()` function

---

## 22. Matchmaking Timer & Timeout Handling [lib/gameLogic.ts, app/page.tsx, hooks/TeamUpContext.tsx] ✅ **Fully Implemented**

### 22.1 Search Timer States
- **Active Search (0-15s):** Full commitment to exact match parameters
- **Expansion Phase (16-29s):** User prompted for expansion options while search continues
- **Timeout State (30s+):** Search terminates, transitions to "Server is Quiet" screen

### 22.2 Background Operation
- **Continued Search:** Original search continues during expansion phase if no user selection
- **Automatic Transition:** Seamless flow between phases without interrupting user experience
- **State Preservation:** Search parameters maintained across phase transitions

### 22.3 Timeout Recovery
- **Manual Retry:** User-initiated reset of search parameters and timer
- **Parameter Reset:** Fresh `join_matchmaking` call with original parameters
- **UI Feedback:** Clear indication of current search state and available actions
