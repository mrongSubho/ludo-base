# Ludo 3077: Project Brain & Engine Logic

This document is the primary technical reference for all core systems, game rules, and architectural decisions implemented in **Ludo 3077**. **Consider this the definitive "Source of Truth" for engine logic.**

---

## 1. Vision & Core Pillars
- **Onchain Arena:** Competitive Ludo on Base Sepolia (`84532`) powered by reusable `ArenaVault` match/spectator vaults, `ClanClaim` war escrows, and EIP-712 pull settlements.
- **Fair Play First:** Networked gameplay executes strictly inside a single server authority (`MatchRoom` Durable Object) with CSPRNG dice, seat-bound Session v2 tokens, and atomic compare-and-swap (CAS) commits.
- **Zero-Video Spectator Betting:** Spectators sync game states directly from the room/match state pipeline with vault-funded pari-mutuel markets.
- **Farcaster & Wallet Native:** Optimized for Farcaster Frames / Base App webviews and protected by the 3-tier Dual-Modal `SignWaitModal` wallet guard.

---

## 2. Architecture [The Network & Room Layer]

### 2.1 Matchmaking & Server-Owned Lobbies (S0–S5)
Match formation prioritizes server-coordinated pairing and deterministic seating before entering a room:
- **Queue & Hybrid Fill (`join_matchmaking` / `join_matchmaking_hybrid`):**
  - Shape-aware Postgres RPCs (`1v1`, `2v2`, `4P`) protected by advisory locks and **30s ticket lease TTLs** (`expires_at > now()`, renewed by status polling and reaped by cron).
  - Edge Server (`EdgeServerClient`, WebSocket `find_match`) remains supported with transparent failover to Supabase matchmaking RPCs.
- **Deterministic Canonical Seating (`assign_match_seats` & `match_seats`):**
  - On match formation, Postgres sorts participating wallets under explicit `"C"` ASCII collation and persists `match_seats(match_id, color, wallet_address, seat_index)`.
  - Each player's Session v2 token can carry `seat_color` (`202610220003`), preventing one participant from issuing actions for another seat.
- **Lobby Doors & Secrets (`lobby_join_policies`):**
  - Every lobby declares a door: `matchmaking` (requires ticket `validation_token`), `invite` (requires server-minted `?s=` room secret and accepted friendship), or `open` (casual code join / hybrid open-fill after `allowOpenJoins()`).
- **Zero-Popup Paid Wagers (`ArenaVault`):**
  - Quick Match and TeamUp wagers reserve funds via `arena_vault_reserve` prior to queue/room entry (`ensureVaultAndReserve`). When vault credit covers the stake, entry executes at **0 gas**; otherwise `SignWaitModal` prompts only the deficit deposit (`wager - vaultBalance`). Cancelling an unmatched search or closing an unstarted room returns the reserve via `arena_vault_release` at 0 gas.

### 2.2 Transport Hierarchy & Relay Safety (`TU-1`)
- **Primary Authority (MatchRoom WebSocket):** Whenever `/api/room/:matchId/ws` is connected, `roomAuthority` is active (`hooks/useGameActions.ts`). Clients emit lightweight validated intents (`REQUEST_ROLL`, `REQUEST_MOVE`, `REQUEST_POWER`) and adopt server-broadcast state snapshots.
- **Public Relay Guard (`game-room-<roomCode>`):** Supabase Realtime Broadcast carries lobby sync, dual-path intents (`GAME_INTENT`), chat, emotes, and ACKs. State-bearing verbs (`START_GAME`, `ROLL_DICE`, `MOVE_TOKEN`, `TURN_SWITCH`, `ENGINE_STATE`, `POWER_HAND`) are **never** accepted from the public relay (`processGameAction(data, via)` admits them only when `via === 'peer'` on offline/local fallback paths).
- **Guest Intent Dual-Path & Dedup:** Guests transmit intents over WebSocket/PeerJS + Supabase Broadcast using shared `intentId`s; LRU/TTL dedup stores (`lib/netcode/dedup.ts`) with monotonic high-water eviction reject replays.

### 2.3 Server Authority Architecture (`MatchRoom` Durable Object, P0–P6)
- **Single Execution Context:** Cloudflare Durable Object (`src/room/MatchRoom.ts` / `src/room/MatchRoomCore.ts`) executes the synced engine (`src/room/engine.ts`), owns CSPRNG dice minting, verifies Session v2 seat authority, and commits state transitions atomically.
- **Atomic Commits (`match_commit_action`):** Incremental state commits and initial S0 seed persistence (`seq = 0`) run through Postgres RPC `match_commit_action` with strict CAS checks on `seq` (returning `STALE_SEQ` + authoritative state on races).
- **Alarms & Hibernation Recovery:** Authoritative turn clocks live inside DO storage alarms (`12s` cast / `15s` move for humans; staggered two-phase `2–4s` roll + `3–5s` move for bots, plus per-seat `afk_expire` and `5s` `disconnect_grace` alarms). Evicted DOs rehydrate seamlessly from `match_states` and resume alarms without client host intervention.
- **Retirements (P6):** Legacy Deno Edge Functions (`roll-dice`, `move-auth`, `resolve-bet`), `DICE_COMMIT`/`DICE_REVEAL`, legacy Strike `1–3`, manual `Autopilot` (`CMD_REQUEST_TRUST { trust: true }`), `IdleWarningOverlay`, and networked `HOST_ELECT` authority switching are retired. Offline pass-and-play and local bot matches mirror the Dual-Tier AFK model in client timers/hooks.
- **Engine Sync Check:** `npm run check:engine` guarantees `lib/engine/core.ts` and `src/room/engine.ts` remain byte-identical (save header banner).

---

## 3. Gameplay [The Rules of War]

### 3.1 Classic, Power & Quick (Turbo) Modes
- **Power (Default):** Includes 5 hidden main-track power tiles (`Boost`, `Shield`, `Teleport`, `Nuke`) plus match traps, power inventory clocks, and tactical HUD VFX.
- **Classic:** Pure Ludo rules (home exit, Force captures, safe stars, exact 57 finish, bonus turns, three-sixes forfeit).
- **Quick (Turbo, code `2`):** Uses identical 15×15 geometry (`MatchPool.sol` `gameMode <= 2`) with each color starting at `[startIdx, BASE_INDEX, BOARD_FINISH_INDEX, BOARD_FINISH_INDEX]` (1 deployed + 2 already home) for fast 3–5 minute matches.

### 3.2 Seating, Pairings & Seat-Aware Turn Cycle (`TU-6`)
- **Corners:** `Bottom-Left (BL)`, `Bottom-Right (BR)`, `Top-Right (TR)`, `Top-Left (TL)`, rotating anti-clockwise.
- **Seating Rules:**
  - **1v1:** Diagonally opposite (`BL↔TR` or `BR↔TL`), seated via `seatedColorsFor('1v1')` (zero unseated ghost turns inside `getNextPlayer` / `activeColorsForTurns`).
  - **2v2:** Teammates diagonally opposite (`Green+Blue` vs `Red+Yellow`).
  - **4P FFA:** All 4 seats (`green`, `red`, `yellow`, `blue`), randomized corner assignment offline or `"C"` collation-assigned server-side.
- **Single Source of Truth (`TEAM_PAIRINGS` in `lib/constants.ts`):** Seating, `LOBBY_COLORS['2v2']`, `getTeammateColor`, `getTeam`, capture truce, trap truce, teammate assist, AI targeting, and win checks all derive from `TEAM_PAIRINGS`.

### 3.3 Movement, Force & Capture
- **Home Exit:** Requires a `6` to deploy from `BASE_INDEX (-1)` to start index `0`.
- **Exact Finish:** Must land exactly on `BOARD_FINISH_INDEX (57)`; overshoots are illegal.
- **Team Force & Capture:** Allied tokens on the same square sum their Force. Capturing requires your team's Force on the destination cell `>=` enemy Force (`checkMultiCapture` evaluates resolved/pre-move state consistently). Teammates never capture or trigger each other's traps (`ENG-12`).
- **Safe Zones & Home Stretch:** 8 Star squares (`SAFE_POSITIONS`) prevent capture/nuke hits. Home lane spans `52..57`.
- **Legality:** Always evaluate moves through `calculateNextPosition` / `getLegalTokenIndices` — never `pos + roll`.

### 3.4 2v2 Teammate Assist & Victory
- Once a player brings all 4 own tokens to `57`, `resolveControllableColor` transparently routes their turns to control their teammate's remaining tokens.
- A 2v2 team wins only when all 8 team tokens reach `57`. `evaluateVictory` is the **single** win evaluator across both `processMove` and `applyPower`'s Teleport branch (`ENG-03`). Both winning colors are appended to `winners`, and paid `ArenaVault` 2v2 pools split net payout 50/50 across both winning wallets (`5%` protocol rake).

### 3.5 Power System v3 (Split Boost, Stack-Safe Nuke, Shield Dome, Teleport Warp)
- **Hidden Tiles & Deterministic Respawns:** `5` main-track tiles (`POWER_TILES_COUNT`, never home tiles), weighted rarity: `Boost (0.40)`, `Shield (0.25)`, `Teleport (0.20)`, `Nuke (0.15)`. Tiles stay invisible until stepped on; replacements spawn deterministically from match-committed `powerTileSeed` via LCG. Wire frames strip `type` via `sanitizeGameStateForWire` (`lib/wireSanitize.ts`), while `applyServerState` preserves the owning local client's held inventory.
- **Timed Inventory:** Per-color slots with expiry clocks (`Nuke 3:00`, `Shield 4:00`, `Boost/Teleport 5:00`); re-collecting refreshes the clock.
- **Boost (Split Two-Step `6`-then-Roll):**
  - `resolveRollWithBoost` + `resolveNetworkedMove` (Branch A & B): Arming **Boost** grants a bonus **`6` step first** (`boostPendingDice` stores the rolled `1–6`), followed immediately by moving any eligible token with your **rolled die (`1–6`)**. (`effectiveMoveSteps` is strictly `1–6` — Boost no longer performs a single `6 + dice` leap.)
  - If no token can legally move `6` (e.g., all tokens in home stretch near `57`), the split step falls through immediately to the rolled die.
  - **Boost & Streak Independence:** Boost's bonus `6` **never** increments `consecutiveSixes`. Players may re-arm Boost on bonus turns (`6 6 6` and `6 6 6 1–5` remain valid; only a 3rd *rolled* six forfeits). If Step 1 captures or finishes a token, `boostSubMoveBonus` preserves the post-Step-2 bonus turn.
- **Nuke (Circular `±3` & Stack-Safe):**
  - Targets any chosen own on-track token and blasts solo unshielded opponent tokens within circular 52-cell track distance (`Math.min(|posA - posB|, 52 - |posA - posB|) <= 3`, seamlessly wrapping across the `51 <-> 0` seam).
  - **Blast Immunity:** Tokens on safe stars, tokens protected by `activeShields`, tokens in base/home stretch, 2v2 teammates, and **stacked enemy tokens (`getTeamForceAtPoint >= 2`, whether 2–4 own tokens or a 2v2 teammate stack)** survive the blast.
- **Shield (Aegis Dome):** Protects all on-board track tokens of that color with glowing dome VFX through the caster's current turn (including bonus rolls) and across every opponent's turn until turn control returns to that player (`clearShieldsOnTurnChange`). Individual tokens entering home stretch (`>= 52`) or hitting an enemy trap prune their own shield while remaining track tokens keep protection until the next turn.
- **Teleport (Forward Star / Instant Finish):** Moves targeted token to the nearest forward safe star (circular), or straight to `57` if on positions `49–56`, invoking `evaluateVictory`.
- **Spend Rules:** Shield and Boost trigger immediately on dock tap; Nuke and Teleport enter ring-targeting mode (`PowerInventoryDock`). One power spend per roll (`powerSpentThisTurn`). Invalid/no-target spends refund cleanly and explain why.

### 3.6 Bonus Turns, Finish & Three-Sixes Streak
- **Bonus Turn (`bonusRoll`):** Rolling a `6`, capturing an enemy token, **or** landing a token cleanly on `BOARD_FINISH_INDEX (57)` (`finishedToken: true`) awards another roll.
- **Streak Reset:** Capturing an enemy OR finishing a token on `57` resets `consecutiveSixes` to `0`.
- **Three Consecutive Sixes:** Rolling 3 consecutive *rolled* `6`s (`checkThreeSixesForMove`) forfeits the 3rd roll and advances the turn immediately.

---

## 4. Board Intelligence [Spatial Systems]
- **15×15 Parity Coordinate Grid (`lib/boardLayout.ts`):** Tokens traverse a global 52-cell track (`0..51`) and enter color-specific home stretches (`52..57`) mapped mathematically via `getBoardCoordinate(pos, color, colorCorner)`.
- **Standard Safe Stars:** `SAFE_POSITIONS` rotated across the 4 quadrants.

---

## 5. Human Integrity, Timers & AI Engine

### 5.1 Dual-Tier AFK Bots, Reclaim Windows, Stealth Kick & Treasury Routing (`lib/afkPolicy.ts`, `MatchRoomCore.ts`)
- **Turn & Presence Detection:** Active humans get **`12s`** to roll (`cast`) and **`15s`** to move (`move`). Multi-signal client presence reports `active`, `window_blurred`, `tab_hidden`, or `disconnected` via silent `CMD_PRESENCE`. Socket disconnects arm a `5s` `disconnect_grace` timer (or engage Tier-1 immediately if the disconnected seat's turn arrives first).
- **Tier-1 AFK Bot (Temporary, Reclaimable — Random / No-Brain Bot):**
  - Engages on turn timeout or expired disconnect grace, incrementing lifetime `afkTriggers` (`1/5 .. 5/5`, never reset on return).
  - Reclaim deadline scales dynamically by match elapsed time at takeover (`now - matchStartedAt`): `<5m → 10m`, `5–10m → 8m`, `10–15m → 6m`, `>=15m → 5m`. Matches never stall during this window.
  - Executes two separate alarm phases (`ai_roll` in **`2–4s`**, `ai_move` in **`3–5s`**) using unbiased CSPRNG (`rollUnbiasedDie`), uniform random legal token selection (`pickTier1RandomMove`), and random power save/spend (`pickTier1RandomPower`).
  - Returning player sees a live `AfkReclaimBar` with audio countdown alerts (`afk_strike`, `afk_ultimatum`, `timer_urgent`) and can reclaim immediately by tapping anywhere (`CMD_REQUEST_TRUST { trust: false }`); manual `Autopilot` toggle (`trust: true`) is disabled (`AUTOPILOT_MANUAL_DISABLED`).
- **Tier-2 Permanent Bot (Locked, Irreversible — Main Smart Bot):**
  - Triggers permanently on EITHER **`afkTriggers >= 5` (`5/5`, `afk_limit_5`)** OR **`now >= afkDeadlineAt` (`afk_timeout` / `disconnect_timeout`)**, hard-locking intents at DO wire level (`SEAT_KICKED`).
  - Pilots using full strategic `getBestMove` + `getBestPowerUsage` at humanized `2–4s` / `3–5s` cadence and unbiased dice. Kicked player sees a persistent red `KickedAlertModal` (no auto-dismiss) offering `Watch in Live Arena` or `Return to Lobby`.
- **Stealth Wire Masking:** `stripPowerTypesForWire` & `sanitizeDeltaForWire` strip `forfeitedWallets`, `kickedSeats`, opponent/spectator `afkStats`, opponent `TURN_TIMEOUT` events, and non-acting `ai_roll`/`ai_move` phase hints so matches continue seamlessly without opponent disruption.
- **Explicit Leave (`CMD_LEAVE_MATCH`) & Settlement Diversion:** Leaving voluntarily forfeits 100% of entry fees and awards 0 LXP/RXP/CHIPS; in `1v1` the opponent wins immediately, in `2v2` the Tier-2 bot continues unless the partner is already kicked/left (in which case opponents win immediately), and in `4P` the leaver ranks 4th while Tier-2 finishes the match. Even if a kicked/forfeited seat's Tier-2 bot finishes 1st, `/api/match/record` & `resolveSettledPayoutShares` (`lib/arenaVaultService.ts`) grant 0 progression/win credit to `forfeitedWallets` and divert 100% of their prize share to the protocol treasury (`ARENA_TREASURY_WALLET`), while non-forfeited `2v2` teammates keep their legitimate `50%` share and spectator bets settle on real board winners.
- **Offline Mirror & 0ms Pass Path:** `useGameTimer.ts` & `useAFKManager.ts` enforce matching Tier-1 random bot + dynamic reclaim expiry offline (`useAIBrain.ts` takes over permanently on kick). Zero-legal-move rolls fast-pass cleanly.

### 5.2 Bot Heuristics & Difficulty (`lib/aiEngine.ts`, `lib/constants.ts`)
Evaluates moves inside a Web Worker (`lib/ai/worker.ts`) and inside `MatchRoomCore` / Live Arena using `AI_SCORES` and returns `{ color, tokenIndex }` (supporting 2v2 teammate assist):
1. `REACH_FINISH` (**+1500**)
2. `CAPTURE_TOKEN` (**+1000** × difficulty capture weight)
3. `THREAT_AVOIDANCE` (**+600** × difficulty capture weight, force- and shield-aware via `calculateNextPosition`)
4. `ENTER_SAFE_ZONE` (**+400**)
5. `PURSUIT_POSITION` (**+250**, ignores shielded/unbreakable opponent stacks)
6. `PROMOTION` (**+150**, entering home stretch)
7. `POWER_TILE_HUNT` (**+120** × difficulty power weight)
8. `EXIT_BASE` (**+80**)
9. `REINFORCE_ALLY` (**+60**)
10. `ENTER_HOME_LANE` (**+25**)
11. `PROGRESSION_MULTIPLIER` (**+2×** color-relative travel distance `0..56`, never raw parity index)
12. Hazards: `AVOID_TRAP` (**-1200**), `BREAK_PROTECTIVE_STACK` (**-300** when splitting a 2-token stack on an unsafe tile)

- **Difficulty Tiers (`DIFFICULTY_PARAMS`):** `rookie` (±40% noise, ignores power tiles, slow clocks), `pro` (baseline weights, 150–1900ms roll / 900ms move), `master` (0% noise, 1.3× power hunt, 1.5× capture, fast 150–700ms roll / 500ms move).
- **Strategic Power AI (`getBestPowerUsage`):** Rookie never spends; Pro/Master arm Nuke on densest unshielded solo clusters, Shield when an unshielded non-safe token is within enemy capture force (evaluated with `calculateNextPosition`), Boost when `<= 12` from finish, chased `<= 6` on an unsafe tile, or all remaining tokens are stuck in base, and Teleport only when an eligible on-track/home-stretch token exists (`tokenIdx` selected explicitly, never targeting yard tokens).

---

## 6. Visuals, Token Kinematics & Audio Stack

- **Three Themes + Deployment Palettes:** **3077** (`theme-3077`, flagship default), **Retro-Futurism** (`theme-retro-futurism`, CRT + `RetroArcLight` pill footer), and **Daybreak** (`theme-daybreak`, Warm Studio Porcelain light), all tinted reactively by deployment mode (`quick` / `team` / `offline` in `lib/deployTheme.ts`).
- **Tokens & 3D Step-Crown Hops (`BoardTokens.tsx`):** `body.token-style-orb` is default (`ChessTokens` opt-in). GSAP FLIP animates multi-cell leaps with screen-space upright `-18px` hops, step-crown rings, and `RunHomeGhost` capture sprints inside `useStableBoardBox`-locked containers.
- **Board HUD & VFX:** `AnchoredDiceBay` (3-theme corner launch docks + `dice-streak-strip` double-six warning + Boost overdrive wing), `PowerInventoryDock`, `PowerVfxOverlay` (Nuke siren warhead + crimson blast corridor, Shield dome burst, Boost plasma trail, Teleport 3-beat warp), and `BoardTerminalHud`.
- **Procedural Audio (`lib/audio/`):** Single-`AudioContext` `SoundEngine` (`sfxCatalog.ts`) + `MusicDirector` (3 genre-specific interactive BGM engines across lobby/queue/crunch heartbeat + optional bilateral L/R 14 Hz pulses) with automatic nested-modal ducking.
- **Reduced Motion Override (`lib/motion.ts`):** 3-way preference (`system` | `full` | `reduced` via `ludo-motion` cookie) controlling `MotionConfig` + CSS + GSAP/confetti guards.

---

## 7. Security Contracts, Encryption & Progression

### 7.1 Wire Schemas & Anti-Cheat Invariants
- `REQUEST_ROLL` (`Record<string, never>`) and `REQUEST_MOVE` (no `diceValue`) validate strictly via Zod `.strict()` (`lib/protocol/schemas.ts`), rejecting caller-supplied dice values.
- `resolveRollWithBoost` enforces `checkThreeSixesForMove` before legality; `resolveNetworkedMove` enforces `isValidStepCount(1..6)` and `evaluateVictory`.
- `npm run test:engine-diff` (1200 deterministic seeded matches comparing `lib/engine/core.ts` vs `lib/gameLogic.ts`), `npm run test:engine-core`, `npm run check:drift` (12 tests), `npm run test:golden` (50/50 terminating corpus), and `npm run test:mp` verify rule consistency in CI.

### 7.2 Identity, ECDH DMs & Wallet Guard
- **Auth & Sessions:** Session v2 (`sessions` with SHA-256 hashed tokens, CSRF Origin/Sec-Fetch checks, `seat_color` binding) + `RateLimitDO` / Postgres `rate_limit_hit` across hot routes.
- **E2EE DMs (`lib/encryption.ts`):** Non-extractable IndexedDB P-256 static keys, public JWK canonicalization (`lib/validation/ecdhJwk.ts`), HKDF-SHA-256 v2 sealed boxes (`16B` salt + static keys in `info`), fail-closed `isSealedBox` door in `POST /api/messages`, and immutable DM columns via `messages_restrict_columns`.
- **Wallet Guard (`SignWaitModal` / `lib/walletGuard.ts` / `NetworkAutoSwitcher`):** Enforces Base Sepolia (`84532`) alignment, pre-flight dry-run simulation (`lib/txSimulator.ts`), Dual-Modal confirmation banners, and strict separation between CDP in-game passkeys vs native external wallet unlock (`WALLET_SIGNING_POLICY.md`).

### 7.3 Match Recording, Settlement & Progression
- `/api/match/record` verifies Session v2 + signed canonical payload (`lib/matchProof.ts`) against `match_states.state.winner`, prevents duplicate winner replays, credits progression (`Level = floor(sqrt(lxp / 100)) + 1`; Tiers: Bronze `0` → Silver `301` → Gold `901` → Platinum `1801` → Diamond `3001` → Arena Master `5001+`), records `arena_vault_settle_match` (`5%` rake, `50/50` split in `2v2`), invokes `arena_vault_settle_spectator_bets`, and bridges `clan_score_queue` / `finalizeFixtureScore` for Clan Wars + `player_free_matches` for batch `MissionSystem` telemetry sync.

---

## 8. ArenaVault Pari-Mutuel Spectator System (`lib/spectatorBetting.ts`)

### 8.1 Zero-Video Sync & Live Arena Directory
- Spectators subscribe to `MatchRoom` / `useSpectatorSync` room broadcasts (`game-room-${roomCode}`) and snapshot backstops with opaque power-tile types stripped (`sanitizeGameStateForWire`).
- `/api/live-arena/directory` (`lib/arena/directoryService.ts`, `lib/arena/demoArenas.ts`) surfaces active matches, open lobbies (`Free` through `10M CHIPS` tiers), hydrated pilot dossiers, and functional demo AI exhibitions without exposing join secrets (`live_matches` narrow grants).

### 8.2 Fixed Early-Match Pari-Mutuel Protocol (`202611190001`)
1. **Window Bounds (`/api/live-matches/window`):** Host/system opens a bounded `winner` betting window clamped strictly to **`30s–180s` (default `90s`)**. Once `now >= window_closed_at` or `finished_at` is set, new bets fail closed (`409 BET_WINDOW_CLOSED`).
2. **0-Gas Vault Funding (`POST /api/spectator-bets` → `arena_vault_place_spectator_bet`):** Bets (`1`–`10,000,000` CHIPS) debit from `arena_vault_accounts` under an advisory lock with `for update` lock on `live_matches`, blocking self-bets by participants (`SELF_BET_NOT_ALLOWED`) and enforcing idempotency per `(wallet, action_id)`.
3. **Pari-Mutuel Settlement (`arena_vault_settle_spectator_bets`):**
   - **Opposed Pool (`winningPool > 0 && losingPool > 0`):** Takes `5%` (`500 bps`) protocol rake capped at `losingPool` so winners never lose principal, and credits proportional payouts to `arena_vault_claims` (`match_prize`, claimable or 0-gas rollable into Vault inside Claim Hub).
   - **Unopposed Winners (`losingPool === 0`):** `100%` principal refund (`0%` rake) via `match_refund` claim vouchers.
   - **Unopposed Losers (`winningPool === 0`):** Losing stakes are settled/forfeited to the House Pool.
   - **2v2 Alignment:** `resolveWinningBetValues` (`lib/spectatorBettingMath.ts`) resolves winner colors, `'Team 1'`/`'Team 2'`, and both teammate wallets consistently from `TEAM_PAIRINGS` / `TEAM_ID`.
