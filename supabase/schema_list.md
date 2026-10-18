# Canonical Supabase Schema & Migration Directory

**Authoritative schema inventory, security model, and migration register for Ludo Base.**

- **Canonical migration count:** 36 migrations (`supabase/migrations/`)
- **Total managed tables:** 49 tables (48 in `public`, 1 in `realtime`)
- **Callable `SECURITY DEFINER` RPCs:** 23 callable functions + 5 trigger functions
- **Schema verification status:** Clean across static contract gates (`npm run check:schema`, `npm run check:rls`) and live database validation (`npm run db:migrate:verify`).

---

## 1. Architecture & Migration Rules

1. **Single Source of Truth:** `supabase/migrations/` is the only active migration directory. Root `migrations/` and `supabase/migrations_archive/` are frozen legacy archives protected by `scripts/archive-guard.test.ts`.
2. **Transactional DDL:** Every canonical migration is wrapped in an atomic `BEGIN; ... COMMIT;` block (`check-schema` rule A4) unless explicitly allowlisted, preventing partial DDL applications.
3. **Arg & Return Stability:** All `CREATE OR REPLACE FUNCTION` definitions must preserve argument names, count, and return types across migration history (`check-schema` rule A1) to avoid Postgres parameter-renaming failures.
4. **Frozen Ledger:** Coin mutations (`players.coins`, `coin_ledger`) are permanently frozen via `players_coins_frozen` trigger. All real-value currency and betting uses the CHIPS escrow system (`chips_escrow_*`).
5. **Server Authority (P0–P6 Complete):** Match lifecycle, turn deadlines, and game moves are server-authoritative. Dice rolls are minted with CSPRNG (`minted_by_kind='server'`), moves commit atomically via `match_commit_action` CAS RPC, and player sessions are managed via scoped HttpOnly cookie tokens (`sessions` table).

---

## 2. Table Inventory (49 Tables)

### 2.1 Identity, Authentication & Sessions
| Table | Origin Migration | Purpose | RLS & Grants |
|---|---|---|---|
| `public.players` | `00000000000000_baseline` | Wallet-bound player profile, username, stats, and ECDH pubkey | RLS enabled; service-role only; `coins` mutation blocked by trigger |
| `public.sessions` | `202610180001_session_v2` | Session v2: SHA-256 hashed session tokens, scopes (`app`, `match`, `spectator`), capabilities, and expirations | RLS enabled; service-role only |
| `public.auth_challenges` | `202610180001_session_v2` | Server-issued single-use cryptographic auth nonces for SIWE / wallet authentication | RLS enabled; service-role only |
| `public.wallet_links` | `202609250001_wallet_links` | Multi-wallet links and primary wallet mappings | RLS enabled; service-role only |
| `public.push_subscriptions` | `202609280001_push_subscriptions` | Web push notification subscription endpoints and auth keys | RLS enabled; service-role only |
| `public.app_sessions` | `00000000000000_baseline` | Legacy v1 app sessions (kept for dual-read backwards compatibility) | RLS enabled; service-role only |

### 2.2 Game Engine, Matches & Lifecycle
| Table | Origin Migration | Purpose | Key Columns / Constraints |
|---|---|---|---|
| `public.matches` | `00000000000000_baseline` | Authoritative match headers, mode, status, and room owner | Added: `finished_at`, `host_proven`, `game_mode_code`, `match_shape`, `room_owner` |
| `public.match_states` | `00000000000000_baseline` | Current authoritative state snapshot, board tokens, turn, and sequence number | Added: `room_version` (1=legacy, 2=Durable Object room) |
| `public.match_rolls` | `00000000000000_baseline` | Minted dice rolls with server CSPRNG, turn seq binding, and consumption status | `status IN ('open', 'consumed', 'passed')`, `seat_color`, unique `(match_id, turn_seq)` |
| `public.match_moves` | `00000000000000_baseline` | Historical journal of validated moves, token movements, and CAS sequence | Indexed by `(match_id, seq)` |
| `public.match_room_events` | `202610180004_room_lifecycle` | Audit journal of server lifecycle events (alarms, turn timeouts, AFK strikes, AI turns) | Append-only; purged by retention RPC |
| `public.match_sessions` | `00000000000000_baseline` | Seat assignments and match tokens | RLS enabled; service-role only |
| `public.provisional_match_sessions` | `00000000000000_baseline` | Temporary seat reservations during lobby formation | Scoped with TTL |

### 2.3 Lobby, Matchmaking & Realtime
| Table | Origin Migration | Purpose | RLS & Grants |
|---|---|---|---|
| `public.matchmaking_queue` | `00000000000000_baseline` | Active matchmaking tickets (purged regularly by CF Cron) | RLS enabled; service-role only |
| `public.game_invites` | `00000000000000_baseline` | Room invite codes and validation tokens (`?s=` room secrets) | RLS enabled; service-role only |
| `public.lobby_join_requests` | `00000000000000_baseline` | Guest seating requests for host authorization | RLS enabled; service-role only |
| `public.lobby_join_policies` | `202609300012_lobby_join_policy` | Room join rules (open, invite-only, validation token requirements) | RLS enabled; service-role only |
| `public.live_matches` | `00000000000000_baseline` | Public lobby index of active/streamable matches | Read-only select granted to anon/auth (narrow columns) |
| `public.live_chat` | `00000000000000_baseline` | Lobby and match public shoutbox messages | RLS enabled; authenticated session wallet required |
| `realtime.messages` | `202610180005_private_realtime` | Supabase Realtime authorization table (NET-03a/b) | RLS enabled; restricted to match participants & service-role |

### 2.4 Social, Chat & Moderation
| Table | Origin Migration | Purpose | Security |
|---|---|---|---|
| `public.friendships` | `00000000000000_baseline` | Mutual friend connections and friend requests | RLS enabled; service-role only |
| `public.conversations` | `00000000000000_baseline` | Direct message conversation metadata and unread counters | RLS enabled; service-role only |
| `public.messages` | `00000000000000_baseline` | ECDH encrypted direct message payloads | Immutable columns enforced by trigger |
| `public.pokes` | `00000000000000_baseline` | Social nudges / pokes between players | Status compatibility constrained |
| `public.user_blocks` | `00000000000000_baseline` | Mutual player blocks (hides presence and DMs) | RLS enabled; service-role only |
| `public.user_reports` | `00000000000000_baseline` | Player reports for abusive behavior / chat | RLS enabled; service-role only |
| `public.feedback` | `00000000000000_baseline` | User feedback submissions | Anonymous INSERT allowed (rate-limited) |
| `public.activities` | `00000000000000_baseline` | Social activity feed entries (wins, unlocks, badges) | Read-only public feed |

### 2.5 CHIPS Economy, Escrow & Marketplace
| Table | Origin Migration | Purpose | Invariants |
|---|---|---|---|
| `public.chips_escrow_config` | `202609300005_spectator_bet_escrow` | Global escrow settings, pool authority signer address, and status | Service-role only |
| `public.chips_escrow_accounts` | `202609300005_spectator_bet_escrow` | Player on-chain deposited CHIPS balances, locked bets, and sequence | Solvency checked on mutation |
| `public.chips_escrow_ledger` | `202609300005_spectator_bet_escrow` | Immutable double-entry ledger of all escrow credits, debits, and settlements | Append-only; balance invariant enforced |
| `public.spectator_bets` | `00000000000000_baseline` | Spectator prediction bets placed on matches | Bound to escrow account and match sequence |
| `public.chips_marketplace_purchases` | `202609300017_chips_marketplace` | Item purchases made with CHIPS balances | Atomic escrow deduction |
| `public.marketplace_purchases` | `202609170001_marketplace_purchase` | Legacy coin marketplace purchases | Frozen (legacy) |
| `public.coin_ledger` | `00000000000000_baseline` | Legacy coins audit ledger | Frozen via `block_coins_mutation` |

### 2.6 Missions, Onboarding & Progression
| Table | Origin Migration | Purpose | Details |
|---|---|---|---|
| `public.mission_catalog` | `202609300003_mission_catalog` | Available recurring missions, categories, thresholds, and rewards | Read-only catalog |
| `public.player_missions` | `00000000000000_baseline` | Player mission progress per period | Added: `period_id` |
| `public.mission_vouchers` | `202609230001_onboarding_referral` | EIP-712 reward vouchers minted for on-chain claiming | Added: `reserved_at` for sweep |
| `public.mission_vouchers_reclaimed` | `202610180007_mission_vouchers_...` | Archive table for swept expired orphaned reservations | Reversible audit table |
| `public.onboarding_progress` | `202609230001_onboarding_referral` | Beginner onboarding step tracking and game track unlocks | Verified server-side against completed matches |
| `public.referral_links` | `202609230001_onboarding_referral` | Referral codes and referee associations | Service-role only |

### 2.7 Tournaments
| Table | Origin Migration | Purpose | RLS & Grants |
|---|---|---|---|
| `public.tournaments` | `00000000000000_baseline` | Tournament brackets, registration deadlines, and prize pools | Public select on narrow columns |
| `public.tournament_participants` | `00000000000000_baseline` | Enrolled players in tournament brackets | Public select on narrow columns |
| `public.tournament_matches` | `00000000000000_baseline` | Tournament bracket pairings and advancement state | Public select on narrow columns |

### 2.8 On-Chain Indexer
| Table | Origin Migration | Purpose | Guarantees |
|---|---|---|---|
| `public.chain_indexer_cursors` | `202610180006_indexer_cursor` | Durable block height cursor per chain ID (P16/G8) | Reorg-safe atomic progression |
| `public.chips_events` | `202609230002_chips_indexer_tables` | Ingested contract event logs (Deposits, Withdrawals, Settles) | Unique `(chain_id, tx_hash, log_index)` |
| `public.chips_pools` | `202609230002_chips_indexer_tables` | On-chain match pools indexed from smart contracts | Unique pool ID |
| `public.chips_pool_seats` | `202609230002_chips_indexer_tables` | Seated players in on-chain match pools | Unique `(pool_id, seat_index)` |
| `public.chips_claimable` | `202609230002_chips_indexer_tables` | Unclaimed tournament and mission winnings | Idempotent claims |

---

## 3. Callable RPCs & Stored Functions

### 3.1 Match Lifecycle & Rules
- `public.match_commit_action(p_match_id, p_expected_seq, p_actor, p_kind, p_payload)`: Single atomic CAS RPC for match room state commits. Atomically checks `seq`, verifies roll binding, marks roll consumed, writes `match_moves`, bumps `match_states.seq`, and returns the updated state or raises `STALE_SEQ`.

### 3.2 CHIPS Escrow & Settlement
- `public.chips_escrow_deposit(p_wallet, p_amount, p_tx_hash)`
- `public.chips_escrow_withdraw(p_wallet, p_amount, p_nonce, p_signature)`
- `public.chips_escrow_place_bet(p_wallet, p_match_id, p_amount, p_predicted_winner)`
- `public.chips_escrow_settle_bets(p_match_id, p_winner_wallet)`
- `public.chips_escrow_spend_purchase(p_wallet, p_amount, p_item_id)`
- `public.chips_escrow_solvency()`: Audits global escrow balance against all account liabilities.
- `public.cash_out_bet(p_bet_id)`
- `public.settle_match_bets(p_match_id)` (Legacy stub / frozen)

### 3.3 Matchmaking & Tournaments
- `public.join_matchmaking(p_wallet, p_mode, p_tier)`
- `public.join_matchmaking_hybrid(p_wallet, p_mode, p_ticket)`
- `public.join_tournament(p_tournament_id, p_wallet)`

### 3.4 Chain Indexer Cursor (P16/G8)
- `public.get_chain_indexer_cursor(p_chain_id)`: Fetches the current confirmed block height.
- `public.update_chain_indexer_cursor(p_chain_id, p_last_block)`: Atomically updates cursor block height with timestamp.

### 3.5 Missions & Vouchers
- `public.next_mission_voucher_nonce(p_wallet)`: Generates replay-safe nonces for EIP-712 reward vouchers.

### 3.6 Scheduled Cleanup & Retention (Cron Invocations)
- `public.cleanup_matchmaking_queue()`: Reaps abandoned matchmaking tickets past TTL.
- `public.cleanup_stale_data()`: Cleans expired provisional sessions and lobby invitations.
- `public.cleanup_auth_challenges(p_keep_hours)`: Reaps consumed or expired SIWE nonces.
- `public.cleanup_sessions(p_keep_days)`: Reaps revoked or expired v2 session tokens.
- `public.cleanup_match_room_events(p_keep_days)`: Purges match room audit logs past retention window.

### 3.7 Social & Chat
- `public.mark_conversation_read(p_conversation_id, p_wallet)`
- `public.purchase_marketplace(p_player_id, p_item_id, p_cost)`

### 3.8 Trigger Functions (Data Invariants)
- `public.block_coins_mutation()`: Enforces permanent freeze on `players.coins` column.
- `public.prevent_client_player_tampering()`: Guards system-controlled player columns against direct writes.
- `public.messages_restrict_columns()`: Guarantees immutable sender, receiver, and ciphertext on DMs.
- `public.touch_updated_at()`: Automatically refreshes row `updated_at` timestamps.
- `public.update_conversation_summary()`: Updates conversation unread counts and snippet on new messages.

---

## 4. Grant & Security Posture (DB-09 Hardening)

1. **Default-Deny RLS:** Enabled across 100% of tables (49/49).
2. **Narrow Client Grants:** Only 5 tables permit client SELECT with explicitly enumerated non-sensitive columns:
   - `matches`: `id, status, game_mode, room_code, created_at, finished_at, room_owner`
   - `live_matches`: `id, match_id, room_code, player_count, status, spectator_count, started_at` (join secret hash excluded)
   - `tournaments`: `id, title, status, start_time, max_participants, current_participants`
   - `tournament_participants`: `tournament_id, player_id, seed, registered_at`
   - `tournament_matches`: `id, tournament_id, round, match_id, player1_id, player2_id, winner_id`
3. **No Client Updates:** `anon` and `authenticated` roles hold **0** UPDATE or DELETE privileges across the entire database.
4. **RPC Protection:** All `SECURITY DEFINER` functions are revoked from `PUBLIC`, `anon`, and `authenticated`. Execution is granted exclusively to `service_role`.

---

## 5. Chronological Migration Register

| # | Timestamp & Name | Category | Scope / Key Changes |
|---|---|---|---|
| 01 | `00000000000000_baseline.sql` | Foundation | Initial 27 tables, baseline schema, RLS, functions, and triggers |
| 02 | `202609170001_marketplace_purchase.sql` | Marketplace | `marketplace_purchases` table and purchase RPC |
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
| 24 | `202609300013_db09_grant_hardening.sql` | Security | DB-09 grant lockdown: narrows client select to 5 tables |
| 25 | `202609300014_provisional_session_scope.sql` | Security | Scopes provisional match session TTL and lookup |
| 26 | `202609300015_live_matches_column_scope.sql` | Security | Hides `join_secret_hash` from client-facing `live_matches` views |
| 27 | `202609300016_db_status_app_sessions_invites.sql` | Netcode | Refines session indexing and invite token lookups |
| 28 | `202609300017_chips_marketplace.sql` | Marketplace | `chips_marketplace_purchases` table and CHIPS item purchasing |
| 29 | `202609300018_phase3_db_hardening.sql` | Security | Definer function security lockdown and parameter verification |
| 30 | `202610180001_session_v2.sql` | Server Auth (P1) | `auth_challenges`, `sessions`, and cleanup RPCs |
| 31 | `202610180002_room_owner.sql` | Server Auth (P2) | Adds `matches.room_owner` for authenticated lobby creation |
| 32 | `202610180003_room_version.sql` | Server Auth (P3) | Adds `match_states.room_version` for DO match room routing |
| 33 | `202610180004_room_lifecycle.sql` | Server Auth (P4) | `match_room_events`, `match_commit_action` CAS RPC, and cleanup |
| 34 | `202610180005_private_realtime.sql` | Server Auth (P5) | `realtime.messages` table and private channel RLS policies |
| 35 | `202610180006_indexer_cursor.sql` | Server Auth (P6) | `chain_indexer_cursors` table and atomic cursor update RPCs |
| 36 | `202610180007_mission_vouchers_pending_cleanup.sql` | Missions | `mission_vouchers_reclaimed` archive table and orphaned sweep |
