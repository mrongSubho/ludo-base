# TOKEN_PARAMS.md — CHIPS Phase-0 freeze record

**Companion to:** `docs/tokenomics/CHIPS_PLANNING.md` (v4.3)  
**Status:** Phase-0 freeze record · pre-deploy template  
**Last updated:** 2026-09-22  
**Rule:** Anything marked **LOCKED** is not adjusted after this file is accepted. Anything marked **OPEN — external** must be completed before Phase-1 contracts that depend on it ship to Sepolia value-bearing paths.

---

## 1. Token identity (LOCKED)

| Param | Value |
| --- | --- |
| Name | `Chips` |
| Symbol | `CHIPS` |
| Standard | B20 Asset (`B20Variant.ASSET`) |
| Decimals | 18 |
| Max supply / cap | 10,000,000,000 × 1e18 = `1e28` |
| Initial liquid | 2,000,000,000 CHIPS |
| Locked in `SupplyLocker` | 8,000,000,000 CHIPS |
| `MINT_ROLE` after bootstrap | **∅** (full pre-mint; no further mint) |
| `SEIZE_ROLE` / `BURN_BLOCKED_ROLE` | Never granted |
| Multiplier | Pinned 1× (raw balances only) |
| EIP-712 token domain version | `1` (B20 fixed) |

### Factory / salt (fill at deploy)

| Env | chainId | salt preimage | salt (computed) | Token address |
| --- | --- | --- | --- | --- |
| Base Sepolia | `84532` | `keccak256("ludo-base-chips-v1", chainId)` | _TBD at deploy_ | _TBD (`0xB200…`)_ |
| Base Mainnet | `8453` | `keccak256("ludo-base-chips-v1", chainId)` | _TBD at deploy_ | _TBD (`0xB200…`)_ |

**Assert after createB20:** `isB20(token)`, `decimals() == 18`, `name() == "Chips"`, `symbol() == "CHIPS"`, `totalSupply() == 1e28`, `supplyCap() == 1e28`, `MINT_ROLE holders == ∅`, `SEIZE`/`BURN_BLOCKED` holders == ∅, `multiplier() == 1e18` (1× WAD).

**Activation gate:** `isActivated(ASSET)` on ActivationRegistry `0x8453…0001` must be true on the target chain before `createB20`. Record the boolean + block number here at deploy:

| Env | `isActivated(ASSET)` | Block | Date |
| --- | --- | --- | --- |
| Sepolia | _TBD_ | | |
| Mainnet | _TBD_ | | |

---

## 2. Allocation (LOCKED — CHIPS_PLANNING section 2)

| Bucket | Total | Initial liquid | Locked | Custody |
| --- | --- | --- | --- | --- |
| Playing Rewards | 3.0B | 600M | 2.4B | `SeasonDistributor` (coded) |
| Treasury | 2.0B | 500M | 1.5B | Treasury multisig + timelock |
| Team | 2.0B | 400M → vesting | 1.6B | OZ VestingWallet (12mo cliff + 36mo linear) |
| Liquidity | 2.0B | 300M seed | 1.7B | Locked vault / LP program |
| Partners | 1.0B | 200M | 0.8B | Partner distributor (milestone oracle) |

**Unlock envelopes (LOCKED):** quarterly 500M max as monthly drips (~166.7M × 3); hard gates = time (≥90d) + utilization (≥75% of previously unlocked play+partner claimed); sink ratio from on-chain `cumulativeBurned`/`cumulativeDrawn` decelerates (skip/half); no compounding missed windows.

**Stall-path (LOCKED):** **automatic S2-draw reduction** if 1–2 envelopes fail gates.  
Treasury bridge (≤100M) is **not** elected. If ever used, a **superseding decision** must be recorded below and repayment books to the **Treasury bucket** only (never play rewards).

| Superseding bridge election | Date | Approver | Notes |
| --- | --- | --- | --- |
| _(none — S2-draw reduction is active)_ | | | |

---

## 3. Play economy numbers (LOCKED)

### 3.1 Season draws (from 3B lifetime play budget)

| Season | Draw | Notes |
| --- | --- | --- |
| S1 | 400M | Acquisition |
| S2 | 320M | Ranked pools hard |
| S3 | 280M | Tournament top-ups |
| S4 | 240M | |
| S5 | 200M | |
| S6 | 160M | |
| S7 | 120M | |
| S8+ | 100M → floor 60M | Remaining amortized |

**S1 decision (LOCKED for Phase 0):** draw **400M**, with **100M Sybil reserve** inside the 600M initial play liquid (worst-case ≤500M). Sybil-profitability model at 22k / 100k-wallet scale remains a **pre-S1-lock exit criterion** (must be published before S1 budget is considered final for mainnet; Sepolia Alpha may run with this provisional 400M).

| Sybil model artifact | Status |
| --- | --- |
| 22k-wallet full-S1 drain case | **DRAFT** — `docs/tokenomics/C0_FREEZE_PACK.md` §1 (publish spreadsheet before S1 lock) |
| 100k-wallet case | **DRAFT** — same |
| Break-even: wallet-create + gas + 7% wash take | **DRAFT** — same |

### 3.2 Welcome grant (LOCKED)

| Param | Value |
| --- | --- |
| Ship | **Yes** |
| Amount | **50 CHIPS** |
| Trigger | Wallet linked + **first completed free online match** |
| Cadence | Once per wallet, lifetime |
| Budget | Playing Rewards (S1 onboarding sub-ledger) |
| Scorer | Yes (rewards surface — MissionClaim/voucher path) |
| Offline/AI only | Does **not** count |

### 3.3 Paid-volume floor (LOCKED)

Daily/weekly mission CHIPS require **≥1 paid on-chain join per week** (`joinPool` event). Free-only = RXP only.

### 3.4 Marketplace CHIPS price band (LOCKED as Phase-2 draft)

| Class | CHIPS |
| --- | --- |
| Common | 50–200 |
| Rare | 500–2,000 |
| Legendary / prestige | 5,000–50,000 |
| Boosts | 100–1,000 |
| Vanity | 200–5,000 |

Tuning allowed only downward-pressure / catalog expansion before Phase-2 launch; publish final catalog before market opens.

### 3.5 Fee tiers (LOCKED caps; chain-scoped allowlist)

| Tier | Entry | Protocol | Burn | Chains |
| --- | --- | --- | --- | --- |
| Casual calibration | 100 | 4% | 1% | **Sepolia only** (omitted from mainnet `createPool` allowlist) |
| Standard | 1,000 | 5% | 2% | Sepolia + Mainnet |
| High roller | 10,000 | 5% | 2% | Sepolia + Mainnet |
| Tournament | published | 5% | 2% | per bracket |

Hard caps at `createPool`: `protocolBps ≤ 500`, `burnBps ≤ 200`.  
Marketplace: 5% protocol + 1% burn.  
`refundGrace` = **180s**. Host bond (Standard+): `max(2% prizeFund, 1% × entryFee × maxSeats)`.

### 3.6 Dispute windows (LOCKED)

| Tier | `disputeWindow` |
| --- | --- |
| Casual | 2 min |
| Standard | 5 min |
| High / Tournament | 10 min |

---

## 4. Authority / keys (fill at deploy — schema LOCKED)

| Role | Address / id | Notes |
| --- | --- | --- |
| B20 initial admin (pre-renounce) | _TBD multisig_ | |
| ProxyAdminMultisig (UUPS) | _TBD_ | 7d upgrade timelock; no EOA |
| SecurityMultisig | _TBD_ | pause/unpause; `attestUnresolvable` last resort |
| Treasury multisig | _TBD_ | fees, grants, liquidity proposal |
| OpsMultisig | _TBD_ | METADATA |
| SeasonDistributor | _TBD contract_ | no EOA top-up; only locker release |
| SupplyLocker | _TBD contract_ | |
| MatchPool / ClaimHub / MissionClaim / SeasonClaim / Marketplace / TreasuryRouter | _TBD_ | UUPS impls + proxies |
| VestingWallet (team) | _TBD_ | 12/36 |
| Edge settlement co-signer | _TBD threshold/HSM_ | Mode A/B, lobby tickets, abandon |
| Voucher op-key registry | _TBD_ | |
| Claim scorer | _TBD_ | rewards-only; mainnet = threshold/HSM |
| Partner milestone oracle | _TBD_ | |
| Builder Code (ERC-8021) | _TBD from base.dev_ | do not re-register if `lib/builderCode.ts` exists |
| Merkle root setter | _TBD multisig_ | 48h + 48h leaf window |

### Deploy fill-in (after `contracts/script/DeployGame.s.sol`)

| Contract | Address | Tx | Date |
| --- | --- | --- | --- |
| MatchPool | | | |
| ClaimHub | | | |
| MissionClaim | | | |
| CHIPS (B20) | | | |

App env: `NEXT_PUBLIC_CHIPS_ADDRESS`, `NEXT_PUBLIC_MATCH_POOL_ADDRESS` (see `lib/chips.ts`).

**Upgrade matrix:** see CHIPS_PLANNING section 8.1c (UUPS + 7d; B20 immutable).  
**Post-audit upgrade-renounce decision:** _TBD Phase 4_.

---

## 5. Phase-0 freeze gates (11)

| # | Gate | Status |
| --- | --- | --- |
| 1 | Pre-freeze legal issue-spot + geo/product acceptance criteria | **DRAFT brief** — `docs/tokenomics/C0_FREEZE_PACK.md` §2 (counsel sign-off still OPEN — external) |
| 2 | Sybil-profitability model (22k/100k) + S1 decision | **PARTIAL** — S1 = 400M provisional LOCKED; model **OPEN — analytics** before S1 final lock |
| 3 | Stall-path election | **LOCKED** — automatic S2-draw reduction |
| 4 | Liquidity unlock: numeric KPIs + owner + date | **PARTIAL** — KPIs from CHIPS_PLANNING section 11; **owner/date OPEN — product** |
| 5 | `isActivated(ASSET)` recorded | **OPEN — deploy-time** (table in section 1) |
| 6 | Mint end-state `MINT_ROLE == ∅` | **LOCKED** (plan + asserts) |
| 7 | Pause / settleBy policy | **LOCKED** — auto-extend `pauseDelta`; BURN pause reverts settle wholesale |
| 8 | Scorer rewards-only | **LOCKED** |
| 9 | Predict Phase-2 entry criteria | **LOCKED** — deferred; join-policy + sportsbook sign-off first |
| 10 | Marketplace CHIPS price draft | **LOCKED** (draft band section 3.4) |
| 11 | Welcome grant | **LOCKED** — ship **50 CHIPS** |

### Liquidity unlock thresholds (numeric — LOCKED proposal; owner/date OPEN)

| Threshold | Target |
| --- | --- |
| D7 retention (cohort) | ≥ 25% |
| Paid pool fill rate | ≥ 40% of opened pools lock within 24h |
| Weekly paid volume | ≥ 10,000 paid joins (mainnet period) |
| Avg open-pool CHIPS | no dead capital > 48h unfilled on > 30% of open pools |
| Delay after mainnet launch | ≥ 90 days before first liquidity unlock |

| Field | Value |
| --- | --- |
| Liquidity unlock owner | **OPEN — product** (name a person/role) |
| Earliest unlock date | **OPEN — product** (not earlier than mainnet + 90d) |

---

## 6. Legacy conversion (LOCKED)

| Param | Value |
| --- | --- |
| Rate | 100 legacy coins = 1 CHIPS |
| Pool cap | 50M CHIPS from **Treasury** |
| Window | 90 days from Phase-1 launch |
| Snapshot | Merkle root of `players.coins` frozen after **7-day public challenge** |
| Unclaimed | Reverts to Treasury |
| Writers frozen | `purchase_marketplace`, `cash_out_bet`, `settle_match_bets` coin path, tournament coin deduct |

---

## 7. Onboarding budget (LOCKED ceilings)

| Line | Cap |
| --- | --- |
| Core package | 1,000 CHIPS/user · 50k-user = **50M** FCFS |
| Extended tracks + referral | **~10M** → **60M S1 onboarding sub-ceiling** |
| Welcome grant | 50 CHIPS × users (inside core/onboarding accounting; not additive surprise mint) |
| Galxe Track E | 4 × 75 = 300 (soulbound OATs only for identity claims) |

---

## 8. Network / ops constants (LOCKED)

| Param | Value |
| --- | --- |
| Phase-1 chain | Base Sepolia `84532` |
| Mainnet later | Base `8453` |
| Factory precompile | `0xB20f000000000000000000000000000000000000` |
| ActivationRegistry | `0x8453000000000000000000000000000000000001` |
| PolicyRegistry | `0x8453000000000000000000000000000000000002` |
| Confirmations (value-bearing) | 12 blocks (≈24s) Base |
| Indexer poll | ~100ms receipt/block watches |
| Edge co-sign SLO | <15s target, alert >60s |
| Mode B window | After effective `settleBy` until `settleBy + pauseDelta + refundGrace + modeBWindow` (modeBWindow **24h** default) |
| Edge-down SLA → `attestUnresolvable` | 30 min past effective settleBy |
| Reorg / ε-breach | Freeze voucher issuance + new pool creates; claims/refunds stay up |
| RPC | Dedicated/self-hosted, backend-proxied — never public in prod |

---

## 9. Acceptance criteria snapshot (from plan)

Phase-1 exit = pool fund → dual-sign or Mode B settle → claim after dispute window → burn memo on explorer → attribution on base.dev → `MINT_ROLE == ∅` asserted. Foundry suite includes double-claim, Mode B + bond slash, Edge-only abandon (no burn), M9 cancelled refunds, pauseDelta, scorer-free claims, B20+8021 suffix assertion.

---

## 10. Sign-off

| Item | Who | Date |
| --- | --- | --- |
| Product freeze (this file + CHIPS_PLANNING v4.3) | _OPEN_ | |
| Legal issue-spot acceptance criteria | _OPEN_ | |
| Sybil model published | _OPEN_ | |
| Liquidity owner + earliest date | _OPEN_ | |
| Eng go-ahead to scaffold `contracts/` | _OPEN_ | |

**When section 10 product + eng rows are signed**, Phase 1 build (base-forge project, MatchPool/ClaimHub/MissionClaim, TOKEN addresses fill-in) may start. Legal gate blocks **mainnet value** and predict; Sepolia scaffold may proceed in parallel with legal open.
