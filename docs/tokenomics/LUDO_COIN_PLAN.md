# LUDO Coin — Full Tokenomics & Gamification Plan

**Project:** Ludo Base  
**Network (now):** Base Sepolia (`84532`)  
**Network (later):** Base Mainnet (`8453`)  
**Document type:** Token design + game-economy plan  
**Status:** Planning draft — implementation not started  
**Last updated:** 2026-09

---

## 0. Why this plan exists

Today the in-game economy is off-chain:

| Surface | Current behavior |
| --- | --- |
| Balance | `players.coins` (bigint, default `1000`) in Supabase |
| Ledger | `coin_ledger` with idempotency keys |
| Match stakes | Lobby wager presets (0 → 1M), matchmaking `wager` / `wager_min` / `wager_max` |
| Spectator bets | `spectator_bets` + host-signed `resolve-bet` + `settle_match_bets` / `cash_out_bet` |
| Missions | Daily/weekly claims paying 50–100 soft coins |
| Social | Poke-back pays +100 coins |
| Marketplace | Cosmetics priced 0–2000 coins; server deducts on purchase |
| Match record | `/api/match/record` pays **LXP/RXP only** — coin pot is intentionally not paid there |
| Terms | Explicitly: entry fees are paid in **virtual Coins** |

The product is already onchain-adjacent (Base + Base Sepolia, OnchainKit, SIWE sessions, match-session EIP-712, host-signed bet resolve, 6492-aware wallet verify). The missing piece is a **real economic asset** with supply, sinks, and a clean bridge between free play and competitive value.

**Goal:** replace “a number in a cell” with a designed dual-currency system that can survive real users on Base Sepolia, then migrate to Base mainnet without redesigning the game.

---

## 1. Executive decision (recommended architecture)

### Do **not** put every match payout onchain.

Gas, latency, cheating UX, and Farcaster frame flows all break if every free table writes to chain.

### Do adopt a **hybrid dual-currency model** (industry-standard web2.5 games on Base):

```text
┌─────────────────────────────────────────────────────────────┐
│                        LUDO BASE ECONOMY                    │
├──────────────────────────┬──────────────────────────────────┤
│  CHIPS (soft currency)   │  $LUDO (hard currency)          │
│  Off-chain, server ledger│  ERC-20 on Base Sepolia/Base    │
│  Free tables, missions,  │  Season rewards, tournaments,   │
│  cosmetics basics, AI    │  premium cosmetics, staking,    │
│  practice, social pokes  │  spectator high-stakes, withdraw│
│  Instant, zero gas       │  Wallet ownership, claimable    │
└────────────┬─────────────┴──────────────┬───────────────────┘
             │        BRIDGE (controlled) │
             │  · Daily soft claims (Chips)
             │  · Season / rank claims → $LUDO
             │  · Optional Chip→LUDO conversion windows
             │  · LUDO deposit → Chip credit (play money)
             └────────────────────────────┘
```

### Naming

| Asset | Role | Where it lives |
| --- | --- | --- |
| **Chips** | Play currency. Renames today’s `players.coins` conceptually (same table can keep the column name `coins` internally). | Supabase `players.coins` + `coin_ledger` |
| **$LUDO** | Real token. Scarcity + ownership + competitive value. | ERC-20 + claim/vault contracts + DB mirror |

UI already shows invite stakes as “LUDO” in places (`InviteNotification`). Product language should split clearly:

- Free / low tables → **Chips**
- Ranked, tournaments, season pots, marketplace hard items → **$LUDO**

> **Alternative (rejected for now):** single onchain token for everything. Forces every free player through wallet+gas, inflates casual UX, and makes mission faucets look like a securities faucet. Hybrid keeps free play cheap and makes $LUDO scarce where it matters.

---

## 2. Token specification — $LUDO

| Parameter | Value |
| --- | --- |
| Name | Ludo Base |
| Symbol | `LUDO` |
| Standard | ERC-20 (OpenZeppelin) |
| Decimals | `18` |
| Max supply | **1,000,000,000** (1B) |
| Initial mint | Allocations minted to a **Minter / SeasonDistributor** controlled by a multisig |
| Chain (testnet) | Base Sepolia `84532` |
| Chain (prod later) | Base `8453` |
| Upgradeability | Token: **non-upgradeable**. Distributor/vault: upgradeable only via timelock (later) |
| Permit | EIP-2612 (gasless approvals for marketplace/claim UX) |
| Roles | `DEFAULT_ADMIN` (multisig), `MINTER` (season distributor only), `PAUSER` (emergency on vault/market, **not** on token transfers if avoidable) |

### 2.1 Allocation (realistic, game-first)

| Bucket | % | Amount | Vesting / release | Purpose |
| --- | --- | --- | --- | --- |
| Play & Season Rewards | 30% | 300M | Emitted per season from SeasonDistributor; hard caps per season | Rank rewards, tournaments, weekly arena |
| Ecosystem / Treasury | 20% | 200M | Multisig; ops, grants, liquidity later | Sustainability, audits, infra |
| Team | 15% | 150M | 6-month cliff, 24-month linear vest | Builders |
| Liquidity & Market Ops | 15% | 150M | Locked until mainnet listing readiness | DEX LP / market making |
| Community & Retro | 10% | 100M | Claim windows; play history + early adopters | Bootstrapping real players |
| Partnerships / Creators / Farcaster | 10% | 100M | Unlock on milestones; KOLs, frames, guilds | Growth |

**No public sale on day one.** Testnet phase is product-economy validation, not fundraising.

### 2.2 Season emission schedule (Play & Season Rewards)

Do **not** pay infinite $LUDO per match. That is the #1 reason game tokens die.

| Phase | Duration | Season cap | Notes |
| --- | --- | --- | --- |
| Sepolia Alpha | ~8–12 weeks | 2M $LUDO / season (test tokens) | Learn real sink/source ratios |
| Mainnet Season 1 | 3 months | 8–12M $LUDO | Based on Alpha metrics |
| Mainnet steady state | quarterly | Declining or flat by governance | Cap published on-chain + in game UI |

Within a season:

| Source | Share of season cap | Claim path |
| --- | --- | --- |
| Ranked / RXP ladder (Bronze → Arena Master) | 40% | End-of-season merkle claim |
| Weekly arena / tournament pots | 35% | Escrowed entry fees + top-up from distributor |
| Daily/weekly mission premium track | 15% | Weekly claim window, diminishing returns |
| Social / referral / creator bounties | 10% | Server-attested claims, hard per-wallet caps |

**Hard rule:** every season has a published cap. Gameplay can never mint outside the distributor.

---

## 3. Economic design — sources, sinks, loops

### 3.1 Chip economy (off-chain, keep the game fun)

Chips stay the default for:

- Free tables and AI practice
- Soft entry-fee lobbies (current wager UX)
- Basic cosmetics (current marketplace price band)
- Daily missions, poke rewards, login bonus
- Spectator prediction (low stakes)

**Keep** current invariants:

- `players.coins >= 0` check
- Column-level RLS lock (clients never write coins)
- Service-role only mutations + `coin_ledger` writes
- Match record path remains progression-only (no silent coin mint)

**Fix before $LUDO pressure hits soft economy:**

1. **Mission claim is not atomic today** (`is_claimed` then separate coin update). Move to one RPC `claim_mission` with row lock + ledger write.
2. **Spectator win payout** exists in archived SQL but baseline `settle_match_bets` only flips status. Decide: pay soft immediately via service RPC, or move high-stakes bets to $LUDO escrow only.
3. **Chip faucet caps:** daily mission total ≈ 450 chips today + poke spam risk. Introduce daily Chip income cap (e.g. 1,500) and soft inflation monitor.

### 3.2 Chip sources vs sinks (target)

| Sources (Chips) | Sinks (Chips) |
| --- | --- |
| Daily bonus / missions | Soft table rake (optional, 0–5%) |
| Win rewards on free tables (small) | Basic marketplace cosmetics |
| Referral welcome grant | Power-mode energy / boosts |
| Guest → wallet migration grant | Soft tournament entry |
| LUDO deposit → play Chips (1-way play credit) | Cosmetic upgrades, emotes, dice skins |
| | Season pass free track boosts (non-$LUDO) |

Target healthy ratio after Alpha: **~1.15–1.3 sinks per 1.0 source** among active players. If average Chip balance rises unbounded, raise sinks — do not secretly mint more.

### 3.3 $LUDO sources vs sinks (target)

| Sources ($LUDO) | Sinks ($LUDO) |
| --- | --- |
| End-of-season rank claim | Tournament entry (escrow) |
| Tournament winnings | Ranked high-stakes tables rake |
| Premium mission claims | Premium cosmetics / limited drops |
| Community retro claim | Marketplace fee (2.5–5%, partial burn) |
| Partner/creator grants | Season pass premium track |
| | Boost NFT mint / upgrade fees |
| | Chip conversion **into** play (optional, rate-controlled) |
| | Guild create / officer tools (later) |

**Critical sink philosophy:** $LUDO must be *wanted for status and competition*, not only dumpable for Chips. Cosmetics + competitive entry are the primary demand drivers. Soft conversion is a pressure valve, not the main sink.

### 3.4 Rake model (competitive)

| Table type | Currency | Rake | Split |
| --- | --- | --- | --- |
| Free / practice | Chips | 0% | — |
| Soft stake | Chips | 0–5% | Soft treasury + cosmetic shop restock |
| Ranked ($LUDO) | $LUDO | 5% | 50% burn, 30% season pot, 20% treasury |
| Tournament | $LUDO | 8% of prize pool | Published before entry |
| Spectator high-stakes | $LUDO | House edge via odds + 2% protocol fee | Fee → burn/treasury |

**Match settlement stays off-chain for gameplay speed**, but:

- Ranked $LUDO tables **lock stake in an onchain escrow** (or custodial vault with onchain proof) before the match starts.
- Settlement is server-authoritative using the existing signed match proof (`buildMatchRecordMessage`) + host/authority chain.
- After settlement, winners see **claimable $LUDO** (pull pattern), not auto-spend from a hot client.

For Sepolia Alpha Phase 1, custodial vault + signed claims is acceptable if every claim is logged to `ludo_ledger` and claim roots are published. Phase 2 moves to onchain escrow contracts.

### 3.5 Soft ↔ hard bridge

| Direction | Rule |
| --- | --- |
| Chips → $LUDO | **Not freely convertible.** Only via (a) seasonal “Treasury of the Board” conversion event with fixed rate & per-wallet cap, or (b) marketplace rewards that convert excess chips at a published rate. Prevents soft farming → hard dump. |
| $LUDO → Chips | Allowed as **play credit** at a worse rate (e.g. 1 LUDO → 400 Chips Alpha). Cannot withdraw Chips. Gives new $LUDO holders a way to play free tables without inventing free tokens. |
| Deposit | Users deposit $LUDO to vault → receive locked “Arena Balance” used for ranked entry; withdraw takes cooldown (24h) + optional fee. |
| Withdraw | Claimable earned $LUDO can withdraw after **7-day vest per claim batch** (anti-sybil, anti-dump). Sepolia can shorten to 24h for testing. |

Example Alpha rates (tune after data):

| Rate | Value |
| --- | --- |
| End-of-season Bronze | ~50 $LUDO |
| Silver | ~150 |
| Gold | ~400 |
| Platinum | ~900 |
| Diamond | ~2,000 |
| Arena Master | ~5,000 + exclusive cosmetic claim |
| Mission premium weekly (active player) | 2–8 $LUDO |
| LUDO → Chip play credit | 1 LUDO = 400 Chips |
| Chip conversion event | 10,000 Chips → 1 $LUDO, max 50/week/wallet |

---

## 4. Gamification plan (make $LUDO feel earned, not farmed)

Existing progression already works — **keep it as the skill spine**:

- **LXP** → level (quadratic: `level = floor(sqrt(lxp/100))+1`)
- **RXP** → rank tiers Bronze → Silver → Gold → Platinum → Diamond → Arena Master
- Seasons by calendar quarter (`season_id`)
- Missions: play / win / streak / social / predict
- Live arena spectating + prediction
- Marketplace cosmetics + themes/dice/tokens equip

### 4.1 Layered reward architecture

```text
Layer 0 — Practice / Free     → Chips only
Layer 1 — Soft competitive    → Chips + LXP + RXP
Layer 2 — Ranked onchain      → $LUDO stake + RXP + season weight
Layer 3 — Tournaments         → $LUDO prize pools + titles
Layer 4 — Spectator Arena     → Chips (low) / $LUDO (high) predictions
Layer 5 — Season settlement   → RXP-weighted $LUDO + cosmetic airdrops
```

### 4.2 Daily & weekly loop (player-facing)

| Cadence | Objectives | Rewards |
| --- | --- | --- |
| Daily free | Play 3, Win 1, Capture 2, Poke back, Daily login | Chips (keep current structure) |
| Daily premium | Same + play 1 ranked $LUDO match | Small $LUDO (capped weekly) |
| Weekly | Win 5 ranked; 3 prediction wins; 1 tournament entry | $LUDO pack + season weight bonus |
| Season | Climb RXP; play ≥ N ranked games; complete weekly tracks | End-of-season claim + exclusive cosmetics |

**Anti-farm rules (must ship with premium rewards):**

1. Ranked $LUDO rewards require wallet age ≥ 1 day + at least 1 deposit or 10 free Chip games.
2. Max premium $LUDO claim per wallet per week (hard code-level cap).
3. Self-match / duplicate-device heuristics: same IP + invite-only high-stakes may reduce reward weight.
4. Match-fixing detection: abnormal forfeit rates → season claim slashed or paused.
5. Guests can view missions; **claims stay wallet-walled** (already the GuestWall direction in ArenaPanel).

### 4.3 Ranked “Arena Seasons”

| Feature | Design |
| --- | --- |
| Season length | 3 months (align with existing `season_id` quarter logic) |
| Ladder | RXP reset soft or hard — recommend **soft reset** (carry 30% RXP) to avoid rage-quit |
| Entry | Ranked queue requires Arena Balance ≥ table min in $LUDO |
| Match types | Classic / Power / Snakes — Power can have higher rake + higher RXP |
| Titles | Season exclusive titles + profile frames (off-chain metadata, optional onchain badge later) |
| Leaderboard | Public top 100 with wallet short address + Farcaster name |

### 4.4 Tournaments (schema already exists)

Use existing `tournaments` / `tournament_participants` / `tournament_matches`.

| Tournament type | Entry | Prize | Notes |
| --- | --- | --- | --- |
| Free Chip cup | Chips | Chips + LXP | Daily/weekly cadence, AI fill |
| $LUDO Open | 5–50 LUDO | 92% of pool after 8% fee | Public brackets |
| Invitational | Invite / rank gate | Fixed LUDO from SeasonDistributor | Streamed on Arena live tab |
| Creator cup | Partner-funded | Mixed | Farcaster growth |

Payout path: tournament contract or custodial escrow → signed result sheet (host + optional second authority) → players claim.

### 4.5 Spectator / GambleFi planning

Already designed: ADR-001 host-controlled betting window, 3s lock, `window_closed_at` validation.

| Tier | Currency | Odds | Payout |
| --- | --- | --- | --- |
| Casual predict | Chips | Soft odds UI | Soft credit |
| Arena predict | $LUDO | Onchain or vault escrow | Claim after resolve proof |
| Cash-out | Same currency | 50% of potential while window open | Keep existing cash-out shape |

**Compliance note:** $LUDO prediction is real-value wagering. On Sepolia this is test economics. Before Base mainnet, legal review + geo gates + age gates + ToS rewrite (current ToS still says virtual Coins). Do not market as investment.

### 4.6 Marketplace as primary sink

Current catalog structure (themes / dices / tokens / items) is correct. Expand into two tracks:

| Track | Currency | Examples |
| --- | --- | --- |
| Soft style | Chips | Existing common/rare skins |
| Prestige | $LUDO | Animated tokens, board frames, win VFX, seasonal mythics |
| True collectible | ERC-1155 (later) | Limited drops, tradeable after season lock |

Purchase rules:

- Soft items stay instant off-chain ownership (current local persist + DB inventory).
- Prestige $LUDO items: burn or treasury-transfer on purchase; ownership recorded in DB; optional onchain mint when user “materializes” the collectible.
- Listing fee + 2.5% sale fee on any player-to-player market (partial burn).

### 4.7 Boost system (optional, Phase 2)

Power mode already has tactical state. Economy boosts must **not** buy wins.

Allowed:

- Cosmetic-only “aura”
- LXP boost +10% for 24h (does not affect RXP)
- Chip earn +10% on free tables (capped)

Forbidden:

- Dice odds modification
- Capture immunity
- Ranked RXP purchase

Boost cost: Chips or small $LUDO. Cap concurrent boosts.

### 4.8 Social / Farcaster loops

| Loop | Reward | Cap |
| --- | --- | --- |
| Poke back | Chips (existing) | Daily cap (UI already says max 20/day) |
| Referral | Soft grant + $LUDO after referee 5 ranked games | Max N referrals/week |
| Frame challenge | Invite frame → both play → Chips + season weight | — |
| Guild (later) | Shared board skin + guild war pots | Phase 3 |

### 4.9 What players see in UI

1. **Wallet header:** Chip balance + $LUDO balance (separate icons).
2. **Lobby:** Free / Soft / Ranked tabs; Ranked shows min stake + rake transparently.
3. **Arena missions:** Free track (Chips) + Premium track ($LUDO, locked if no wallet session).
4. **Season page:** Rank, RXP progress, projected end-of-season $LUDO, claim countdown.
5. **Marketplace:** Dual currency price tags; “need X more LUDO” same pattern as current chips shortage copy.
6. **Match end:** LXP/RXP gained; if ranked — stake settled + claimable $LUDO or loss receipt.

---

## 5. Technical architecture

### 5.1 Contracts (Base Sepolia)

| Contract | Responsibility |
| --- | --- |
| `LudoToken.sol` | ERC-20 + EIP-2612 + fixed cap + roles |
| `SeasonDistributor.sol` | Holds play-reward allocation; owner/ops pushes weekly roots or budget epochs; emits `EpochBudget` |
| `RewardClaim.sol` | Merkle claim for season/community rewards; stores root + epoch + token |
| `GameVault.sol` | Deposit/withdraw $LUDO for Arena Balance; pause; cooldown; emits deposit/withdraw events for DB indexer |
| `TournamentEscrow.sol` | (Phase 2) Accept entries, hold prize pool, release on signed results |
| `MarketplaceFeeSplitter.sol` | (Phase 2) Fee routing: burn + treasury |
| `LudoBadge.sol` (optional ERC-1155) | Season cosmetics / achievement badges |

**Sepolia Alpha Phase 1 can ship with:** `LudoToken` + `RewardClaim` + `GameVault` only. Tournament escrow can be custodial initially.

### 5.2 Off-chain authority (keep security model)

Do not regress AGENTS.md invariants:

1. Teams / engine math unchanged.
2. Networked rolls remain Edge `roll-dice` with receipts.
3. Networked moves remain Edge `move-auth` / match session.
4. `/api/match/record` stays signature-gated; signer must be participant; **no free-form payout**.
5. `resolve-bet` stays host-signed + `live_matches.host_address`.
6. RLS: clients never write `coins` / future `ludo_balance`.
7. DMs ECDH unchanged.

**New invariants:**

8. $LUDO earn events only from server/ops with audited job keys — never client-supplied amounts.
9. Every $LUDO mirror row in DB must reference a chain event id or a signed claim batch id.
10. Withdraw path requires SIWE app session + optional match-session is **not** sufficient (wallet tx signature only).
11. Ranked stake lock must fail-closed if vault indexer lag > threshold.
12. Season claim roots published publicly (IPFS/URL + onchain root) before claim UI opens.

### 5.3 Database additions (migration sketch)

New tables (canonical under `supabase/migrations/`):

```text
ludo_claims (
  id, wallet_address, epoch_id, source,
  amount numeric, vest_until timestamptz,
  claim_tx text null, status, merkle_index,
  created_at
)

ludo_ledger (
  id, wallet_address, amount numeric,
  balance_after numeric,
  reason, reference_type, reference_id,
  chain_event_id text null,
  idempotency_key unique,
  created_at
)

ludo_vault_positions (
  wallet_address pk,
  deposited numeric,
  withdrawn numeric,
  arena_balance numeric,
  updated_at
)

season_reward_epochs (
  epoch_id, season_id, cap, root, uri,
  starts_at, ends_at, status
)

onchain_events (
  id, chain_id, tx_hash, log_index,
  event_name, wallet_address,
  amount numeric, payload jsonb,
  ingested_at,
  unique(chain_id, tx_hash, log_index)
)
```

Extend existing:

- `players`: `ludo_claimable`, `ludo_withdrawable`, `ludo_vault`, `sybil_score`, `reward_tier`
- `tournaments`: `currency` (`chips`|`ludo`), `entry_amount`, `prize_pool_ludo`, `escrow_tx`
- `spectator_bets`: `currency`, `escrow_ref`
- `coin_ledger`: keep as Chip ledger only (do not overload)

### 5.4 Settlement flows

**A. Free / soft match**

```text
Host signs match record → /api/match/record
  → LXP/RXP/missions only
  → optional soft rake if wager>0 (service RPC + coin_ledger)
  → no $LUDO
```

**B. Ranked $LUDO match (custodial Alpha)**

```text
Join ranked → vault.debit(arena_balance, stake) + row lock
Match plays (existing engine + Edge auth)
Record signed result → settlement job
  winner: vault.credit(stake*2*(1-rake))  OR ludo_claimable += payout
  losers: stake transferred to pot pool
  rake split recorded in ludo_ledger
Client shows claim/receipt
```

**C. Season claim**

```text
Ops builds leaf: (wallet, rxp, amount, epoch)
Publish merkle root onchain RewardClaim.setRoot(epoch, root)
User opens Season UI → proof fetched
Wallet signs tx → RewardClaim.claim(epoch, amount, proof)
Indexer writes onchain_events + ludo_claims.status=claimed
```

**D. Spectator $LUDO predict (Phase 2)**

```text
Window open → escrow debit (vault or onchain)
3s lock (ADR-001) → roll reveal
Host-signed resolve-bet → settle
Winners: claimable credit after proof
```

### 5.5 Frontend / app integration

| Area | Change |
| --- | --- |
| `app/Providers.tsx` | Already has Base + Base Sepolia wagmi chains — keep; expose `NEXT_PUBLIC_LUDO_CHAIN` + token address env |
| Profile / header | Dual balance; claim button for withdrawable $LUDO |
| GameLobby | Tabs: Free / Soft / Ranked; Ranked stake uses vault balance |
| ArenaPanel | Premium mission track; season claim CTA |
| MarketplacePanel | Currency-aware price + purchase path (approve + call or custodial debit) |
| New panel | **Vault / Claim** — deposit, withdraw, claim epoch, tx history |
| Settings | Show chain, token address, explorer links |
| Terms / Privacy | Rewrite “virtual Coins” → Chips + $LUDO; add testnet disclaimers; mainnet legal TBD |

### 5.6 Indexer job

Small Node/Deno job (or Next cron):

1. Watch `GameVault` Deposit/Withdraw + `RewardClaim` Claimed.
2. Upsert `onchain_events` idempotently by `(chain_id, tx_hash, log_index)`.
3. Update player vault mirrors.
4. Alert on vault DB ≠ chain sum mismatch.

---

## 6. Security & anti-abuse

| Risk | Mitigation |
| --- | --- |
| Client-forged earn | All $LUDO amounts server/contract derived; never accept client amount |
| Mission double-claim | Atomic RPC + unique `idempotency_key` in `ludo_ledger` |
| Sybil multi-account | Ranked rewards need wallet age + deposit/play gates; weekly caps; IP/device heuristics lower weight |
| Match-fixing | Existing authority + host proof; abnormal result review; season claim pause authority |
| Host collusion on bets | ADR-001 window + server reject early settle + host_address binding (already) |
| SQL/RLS regression | Keep coins/ludo columns default-deny; only service_role RPCs |
| Key compromise | Team vesting + treasury on multisig; minter role limited to distributor |
| Market manipulation | No free Chips→LUDO; conversion events capped |
| Compliance | Testnet first; geo/age gates before mainnet value; no yield/burn-and-earn language |
| Bridge lag / stuck stake | Vault withdrawal cooldown + ops pause + manual dispute table |

---

## 7. Phased roadmap

### Phase 0 — Spec freeze (this doc)
- Agree dual-currency decision
- Publish numbers (supply, caps, rake, rates)
- Legal: testnet disclaimer + age gate language

### Phase 1 — Base Sepolia Alpha (hard token skeleton)
- Deploy `LudoToken` + `RewardClaim` + `GameVault` on Base Sepolia
- Env + explorer links in Settings
- DB: `ludo_*` tables + atomic mission claim RPC fix
- Dual-balance UI (display-only onchain until claims work)
- Weekly season epoch for **test** rewards (merkle claims)
- Keep ranked mostly Chips if vault not ready; optional small $LUDO ranked

**Exit criteria:** a player can earn $LUDO from a published season claim, see it in wallet, deposit to vault, enter a $LUDO table, and withdraw after cooldown.

### Phase 2 — Competitive $LUDO
- Ranked $LUDO queue + settlement job
- Tournaments with $LUDO entry + prize claims
- Spectator $LUDO predict tier
- Marketplace prestige track with $LUDO prices + burn/treasury split
- Sybil scoring + reward weight

**Exit criteria:** real rake/sink data across 2+ weeks; average session still fun in free mode.

### Phase 3 — Farcaster / growth
- Frame challenge rewards
- Creator cup templates
- Referral $LUDO after quality thresholds
- OG/badge collectibles (ERC-1155 optional)

### Phase 4 — Base mainnet prep
- Security review of token + vault + claim
- Multisig + timelock
- Legal review (wagering, marketing claims, geos)
- Migration plan: Sepolia balances are **not** mainnet balances; provide fair conversion rules for Alpha testers (optional commemorative badge + small mainnet grant)
- Redeploy contracts on Base `8453`
- Liquidity strategy still unlocked until product metrics justify it

---

## 8. KPIs to watch (economy health)

| Metric | Healthy signal | Alarm |
| --- | --- | --- |
| Free-player D7 retention | Stable or up after token launch | Free mode feels pointless |
| Chip inflation | Supply growth &lt; sink growth | Everyone rich, marketplace ignored |
| $LUDO claim → 7d hold | &gt; 50% still held/used in-game | Instant dump every claim |
| Ranked participation | Rising absolute players | Only bots/farmers |
| Rake coverage vs emissions | Sinks ≥ 40% of seasonal emissions by S2 | Emissions with no demand |
| Withdraw vs deposit ratio | Deposits ≥ withdrawals in ranked cohorts | Exit-only economy |
| Mission abuse rate | Low multi-account claim share | Spike after reward raise |
| Avg match free vs ranked | Ranked minority but growing | All value dump, no free fun |
| Marketplace $LUDO volume | Organic weekly volume | Zero after first hype |

---

## 9. Immediate engineering checklist (when implementation starts)

1. [ ] Freeze token params in `docs/tokenomics/` (this doc + `TOKEN_PARAMS.md` addresses post-deploy)
2. [ ] Add Foundry/Hardhat project under `contracts/` (not yet present)
3. [ ] Deploy Sepolia token; commit addresses to env examples (never commit keys)
4. [ ] Migration: `ludo_*` tables + `claim_mission` atomic RPC + coin_ledger write for missions
5. [ ] Mirror balance API: `GET /api/ludo/balance` (session-gated)
6. [ ] Claim API + merkle epoch publisher job
7. [ ] Vault deposit/withdraw UI + indexer
8. [ ] Lobby Ranked tab + stake lock flow
9. [ ] Update Terms/Privacy/Settings chain copy
10. [ ] Smoke tests for claim idempotency, RLS denial on `ludo_*`, vault cooldown

---

## 10. Explicit non-goals (for now)

- No free mint from client
- No per-match unlimited $LUDO faucet
- No yield farming / staking APR as a product feature
- No trading of free Chips for $LUDO outside capped events
- No onchain dice (game remains off-chain + signed proofs)
- No mainnet liquidity dump plan before retention metrics exist

---

## 11. Decision log (defaults chosen in this plan)

| Decision | Choice | Why |
| --- | --- | --- |
| Currency model | Dual: Chips + $LUDO | UX + scarcity + realistic game economy |
| Chain now | Base Sepolia | Already wired in wagmi/OnchainKit |
| Supply | 1B fixed | Enough for seasons without meme-coin confusion |
| Match settlement | Off-chain + signed proof; $LUDO stake in vault/escrow | Speed + existing trust model |
| Soft→hard convert | Capped events only | Stops farm dumps |
| Missions | Chips always; $LUDO premium capped | Keeps casual loop healthy |
| Token upgradeability | Non-upgradeable token | Trust |
| Emission | Season caps via distributor | Sustainability |

---

## 12. Open questions for product (non-blocking defaults already chosen)

1. Display name for soft currency in UI: **Chips** vs keep the word **Coins**? (Plan uses Chips for clarity.)
2. Should Alpha season rewards be claimable to a connected wallet immediately (more fun) or vest 7d (more realistic)? **Default: 24h on Sepolia, 7d on mainnet.**
3. Power mode ranked: higher rake and higher RXP, or separate $LUDO table? **Default: higher rake, same queue flag.**
4. Do we want an onchain badge for Season 1 participants even before mainnet? **Default: yes, commemorative Sepolia badge (cheap, good for Farcaster).**

---

*This plan is intentionally implementation-aware: it reuses `coin_ledger`, match proof signing, host-resolved bets, season RXP tiers, mission systems, tournament tables, and the existing Base Sepolia wallet stack. Next step after approval is contract scaffolding + Phase 1 migrations — not a token launch announcement.*
