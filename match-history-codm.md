# Call of Duty Mobile Style Match History & On-Chain Sync Hub

## 1. Objective & Architecture
Build a **Call of Duty: Mobile (CODM)** inspired **Battle Log / Match History** experience directly inside [`UserProfilePanel.tsx`](file:///Users/mrongsubho/Documents/Termninal/ludo-base/app/components/UserProfilePanel.tsx) as a dedicated tab (`OVERVIEW` | `MATCH HISTORY`), relocate the [`UnsyncedMatchesPanel.tsx`](file:///Users/mrongsubho/Documents/Termninal/ludo-base/app/components/UnsyncedMatchesPanel.tsx) on-chain sync command bar there from `MissionPanel.tsx`, and ensure 100% visual fidelity across both **Retro-Futurism** (`theme-retro-futurism`) and **Daybreak** (`theme-daybreak`).

---

## 2. Backend API: `GET /api/matches/history`
Create [`app/api/matches/history/route.ts`](file:///Users/mrongsubho/Documents/Termninal/ludo-base/app/api/matches/history/route.ts):
- **Auth & Rate Limit**:
  - Authenticated via `requireSessionWallet(request, { scope: 'app', expectedWallet })` using `Authorization: Bearer <sessionId>` / `x-session-id` header (never query string, honoring P3 invariant).
  - Registered in [`lib/rateLimitRoutes.ts`](file:///Users/mrongsubho/Documents/Termninal/ludo-base/lib/rateLimitRoutes.ts) under both `RATE_LIMITS` (`60 req/min GET`) and `SESSION_GATED`.
- **Data Aggregation (Unified Battle Log)**:
  1. **`matches` table**: Last 50 matches where `participants` overlaps caller wallet (`id`, `created_at`, `finished_at`, `game_mode`, `match_shape`, `participants`, `winner_address`, `room_code`, `spectator_count`, `total_bet_volume`).
  2. **`player_free_matches` table**: Caller's free-match telemetry (`match_id`, `won`, `is_pvp`, `captures`, `played_at`, `onchain_synced`, `sync_tx_hash`). Merged with `matches` by `match_id` so both legacy matches and newly queued free matches appear seamlessly.
  3. **`chips_pools` table**: Enriches paid matches with on-chain pool telemetry (`pool_id`, `entry_fee`, `prize_fund`, `status`, `settle_tx`, `settled_at`).
  4. **`players` table**: Resolves participant display names (`username`), `rank_tier`, and `avatar_url` for all seats in the match so the expandable post-match scoreboard shows human-readable combatant tags.

---

## 3. CODM Battle Log UI & Component Design

### 3.1 Top-Level Navigation in `UserProfilePanel.tsx`
- Add [`PanelTabs`](file:///Users/mrongsubho/Documents/Termninal/ludo-base/app/components/PanelTabs.tsx) below the profile header:
  - **Tab 1: `OVERVIEW`** — Identity card, Level/Rank XP bars, Form chart, Mode breakdown, Career Stats, Vault Relic Showcase, Privacy settings.
  - **Tab 2: `HISTORY`** — CODM Battle Log + On-Chain Sync Command Center, with a live `TabCount` badge when the player has unsynced free matches (`unsyncedCount > 0`) or total matches count.

### 3.2 On-Chain Sync Command Bar (`UnsyncedMatchesPanel.tsx`)
- Relocated from `MissionPanel.tsx` to the top of the `HISTORY` tab in `UserProfilePanel.tsx`.
- Refined into a tactical **On-Chain Telemetry Sync Bar** that works inside `.ludo-profile-scope` (auto-adapting to both Retro-Futurism and Daybreak):
  - Displays pending unsynced free matches count, total wins, and captures waiting to be written on-chain.
  - One-click **"SYNC ON-CHAIN"** button triggers `MissionSystem.syncFreeMatches(attestations, signatures)` (user pays gas) and refreshes both the Sync Bar and Match History cards immediately upon confirmation.
  - When `count === 0`, displays a sleek verified status bar: `"ALL MATCHES VERIFIED ON-CHAIN"`.

### 3.3 Tactical Combat Summary Ribbon & Filter Bar (`MatchHistoryTab.tsx`)
- **4-Column Combat Summary Strip**:
  - `COMBAT LOGS` (Total filtered matches)
  - `WIN RATE` (`XX%` + W/L ratio)
  - `ELIMINATIONS` (Total token captures across matches)
  - `NET RATING` (`+XX / -XX RXP` net delta)
- **Filter Pills**:
  - `ALL` | `CLASSIC` | `POWER` | `PAID` | `UNSYNCED`

### 3.4 CODM Match Cards & Expandable Post-Match Scoreboard
- **Collapsed Match Card (CODM Signature Layout)**:
  - **Left Tactical Accent Edge**:
    - `VICTORY`: Bold emerald bar (`border-l-4 border-emerald-400`), `VICTORY` stamp, `+30 RXP` / `+150 LXP` pill.
    - `DEFEAT`: Crimson bar (`border-l-4 border-red-400`), `DEFEAT` stamp, `-15 RXP` / `+50 LXP` pill.
  - **Center Mode & Telemetry**:
    - Mode title + shape badge (`CLASSIC · 1V1`, `POWER · 4P`, `TEAM UP · 2V2`, `SOLO · VS AI`).
    - Combat metrics row: Captures count (`⚔️ X CAPTURES`), Stakes (`CHIPS POOL` pot or `FREE PLAY`), Duration (`Xm Xs`), Relative time (`2h ago`).
  - **Right On-Chain Verification Badge**:
    - Paid Pool: `SETTLED` (with BaseScan link icon) or `POOL LOCKED`.
    - Free Match: `SYNCED` (cyan/emerald badge) or `UNSYNCED` (amber dot).
- **Expanded Post-Match Scoreboard (Tap-to-Expand)**:
  - **Combatant Roster**: Lists all participants in the match with their avatar initial, display name / short wallet, rank tier badge, `YOU` tag, and `WINNER` trophy badge.
  - **Match Telemetry Footer**: Room code (`#XXXX`), Match ID digest, exact UTC timestamp, and direct clickable **BaseScan TX** link (`sync_tx_hash` or `settle_tx`) when recorded on-chain.

---

## 4. Theme Proofing (Retro-Futurism & Daybreak)
- Built strictly with the `.ludo-profile-scope` semantic class vocabulary (`text-white`, `text-white/60`, `text-white/35`, `bg-white/[0.04]`, `bg-black/40`, `border-white/10`, `text-cyan-400`, `text-emerald-400`, `text-amber-400`, `text-red-400`) which [`app/styles/themes/daybreak.css`](file:///Users/mrongsubho/Documents/Termninal/ludo-base/app/styles/themes/daybreak.css) automatically maps to crisp porcelain white cards, slate ink, and AA-safe accents in Daybreak mode.
