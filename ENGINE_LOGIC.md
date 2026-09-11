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
- **Team pairings (single source of truth — `TEAM_PAIRINGS` in `lib/constants.ts`):** **Green+Yellow** vs **Red+Blue**. Seating (`assignCorners2v2`), capture truce, teammate assist, AI targeting, and win checks all read this table. Never fork a second pairing.

### 3.3 Movement & Capture (Force Mechanics)
- **Home Exit:** Requires a `DICE_MAX` (6) to move from base (`BASE_INDEX: -1`) to start tile (0).
- **Exact Finish:** Tokens land exactly on `BOARD_FINISH_INDEX` (57); over-roll results in no movement.
- **The Force System:** Multiple tokens from the same team on one square increase that square's "Force."
- **Capture Rule:** To capture an opponent, your team's Force on that square must be >= their Force.
- **Safe Zones:** 8 "Star" squares provide immunity to capture regardless of Force.
- **Home Lane:** Tokens enter the protected home lane at `HOME_LANE_START_INDEX` (52).
- **Legality:** Always use `calculateNextPosition` / `getLegalTokenIndices` — never `pos + roll` (that breaks gate crossing into 52–57).

### 3.4 2v2 Teammate Assist
Once a player has finished all 4 of their own tokens, they can move their teammate's tokens during their own turn. 
- **Victory:** A team wins only when all 8 tokens (4 per player) have reached the Finish square.
- **Teams:** Green+Yellow (team 1) vs Red+Blue (team 2).

### 3.5 Power System v3 (hidden tiles → timed inventory → targeted spend)
- **Tiles:** exactly 5 (`POWER_TILES_COUNT`), main track only, never home tiles. Each carries a hidden type (rarity: Boost .4 / Shield .25 / Teleport .2 / Nuke .15). Tiles render NOTHING pre-pickup; landing exactly on one reveals (flash + discovery message), grants to inventory, and spawns a replacement elsewhere.
- **Inventory:** per-color arrays of `{type, expiresAt}` — counts with clocks (Nuke 3:00, Shield 4:00, Boost/Teleport 5:00). Re-pickup of a held type refreshes its clocks. Expiry sweeps run on every game transition; expired items vanish silently. Bottom-centered badge bar (counts + mm:ss, amber pulse <30s), rendered only when non-empty.
- **Mechanics:** Shield = all on-board tokens until your next move completes (cleared on move resolution). Nuke = every opponent token within ±3 of the SELECTED token goes home; shields + safe stars hold. Boost = next move +6 (consumed in `moveToken`, host-computed so guests replay exact steps). Teleport = foremost token to nearest forward star (circular); 49–56 → straight to 57.
- **Spend rules:** tap badge → Shield/Boost fire immediately; Nuke/Teleport arm targeting (gold rings on that color's tokens, tap token to fire, tap elsewhere/badge to cancel). One power per roll (`powerSpentThisTurn`, cleared on each new roll). No-target spends keep the power + explain why. Powers execute host-side; guests replay via broadcast state.
- **AI:** Rookie never spends; Pro spends on condition; Master targets Nuke at the densest cluster. All tiers "sense" hidden tiles via the hunt weight.
- **Effects/sounds:** Nuke = blast-cell red blink (`nukeFlash`, 1.4s) + siren→boom + heavy haptic + kill-feed line. Shield = cyan token rings until consumed. Boost/Teleport/Pickup = sweep/blip/chime. Legacy emoji power badge removed.

### 3.6 Valid-move highlighting (UI, not engine)
- A token is legal iff `calculateNextPosition(pos, dice, color, cc) !== pos`. `BoardTokens.tsx` + `BoardHome.tsx` evaluate this per-token on every `moving` phase and mark legal tokens (double pulsing ring + bounce arrow, bright filter) vs illegal (dimmed to ~38% opacity, desaturated). A dashed ring at `getBoardCoordinate(nextPos)` previews the landing cell (including home-exit to `startIdx` on `6`). Turn with no legal moves passes instantly — see §5.1.
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
- **No-valid-move fast path:** If `gamePhase === 'moving'` and no token satisfies the §3.5 legality check, the turn hands over with **0ms delay** (was 2s). The dice does a spring toss-in at the next player's corner as the only turn-pass cue. `hooks/useGameActions.ts` also hard-resets `rollingRef` on this path — otherwise the roll guard deadlocks every future roll (see six-loop bug).

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
- **Difficulty tiers (`DIFFICULTY_PARAMS` in `lib/constants.ts`, stored per match as `GameState.botDifficulty`, default `pro` = legacy behavior):**
    - **Rookie:** ±40% score noise, ignores power tiles (`powerHunt 0`, never spends powers), capture ×0.7, slow clocks (roll 600–2200ms, move 1400ms).
    - **Pro:** clean baseline weights, standard clocks (roll 150–1900ms, move 900ms).
    - **Master:** no noise, power ×1.3, capture ×1.5, fast clocks (roll 150–700ms, move 500ms).
- **Timing:** `lib/constants.ts` — `BOT_ROLL_DELAY_MIN 150ms`, `BOT_ROLL_DELAY_MAX 1900ms` (randomized within 2s), `BOT_MOVE_DELAY 900ms`. Combined with dice tumble 1.2s + move anim 1.3s, a full bot turn is ~4–6s (was ~7–11s).

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

## 6. UI & UX Aesthetics [Visual Design System]

### 6.1 Interactive Feedback
- **Token Pulse / Valid-move cues:** Tokens pulse when it's your turn; legal tokens get a double pulsing ring + bounce arrow and stay bright, illegal ones are dimmed (~38% opacity) — see §3.5. Destination ring previews the landing cell.
- **Token art:** `ChessTokens.tsx` pawn pieces (rank via `getTokenRank`) are default; a pure-CSS orb style is opt-in via `body.token-style-orb` (`TokenStyleSwitcher.tsx` + `usePreferences.ts:tokenStyle`) and hides the SVGs. Both share the same movement pipeline. Previews: `/token-preview`, `/token-move-test`.
- **Movement:** GSAP timeline only (see `BoardTokens.tsx:TokenPiece`): FLIP with layout-measured `offsetWidth` units, **uniform `TOTAL 1.3s`** for any dice (cell hops `LEAP 0.79*cellDur` / `BEAT 0.21*cellDur`, hop `-18px` in screen space via an upright wrapper that cancels board rotation). Stacking offsets on the outer div are instant (`x/y {duration:0}`) to avoid wobble on captures. Capture run-home is a `RunHomeGhost` that sprints the reverse track with `xPercent/yPercent`. Dice pass-in: spring toss + expanding ring; awaiting-roll / awaiting-move blink rings on `LudoDice` / avatar. The former `.ludo-token-pulse` wrapper is required — never animate `transform` on the counter-rotated root itself.
- **Screen Shake**: Capturing an opponent triggers a subtle board-wide vibration.
- **Diagonal Seating (1v1 & 2v2):** 
    - Partners and 1v1 opponents are **physically enforced** to be diagonally opposite (`BL+TR` or `BR+TL`).
    - Color assignments are secondary to physical position; the engine ensures the two active players are always opposite in the game loop.
- **Celebration Glow**: The central Finish Zone emits a cyan/purple glow when a player wins.
- **Match Reveal Overlay**: High-intensity "MATCH!" screen with glassmorphism, rival profile fetching (username/avatar), and match criteria (1v1, mode, wager).

### 6.2 Layout & Navigation
- **Sandwich Layout:** All panels are vertically centered with fixed top/bottom gutters (`top-64`, `bottom-80`).
- **Dynamic Design:** Use of glassmorphism, pulse animations, and interactive "Pill" headers.
- **Edge Diagnostic HUD:** Redesigned bottom-anchored HUD showing `📡 EDGE PRIMARY` or `SUPABASE FALLBACK` status, ensuring users are aware of the connection engine.

### 6.3 Technical Guardrails (UI-Side)
- **Identity & Naming Guard**: 
    - **Convention**: Players without a resolved social identity default to **`Guest [Last 6 Uppercase]`** (e.g., `Guest D1F23A`) derived from their wallet address.
    - **Resolution**: The `ProfileSyncer` component attempts to resolve decentralized profiles via Farcaster Frame SDK, Neynar API, and OnchainKit (Base Names/ENS).
    - **Sync**: Once resolved, the profile is broadcast via a specialized `SYNC_PROFILE` event in `TeamUpContext.tsx`, updating the lobby's `participants` list in real-time.
- **Atomic Ticket Purging**: Initiating a new search (`startSearch`) triggers an immediate purge of all stale `searching` records for that player's wallet, preventing "Shadow Matches" with orphaned sessions.
- **Safe Match Cancellation**: Users can safely exit the "Match Found" screen before the P2P synchronization finishes without losing coins or rating points.
- **Modular Game Logic**: Core logic is decoupled from hooks. `processMove`, `calculateNextPosition`, and `getBoardCoordinate` handle discrete, testable game rules.

---

## 7. Technical Guardrails [Quality of Service]

### 7.1 Dice (Edge Function — networked seats)
All **networked** rolls (humans, host-orchestrated bots, AFK auto-play) call the Supabase Edge Function (`/functions/v1/roll-dice`) for a CSPRNG 1–6 result:
1. Client broadcasts a `REQUEST_ROLL` intent (`isRolling`, UI spins).
2. Client queries the `roll-dice` Edge Function.
3. On success, the host broadcasts `ROLL_DICE` with the fetched value.
4. **No client RNG fallback in networked matches.** If the Edge call fails, the roll is aborted (UI unlocks). Offline / local-bot matches may use local RNG.
5. **Anti-Drop Security:** If a host drops a bad roll, the 15s turn timer (`useGameTimer.ts`) applies an AFK strike and forces an auto-move (Edge again when networked).
6. **Server receipts (`match_rolls`):** Edge persists every networked face (`match_id`, unique `action_id`, `result`). Same `actionId` always replays the same face — no retry-until-six. Host broadcasts `rollId` with `ROLL_DICE` for spectators/audit. Table is RLS read-only for clients.
7. **Server receipts (`match_rolls`):** Edge persists every networked face (`match_id`, unique `action_id`, `result`). Same `actionId` always replays the same face — no retry-until-six. Host broadcasts `rollId` with `ROLL_DICE` for spectators/audit. Table is RLS read-only for clients.

### 7.1b Server-validated moves (v2)

Networked matches seed `match_states` on `START_GAME`. Moves go through the `move-auth` Edge Function:

1. Wallet-signed `submit-move` (player seat) or host-signed `host-assist` (bot/AFK only).
2. Edge binds `rollId` from `match_rolls` (one roll → one move).
3. Edge runs pure `lib/engine` (`processMove` / `getLegalTokenIndices`).
4. Optimistic `seq++` on `match_states`; `match_moves` audit; broadcast `ENGINE_STATE`.
5. `match_states.seq` is display authority (host is animator/relay, not rules).
6. No legal move → signed `pass-turn`. **Powers (P3):** `submit-move` applies Boost (+6) and pickup; signed `submit-power` handles shield/boost/nuke/teleport (`seq++`). Power mode is server-trusted.
7. **P4 display authority:** clients subscribe to `match_states` (realtime). Host `ENGINE_STATE` is a **hint only** — applied iff `payload.seq` is strictly ahead of the known server seq.

Shared rules: `lib/engine/core.ts` ↔ `supabase/functions/_shared/engine.ts` (`npm run check:engine`).

### 7.2 Chat encryption
DMs use **ECDH P-256 sealed boxes** (`lib/encryption.ts`): each identity holds a static keypair in localStorage and publishes the public JWK on `players.ecdh_pubkey`. Senders generate an ephemeral pair, derive AES-GCM via the peer's static pubkey, and store `{v:1, epk, iv, content}`. Recipients open with their static private key. Legacy wallet-hash ciphertext remains decrypt-only via `decryptAnyMessage` fallback. Messages UPDATE is column-locked by trigger (`20260914_messages_rls_lockdown.sql`).

Note: if a recipient has never published `ecdh_pubkey`, new sends fail closed (no plaintext downgrade).

### 7.3 Match recording (signed)
`/api/match/record` requires a wallet signature over a canonical payload (`lib/matchProof.ts`). The signer must be a listed participant. Coin pots are **not** paid from this route (progression only). Replay is blocked when `matchId` already has a winner.

### 7.4 Player Progression
- **Level:** `floor(sqrt(lxp / 100)) + 1`.
- **Rank Tiers:** Bronze (0) -> Silver (301) -> Gold (901) -> Platinum (1801) -> Diamond (3001) -> Arena Master (5001+).

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

**Security V3 (signed settlement):** `resolve-bet` no longer accepts a free-form `result` from the network. The host wallet-signs `buildBetResolveMessage(...)` (`lib/matchProof.ts`). The Edge Function recovers the signer, requires `live_matches.host_address` to match, and only then calls `settle_match_bets`. Host address is written on `hostGame` / `START_GAME` (migration `20260914_live_matches_host_address.sql`).

### 8.3 New Database Tables
| Table | Purpose |
|-------|---------|
| `live_matches` | Betting window lifecycle per match (open/closed/resolving) |
| `spectator_bets` | All spectator wagers with timing guard + idempotency columns |

---

## 9. Advanced Synchronization & Multi-Host Resilience

### 9.1 Hybrid Mesh Topology (Cloud + Local)
The "Live Broadcast" system utilizes a dual-channel sync pipeline to ensure zero-latency gameplay across global regions:
- **Supabase Realtime (Primary):** Acts as the high-availability "Cloud Relay." All game events (dice, moves, turns) are broadcasted to a dedicated room channel. This bypasses NAT/Firewall issues that often plague P2P.
- **PeerJS (Secondary):** A low-latency "Local Mesh" for identity-heavy tasks like `validation_token` handshakes and `SYNC_PROFILE` events.

### 9.2 Zero-Trust Action De-duplication
To handle multiple relay channels without state corruption, every `broadcastAction` is stamped with a unique `actionId`.
- **Deduplication:** Clients maintain a `processedActionIds` Ref. If an action is received via both P2P and Supabase, the duplicate is ignored instantly based on its ID.

### 9.3 Authority Migration (The "Baton Pass")
If the original Host disconnects or goes AFK, the system performs an **Authority Migration** via `useGamePresence`:
- **Election:** A new `isComputeHost` is elected based on active presence priority.
- **Continuation:** The new authority takes over game engine orchestration (AI moves, turn switching), ensuring the match progresses even if the creator leaves.

### 9.4 Authoritative State Overrides
Periodic `ENGINE_STATE` signals are sent by the Authority. These payloads include a `stateOverride` key which Guests apply directly to their local `setLocalGameState`. This force-syncing acts as a "hard reset" for any potential client-side desynchronization.

---
*Created by Antigravity AI for Ludo Base.*
