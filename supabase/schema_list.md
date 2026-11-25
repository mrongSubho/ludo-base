# Canonical Supabase Schema & Migration Directory

**Authoritative schema inventory, security model, and migration register for Ludo 3077.**

- **Canonical migration count:** 55 migrations (`supabase/migrations/`)
- **Total managed tables:** 70 tables (`69` in `public`, `1` in `realtime`)
- **Distinct SQL functions across migrations:** 47 (`40` callable `SECURITY DEFINER` RPCs, `1` `SECURITY INVOKER` column-default helper, `6` trigger functions; `check:schema` validates `66` total function definitions across the migration chain)
- **Schema verification status:** Clean across static contract gates (`npm run check:schema` — 55 migrations / 66 function defs, `npm run check:rls` — 55 migrations); live database validation runs with `LUDO_SCHEMA_DB_URL` via `npm run db:migrate:verify`.

---

## 1. Architecture & Migration Rules

1. **Single Source of Truth:** `supabase/migrations/` is the only active migration directory. Root `migrations/` and `supabase/migrations_archive/` are frozen legacy archives protected by `scripts/archive-guard.test.ts`.
2. **Transactional DDL:** Every canonical migration is wrapped in an atomic `BEGIN; ... COMMIT;` block (`check-schema` rule A4) unless explicitly allowlisted, preventing partial DDL applications.
3. **Arg & Return Stability:** All `CREATE OR REPLACE FUNCTION` definitions must preserve argument names, count, and return types across migration history (`check-schema` rule A1) — creating mismatched argument lists produces accidental Postgres overloads rather than replacing the function.
4. **Frozen Coin Ledger:** Legacy coin mutations (`players.coins`, `coin_ledger`) are permanently frozen via `players_coins_frozen` (`block_coins_mutation`). On-chain/escrowed currency uses `ArenaVault` (`arena_vault_*`), `ClanClaim` / `ArenaVault` smart contracts, and CHIPS escrow (`chips_escrow_*`).
5. **Server Authority & Scoped Sessions:** Match lifecycle, turn deadlines, deterministic seat assignment (`match_seats`), and game moves are server-authoritative via the `MatchRoom` Durable Object (`match_commit_action` CAS RPC). Scoped sessions (`sessions`) include optional `seat_color` binding (`202610220003`).

---

## 2. Table Inventory (70 Tables)

### 2.1 Identity, Authentication & Sessions
| Table | Origin Migration | Purpose | RLS & Grants / Notes |
|---|---|---|---|
| `public.players` | `00000000000000_baseline` | Wallet-bound player profile, username, stats, ECDH pubkey, `is_public`, `allow_requests`, random pilot avatar default | RLS enabled; narrow column-scoped SELECT; `coins` mutation blocked; privacy cols `202611200001`; avatar default/trigger `202611220001` |
| `public.sessions` | `202610180001_session_v2` | Session v2: SHA-256 hashed session tokens, scopes (`app`, `match`, `spectator`), optional `seat_color` (`202610220003`), expirations | RLS enabled; service-role only |
| `public.auth_challenges` | `202610180001_session_v2` | Server-issued single-use cryptographic auth nonces for SIWE / wallet authentication | RLS enabled; service-role only |
| `public.wallet_links` | `202609250001_wallet_links` | Multi-wallet links and primary wallet mappings | RLS enabled; service-role only |
| `public.push_subscriptions` | `202609280001_push_subscriptions` | Web push notification subscription endpoints and auth keys | RLS enabled; service-role only |
| `public.app_sessions` | `00000000000000_baseline` | Legacy v1 app sessions (kept for dual-read backwards compatibility) | RLS enabled; service-role only |

### 2.2 Game Engine, Matches & Lifecycle
| Table | Origin Migration | Purpose | Key Columns / Constraints |
|---|---|---|---|
| `public.matches` | `00000000000000_baseline` | Authoritative match headers, mode, status, and room owner | Added: `finished_at`, `host_proven`, `game_mode_code`, `match_shape`, `room_owner` |
| `public.match_seats` | `202610220002_match_seats` | Canonical server-assigned `(match_id, color, wallet_address, seat_index)` seat roster | RLS enabled; client SELECT granted; unique `(match_id, wallet_address)` |
| `public.match_states` | `00000000000000_baseline` | Current authoritative state snapshot, board tokens, turn, and CAS `seq` | Added: `room_version` (`1`=legacy, `2`=Durable Object room) |
| `public.match_rolls` | `00000000000000_baseline` | Minted dice rolls with server CSPRNG, turn seq binding, and consumption status | `status IN ('open', 'consumed', 'passed')`, `seat_color`, unique `(match_id, turn_seq)` |
| `public.match_moves` | `00000000000000_baseline` | Historical journal of validated moves, token movements, and CAS sequence | Indexed by `(match_id, seq)` |
| `public.match_room_events` | `202610180004_room_lifecycle` | Audit journal of server lifecycle events (alarms, turn timeouts, AFK strikes, AI turns) | Append-only; purged by retention RPC |
| `public.match_sessions` | `00000000000000_baseline` | Legacy EIP-712 seat grants | RLS enabled; service-role only |
| `public.provisional_match_sessions` | `00000000000000_baseline` | Temporary seat reservations during lobby formation (`(authorization_key, wallet_address)` unique) | Scoped with TTL |

### 2.3 Lobby, Matchmaking & Realtime
| Table | Origin Migration | Purpose | RLS & Grants |
|---|---|---|---|
| `public.matchmaking_queue` | `00000000000000_baseline` | Active matchmaking tickets (shape-aware, 30s lease TTL, purged by Cron) | RLS enabled; service-role only |
| `public.game_invites` | `00000000000000_baseline` | Room invite codes and validation tokens (`?s=` room secrets) | RLS enabled; service-role only |
| `public.lobby_join_requests` | `00000000000000_baseline` | Guest seating requests for host authorization | RLS enabled; service-role only |
| `public.lobby_join_policies` | `202609300012_lobby_join_policy` | Room join rules (`matchmaking`, `invite`, `open`) | RLS enabled; service-role only |
| `public.live_matches` | `00000000000000_baseline` | Public lobby/spectator index (`window_opened_at`, `window_closed_at`, `bet_window_status`) | Narrow 6-column SELECT granted to anon/auth (secret hash excluded) |
| `public.live_chat` | `00000000000000_baseline` | Lobby and match public shoutbox messages (`content` <= 500 chars) | RLS enabled; SELECT granted; writes gated via API |
| `realtime.messages` | `202610180005_private_realtime` | Supabase Realtime authorization table (`match:*`, `game-room-*`, extended to `clan-*` & `clan-war-*` in `202611180001`) | RLS enabled; scoped by topic/role policies |

### 2.4 Social, Chat & Moderation
| Table | Origin Migration | Purpose | Security |
|---|---|---|---|
| `public.friendships` | `00000000000000_baseline` | Mutual friend connections and friend requests | RLS enabled; service-role only |
| `public.conversations` | `00000000000000_baseline` | Direct message conversation metadata and unread counters | RLS enabled; service-role only |
| `public.messages` | `00000000000000_baseline` | ECDH P-256 encrypted direct message payloads (`<= 4000` chars) | Immutable columns enforced by `messages_restrict_columns` |
| `public.pokes` | `00000000000000_baseline` | Social nudges / pokes between players | Status presence constrained |
| `public.user_blocks` | `00000000000000_baseline` | Mutual player blocks (hides presence and DMs) | RLS enabled; service-role only |
| `public.user_reports` | `00000000000000_baseline` | Player reports for abusive behavior / chat | RLS enabled; service-role only |
| `public.feedback` | `00000000000000_baseline` | User feedback submissions | Service-role writes via rate-limited `/api/feedback` |
| `public.activities` | `00000000000000_baseline` | Social activity feed entries (wins, unlocks, badges) | RLS enabled; service-role reads/writes |

### 2.5 CHIPS Economy, Escrow, ArenaVault & Marketplace
| Table | Origin Migration | Purpose | Invariants |
|---|---|---|---|
| `public.arena_vault_accounts` | `202611170001_arena_vault_system` | Reusable Match & Spectator Vault CHIPS balances | Non-negative `balance >= 0`, lowercase wallet PK; RLS service-role only |
| `public.arena_match_stakes` | `202611170001_arena_vault_system` | Per-match reserved/committed/settled/released/forfeited wagers | Unique `(match_key, wallet_address)`; RLS service-role only |
| `public.arena_vault_claims` | `202611170001_arena_vault_system` | Claim Hub vouchers (`match_prize`, `vault_withdraw`, `match_refund`; statuses `claimable`, `rolled`, `claimed`) | `amount > 0`; RLS service-role only |
| `public.arena_vault_ledger` | `202611170001_arena_vault_system` | Idempotent double-entry audit ledger for deposits, wagers, spectator bets, prizes & refunds | Unique `(wallet_address, reason, ref)`; RLS service-role only |
| `public.chips_escrow_config` | `202609300005_spectator_bet_escrow` | Global escrow settings, treasury wallet, and status | Service-role only |
| `public.chips_escrow_accounts` | `202609300005_spectator_bet_escrow` | Legacy/escrow CHIPS balances, locked bets, and sequence | Solvency checked on mutation |
| `public.chips_escrow_ledger` | `202609300005_spectator_bet_escrow` | Immutable ledger of escrow credits, debits, purchases & clan fees (`202611020001` expanded reasons) | Append-only; unique `(wallet_address, reason, ref)` |
| `public.spectator_bets` | `00000000000000_baseline` | Pari-mutuel spectator prediction bets funded from `arena_vault_accounts` (`202611190001`) or legacy escrow | Idempotent on `(player_id, action_id)`; timing guard enforced |
| `public.chips_marketplace_purchases` | `202609300017_chips_marketplace` | Item purchases made with CHIPS balances | Atomic escrow deduction |
| `public.marketplace_purchases` | `202609170001_marketplace_purchase` | Legacy coin marketplace purchases | Frozen (legacy) |
| `public.coin_ledger` | `00000000000000_baseline` | Legacy coins audit ledger | Frozen via `block_coins_mutation` |

### 2.6 Missions, Onboarding & Progression
| Table | Origin Migration | Purpose | Details |
|---|---|---|---|
| `public.mission_catalog` | `202609300003_mission_catalog` | Available recurring missions, categories, thresholds, and rewards (`5..20` band) | Read-only catalog |
| `public.player_missions` | `00000000000000_baseline` | Player mission progress per period | Scoped by `period_id` |
| `public.mission_vouchers` | `202609230001_onboarding_referral` | EIP-712 reward vouchers minted for on-chain claiming | Added: `reserved_at` for orphaned sweep |
| `public.mission_vouchers_reclaimed` | `202610180007_mission_vouchers_pending_cleanup` | Archive table for swept expired orphaned reservations | Reversible audit table |
| `public.player_free_matches` | `202610270001_free_match_sync_queue` | Queue tracking unsynced free matches for batch `MissionSystem` on-chain telemetry sync | Client SELECT allowed; writes revoked to `service_role`; unique `(player_id, match_id)` |
| `public.onboarding_progress` | `202609230001_onboarding_referral` | Beginner onboarding step tracking and game track unlocks | Verified server-side against completed matches |
| `public.referral_links` | `202609230001_onboarding_referral` | Referral codes and referee associations | Service-role only |

### 2.7 Tournaments
| Table | Origin Migration | Purpose | RLS & Grants |
|---|---|---|---|
| `public.tournaments` | `00000000000000_baseline` | Tournament brackets, registration deadlines, and prize pools | Public SELECT granted |
| `public.tournament_participants` | `00000000000000_baseline` | Enrolled players in tournament brackets | Service-role only under DB-09 |
| `public.tournament_matches` | `00000000000000_baseline` | Tournament bracket pairings and advancement state | Status present check enforced |

### 2.8 Tactical Clans & 3N Clan Wars (14 Tables)
| Table | Origin Migration | Purpose | RLS & Key Constraints |
|---|---|---|---|
| `public.clan_level_config` | `202611020001_clan_system_core` | Seeded Level 1–20 CXP thresholds, member caps (`20→50`), officer slots (`2→6`), feature unlocks | RLS enabled; service-role only |
| `public.clans` | `202611020001_clan_system_core` | Master clan registry (name, uppercase 2–5 tag, crest, CWR, division, treasury, `treasury_public`, `rename_count`) | Privacy/rename columns added `202611180002`; RLS service-role only |
| `public.clan_members` | `202611020001_clan_system_core` | One-clan-per-wallet membership (`commander`, `officer`, `elite`, `member`), weekly/total CXP, WP | Unique `wallet_address`; RLS service-role only |
| `public.clan_join_requests` | `202611020001_clan_system_core` | Pending/accepted/rejected/expired clan membership applications (7-day expiry) | Unique `(clan_id, wallet_address)`; RLS service-role only |
| `public.clan_chat` | `202611020001_clan_system_core` | Plaintext Clan Hall chat (`<= 280` chars) | RLS enabled; service-role only |
| `public.clan_war_calls` | `202611020001_clan_system_core` | War mobilization challenges (`5/10/15/20` bracket, fee >= 500, 100% governance split check) | Status `notice_open | searching | matched | cancelled | expired` |
| `public.clan_war_stakes` | `202611020001_clan_system_core` | Locked buy-ins per war call (`member_fee`, `booster`, `treasury_subsidy`) | Unique `(war_call_id, wallet_address, kind)` |
| `public.clan_wars` | `202611020001_clan_system_core` | Matched clan wars (`prep_phase`, `active_war`, `settling`, `completed`, `draw_refunded`) | Added `clan_a_call_id`, `clan_b_call_id` (`202611180001`) |
| `public.clan_war_fixtures` | `202611020001_clan_system_core` | `3N` fixture matrix (`1v1` and `2v2`) + bilateral scheduling (`proposed_by`, `proposed_at` in `202611180001`) | Unique `(war_id, fixture_index)` |
| `public.clan_war_points` | `202611020001_clan_system_core` | Per-fixture War Points (WP) ledger (`base_win`, `walkover`, `loss`, `capture`, `home_sweep`, etc.) | Unique `(war_id, fixture_id, wallet_address, kind)` |
| `public.clan_claims` | `202611020001_clan_system_core` | Pull-based EIP-712 `ClanClaim` vouchers (`war_principal`, `war_merit_wp`, `war_gov_share`, `war_refund`, etc.) | Unique `(wallet_address, claim_type, source_id)` added `202611180001` |
| `public.clan_treasury_ledger` | `202611020001_clan_system_core` | Internal clan treasury audit ledger (`war_cut`, `donation`, `subsidy_return`, `war_subsidy`, etc.) | RLS enabled; service-role only |
| `public.clan_score_queue` | `202611020001_clan_system_core` | Idempotent outbox bridging completed match records to clan/fixture scoring | Unique `match_id`; RLS service-role only |
| `public.clan_mission_progress` | `202611180001_clan_hardening_and_lifecycle` | Clan daily contracts & weekly objective progress per `(clan_id, wallet_address, mission_key, period_key)` | RLS enabled; service-role only |

### 2.9 On-Chain Indexer & Infrastructure
| Table | Origin Migration | Purpose | Guarantees |
|---|---|---|---|
| `public.chain_indexer_cursors` | `202610180006_indexer_cursor` | Durable block height cursor per chain ID (P16/G8) | Reorg-safe atomic progression |
| `public.chips_events` | `202609230002_chips_indexer_tables` | Ingested contract logs & txHash replay prevention (Deposits, Withdrawals, Settles, Clan create, War buy-in) | Unique `(chain_id, tx_hash, log_index)` |
| `public.chips_pools` | `202609230002_chips_indexer_tables` | On-chain match pools indexed from `MatchPool` | Unique pool ID |
| `public.chips_pool_seats` | `202609230002_chips_indexer_tables` | Seated players in on-chain match pools | Unique `(pool_id, seat_index)` |
| `public.chips_claimable` | `202609230002_chips_indexer_tables` | Unclaimed tournament/escrow rewards | Idempotent claims |
| `public.rate_limit_buckets` | `202610200003_rate_limit_shared` | Fixed-window distributed rate-limit counters (SA-5) | RLS enabled; service-role only |

---

## 3. Stored Functions Inventory (47 Distinct Functions)

### 3.1 Match Lifecycle, Seating & Rules
- `public.assign_match_seats(p_match_id, p_match_shape, p_participants)`: Deterministically sorts participant wallets under explicit Postgres `"C"` collation and persists color/seat assignments into `match_seats` (`202610220002`).
- `public.match_commit_action(p_match_id, p_expected_seq, p_new_state, p_event_type, p_event_payload)`: Single atomic CAS RPC for MatchRoom state commits & S0 initial seed persistence (casts `match_states.match_id = p_match_id::text`, derives `room_code`/`host_address` from `matches`/`match_seats` as of `202610230005`).

### 3.2 ArenaVault (Quick Match, TeamUp & Spectator Pari-Mutuel)
- `public.arena_vault_credit_deposit(p_wallet, p_amount, p_tx_hash)`: Advisory-locked idempotent vault deposit credit.
- `public.arena_vault_reserve(p_match_key, p_wallet, p_amount)`: Atomically reserves reusable vault balance for queuing/lobby entry (0 gas when covered).
- `public.arena_vault_release(p_match_key, p_wallet)`: Returns unused reserved stake on search cancel / lobby close / stake step-down (0 gas).
- `public.arena_vault_commit_match(p_match_keys, p_match_id)`: Commits reserved stakes on match start.
- `public.arena_vault_request_withdraw(p_wallet, p_amount)`: Converts vault balance into a claimable EIP-712 `vault_withdraw` voucher in `arena_vault_claims`.
- `public.arena_vault_roll_prize(p_wallet, p_claim_id)`: Rolls a claimable prize straight into `arena_vault_accounts` at 0 gas.
- `public.arena_vault_settle_match(p_match_id, p_winners, p_shares_bps, p_rake_bps)`: Distributes committed wager pot (default 5% rake) to winner claim vouchers.
- `public.arena_vault_place_spectator_bet(p_player, p_match_id, p_bet_type, p_bet_value, p_amount, p_action_id)`: Advisory-locked pari-mutuel spectator stake debit from `arena_vault_accounts` (`202611190001`), enforcing fixed window closure, anti-self-bet, and idempotency.
- `public.arena_vault_settle_spectator_bets(p_match_id, p_winning_values, p_rake_bps)`: Opposed pari-mutuel settlement (5% rake capped at losing pool) to `arena_vault_claims`; unopposed winners receive 100% `match_refund` (`0%` rake); unopposed losers forfeit to House Pool.

### 3.3 Legacy CHIPS Escrow & Marketplace
- `public.chips_escrow_touch(p_wallet)`
- `public.chips_escrow_deposit(p_wallet, p_amount, p_tx_hash)`
- `public.chips_escrow_withdraw(p_wallet, p_amount, p_nonce, p_signature)`
- `public.chips_escrow_place_bet(p_wallet, p_match_id, p_amount, p_predicted_winner)`
- `public.chips_escrow_settle_bets(p_match_id, p_winner_wallet)`
- `public.chips_escrow_spend_purchase(p_wallet, p_amount, p_item_id)`
- `public.chips_escrow_solvency()`
- `public.cash_out_bet(p_bet_id)` / `public.settle_match_bets(p_match_id)` (Legacy stubs — frozen)
- `public.purchase_marketplace(p_player_id, p_item_id, p_cost)` (Legacy stub)

### 3.4 Tactical Clans & Wars
- `public.clan_create_with_escrow(p_leader_wallet, p_name, p_tag, p_bio, p_crest, p_request_id, p_fee_base)`: Escrow-based clan creation overload (note: `202611020002` adjusted tag check `2..5` chars and granted execute to `authenticated, service_role`; primary app flow also uses direct on-chain CHIPS transfer via `app/api/clans/route.ts`).
- `public.increment_member_cxp_wp(p_clan_id, p_wallet, p_wp, p_cxp)`: Atomic increment of member `war_points`, `weekly_cxp`, and `total_cxp` (`202611180001`).
- `public.increment_clan_cxp(p_clan_id, p_cxp_delta)`: Atomic clan CXP increment with automatic `clan_level_config` threshold level-up (`202611180001`).
- `public.clan_adjust_member_count(p_clan_id, p_delta)`: Non-negative atomic member counter adjustment (`202611180001`).
- `public.clan_credit_treasury_donation(p_clan_id, p_amount, p_reason, p_ref)`: Atomic clan treasury credit + ledger entry (`202611180001`).
- `public.clan_match_war_calls(p_call_a_id, p_call_b_id)`: Advisory-locked matching of two searching clan war calls into `clan_wars` (`202611180001`).

### 3.5 Matchmaking, Tournaments, Missions & Infrastructure
- `public.join_matchmaking(p_player_id, p_game_mode, p_match_type, p_wager, p_wager_min, p_wager_max)`: Shape-aware matching (`1v1`, `2v2`, `4P`), filters `expires_at > now()`, writes `match_seats` on match creation (`202610240001`).
- `public.join_matchmaking_hybrid(p_player_id, p_game_mode, p_match_type, p_wager, p_wager_min, p_wager_max, p_room_code)`: Hybrid party fill with 30s lease TTL and shape-aware seat assignment (`202610240001`).
- `public.join_tournament(p_tournament_id, p_wallet)`
- `public.get_chain_indexer_cursor(p_chain_id)` / `public.update_chain_indexer_cursor(p_chain_id, p_last_block)`
- `public.next_mission_voucher_nonce(p_wallet)`
- `public.rate_limit_hit(p_key, p_window_ms, p_limit)`: Shared fixed-window counter RPC (`202610200003`).
- `public.mark_conversation_read(p_conversation_id, p_wallet)`
- `public.random_pilot_avatar()`: `SECURITY INVOKER` helper returning one of 18 random pilot portrait IDs (`avatar:pilot-*`) for default player rows (`202611220001`).

### 3.6 Scheduled Cleanup & Retention (Cron Invocations)
- `public.cleanup_matchmaking_queue()`
- `public.cleanup_stale_data()`
- `public.cleanup_auth_challenges(p_keep_hours)`
- `public.cleanup_sessions(p_keep_days)`
- `public.cleanup_match_room_events(p_keep_days)`

### 3.7 Trigger Functions (6 Data Invariants)
- `public.block_coins_mutation()`: Enforces permanent freeze on `players.coins`.
- `public.prevent_client_player_tampering()`: Guards system-controlled player columns against direct writes.
- `public.messages_restrict_columns()`: Guarantees immutable sender, receiver, and ciphertext on DMs.
- `public.touch_updated_at()`: Automatically refreshes row `updated_at` timestamps.
- `public.update_conversation_summary()`: Updates conversation unread counts and snippet on new messages.
- `public.assign_default_pilot_avatar()`: `BEFORE INSERT` trigger assigning `random_pilot_avatar()` when `players.avatar_url` is null/blank (`202611220001`).

---

## 4. Grant & Security Posture (DB-09 + Extensions)

1. **Default-Deny RLS:** Enabled across **100% of managed tables (`70/70`)**.
2. **Narrow Client `SELECT` Grants:** Only **7 tables** allow `anon` / `authenticated` `SELECT`:
   - `players`: explicitly enumerated non-sensitive columns (including `is_public, allow_requests` from `202611200001`; excludes `coins`, `ecdh_pubkey`)
   - `live_matches`: narrow 6 public columns (`202609300015`; secret hashes excluded)
   - `matches`, `tournaments`, `live_chat`, `match_seats` (`202610220002`), `player_free_matches` (`202610270001`)
3. **No Client Mutations:** `anon` and `authenticated` hold **0** direct `UPDATE` or `DELETE` privileges across public tables.
4. **RPC Protection:** All `SECURITY DEFINER` RPCs are revoked from `PUBLIC` / `anon` / `authenticated` and restricted to `service_role` (only `clan_create_with_escrow` grants `authenticated, service_role` per `202611020002`).

---

## 5. Chronological Migration Register (55 Migrations)

| # | Timestamp & Name | Category | Scope / Key Changes |
|---|---|---|---|
| 01 | `00000000000000_baseline.sql` | Foundation | Initial 27 tables, baseline schema, RLS, functions, and triggers |
| 02 | `202609170001_marketplace_purchase.sql` | Marketplace | `marketplace_purchases` table and legacy purchase RPC |
| 03 | `202609180001_pokes_status_compat.sql` | Social | Status compatibility check on `pokes` table |
| 04 | `202609180002_matches_finished_at.sql` | Matches | Adds `finished_at` timestamp column to `matches` |
| 05 | `202609180003_live_chat_room_nullable.sql` | Social | Allows global lobby chat with nullable `room_id` |
| 06 | `202609180004_rpc_revoke_anon.sql` | Security | Revokes public/anon execution on sensitive RPCs |
| 07 | `202609230001_onboarding_referral.sql` | Missions | `referral_links`, `onboarding_progress`, and `mission_vouchers` tables |
| 08 | `202609230002_chips_indexer_tables.sql` | Indexer | `chips_events`, `chips_pools`, `chips_pool_seats`, `chips_claimable` |
| 09 | `202609230003_freeze_legacy_coin_writers.sql` | Economy | Freezes legacy coin writers and enforces ledger |
| 10 | `202609250001_wallet_links.sql` | Identity | `wallet_links` table for multi-account associations |
| 11 | `202609280001_push_subscriptions.sql` | Push | `push_subscriptions` table for web push notifications |
| 12 | `202609300001_coin_freeze_corrective.sql` | Economy | Transactional corrective freeze trigger on `players.coins` |
| 13 | `202609300002_match_rolls_status_vocabulary.sql` | Engine | Constrains `match_rolls.status` to `open`, `consumed`, `passed` |
| 14 | `202609300003_mission_catalog.sql` | Missions | Canonical `mission_catalog` table and catalog data |
| 15 | `202609300004_player_missions_period.sql` | Missions | Adds `period_id` partitioning column to `player_missions` |
| 16 | `202609300005_spectator_bet_escrow.sql` | Escrow | `chips_escrow_*` tables, ledger, solvency, and bet escrow binding |
| 17 | `202609300006_revoke_escrow_touch.sql` | Security | Revokes non-essential escrow touch endpoints |
| 18 | `202609300007_matches_host_proven.sql` | Netcode | Adds `host_proven` verification column to `matches` |
| 19 | `202609300008_bet_idempotency_and_ledger_docs.sql` | Escrow | Enforces idempotency keys on spectator bet transactions |
| 20 | `202609300009_matches_pool_shape.sql` | Netcode | Adds `game_mode_code` and `match_shape` columns to `matches` |
| 21 | `202609300010_phase1_unblock.sql` | Missions | Adds `reserved_at` and pending index on `mission_vouchers` |
| 22 | `202609300011_roll_receipt_binding.sql` | Engine | Binds rolls to turns with `seat_color` and unique index |
| 23 | `202609300012_lobby_join_policy.sql` | Lobby | `lobby_join_policies` table and room secret validation |
| 24 | `202609300013_db09_grant_hardening.sql` | Security | DB-09 grant lockdown: narrows client select allowlist |
| 25 | `202609300014_provisional_session_scope.sql` | Security | Scopes provisional match session TTL and `(authorization_key, wallet_address)` |
| 26 | `202609300015_live_matches_column_scope.sql` | Security | Hides secret columns from client-facing `live_matches` reads |
| 27 | `202609300016_db_status_app_sessions_invites.sql` | Netcode | Refines session indexing, presence CHECKs, and invite token lookups |
| 28 | `202609300017_chips_marketplace.sql` | Marketplace | `chips_marketplace_purchases` table and CHIPS item purchasing |
| 29 | `202609300018_phase3_db_hardening.sql` | Security | Definer hardening, `prevent_client_player_tampering`, drops `messages` from publication |
| 30 | `202610180001_session_v2.sql` | Server Auth (P1) | `auth_challenges`, `sessions`, and cleanup RPCs |
| 31 | `202610180002_room_owner.sql` | Server Auth (P2) | Adds `matches.room_owner` for authenticated lobby creation |
| 32 | `202610180003_room_version.sql` | Server Auth (P3) | Adds `match_states.room_version` for DO match room routing |
| 33 | `202610180004_room_lifecycle.sql` | Server Auth (P4) | `match_room_events`, `match_commit_action` CAS RPC, and cleanup |
| 34 | `202610180005_private_realtime.sql` | Server Auth (P5) | `realtime.messages` table and private channel RLS policies |
| 35 | `202610180006_indexer_cursor.sql` | Server Auth (P6) | `chain_indexer_cursors` table and atomic cursor update RPCs |
| 36 | `202610180007_mission_vouchers_pending_cleanup.sql` | Missions | `mission_vouchers_reclaimed` archive table and orphaned sweep |
| 37 | `202610200001_matchmaking_shape_aware.sql` | Matchmaking | Shape-aware `join_matchmaking` (accumulates 4 slots for `2v2`/`4P`) |
| 38 | `202610200002_matchmaking_caller_ticket.sql` | Matchmaking | Inserts matched ticket for calling player alongside matched opponents |
| 39 | `202610200003_rate_limit_shared.sql` | Security | `rate_limit_buckets` table + atomic `rate_limit_hit` RPC (SA-5) |
| 40 | `202610210001_fix_hybrid_matchmaking.sql` | Matchmaking | Fixes hybrid host party advertisement & public queue hunting |
| 41 | `202610220001_seed_persistence.sql` | Server Lobby (S0) | Allows `match_commit_action` to seed initial `match_states` row (`seq = 0`) |
| 42 | `202610220002_match_seats.sql` | Server Lobby | `match_seats` table, `assign_match_seats` (`"C"` collation), updates `join_matchmaking*` |
| 43 | `202610220003_session_seat_color.sql` | Server Auth | Adds `sessions.seat_color` check-constrained to `green/red/yellow/blue` |
| 44 | `202610220004_fix_matchmaking_overloads.sql` | Matchmaking | Cleans up parameter types/overloads for `join_matchmaking` & `join_matchmaking_hybrid` |
| 45 | `202610230005_fix_match_commit_types.sql` | Server Auth | Casts `match_states.match_id = p_match_id::text` & fills `room_code`/`host_address` on S0 seed |
| 46 | `202610240001_fix_matchmaking_expiry_and_hybrid.sql` | Matchmaking | Restores `expires_at > now()` filtering, 30s lease TTL, shape-aware hybrid match |
| 47 | `202610270001_free_match_sync_queue.sql` | Progression | `player_free_matches` table tracking unsynced free matches for batch telemetry sync |
| 48 | `202611020001_clan_system_core.sql` | Clans | Adds 13 core clan/war tables, level 1–20 seed, escrow reasons, and `clan_create_with_escrow` |
| 49 | `202611020002_clan_create_escrow_overload.sql` | Clans | Adds defaults, `2..5`-char tag validation, and `authenticated`/`service_role` grant |
| 50 | `202611170001_arena_vault_system.sql` | ArenaVault | `arena_vault_accounts`, `arena_match_stakes`, `arena_vault_claims`, `arena_vault_ledger` + 7 vault RPCs |
| 51 | `202611180001_clan_hardening_and_lifecycle.sql` | Clans | `clan_mission_progress`, atomic CXP/WP/count/donation/war-match RPCs, fixture proposal cols, claim unique index, private `clan-*`/`clan-war-*` realtime policies |
| 52 | `202611180002_clan_profile_account.sql` | Clans | Adds `clans.treasury_public` and `clans.rename_count` columns |
| 53 | `202611190001_spectator_parimutuel_vault.sql` | Spectator Bets | `arena_vault_place_spectator_bet` & `arena_vault_settle_spectator_bets` pari-mutuel Vault RPCs |
| 54 | `202611200001_profile_privacy.sql` | Privacy | Adds `players.is_public` & `players.allow_requests` with client SELECT grant |
| 55 | `202611220001_default_random_pilot_avatar.sql` | Identity | `random_pilot_avatar()`, `assign_default_pilot_avatar()` trigger & backfill across 18 portraits |
