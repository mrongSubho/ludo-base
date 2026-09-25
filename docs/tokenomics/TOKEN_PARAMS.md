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
| Base Sepolia | `84532` | `keccak256("ludo-base-chips-v1", chainId)` | _TBD at deploy_ | **`0xB200000000000000000000821408122b9Ed3d05B`** (created 2026-09-24) |
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

Sepolia values below are live on `84532` (B20 stack, 2026-09-25). Mainnet targets stay _TBD_ until multisigs/contracts exist.

| Role | Address / id | Notes |
| --- | --- | --- |
| B20 initial admin (pre-renounce) | Sepolia: `0xbcCa5DcBF293D98A627fD3814D5AE8249bB1DFaF` (deployer EOA) · mainnet: _TBD multisig_ | `DEFAULT_ADMIN_ROLE` still held — needed until roles/timelocks final; do not renounce yet |
| ProxyAdminMultisig (UUPS) | _TBD_ | 7d upgrade timelock; no EOA. Sepolia B20 stack is non-proxy |
| SecurityMultisig | _TBD_ | pause/unpause; `attestUnresolvable` last resort |
| Treasury multisig | _TBD_ | fees, grants, liquidity proposal |
| OpsMultisig | _TBD_ | METADATA |
| SeasonDistributor | _TBD contract_ | no EOA top-up; only locker release |
| SupplyLocker | _TBD contract_ | |
| MatchPool | Sepolia: `0x879E7D5676332964C6aB95d6F357a9C185dbB6B3` | B20-bound; Marketplace / TreasuryRouter _TBD_ |
| ClaimHub | Sepolia: `0x1430E2D4dFAe938098400456e1DE6d3d84934850` | B20-bound |
| MissionClaim | Sepolia: `0x01abff6c58a25b80bfd68cb563b54c1155aa1def` | B20-bound |
| SeasonClaim | Sepolia: `0x83ae874e85c94920540f43fc6706ee485be44cbe` | B20-bound |
| LegacyClaim | Sepolia: `0x140b790ea880ca7da31f88db75058964699e7ebd` | B20-bound |
| VestingWallet (team) | _TBD_ | 12/36 |
| Edge settlement co-signer | Sepolia: `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` (smoke key) · mainnet: _TBD threshold/HSM_ | Mode A/B, lobby tickets, abandon; replace before mainnet |
| Voucher op-key registry | Sepolia: MissionClaim `opKey` = deployer EOA (rotate `SetOpKey.s.sol`); mainnet registry + HSM **OPEN** | |
| Claim scorer | _TBD_ | rewards-only; mainnet = threshold/HSM |
| Partner milestone oracle | _TBD_ | |
| Builder Code (ERC-8021) | _TBD from base.dev_ | do not re-register if `lib/builderCode.ts` exists |
| Merkle root setter | Sepolia: `0xbcCa5DcBF293D98A627fD3814D5AE8249bB1DFaF` (deployer EOA) · mainnet: _TBD multisig_ | 48h + 48h leaf window |

### Deploy fill-in (Base Sepolia `84532` — DeployStack 2026-09-22)

| Contract | Address | Tx | Date |
| --- | --- | --- | --- |
| Deployer / Owner | `0xbcCa5DcBF293D98A627fD3814D5AE8249bB1DFaF` | — | 2026-09-22 |
| MockChips (CHIPS stand-in) | `0xBBC2a1c0F1d8A20A21dD0C0D1C4c22142D118876` | `0x075e98033f0f17c54734ee979bba3e7df695cd7f8f67de9ae163a87eb8852178` | 2026-09-22 |
| MatchPool | `0xc9f0be5915B7Cd19Cc28cDb161A30539C2D156Ca` | `0x14432a5b5b5c7ae1cb51ae1347585d1174a86f754f66e8df3ff235aa61e98273` | 2026-09-22 |
| ClaimHub | `0xB839f7A75943921ca4BA94259F65AEc890bAc3dC` | `0x1df4d7ebdbfbb9edf20d2c2892fc84e2f3f387a620d4f88d141ad501e9afd06b` | 2026-09-22 |
| MissionClaim | `0xFaECEa156d26420Af6c28261a418a577Ec22343d` | `0xcc7a5f37e861861e2c981d07ec1e1d03ebf710b66d0c500f7267437519bfb9b0` | 2026-09-22 |
| SeasonClaim | `0xAF597e1A70cd2c0cD4C2745daf48ac44B83885F0` | `0x3c12f2167a699da12d67a89de5cc4cb981ba75af8c43510255d2c122091ad381` | 2026-09-22 |
| LegacyClaim | `0xCEd4f0D76527Aa6D2d2713186a1D0A924C70Eb83` | `0x2b24cae8661b97ec29d55123d8b3bb2a1ef979d00def4254322a5222bd283813` | 2026-09-22 |
| MatchPool.setClaimHub | wired | `0x8303cd0b66d24001087bf0c9ac751f85e42673bf252e7826e25d8c5734e708e5` | 2026-09-22 |
| CHIPS (B20 Asset) | **`0xB200000000000000000000821408122b9Ed3d05B`** | createB20 `0xb98a85ff…5596` · mint `0xa3e70d52…429e` · revoke MINT `0x6c334551…e32a` | 2026-09-24 |
| MatchPool (B20-bound) | **`0x879E7D5676332964C6aB95d6F357a9C185dbB6B3`** | DeployStack | 2026-09-25 |
| ClaimHub (B20-bound) | **`0x1430E2D4dFAe938098400456e1DE6d3d84934850`** | DeployStack | 2026-09-25 |
| MissionClaim (B20-bound) | **`0x01abff6c58a25b80bfd68cb563b54c1155aa1def`** | DeployStack | 2026-09-25 |
| SeasonClaim (B20-bound) | **`0x83ae874e85c94920540f43fc6706ee485be44cbe`** | DeployStack | 2026-09-25 |
| LegacyClaim (B20-bound) | **`0x140b790ea880ca7da31f88db75058964699e7ebd`** | DeployStack | 2026-09-25 |
| Deprecated MockChips stack | MatchPool `0xc9f0be59…` · ClaimHub `0xB839f7A7…` · Mission `0xFaECEa15…` · Legacy `0xCEd4f0D7…` · Season `0xAF597e1A…` | **do not use** | 2026-09-22 |

Explorer: https://sepolia.basescan.org/address/0xc9f0be5915B7Cd19Cc28cDb161A30539C2D156Ca

App env: `NEXT_PUBLIC_CHIPS_ADDRESS`, `NEXT_PUBLIC_MATCH_POOL_ADDRESS`, `NEXT_PUBLIC_MISSION_CLAIM_ADDRESS`, `NEXT_PUBLIC_LEGACY_CLAIM_ADDRESS` (see `lib/chips.ts`).

**Upgrade matrix:** see CHIPS_PLANNING section 8.1c (UUPS + 7d; B20 immutable).  
**Post-audit upgrade-renounce decision:** _TBD Phase 4_.

---

## 5. Phase-0 freeze gates (11)

| # | Gate | Status |
| --- | --- | --- |
| 1 | Pre-freeze legal issue-spot + geo/product acceptance criteria | **DRAFT brief** — `docs/tokenomics/C0_FREEZE_PACK.md` §2 (counsel sign-off still OPEN — external) |
| 2 | Sybil-profitability model (22k/100k) + S1 decision | **PARTIAL** — S1 = 400M provisional LOCKED; `docs/tokenomics/SYBIL_MODEL.md` **DRAFT 2026-09-25**; live Sepolia telemetry still OPEN before S1 final lock |
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

## Legacy snapshot (rebuilt 2026-09-25 for B20 LegacyClaim)
| Field | Value |
| --- | --- |
| Claim contract | `0x140b790ea880ca7da31f88db75058964699e7ebd` (B20 CHIPS) |
| Root | `0x44cb6fd4d75a1cafe92263523a9e814ebad6b15525170efd1e07e18dd584857b` |
| Entries | 5 (100:1, rate 100) |
| Published | 2026-09-25 (`public/legacy-snapshot.json`) |
| Challenge ends | **2026-10-02T05:03:46Z** (7d) |
| Then | `bash scripts/publish-legacy-root.sh --set-root` → 90-day claim window |
| Prior root | `0xede9cb6d…` was bound to deprecated MockChips LegacyClaim `0xCEd4f0D7` — **obsolete** |

Coin writers FROZEN (202609230003_freeze_legacy_coin_writers.sql).
Funding: **50M CHIPS transferred** to LegacyClaim (2026-09-25). Preflight green except challenge window (set-root after 2026-10-02).

## Sepolia role snapshot (B20 CHIPS, 2026-09-25)
| Role | Holder | Status |
| --- | --- | --- |
| `DEFAULT_ADMIN_ROLE` | `0xbcCa…1DFaF` (deployer) | **still held** — needed until roles/timelocks final; do not renounce yet |
| `MINT_ROLE` | ∅ | **revoked** after 10B pre-mint |
| `BURN_ROLE` | MatchPool `0x879E…` | granted 2026-09-25 (`0xe4908951…`) |
| `supplyCap` | 10B (1e28) | asserted |
| `multiplier` | 1× (1e18) | asserted |
| MissionClaim `opKey` | deployer EOA (placeholder) | rotate via `scripts` / `SetOpKey.s.sol` before prod |
| Edge `edgeSigner` | `0xf39F…2266` (smoke key) | replace with HSM/threshold before mainnet |

## Ops scripts (B20)
- `scripts/b20-smoke.sh` — setEdgeSigner + GrantBurnRole + SmokeRealChips
- `scripts/claim-sepolia.sh <poolId>` — ClaimHub.claimMatch
- `contracts/script/SetOpKey.s.sol` — MissionClaim op-key rotate
- `scripts/propose-season-root.sh` + `contracts/script/SetSeasonRoot.s.sol` — season propose/activate
- `scripts/buildSeasonLeaves.ts` — season leaves (wired to SeasonClaim `0x83ae…`)
- `scripts/build-legacy-snapshot.ts` + `scripts/publish-legacy-root.sh` — legacy root

## Phase-0 remaining
- See docs/tokenomics/PHASE0_OPEN_GATES.md (legal / Sybil / liquidity owner)

## B20
- base-std installed at contracts/lib/base-std — uncomment CreateChips.s.sol, then base-forge broadcast


### Legacy snapshot published (2026-09-24T21:45:23Z)
- URL path: public/legacy-snapshot.json (host on ludobase.xyz / IPFS)
- Root: 0xede9cb6deb53ce657f4b9e229845e79d193d7f4e9bb3655bc312c18720870d7b
- Challenge ends: 2026-10-01T21:45:23Z (7 days)
- setSnapshotRoot after challenge: bash scripts/publish-legacy-root.sh --set-root
### Legacy snapshot published 2026-09-24T21:45:23Z
- File: public/legacy/snapshot.json
- Root: 0xede9cb6deb53ce657f4b9e229845e79d193d7f4e9bb3655bc312c18720870d7b
- Challenge ends: 2026-10-01T21:45:23Z
- setSnapshotRoot after challenge: bash scripts/publish-legacy-root.sh --set-root

## CHIPS B20 live (Base Sepolia) — 2026-09-24
- Address: 0xB200000000000000000000821408122b9Ed3d05B
- Standard: B20 Asset (base-forge createB20)
- Script: contracts/script/CreateChips.s.sol via base-forge
- Next: mint 10B, allocate buckets, revoke MINT_ROLE (assert holders empty)
- App: NEXT_PUBLIC_CHIPS_ADDRESS set — replaces MockChips

## CHIPS B20 live (2026-09-24)
- Address: 0xB200000000000000000000821408122b9Ed3d05B
- Deploy: base-forge CreateChips.s.sol (B20 Asset)
- Env: NEXT_PUBLIC_CHIPS_ADDRESS + CHIPS_ADDRESS set
- Next: mint 10B + revoke MINT_ROLE + assert totalSupply=10B

## CHIPS B20 live (2026-09-24)
- Address: 0xB200000000000000000000821408122b9Ed3d05B
- createB20 tx: 0xb98a85ff5bbb250765cd74e019a6133791ff104ce07d7b56b12c1e3a4c445596 (block 47262990)
- Name/Symbol: Chips / CHIPS (base-cast verified)
- Env: NEXT_PUBLIC_CHIPS_ADDRESS set
- Next: BootstrapChips batchMint 10B + revoke MINT_ROLE

## CHIPS B20 live (2026-09-24)
- Address: 0xB200000000000000000000821408122b9Ed3d05B
- createB20 tx: 0xb98a85ff5bbb250765cd74e019a6133791ff104ce07d7b56b12c1e3a4c445596 (block 47262990)
- Name/Symbol verified: Chips / CHIPS
- BootstrapChips pending: batchMint 10B + revoke MINT_ROLE


## CHIPS B20 live (2026-09-24)
- Address: 0xB200000000000000000000821408122b9Ed3d05B
- createB20 tx: 0xb98a85ff5bbb250765cd74e019a6133791ff104ce07d7b56b12c1e3a4c445596
- Block 47262990 · base-sepolia
- Name/Symbol: Chips / CHIPS (base-cast verified)
- isB20Initialized: true
- Next: BootstrapChips batchMint 10B + revoke MINT_ROLE

## CHIPS B20 bootstrap (2026-09-24)
- batchMint 10B: 0xa3e70d525573399e9ee8252ddadaa193f2c3ec94fc233b0fc3ece7fa1a7c429e
- revokeRole MINT_ROLE: 0x6c334551ab5837347e5fea5a1a1e23feac64ff53a06d73cf94f51dced58ae32a
- Block 47265011 · MINT_ROLE deployer = false (simulated log)
- Verify totalSupply on chain and record balances

## CHIPS B20 VERIFIED on-chain (2026-09-24)
| Item | Value |
| --- | --- |
| Token | `0xB200000000000000000000821408122b9Ed3d05B` |
| createB20 | `0xb98a85ff…5596` block 47262990 |
| batchMint 10B | `0xa3e70d52…429e` block 47265011 |
| revokeRole(MINT_ROLE) | `0x6c334551…e32a` block 47265011 |
| totalSupply | **10,000,000,000 CHIPS** (verified base-cast) |
| MINT_ROLE (deployer) | **false** (revoked) |
| Balance note | Sepolia bootstrap sent all 10B to deployer (bucket wallets defaulted). Re-split before mainnet. |
| App env | `NEXT_PUBLIC_CHIPS_ADDRESS` = live B20 (not MockChips) |

## New MatchPool / ClaimHub on real B20 CHIPS (2026-09-25)
- MatchPool: 0x879E7D5676332964C6aB95d6F357a9C185dbB6B3
- ClaimHub: 0x1430E2D4dFAe938098400456e1DE6d3d84934850
- CHIPS (B20): 0xB200000000000000000000821408122b9Ed3d05B
- Use scripts/b20-smoke.sh for setEdgeSigner + SmokeRealChips


## B20 smoke progress (2026-09-25)
- New MatchPool (B20): 0x879E7D5676332964C6aB95d6F357a9C185dbB6B3
- New ClaimHub: 0x1430E2D4dFAe938098400456e1DE6d3d84934850
- **setEdgeSigner DONE** — `0xaabac504…4097` block 47270585; `edgeSigner()` = `0xf39Fd6e5…2266`
- SmokeRealChips **simulated only** (script reverted before broadcast). Simulated poolId `0xb48929e8…4f16` is **not on-chain** (`getPoolSummary` all zeros).
- Root cause: `settlePool` → `chips.burnWithMemo` requires **`BURN_ROLE`** on the B20 token. New MatchPool `0x879E…` does not hold it (`hasRole(BURN_ROLE, pool) == false`). Role hash `0xe97b1372…2fa22` = `keccak256("BURN_ROLE")`.
- Deployer still holds `DEFAULT_ADMIN_ROLE` → can `grantRole(BURN_ROLE, MatchPool)`.
- **setEdgeSigner re-run 2026-09-25** `0xf35e87ec…4b55` block 47270954 (harmless idempotent set). `edgeSigner` still `0xf39F…`.
- **GrantBurnRole FAILED** (nonce race with prior broadcast in same script): `nonce too low: next nonce 379, tx nonce 378`. Role still **not** granted. Script mode bug fixed: `--burn-only` now only grants.
- **GrantBurnRole DONE** — `0xe4908951…8a4a` block 47271261; `hasRole(BURN_ROLE, 0x879E…) == true`
- **SmokeRealChips DONE** — full create→join→lock→**settle** on real B20 (settle `0x5a4f3214…b2867` block 47271330). Burn leg succeeded (`burnWithMemo` in settle).
- **poolId (this match):** `0xde2da932d4997ae2c9c6aafdd28db4daa2f478601bba469ad0c557a03a96a3b4`
  - Not the contract address. `MATCH_POOL` / `POOL` `0x879E7D56…b6B3` is the **MatchPool contract** (fixed). Each smoke makes a new `poolId` (bytes32 match id).
- Pool summary after settle: status=3 (Settled), gross 2000e18, prizeFund 1860e18, claimUnlockAt=1790311248
- **CLAIM DONE 2026-09-25** — `0xd465320497f8d641aecae911411ad4bc555d4eae4e72fac82c63101dcabe083e` block 47271526
  - Winner `0x7099…` received **1860 CHIPS** from MatchPool on token `0xB200…`
  - Post-claim p2 balance **10860 CHIPS**; pool drained to **0**
  - `totalSupply` **9,999,999,960 CHIPS** (= 10B − **40 CHIPS** burned in settle `burnWithMemo`)
- **Real B20 E2E complete:** create → join×2 → lock(bond) → settle(+burn) → claim on MatchPool `0x879E…` / ClaimHub `0x1430…` / CHIPS `0xB200…`
