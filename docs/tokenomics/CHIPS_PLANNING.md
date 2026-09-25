# Chips (CHIPS) — Full Token Economy Plan

**Project:** Ludo Base  
**Token:** Chips · Symbol `CHIPS`  
**Standard:** **B20 Asset** (Base native protocol-level token standard)  
**Network (now):** Base Sepolia (`84532`)  
**Network (later):** Base Mainnet (`8453`)  
**Supply:** **10,000,000,000** fixed (10B)  
**Document type:** Product tokenomics + gamification + settlement architecture  
**Execution sequencing:** `docs/planning/RECOMMENDED_IMPLEMENTATION_PLAN.md` — **engine/gaps first (stable build)**, then CHIPS value track. Voice / i18n / ads are parked until after that gate. During the stable-build push, CHIPS work is freeze-pack + optional M11 spike only (no MatchPool/ClaimHub/value UI).  
**Status:** Planning baseline (v4.3 — Strix audit applied: Edge-fallback settle, abandon dual-sign, on-chain sink counters, upgrade matrix, lobby-ticket authority, M1–M11 + hygiene)  
**Last updated:** 2026-09-22

---

## 0. Executive decisions (locked)

| # | Decision | Detail |
| --- | --- | --- |
| 1 | **Single currency** | One asset only: **CHIPS**. No soft/hard dual token. |
| 2 | **On-chain by default** | Online multiplayer, marketplace, mission claims, tournaments, spectator pots — all CHIPS on Base. |
| 3 | **Offline exception** | Only **Offline / AI matches** stay off-chain (no stake, no CHIPS transfer). |
| 4 | **Token standard** | **B20 Asset** via Base factory precompile — not a custom ERC-20 clone. |
| 5 | **Name / symbol** | Name: **Chips** · Symbol: **CHIPS** |
| 6 | **Supply** | **10B max cap**, supply cap enforced at B20 creation (+ section 8.1b end-state). **2B initial liquid**, 8B in `SupplyLocker` under gated quarterly unlocks (section 2.2). |
| 7 | **Allocation** | Play rewards 30% · Treasury 20% · Team 20% · Liquidity 20% · Partners 10% |
| 8 | **Claims** | **100% pull-based.** Nothing auto-transfers to a player wallet from game clients. |
| 9 | **Paid matches** | Entry fee is approved + pulled into a **visible on-chain Match Pool**. Winners **claim individually** from that pool (immediately after settle, or later from their claim hub). |

Supabase is **no longer the balance authority**. It becomes:

- match/session authority (rules, dice, move auth — unchanged trust model)
- **indexer / cache** of on-chain balances and pool state for fast UI
- publisher of signed settlement payloads that the **contracts** accept

---

## 1. Why B20 (and why Chips on it)

B20 is Base’s native ERC-20-compatible token standard, implemented as chain precompiles (not a Solidity ERC-20 you deploy yourself). It gives Ludo Base production controls that matter for a real game economy:

| B20 capability | How Chips uses it |
| --- | --- |
| ERC-20 parity | Wallets, explorers, OnchainKit, swaps treat CHIPS like any ERC-20 |
| **Supply cap** | Hard 10B ceiling via `updateSupplyCap` in factory `initCalls`. The cap is admin-mutable on B20 (raise or lower freely, floor = current `totalSupply`) — so "fixed" is delivered by the explicit end-state in section 8.1b: distribute → lock role-admins → `renounceLastAdmin()` → assert `supplyCap == 10B` immutable. Cap value (10B×1e18 = 1e28) fits well under the `uint128.max` ceiling; deploy script asserts the on-chain value rather than citing a sentinel. **Max is 10B; initial liquid supply is 2B** — the remaining 8B sits pre-minted in the `SupplyLocker` under gated tranche releases (section 2.2). |
| **Roles (least privilege, end-state in section 8.1b)** | **`MINT_ROLE` holders = ∅ after bootstrap** — full 10B is pre-minted in the create/bootstrap run; `SeasonDistributor` only **draws/transfers** unlocked budget (never mints). `initCalls` may briefly grant `MINT_ROLE` to the distributor for a single bootstrap mint if the factory path requires it, but the same runbook **revokes it** before Phase 1 exit (section 8.1 assert). `BURN_ROLE` on `MatchPool` + `Marketplace` only (TreasuryRouter receives protocol fees, it does not burn); `PAUSE_ROLE`/`UNPAUSE_ROLE` split on SecurityMultisig; `METADATA_ROLE` on OpsMultisig + timelock; `OPERATOR_ROLE` on SecurityMultisig + timelock for announcements ONLY with the UI multiplier permanently pinned at 1× (no scheduled/instant updates ever; all contracts and the indexer use raw balances exclusively). **Never granted:** `SEIZE_ROLE`, `BURN_BLOCKED_ROLE` (deprecated third-party-burn path — banning `SEIZE` alone is insufficient). Every admin-gated call routes through named timelocks (section 8.10) until an explicit `renounceLastAdmin()` decision, which freezes policy updates too — so geo/eligibility policy must be designed *before* any renounce. |
| **ERC-2612 permit (EOA-only)** | B20 `permit` recovers EOA signatures only — it does **not** work for smart/AA wallets (our default is `smartWalletOnly`). Permit is the EOA fast-path only. The primary join path is EIP-5792 batched `approve + joinPool` via `useSendCalls` (see section 4.6). |
| **Memos (`burnWithMemo`, `transferWithMemo`, …)** | Memo field is `bytes32` (e.g. `keccak256("match:burn")`), emitted as a `Memo` event joined to its parent via `(txHash, logIndex - 1)`. Human tags (`match:fee`, `match:burn`, `market:burn`, `season:claim`) are the pre-image convention; the indexer stores both tag string and `bytes32`. `burn`/`burnWithMemo` burn from the **caller's own balance** and require `BURN_ROLE` — so the pool/market contract holds gross custody and burns from itself. |
| **batchMint** | **Dead path after bootstrap (Strix M6).** With `MINT_ROLE` holders = ∅ nobody can call it. All season/partner/locker distributions are **`transfer` / `transferFrom` of pre-minted balances** (distributor/locker/partner distributor). The B20 `batchMint` surface is documented only so audits know we do not use it. Announcements remain a separate OPERATOR surface and do not imply mint. |
| **Announcements** | Treasury/season transparency via B20 `announce` brackets, gated by `OPERATOR_ROLE` held under multisig+timelock with the multiplier permanently pinned at 1× (see Roles row). If OPERATOR is ever renounced away, announcements fall back to off-chain event logs — never silently. |
| **Granular pause** | `TRANSFER \| MINT \| BURN \| SEIZE` are independently pausable. **Pausing `TRANSFER` freezes claims too** (claims are transfers from pool/ClaimHub) — the incident policy must state this; there is no separate "claim" pause feature. |
| **Policy registry** | All scopes default `ALWAYS_ALLOW`. Geo/eligibility gating is a **Phase-1 legal requirement** for paid-entry pools (not "optional later") — design the policy + age-gate + legal opinion before mainnet value. `approve`/`permit` are not policy-gated. |
| Factory | Deterministic address via `B20Factory` + `(variant, sender, salt)`; variant byte in address (`0xB200…`). |
| **Builder Codes (ERC-8021)** | Every CHIPS tx carries the ERC-8021 attribution suffix (`dataSuffix` on the wagmi config + `capabilities.dataSuffix` for `sendCalls`). Missing attribution is silent revenue loss. See section 8.7. |

**Variant:** `ASSET` (decimals **18**). Not `STABLECOIN` — CHIPS is a game/utility asset, not a fiat proxy.

**Factory precompile:** `0xB20f000000000000000000000000000000000000`  
**Create call:** `createB20(ASSET, salt, params, initCalls)`  
**Activation:** confirm B20 Asset feature is live on Base Sepolia via ActivationRegistry before deploy.

### 1.1 Token identity

| Field | Value |
| --- | --- |
| Name | `Chips` |
| Symbol | `CHIPS` |
| Standard | B20 Asset |
| Decimals | 18 |
| Max supply | 10,000,000,000 CHIPS (cap; see section 2 for the unlock schedule) |
| Initial liquid supply | 2,000,000,000 CHIPS at bootstrap (bucket split in section 2.1); remaining 8B pre-minted into `SupplyLocker` |
| Supply cap | Set to 10B via `updateSupplyCap` in factory `initCalls`, then made immutable by the section 8.1b end-state (`renounceLastAdmin()` + on-chain assert). No down-only primitive exists on B20 — immutability comes from renouncing admin, with the freeze trade-offs named in section 8.1b. |
| Version (EIP-712) | `1` (B20 fixed) |
| contractURI | ERC-7572 metadata (name, logo, explorer, terms URL) |
| extraMetadata | `game=ludo-base`, `season-budget=published`, `docs=<this path>` |

---

## 2. Supply & allocation (10B max, 2B initial)

```text
10,000,000,000 CHIPS max (100%)
├── Playing Rewards ....... 30%  ·  3,000,000,000  (600M liquid · 2.4B locked)
├── Treasury .............. 20%  ·  2,000,000,000  (500M liquid · 1.5B locked)
├── Team .................. 20%  ·  2,000,000,000  (400M in vesting · 1.6B locked)
├── Liquidity ............. 20%  ·  2,000,000,000  (300M liquid · 1.7B locked)
└── Partners .............. 10%  ·  1,000,000,000  (200M liquid · 0.8B locked)
                                                ─────────────────────────────
Initial liquid/allocated: 2.0B · Locked in SupplyLocker: 8.0B (section 2.2)
```

### 2.1 Allocation rules

| Bucket | Amount (of 10B) | Initial (liquid at bootstrap) | Locked (SupplyLocker) | Custody | Release |
| --- | --- | --- | --- | --- | --- |
| **Playing Rewards** | 3.0B | 600M (covers S1 400M + 200M buffer) | 2.4B | `SeasonDistributor` **coded contract** (not an EOA): holds unlocked budget, exposes a coded epoch-budget function (per-epoch ceiling, timelocked parameter changes). **No mint authority after bootstrap** (`MINT_ROLE` holders = ∅): holds pre-minted unlocked budget and tops up from `SupplyLocker` tranches; coded epoch-budget function only | **Season budgets** via epoch caps + per-wallet daily/weekly caps (section 5.3). Epoch ceilings are hard stops: when an epoch budget depletes, issuance pauses to the published refill schedule (never pro-rata dilution, never over-mint). Never free-form client mint. Unspent rolls forward within the 3B lifetime cap. Unlocked tranches top up the distributor per section 2.2. |
| **Treasury** | 2.0B | 500M (ops/runway + 50M conversion pool) | 1.5B | Multisig Treasury + timelock (delays per section 8.10: standard ops 48h, large moves 7d; timelock active before mainnet value). Also funds the legacy conversion pool (section 3.3, capped, from Treasury — never from the 3B play budget) | Ops, audits, infra, esports, buyback-burn later, grants. All large moves via `announce`. |
| **Team** | 2.0B | 400M into vesting | 1.6B | Named vesting contract (e.g. OpenZeppelin `VestingWallet` or equivalent, multisig admin) | 12-month cliff, 36-month linear after cliff (institutional minimum for a 20% founder allocation). Vesting contract address published at deploy; no EOA unlocks. Unlocked tranches flow into vesting (cliff/linear still apply — unlock ≠ liquid; vesting tail accretes to circulating, never at unlock). |
| **Liquidity** | 2.0B | 300M seed | 1.7B | Time-locked vault / LP program (locked at deploy) | **No public sale on day one.** Unlock only against numeric KPIs (owner: Treasury multisig proposes, SecurityMultisig approves after timelock; thresholds published in TOKEN_PARAMS before mainnet; section 11: retention + pool-volume thresholds + delay), not discretion. |
| **Partners** | 1.0B | 200M | 0.8B | Partner distributor contract (pull-based `claimGrant`) + named milestone oracle (oracle identity, key/threshold, and timelock published at deploy; oracle can only release against published milestones, never mint) | Farcaster creators, guilds, Base ecosystem, KOL cups. Grants released against published milestones only. |

**Deployment pattern:** mint full 10B once (bounded by the cap), allocate 2B liquid per the table above, immobilize 8B in the `SupplyLocker` (section 2.2) in the same bootstrap run, then execute the section 8.1b end-state. Pre-mint-to-locker (not future mint rights) is deliberate: the full 10B exists and is visible on-chain from day one, so "fixed supply" is auditable, not a promise about future restraint. Playing Rewards then **draw down** unlocked budget — it is not an open faucet.

> Rationale: max supply is real (cap + visible 10B), liquid supply starts lean (2B), and growth unlocks only against proven usage.

### 2.2 Smart unlock schedule (8B gated locker)

The `SupplyLocker` is a coded contract holding the 8B with per-bucket accounting. Releases run on **quarterly envelopes of 500M** (16 envelopes ≈ 4 years), split pro-rata per bucket — but each envelope, once its gates pass, pays out as **three monthly drips of ~166.7M**, not one quarterly cliff (cliffs concentrate predictable short-the-rumor windows; drips slice the meta-order):

| Per monthly drip | Play | Treasury | Team → vesting | Liquidity | Partners |
| --- | --- | --- | --- | --- | --- |
| ~166.7M | 50M | 31.25M | ~33.3M | ~35.4M | ~16.7M |

A quarterly envelope opens **iff the two hard gates pass** (checked on-chain where possible, independently attested otherwise):

1. **Time:** ≥90 days since the last envelope opened (global clock — at most one envelope per window; missed windows never compound).
2. **Utilization (the demand gate):** ≥75% of previously unlocked play + partner budgets actually claimed/distributed (proof via ClaimHub + distributor accounting, read on-chain by the locker). Unlocking into idle wallets is forbidden.

**Sink health is a deceleration signal, not a hard block:** the trailing-90-day burn/emissions ratio trims the next envelope when weak — year-1 target ≥5%, year-2+ ≥10%, steady ≥15%, each set with ~10pp headroom over trailing data. A soft print **skips or halves** the next envelope; it never permanently bricks the schedule.

**Ratio inputs are on-chain cumulative counters (Strix HIGH-3) — never Postgres:** contracts cannot read `chips_events`. Maintain:
- `cumulativeBurned` (MatchPool / Marketplace / sink contracts increment on every `burnWithMemo`);
- `cumulativeDrawn` (SeasonDistributor + locker release + MissionClaim/SeasonClaim funding increments on every budget draw).
Ratio = Δ`cumulativeBurned` / Δ`cumulativeDrawn` over the trailing 90d window, computed from two on-chain reads (or an on-chain view that samples both). **No off-chain input is required for the gate.** If a residual off-chain factor is ever added, it requires an **independent attestor** (never self-scored metrics) and is a plan revision — not a silent substitute.

**Security gate:** no active incident pause, no unresolved ε-breach (section 8.6).

Destinations are fixed and **pre-announced ≥30 days before each window** (addresses published): play → `SeasonDistributor` epoch budget; treasury → Treasury multisig (timelocked); team → vesting contract (cliff/linear still apply); liquidity → locked vault/LP program; partners → partner distributor (milestone-gated). LP is seeded **before** the first envelope opens, and each window ships with a market-maker absorption plan at T+0 — conditional timing gets a deterministic outer calendar (earliest-possible dates) plus 30-day utilization/burn telemetry, so MMs can model it.

Controls: SecurityMultisig can **pause** unlocks immediately; resume via timelock. **Acceleration** requires a 14-day announced timelock with published rationale (emergency only). **Deceleration** (skipping a passed gate) is always allowed and default-safe. Every drip emits `UnlockExecuted` + a B20 `announce` + dashboard update.

**Circulating-supply reconciliation (published from day one):** the dashboard reports three numbers, never one — (a) locker-locked, (b) unlocked-but-designated (vesting/treasury/vault/partner-designated wallets), (c) CMC/CG-verified circulating. Team/treasury-unlocked balances are never marketed as float.

**Stall-path funding (pre-committed — election locked, Strix M7/M8):** S1 is sized to a **≤500M worst case** (600M initial play budget minus a 100M Sybil reserve), so one stalled quarter cannot halt missions. **Elected default = automatic S2-draw reduction.** If 1–2 consecutive envelopes fail their gates, the next season draw is cut by the shortfall (e.g. failed 150M play tranche → S2 reduced by 150M). The **Treasury bridge (≤100M)** is **not** the default; it is available only if a Phase-0 superseding decision is recorded in TOKEN_PARAMS **and** repayment is booked to the **Treasury bucket** of the next passed envelope (never carved from Playing Rewards — that would be a hidden tax on player emissions). The 0-tranche-year-1 scenario is simulated publicly before S1 locks.

Coverage check: S1+S2 draws (400M + 320M = 720M) are covered by the initial 600M play budget plus first-year envelopes (4 × 150M = 600M) — with utilization gates ensuring unlocks track real demand, not the calendar alone.

---

## 3. Single-currency game economy

### 3.1 What moves CHIPS (on-chain)

| System | Flow |
| --- | --- |
| Paid multiplayer (Classic / Power / Snakes) | Entry → Match Pool → protocol fees/burn → winner claim |
| Free online tables | No stake; optional mission progress only |
| Tournaments | Entry → Tournament pool → prize claims |
| Spectator predictions (Arena) | Stake → Predict slice of match pool or sibling pool → claim |
| Marketplace | Buyer pays CHIPS → seller (+ burn + treasury split) |
| Mission claims | User pulls reward from claim contract / voucher |
| Season rank rewards | User pulls merkle claim after season end |
| Social rewards (poke, referral) | Claim vouchers — still user-initiated pull |
| Vanity / forge / boosts | Spend CHIPS → burn-heavy sinks |

### 3.2 What stays off-chain

| System | Rule |
| --- | --- |
| **Offline / AI matches** | Local engine only. **No CHIPS stake, no pool, no claim.** |
| LXP / RXP / cosmetics equip state | Off-chain progression + prefs (unchanged) |
| Dice rolls, move auth, match proof | Off-chain authority (unchanged security model) |
| Chat / DMs (ECDH) | Unchanged |

Offline/AI may advance **local practice stats**. It does **not** pay CHIPS. If we later want practice→reward, it must be a **capped online claim** (mission progress), never a local mint.

### 3.3 Supabase role after CHIPS

| Keep in Supabase | Move on-chain / contract-adjacent |
| --- | --- |
| Match engine state, Edge RNG receipts, move-auth | Token balances (source of truth = chain) |
| Profiles, friends, messages, missions **progress** | Mission **payouts** |
| Pool *cache* for UI (amount, seats, status) | Pool **funds**, settle, claims |
| Settlement *proposal* + signatures | Settlement **execution** + credit assignment |
| Anti-fraud signals | Final economic writes |

`players.coins` becomes a **display mirror** (indexed from chain / claim hub), not a writable game currency. RLS stays locked; no client writes.

> **Decimals migration note:** CHIPS is 18 decimals (10B×1e18 = 1e28). Legacy `players.coins bigint` (max ~9e18 ≈ 9 CHIPS) and `spectator_bets.amount bigint` cannot hold CHIPS base units. All on-chain amounts use `numeric` in Postgres and `bigint`/`parseUnits` in TS (viem). Cutover plan: feature-flag legacy coin writes (`purchase_marketplace`, `cash_out_bet`, `settle_match_bets`, `join_tournament` coin path) → freeze → backfill `coins_source='legacy'|'chain_cache'` → UI reads chain/indexer only. Never run legacy coin payouts and CHIPS claims in parallel for the same reward.

---

## 4. Match Pool system (core economic primitive)

This replaces “wager number in lobby + settle later in DB.”

### 4.1 Design goals

1. Every paid match has a **visible on-chain pool** before play starts.
2. Players **explicitly authorize** entry — primary: EIP-5792 batched `approve + joinPool` in one wallet approval (smart-wallet compatible); fallback: EIP-2612 `permit` for EOAs, or plain `approve` + `joinPool`.
3. Protocol fees + burn are **deterministic and visible** in the pool UI.
4. After settle, **each winner claims their own cut** — no push payout from a hot key.
5. Claims can happen **right after the match** or **later from the player’s claim hub**.
6. Free matches never touch the pool contract.
7. Every pool/market/claim tx carries the ERC-8021 Builder Code suffix (section 8.7).

### 4.2 Contracts (pool family)

| Contract | Purpose |
| --- | --- |
| `Chips` | B20 Asset token |
| `MatchPool` | Create / fund / lock / settle (Mode A dual-sign + Mode B Edge-fallback) / claim / refund for multiplayer matches. **Holds gross custody + optional `hostBond`.** Burns its own balance via `burnWithMemo`; routes protocol fees via `transferWithMemo`. Reentrancy-guarded, CEI-ordered. **UUPS** (section 8.1c). Binds Edge lobby ticket at create (HIGH-5). |
| `ClaimHub` | Per-player accrued claimable balance — **view/aggregator + batch-claim router** over `MatchPool` credits (funds stay in `MatchPool`; `ClaimHub` never double-counts). Batch pull entry point. |
| `MissionClaim` | Pull-based mission / social / engagement rewards |
| `SeasonClaim` | Merkle season rank claims |
| `Marketplace` | Listings, purchases, fee + burn split |
| `TreasuryRouter` | Receives protocol fees; optional auto-buyback later |
| `SeasonDistributor` | Holds 3B play budget; funds epochs to claim contracts |

**Sepolia Phase 1 minimum:** `Chips` + `MatchPool` + `ClaimHub` + `MissionClaim`.

### 4.2b Pool creation policy (compile-time-safe economics)

Permissionless pool creation is allowed **iff** every parameter is validated on-chain at `createPool` — otherwise a malicious creator ships a 100%-fee pool behind a cloned lobby card:

| Parameter | On-chain rule (enforced in `createPool`, immutable after) |
| --- | --- |
| `entryFee` | Must equal a published fee-tier allowlist (100 / 1,000 / 10,000 / tournament-published). No free-form fees. |
| `protocolBps` / `burnBps` | Hard caps: `protocolBps ≤ 500` (5%), `burnBps ≤ 200` (2%); exact tier values from section 4.5. Tuner = Treasury multisig via timelock (section 8.10); tiers versioned, existing pools unaffected. |
| `maxSeats` / `gameMode` | Whitelist: seats ∈ {2, 4}, mode ∈ {classic, power, snakes}. |
| `authority` | Bound at creation to the host wallet **committed in an Edge-signed lobby ticket** (`lobbyTicket = { roomCode, matchId, host, seatWallets, seatColors, gameMode, issuedAt, edgeSig }`). `createPool` **verifies the Edge signature** and requires `authority == ticket.host`, `seatWallets == ticket.seatWallets`, `seatColors == ticket.seatColors`. TeamUp state stays off-chain; contracts only trust the Edge attestation (same co-signer that later attests settles). The pool creator cannot self-appoint a different settler (Strix HIGH-5). Changeable only via the compute-host rotation rule (section 4.7). Store `ticketHash` on the pool. |
| `seatWallets` | Full seat allowlist committed at creation (`createPool(roomCode, seatWallets[], seatColors[], lobbyTicket)`), lengths must equal `maxSeats` **and** match the ticket. `joinPool` reverts for non-allowlisted wallets — closes seat squatting without trusting off-chain TeamUp state alone. |
| `poolKind` / `parentPoolId` / `windowClosedAt` | `poolKind` ∈ {match, predict}; predict pools commit `parentPoolId` + fixed `windowClosedAt` **at creation** (never mirrored mid-match — see section 4.10). **Bounded (Strix M3):** `windowClosedAt` must satisfy `parent.createdAt ≤ windowClosedAt ≤ parent.lockedAt + 10 minutes` (or `parent.settleBy` if locked already) — a distant cutoff that could admit post-reveal entries reverts at creation. **Phase 1: match pools only** — predict join-policy (not match `seatWallets`) is a Phase-2 entry artifact. |
| `hostBond` | Optional but **default-on for paid tiers ≥ Standard (Strix HIGH-1):** host posts `hostBond = max(2% of prizeFund, 1% of entryFee × maxSeats)` in CHIPS at `lockPool`. Bond is **slashed to the prize fund** if the pool hits timeout-refund **without** an Edge-attested unresolvable outcome (host withhold). If Edge attests unresolvable/match-broken, bond returns to host and entries fully refund. Casual 100-tier may omit bond (gas). |

Join-UX rule: the client reads `entryFee / protocolBps / burnBps / authority / status` **from chain** (never the indexer cache) and displays them pre-approve; any cache-vs-chain mismatch reverts the flow. Foundry squat test required (non-allowlisted join reverts; over-cap params revert).

### 4.3 Pool lifecycle

```text
┌──────────┐   join/fund    ┌──────────┐   all seats / host lock   ┌──────────┐
│  OPEN    │ ─────────────► │  FUNDED  │ ───────────────────────►  │  LOCKED  │──settleBy deadline──► TIMEOUT path
└──────────┘                └──────────┘                           └────┬─────┘  (anyone-refund, see liveness)
      │                              │                                     │
      │ cancel (host, pre-lock only) │ match plays (off-chain engine)      │
      ▼                              ▼                                     ▼
┌──────────┐                  ┌──────────┐   dual-signed settle     ┌──────────┐
│CANCELLED │                  │ EXPIRED  │   (authority)          │ SETTLED  │
└──────────┘                  └──────────┘                        └────┬─────┘
     refunds to joiners (pull)      TTL + caller pinned (section 4.7)          pull claims
                                                                           (until unlockAt)
```

Coded transition table (terminal states absorb all further transitions):

| From → To | Caller | Condition |
| --- | --- | --- |
| OPEN → FUNDED | any allowlisted joiner | `joinPool` with exact fee; `filledSeats < maxSeats` |
| OPEN → CANCELLED | creating host only | **pre-lock only**; full refunds via `refundJoin` pull |
| FUNDED → LOCKED | host | all seats funded-confirmed (indexer confirmations per section 8.6); posts `hostBond` when required (section 4.2b) |
| LOCKED → SETTLED | **anyone** holding valid proof | Mode A (before effective `settleBy`): dual-sign host + Edge. Mode B (after effective `settleBy`): **Edge-only attested settle** (Strix HIGH-1). Both permissionless to submit. |
| LOCKED → CANCELLED (timeout-refund) | **anyone** | `block.timestamp > effective settleBy + refundGrace` **and** no valid settle **and** Edge attests `unresolvable` (or Edge-down SLA elapsed) → full refunds; if timeout without Edge-`unresolvable` and host withheld → slash `hostBond` into prize fund then refund entries + residual to a pro-rata winners claim (or full refund + bond to Treasury if outcome truly unknown — see section 4.7) |
| OPEN/FUNDED → EXPIRED | anyone | lobby TTL elapsed (published per tier, e.g. 24h unfilled) → refunds |
| SETTLED/CANCELLED/EXPIRED → * | — | terminal; every further transition reverts |

`settleBy = lockedAt + settleWindow` (published per tier, e.g. 60 min) is stored at lock. Cancel is **never** available post-lock — a losing host cannot cancel instead of paying winners.

**Refund grace (Strix M1):** timeout-refund is only valid after `effective settleBy + refundGrace` (default **3 minutes**; published per tier). In-flight dual-sign settles that land near the boundary are not frontran by a loser-initiated refund. Settle (Mode A or B) remains valid until the **refund** deadline.

**Pause extension (freeze rule):** any on-chain pause that blocks settle (`TRANSFER` or `BURN`) **auto-extends `settleBy` by the pool’s pause-delta** — `pauseDelta[poolId]` accumulates `unpausedAt - pausedAt` while the relevant feature is paused; effective deadline = `settleBy + pauseDelta`. Timeout-refund and settle both read the **effective** deadline. Product copy: incident pause delays payouts; it does **not** convert wins into refunds. BURN-pause still reverts `settlePool` wholesale (no partial settle) until unpause — then settle remains available until the extended deadline. Foundry test: pause → unpause → settle succeeds after original `settleBy` but before extended deadline; timeout-refund before extended deadline reverts.

**Settle liveness (Strix HIGH-1) — three locks:**
1. **`settlePool` is permissionless** whenever both required signatures are provided — winners never depend on the host to *submit*.
2. **Mode B — Edge-fallback settle after `effective settleBy`:** Edge alone may submit `settlePoolEdge(poolId, payoutPlan, edgeSig, evidence)` with an attested outcome from `match_states` + roll receipts. Dual-sign is **not** required after the deadline. This kills the free “lose and never sign” grief.
3. **Refund only if Edge attests `unresolvable`** (match broken / authority gone / irrecoverable desync). A silent host alone cannot convert earned wins into refunds. If the host withheld **and** Edge has a resolvable outcome → Mode B pays winners and **slashes `hostBond`** (when posted) into the prize fund as a grief penalty. If Edge is down past an ops SLA (e.g. 30 min after `effective settleBy`), Security multisig may submit `attestUnresolvable` under timelock exception (announced) to unstick refunds — last resort, monitored.

### 4.4 Pool parameters (on-chain struct)

```solidity
struct MatchPool {
    bytes32 poolId;          // keccak(chainId, matchId, roomCode, chainSalt) — chainId in hash blocks Sepolia/mainnet replay.
                             // chainSalt embeds chainId too: factory salts are DISTINCT per env (e.g. keccak("ludo-base-chips-v1", chainId))
                             // so Sepolia/mainnet token addresses differ — kills commemorative-vs-real confusion at address level.
    uint8   gameMode;        // classic | power | snakes (whitelisted at creation)
    uint8   poolKind;        // 0 = match, 1 = predict (locked at creation, section 4.10)
    uint8   maxSeats;        // 2 or 4 (2v2 = 4 seats, 2 teams)
    uint8   filledSeats;
    uint8   status;          // open | funded | locked | settled | cancelled | expired (transition table section 4.3)
    address[] seats;         // participant wallets in seat order (allowlist committed at creation)
    uint8[] seatColors;      // color per seat, committed at join/lock — makes TEAM_PAIRINGS checks executable (section 4.5)
    mapping(address => uint256) seatIndex; // 1-based; 0 = not seated (winners-⊆-seats check)
    address authority;       // host from Edge-signed lobbyTicket (section 4.2b); rotation only via section 4.7 liveness rule
    bytes32 ticketHash;      // hash of the Edge lobby ticket bound at createPool (Strix HIGH-5)
    uint128 entryFee;        // CHIPS per seat (tier allowlist at creation; per-chain (Strix M10))
    uint128 gross;           // filledSeats * entryFee (updated on join)
    uint128 protocolBps;     // protocol fee (capped section 4.2b)
    uint128 burnBps;         // burn cut (capped section 4.2b)
    uint128 prizeFund;       // gross - fees - burn (locked for winners)
    uint128 protocolAmount;
    uint128 burnAmount;
    uint128 hostBond;        // CHIPS posted at lock (0 if exempt); slashed on host-withhold timeout (section 4.7 HIGH-1)
    bytes32 resultHash;      // AUDIT LOG of the settled payout (hash of canonical payoutPlan, stored at settle for explorers).
                             // Not a forgery mitigation (outcome unknown at lock): integrity comes from dual-sign / Edge-fallback + nonce
                             // consumption + winners-⊆-seats + equal-split checks, not from this field.
    uint64  createdAt;
    uint64  lockedAt;
    uint64  settleBy;        // lockedAt + settleWindow — anyone may timeout-refund after effective deadline
    uint64  pauseDelta;      // Σ (unpausedAt - pausedAt) while TRANSFER|BURN paused; effective settleBy += pauseDelta (section 4.3)
    uint64  refundGrace;     // seconds after effective settleBy before refund allowed (default 180; Strix M1)
    uint64  settledAt;
    uint64  claimUnlockAt;   // settledAt + disputeWindow — claimMatch/claimAll enforce this (section 4.8).
                             // refundJoin: if status==settled, same unlock applies; if cancelled/expired, refunds are immediate (Strix M9).
    uint64  windowClosedAt;  // predict pools only: entry cutoff committed at creation, BOUNDED (section 4.2b Strix M3)
    bytes32 parentPoolId;    // predict pools only: main pool reference
    uint256 settleNonce;     // consumed per settle — cross-pool settle replay reverts (section 4.7)
    // NOTE: no claimDeadline in v1 — match prizes do not expire (see section 4.8). If an expiry is ever
    // introduced it needs a new plan revision + migration, not a silent field reuse.
}
```

### 4.5 Fee schedule (visible in lobby)

Default **paid** table (tunable per mode / stake tier within the section 4.2b caps):

| Stake tier | Entry example | Protocol fee | Burn | Winner share of prize fund |
| --- | --- | --- | --- | --- |
| Casual paid | 100 CHIPS | 4% | 1% | 100% of prize fund (1v1) or mode split |
| Standard | 1,000 CHIPS | 5% | 2% | mode split |
| High roller | 10,000 CHIPS | 5% | 2% | mode split |
| Tournament | variable | 5% | 2% | published bracket |

Fee governance: tiers change only via Treasury-multisig proposal + timelock (section 8.10); on-chain caps in section 4.2b are immutable **per pool** at creation. Lowering caps for **future** pools requires a MatchPool **implementation upgrade** under the section 8.1b upgrade matrix (UUPS + timelock + optional post-audit upgrade-renounce) — never raised silently and never through an unnamed key. Player-facing take (fees+burn) is shown as a single "protocol take" number in the lobby; no sensitivity games (take never rises when volume drops).

**1v1 example (1,000 entry):**

```text
Gross     = 2,000
Fee   5%  =   100  → TreasuryRouter (transferWithMemo, memo=keccak("match:fee"))
Burn  2%  =    40  → MatchPool.burnWithMemo(memo=keccak("match:burn")) from pool custody
Prize     = 1,860  → winner claimable
```

**Casual 1v1 example (100 entry):**

```text
Gross     = 200
Fee   4%  =     8  → TreasuryRouter
Burn  1%  =     2  → burn
Prize     =   190  → winner claimable
```

**4-player FFA example (1,000 entry):**

```text
Gross     = 4,000
Fee   5%  =   200
Burn  2%  =    80
Prize     = 3,720
Split     = winner 100% (default FFA)
          optional: 70/20/10 for top-3 experimental queues
```

**High-roller 1v1 example (10,000 entry):**

```text
Gross     = 20,000
Fee   5%  =  1,000
Burn  2%  =    400
Prize     = 18,600
```

**2v2 example (locked: 50-50):** prize fund split equally to **2 winning teammates**; each claims `prizeFund / 2` (floor) with **odd wei dust to the first winning seat** (seat index order). Winner set must satisfy `TEAM_PAIRINGS` (`lib/constants.ts`: Green+Blue vs Red+Yellow) via on-chain `seatColors` (Strix M2). Plan builder: `lib/payoutPlan.ts` `buildPayoutPlan({ shape: "2v2", … })`. Foundry: `MatchPoolPayout.t.sol`.

**4P top-2 podium (locked: 75/25):** when two winners are **not** a `TEAM_PAIRINGS` pair, **1st gets 75%**, **2nd gets 25%** of `prizeFund` (remainder to 2nd so the sum is exact). Single winner = 100%. Enforced in `MatchPool._applySettle` + `buildPayoutPlan({ shape: "4P", … })`.

> **Gas reality check & Mainnet Gas Floor:** Casual 100-CHIPS tiers are demonstrably gas-negative on L2 (aggregate lifecycle gas across approve, join, settle, and claim exceeds net prize at early token valuations). Casual 100-CHIPS is strictly a Sepolia calibration tier. **Enforced at the contract layer per chain (Strix M10), not UI-only:** the `createPool` fee-tier allowlist is **chain-scoped** — Base Mainnet `MatchPool` does not register the 100-CHIPS tier at all, so direct contract joins of calibration pools are impossible. The lobby also hard-filters/hides any stake tier < 1,000 CHIPS on mainnet until the ERC-8168 Gas Paymaster (section 8.9) is live and funded (defense in depth).

### 4.6 Join flow (user authorization — batch-first)

```text
Player sees lobby: "Pool 0xabc… · Entry 1,000 CHIPS · Fee 5% · Burn 2% · Seats 3/4"

1. Wallet connect + SIWE app session (identity). SIWE verifies against the active
   chain (84532 in Phase 1, 8453 on mainnet) — the current 8453-only gate
   (lib/walletVerify.ts, lib/sessionProof.ts) must accept 84532 first.
2. Primary path — EIP-5792 batch (works for smart wallets, our default):
   Client builds sendCalls([{ approve(MatchPool, entryFee) }, { joinPool(poolId) }])
   with ERC-8021 builder-code attribution (section 8.7). One user approval, atomic.
   Allowance is exactly entryFee with a short deadline — never infinite.
3. Fallback path — EOA permit: sign Permit(owner, MatchPool, value=entryFee, deadline),
   then MatchPool.joinPool(poolId, permitArgs). Permit is EOA-only and must not be
   offered to smart-wallet users.
4. Contract:
   - `joinPool` requires `permit.owner == msg.sender` when the permit path is used; leftover allowance after an exact-fee join is asserted ~0 in tests
   - pulls entryFee via transferFrom (permit or pre-approved allowance)
   - seat = msg.sender, must be in the creation-time `seatWallets` allowlist (front-run squats revert); records `seatColors[msg.sender]`; guest wallets cannot join paid tables
   - gross += entryFee
   - emits PoolJoined(poolId, seatIndex, player, entryFee) + Memo(keccak("match:join"))
5. Indexer updates Supabase lobby cache (with reorg handling — section 8.6)
6. Game starts when seats full OR host calls lockPool

> Wallet-compat note: where the wallet lacks atomic batch support, the client falls back to sequential `approve` → `joinPool` with the same exact-fee + short-deadline parameters (two approvals, same guarantees). Exact-allowance discipline is first-party-UX-only and unenforceable on third-party/Farcaster-frame clients — Phase 3 frames use a signed join-intent binding so a frame relay cannot substitute calldata (e.g. infinite approval).

> **Smart-wallet plan (`docs/planning/SMART_WALLET_PLAN.md`):** this §4.6 join authorization is **authoritative**. CDP spend permissions are **not** the primary join path (optional later only if this section is amended). Player identity and `seat` / claim / host addresses are the **parent Base Account** — never a CDP sub-account (`seat = msg.sender` would strand prizes on a regenerable app-scoped account). Gas sponsorship remains §8.9 (ERC-8168 gas-only); CDP paymaster is interim UX only.
```

**Fail-closed:** online paid match **cannot start** until all seats show `funded` on-chain (or host cancels). Guest wallets cannot join paid tables. Seats and claims bind to the parent smart-account address (see smart-wallet plan §1.1).

**Free online tables:** **no MatchPool is created.** Free play never calls the pool contract. A pool is created only when `entryFee > 0` or a Phase-2 predict sibling needs a parent poolId. (`entryFee = 0` pools are not a supported product surface.)

### 4.7 Settlement (authority → claim credits, not pushes)

Game remains off-chain for speed and existing integrity (Edge rolls, match session, host proof). Settlement becomes a **signed payload + on-chain credit**.

**Settlement payload — EIP-712 `ChipsMatchSettle` (version `1`):**

```text
domain:    { name: "LudoBase MatchPool", version: "1", chainId, verifyingContract: MatchPool }
message:   { poolId, matchId, roomCode, gameMode, participants[], winnerAddresses[],
             payoutPlan[{ addr, amount }...], nonce, deadline, authority }
```

* `payoutPlan` canonical encoding (ordered addrs ascending, amounts, `chainId`, `poolId`, `nonce`) hashes to `resultHash`. Any malleability = revert.
* `sum(payoutPlan) == prizeFund` enforced on-chain.
* 2v2 winner sets enforced against `TEAM_PAIRINGS` (see section 4.5).
* Authority = **dual-sign from day one, including Sepolia** (not a Phase-4 upgrade) for the **happy path before `effective settleBy`**: the host signature AND an Edge co-signature are both required. Edge co-signer identity: a dedicated settlement key held in the Edge runtime secret store, key-separated from the voucher op-key (section 6.1) and from game-ops keys; signing policy: Edge attests `(poolId, winnerSet, payoutPlanHash, seqRange)` derived from `match_states` + roll receipts, never from host assertions alone. **`settlePool` is permissionless** whenever the required signature set is provided — anyone (winner, relayer, watcher) may submit (Strix HIGH-1).
* **Mode B — Edge-fallback settle (after `effective settleBy`, Strix HIGH-1):** if the host withholds their signature, Edge alone may submit `settlePoolEdge(poolId, payoutPlan, edgeSig, unresolvableFlag=false)`. Edge key custody is **threshold/HSM on Sepolia and mainnet from day one** (Strix HIGH-2 bar) — it is a half-custodian of every pot. Timeout-refund is **not** the default path for a silent host: refunds require Edge `unresolvable=true` (or Security `attestUnresolvable` after Edge-down SLA). Host-withhold + resolvable Edge outcome → Mode B pays winners and slashes `hostBond`.
* **Ops SLO & Retry Pipeline (freeze):** Edge co-signing is triggered asynchronously upon match completion via an idempotent Supabase background worker / retry queue (decoupled from host client connectivity). Target settle-ready payload <15s and **before** the winner’s claim CTA. Alert threshold >60s co-sign latency. If Edge co-sign is temporarily missing, UI explains delayed payout (not a silent loss) until retry succeeds or Mode B / refund path engages.
* Host rotation: if compute-host baton-passes (`ENGINE_LOGIC.md` section 5.3/section 9.3), the new host must call `rotateAuthority(poolId, edgeAttestation)` — Edge attests the handover against presence + `match_states.host_address`; the contract updates `authority` only with a valid Edge co-signature. Stale hosts cannot settle after rotation. Ladder ticket binding from createPool still applies to the original host field; rotation is the only post-create change.
* Abandon/forfeit is never host-declared alone — and **never burns on a single Edge signature (Strix HIGH-2)**:
  * `submitAbandon(poolId, evidence)` with **Edge-only** evidence → **100% full refund of all entries**, zero burn, bond returned to host if the abandon was not host-caused.
  * `submitAbandonDual(poolId, evidence, hostSig)` with **Edge + host** (or Edge + tournament authority) → the section 5.1 split (50% burn / 50% to non-abandoning prize) may apply.
  * Caller is permissionless with valid sig(s); rate-limited per pool; `evidence = { poolId, accusedSeat, seqAtDisconnect, afkStrikes, edgeSig }`. Edge-key custody must match this impact (threshold/HSM, Sepolia included).
* Personal-sign text payloads (`lib/matchProof.ts` style) remain for off-chain match-record/bet-resolve only — **on-chain settle verifies EIP-712** (EOA `ecrecover` + ERC-1271/6492 smart-wallet path, Base-chain-gated per skill).

**On-chain `settlePool(poolId, payoutPlan, proof)` — exact checks (Mode A / dual-sign):**

0. **Caller is unrestricted** (any address) — signatures authorize the payload, not the submitter (Strix HIGH-1).
1. Requires `status == locked` and `block.timestamp ≤ settleBy + pauseDelta[poolId]` **or** (Mode B window) `settleBy + pauseDelta < now ≤ settleBy + pauseDelta + refundGrace + modeBWindow` with Edge-only proof.
2. Recovers host signer AND Edge co-signer from the EIP-712 `ChipsMatchSettle` signatures **(Mode A)**; requires `hostSigner == pool.authority == message.authority` and Edge signer == registered Edge co-signer; requires `block.timestamp ≤ deadline`. **Mode B:** Edge signature only (`settlePoolEdge`), Edge signer == registered Edge co-signer, and `now` is past effective `settleBy`.
3. Requires `message.settleNonce == pool.settleNonce`, then consumes it (`settleNonce++`) — cross-pool settle replay reverts.
4. Checks `sum(payoutPlan) == prizeFund` and `keccak(canonicalPayoutPlan) == resultHash` (audit field only — written in this call from the submitted plan; **not** a pre-lock commitment and **not** a security oracle; dual-sign/Edge-fallback + nonce + seat/team checks are the integrity path).
5. Requires every `payoutPlan.addr` ∈ `seats` (accomplice-diversion reverts) and 2v2 sets satisfy `TEAM_PAIRINGS` via `seatColors` with **floor + dust-to-first-winning-seat** (Strix M2).
6. Marks pool `settled`, stores `resultHash` + `settledAt`, sets `claimUnlockAt = settledAt + disputeWindow`. If Mode B after host-withhold with resolvable outcome: **slash `hostBond` into `prizeFund`** before credits (winners claim the extra).
7. For each winner: records credit `(player, poolId) → amount` against funds held in `MatchPool` and emits a `ClaimHub`-indexed credit event — **credits only, no transfers**.
8. Burns `burnAmount` from pool custody via `burnWithMemo(keccak("match:burn"))` (pool holds `BURN_ROLE`; no EOA burner); increments `cumulativeBurned`.
9. Routes `protocolAmount` to `TreasuryRouter` via `transferWithMemo(keccak("match:fee"))`.
10. Emits `PoolSettled`, `ChipsBurned`, `FeeRouted`.

**No auto `transfer` to winners in settle.** Credits sit until claimed.

### 4.8 Individual claim (pull — two paths)

Players choose when to pull. Both are first-class.

#### Path A — Immediate claim (post-match)

```text
Match ends → UI: "You won 1,860 CHIPS · Claim Unlocks in 04:59 (Dispute Protection Window)"
Primary CTA button is disabled with an active real-time countdown timer (`claimUnlockAt - now()`);
tooltip explains on-chain dispute verification. Client strictly blocks sending `claimMatch`
prior to `block.timestamp >= claimUnlockAt` to eliminate preventable revert gas errors.
Once unlocked, CTA lights up: "Claim 1,860 CHIPS (Est. Net ~1,858 CHIPS)".
User sends claimMatch(poolId) (wallet tx with builder-code suffix)
MatchPool (funds holder) via ClaimHub router (ClaimHub calls MatchPool.claimFor under an
explicit router allowlist; reentrancy guard spans both contracts):
  - require settled && block.timestamp >= claimUnlockAt && credit[player][poolId] > 0 && !claimed
  - checks-effects-interactions: zero the credit FIRST (idempotent, reentrancy-guarded)
  - CHIPS.transfer(player, amount)
  - emit PrizeClaimed(poolId, player, amount) + Memo(keccak("match:prize"))
```

Gas is paid by the player. UX copy must show gross, gas estimate, and net. Sponsored claims
via ERC-8168 payer (section 8.9) cover gas only — prize value still comes from pool custody.
`claimMatch` and `claimAll` zero the same credit record atomically: claiming one path
bricks the other for that `(player, poolId)` (Foundry test required).

#### Path B — Deferred claim (user pool / hub)

```text
Credits accumulate in ClaimHub across matches, missions, seasons.

claimable[player] = Σ unclaimed credits

User opens Wallet → Claimable
  Match wins:     4,220
  Missions:         350
  Season S1:      1,200
  Social:           40

User calls ClaimHub.claimAll()  // or claimMany(refs[])
→ one transfer of total
→ emits ClaimBatch(player, total, refs[])
```

Aggregation rules: `claimAll` is paginated under the hood via `claimMany(refs[], cursor)` with `MAX_CLAIM_REFS` per tx (published constant, e.g. 25) — an unbounded loop is a gas-grief vector, so the infinite variant is a client-side loop over bounded calls, never one unbounded tx. Cross-contract batches (match + mission + season in one tx) are all-or-nothing per ref. **Strict batch-level Checks-Effects-Interactions (CEI)** is enforced across the multi-contract graph: `ClaimHub` zeroes/marks claimed every touched credit across `MatchPool`, `MissionClaim`, and `SeasonClaim` **BEFORE** initiating any external token transfer. A global router-level `nonReentrant` guard spans `ClaimHub`, and underlying contracts enforce `caller == claimHubRouter` under an explicit allowlist, preventing re-entry through recipient `fallback`/`receive` hooks.

**Smart planning defaults:**

| Rule | Default |
| --- | --- |
| Minimum claim | None on free-tier; optional 10 CHIPS min to reduce dust tx spam (does not fix gas-negative micro-prizes — see section 4.5) |
| Batch claim | `claimAll` pulls every open credit |
| Expiry | Unclaimed match prizes **do not expire** in v1 (player-friendly). Optional 180-day soft nudge in UI. No `claimDeadline` enforcement, no automatic burn/sweep of user credits. |
| Dust | **No ops-initiated burn of user credits.** Dust consolidation is strictly user-opt-in (`claimAll` includes dust) — an ops job can never pull or burn from `credit[player][poolId]`. |
| Forfeit | Cancelled/expired/timeout pools refund joiners via `refundJoin(poolId)` pull — consuming the **same** `(player, poolId)` credit record that claims use, so cancelled→settled confusion can never double-pay. **`refundJoin` unlock rule (Strix M9):** if `status == settled`, `block.timestamp ≥ claimUnlockAt` is required (same as claims); if `status ∈ {cancelled, expired}` (pre-lock cancel, lobby TTL, or Edge-`unresolvable` timeout), refunds are **immediate** — `claimUnlockAt` is 0 / ignored on those paths so cancelled refunds never brick. |
| Sybil | **Scorer scope (freeze): rewards-only.** Scorer-signed claim authorizations gate **play-reward surfaces only** — `MissionClaim`, `SeasonClaim`, partner `claimGrant`. **Match prizes and pool refunds never require a scorer** — dual-sign settle (or cancel/timeout paths) is the sole authorization; a scorer outage cannot freeze settled pot money. On those reward surfaces, eligibility is enforced **on-chain** (not UI-only): scorer key = named custodian in section 8.10, nonce-consumed, attests wallet-age/deposit/paid-volume. Free-table farming is costless, so paid-pool volume and stake dominate the score. |
| Dispute window | **On-chain enforced for settled staked pools** (`claimMatch`/`claimAll` and `refundJoin` **when settled** revert before `claimUnlockAt`). Cancelled/expired refunds are immediate (Strix M9). |

| Tier | `disputeWindow` | Rationale |
| --- | --- | --- |
| Casual paid | 2 min | low stakes, fast UX |
| Standard | 5 min | |
| High roller / Tournament | 10 min | watcher coverage window |

> KPI note: settle-latency p95 < 10 min (section 11) measures `lock → settled`, **excluding** the dispute window (`settled → claimable`). The window exists so automated watchers can trigger timeout-refund or flag — not so humans must win a 10-minute race.
>
> **Dispute UX Rule:** The post-match and claim UI must show an active real-time countdown timer (`claimUnlockAt - now()`, mm:ss) with copy explaining dispute verification. The Claim CTA remains client-disabled until `block.timestamp >= claimUnlockAt` so players are never exposed to preventable contract reverts.

### 4.9 Pool UI (product surface)

Every lobby tile for a paid match shows:

- Pool id (short)
- Entry fee in CHIPS
- Seats filled / max
- Live **gross pot**
- Fee % / burn %
- Projected winner claim
- Chain: Base Sepolia / Base
- CTA: **Approve & Join** / **Watch** / **Claim**

Arena live spectator view shows the same pool card + claim history after settle.

### 4.10 Related pools

| Pool type | Entry | Settlement | Claim |
| --- | --- | --- | --- |
| Ranked 1v1 | CHIPS | Host/authority signature | Winner individual |
| Casual 4P | CHIPS | Authority | Winner (or top-N split) |
| 2v2 | CHIPS per seat | Authority + team winners | Each teammate |
| Tournament | CHIPS | Bracket authority + final root | Each earner |
| Spectator predict | CHIPS | Same match authority + bet type | Winning predictors |
| Free match | none | Progression only | Mission claims only |

Spectator bets use `poolKind = predict` **inside `MatchPool`** (locked shape — no separate `PredictPool` contract). A predict pool commits `parentPoolId` + fixed `windowClosedAt` **at creation** and enforces `block.timestamp ≤ windowClosedAt` on every entry (conservative skew, e.g. cutoff = 5s before the off-chain 3s reveal window opens, so a lagging mirror can never admit post-reveal entries).

> **Predict integrity (ADR-001 on-chain):** the cutoff is committed at creation, never mirrored mid-match. Predict settles only after the main pool settles; if the main pool is cancelled/expired/timeout, predict entries refund (no loss to predictors).

**Predict payout — parimutuel (locked):** predictors stake on an outcome (winner color / dice parity / bet type per market). After the main pool settles, the losing side's net (gross − fees − burn) is distributed pro-rata to winning-side stakes; winners additionally reclaim their own stake. Worked example (1,000 CHIPS stakes, 5% fees + 2% burn on predict gross): sides A=3,000 / B=1,000, A wins → distributable = 4,000 − 280 = 3,720; each 1,000 A-stake claims 1,000 + (1,000/3,000 × (3,720 − 3,000)) = 1,240.

**Predict triggers (callers pinned):** `settlePredict` callable by anyone after the parent settles (reads parent outcome, permissionless); `refundPredict` callable by anyone if the parent cancels/expires/times out. Predict pools inherit the parent's dispute window before predictor claims unlock, with no independent predict dispute.

> **Legal:** paid-outcome prediction is a sportsbook surface with higher gambling exposure than playing. It ships only under the section 9/H7 pre-freeze legal gate (permitted/blocked geos, age verification method) — never inherits the match-pool analysis by default.

---

## 5. Smart burn mechanism

Burns are not marketing language — they are **on-chain, memo-tagged, measurable**.

### 5.1 Burn sources (priority order)

| Source | Rate (Sepolia default) | Memo tag | When |
| --- | --- | --- | --- |
| **1. Match pool burn** | 1–2% of gross by tier (hard max) | `match:burn` | At settle |
| **2. Marketplace burn** | 6% of sale total (5% protocol + 1% burn) | `market:burn` | On purchase |
| **3. Prestige / forge** | Fixed + % on upgrades | `forge:burn` | On craft |
| **4. Vanity sinks** | Custom name, frames, emote slots | `vanity:burn` | On purchase |
| **5. Season pass** | 20–40% of pass price burned | `pass:burn` | On buy |
| **6. Tournament no-show** | 100% of forfeited entry | `tour:forfeit` | On bracket lock. **Destination (hygiene):** 100% of a no-show entry is **burned** (this memo) — not redistributed to the bracket and not kept by treasury — so a no-show cannot farm or dilute the pot. (If a future tournament wants consolation redistribution, it is a new plan revision with an explicit split.) |
| **7. Ranked abandon** | 50% of stake **only on dual-signed abandon** | `match:abandon` | **Strix HIGH-2 custody split:** **Edge-only** `submitAbandon` → **100% refund to everyone, burn = 0** (single key cannot burn victim stakes). **Edge + host** (or Edge + tournament authority) `submitAbandonDual` → 50% burn / 50% to non-abandoning side's prize fund. Caller permissionless with valid sig(s); rate-limited per pool. `evidence = { poolId, accusedSeat, seqAtDisconnect, afkStrikes, edgeSig }`. Disconnect-vs-quit: grace window (e.g. 60s reconnect) before abandon is submittable; false-positive appeals feed the dispute path (section 4.8). |
| **8. Boost tax** | 10–20% of XP-boost spend | `boost:burn` | On boost |
| **9. Treasury buyback-burn** | Optional later from revenue | `treasury:bb` | Manual/multisig |

### 5.2 What we do **not** burn

- Mission principal rewards (don’t tax fun)
- Free-table play (no fee)
- Team vest unlocks
- Liquidity inventory

### 5.3 Emission vs burn targets

Play budget is 3B (fixed lifetime draw, not new mint). Net-inflation warning: at the
indicative rates below, S1 emits ~400M against ~16–28M burned (**net +372–384M**). The
"sinks keep pace" goal (section 5.5) is therefore back-loaded — treat S1–S3 as deliberate
net-inflationary bootstrap and gate it with per-wallet caps, or the 3B budget is a faucet:

| Phase | Play emissions (indicative) | Expected burn share of emissions |
| --- | --- | --- |
| Season 1 bootstrap | ~400M | 4–7% |
| Seasons 2–3 growth | ~280–320M / season | 8–12% |
| Steady state | declining curve from remaining budget | 15–30%+ as volume grows |

Back-of-envelope guardrail: 10k DAU × 50 CHIPS/day × 90d ≈ 45M/season (fits); 100k DAU at
the same rate ≈ 450M (blows S1 alone). Required controls (Phase 1): per-wallet
daily cap (e.g. ≤200 CHIPS/day missions) + weekly cap + paid-pool-volume weighting for
season claims. Re-run the model at 10k/100k DAU before locking S1 budgets.

> **Budget-exhaustion rule (freeze gate):** per-wallet caps bound individuals, not the aggregate (100k DAU × 18k/season cap = 1.8B demand vs 400M S1 draw). Epoch ceilings are therefore **hard stops**: when an epoch budget depletes, mission issuance pauses to the published refill schedule — never pro-rata dilution, never over-mint. And the **Sybil-profitability analysis is a freeze exit criterion**: model farm revenue vs wallet-creation + gas + 7%-wash-take cost at 22k-wallet (full S1 drain) and 100k-wallet scale; if farming is profitable at scale, S1 budgets don't lock until stake/deposit gates (section 7.2) close the gap. First-come Sybils must never eat honest users' rewards.

**Season emission curve (from the 3B play budget, not new mint):**

| Season | Budget draw | Notes |
| --- | --- | --- |
| S1 | 400M | Acquisition, generous missions |
| S2 | 320M | Introduce ranked pools hard |
| S3 | 280M | Tournament top-ups |
| S4 | 240M | Tighten daily caps |
| S5 | 200M | Skill-weighted more |
| S6 | 160M | |
| S7 | 120M | |
| S8+ | 100M → floor 60M | Remaining budget amortized; governance can re-slice only downward |

Unspent season budget **rolls forward** in the distributor — it is not burned automatically (preserves optionality) but cannot exceed the 3B lifetime play allocation.

### 5.4 Burn transparency

- Every burn uses B20 `burnWithMemo` with a `bytes32` memo (tag pre-images: `match:burn`, `market:burn`, `forge:burn`, `vanity:burn`, `pass:burn`, `tour:forfeit`, `match:abandon`, `boost:burn`, `treasury:bb`).
- Protocol-fee legs use `transferWithMemo` with `match:fee` / `market:fee` tags.
- Public dashboard: circulating supply = `totalSupply()` on-chain; burned = Σ burn events; play remaining = distributor balance.
- Memo taxonomy indexed in `chips_events` for product analytics — indexer joins `Memo` to its parent via `(txHash, logIndex - 1)` and stores both `memo_bytes32` and human `tag`.

### 5.5 Deflation philosophy

Chips is **not** a pure deflationary meme. The goal is:

> **Sinks + burns keep pace with play emissions so competitive CHIPS retains meaning.**

Match protocol fees fund treasury (runway, esports). Burn reduces float. Play rewards fund engagement. Liquidity bucket waits for real demand — we do not print to fake volume.

---

## 6. Pull-based claims (full stack)

**Invariant:** clients never receive CHIPS pushed from a privileged hot wallet for gameplay outcomes.

| Reward type | Contract | Player action |
| --- | --- | --- |
| Match prize | MatchPool / ClaimHub | `claimMatch` or `claimAll` |
| Pool refund (cancel) | MatchPool | `refundJoin` |
| Daily / weekly missions | MissionClaim | Sign in → `claimMission` |
| Social (poke/referral) | MissionClaim voucher | `claimVoucher` |
| Season rank | SeasonClaim merkle | `claimSeason(epoch, proof)` |
| Tournament prize | Tournament pool | `claimMatch` / `claimAll` |
| Prediction win | Predict pool | `claimMatch` |
| Partner grant | Partner distributor | `claimGrant` |

### 6.1 Mission claims (on-chain)

Progress stays in Supabase (play counts, wins, pokes). Payout is a **voucher**:

```text
Server (service role) issues EIP-712 voucher:
  domain: { name: "LudoBase MissionClaim", version: "1", chainId, verifyingContract: MissionClaim }
  message: { chainId, wallet, missionId, amount, periodId, deadline, nonce }
  sig: opKey (rotated; on-chain registry below)

User wallet calls MissionClaim.claim(voucher) (wallet tx with builder-code suffix)
Contract:
  - verify op signature against the ON-CHAIN signer registry (multisig-rotatable; EOA + 1271/6492 path)
  - require block.timestamp ≤ deadline (vouchers expire — rotation actually invalidates the unredeemed)
  - replay-guard: consumed voucher-hash registry ONLY — used[keccak(chainId, contract, wallet, missionId,
    periodId, amount, nonce)] (one primitive, explicit; no ambiguous period-key fallback)
  - require period issuance ≤ on-chain per-period ceiling (consistent with section 5.3 caps)
  - transfer CHIPS from MissionClaim budget
  - emit MissionClaimed + Memo(keccak("mission:claim"))
```

Custody: the signer registry holds N op-keys with per-key scopes; rotation = on-chain `setOpKey` (multisig + timelock section 8.10) that simultaneously revokes the old key — server-side revocation lists alone do not revoke on-chain. Incident procedure: rotate key, publish revoked-key list, expired-deadline vouchers die on their own. The voucher-issuing server waits N confirmations (section 8.6 thresholds) on paid-join proofs before minting — a reorged join must never mint a voucher.

Daily mission amounts remain small (tens of CHIPS), weekly larger, premium streak larger still — all inside season budget **and** per-wallet daily/weekly caps (section 5.3). Paid-match missions require **on-chain join** events (indexer), not self-reported lobby state.

### 6.2 Season claims

```text
End of season:
  ops builds merkle leaves (chainId, SeasonClaim contract, epoch, wallet, amount)
  leaves published to IPFS + N-hour public challenge window (e.g. 48h)
  root set by multisig + timelock (section 8.10); epoch frozen on activation —
  no root replacement after claims open, ever
  UI shows projected amount from off-chain rank

User: claimSeason(epoch, amount, proof)
  → contract checks claimed[epoch][wallet] == false, verifies proof against the frozen root
  → pull CHIPS
  → optional badge mint later
```

Leaf binding (`chainId` + contract + epoch) kills cross-epoch and Sepolia/mainnet proof replay. The root setter is custodian of the whole epoch budget: malicious-root rug needs no front-running, so the setter is multisig + timelock + public leaf window by rule, not by ops discipline.

RXP tiers drive amounts (same progression spine as today: Bronze → Arena Master).

### 6.3 Claim UX rules

1. Show **gross claimable**, **gas estimate**, and **net**.
2. One primary CTA: **Claim all available**.
3. Secondary: claim single match.
4. Never require a claim to play free tables.
5. Guests: can view; claims wallet-walled (existing GuestWall).
6. SIWE app session for API session work; **token claim itself is a wallet tx with builder-code attribution**.
7. Every claim/join/market tx goes through the wagmi `dataSuffix` config (section 8.7) — no unattributed sends.

---

## 7. Gamification (single-currency)

Keep LXP/RXP as **skill identity**. CHIPS is **economic identity**.

### 7.1 Loop

```text
Free online / AI → RXP + mission PROGRESS only (no CHIPS for free-only accounts)
       ↓
First paid join (or welcome grant if product ships one) unlocks mission CHIPS
       ↓
Paid pool (visible pot) → win → claim now or later via ClaimHub
       ↓
Paid-volume floor maintained (e.g. ≥1 paid join/week) → daily/weekly mission CHIPS
       ↓
Climb RXP + paid volume → season merkle claim (rank ∧ paid-volume eligibility)
       ↓
Spend: marketplace / boosts / tournaments / vanity (burns fire)
       ↓
Tournaments & ranked high-stakes → bigger pools → bigger claims
```

> **Loop invariant:** free-only accounts earn **RXP and cosmetics progress**, not CHIPS mission payouts. **Welcome grant = 50 CHIPS one-time** (Phase-0 locked) is the only free→CHIPS bridge until the first paid join; it is not open daily missions.

Offline/AI = practice only.

### 7.2 Mission design (pull payouts)

| Tier | Examples | CHIPS (indicative) | Cadence |
| --- | --- | --- | --- |
| Daily free | Play 3, Win 1, Capture 2, Login | 20–80 | Daily pull |
| Daily social | Poke back (capped) | 20 | Daily |
| Weekly | 5 paid wins, 1 tournament entry | 200–800 | Weekly |
| Season | Rank thresholds | see ladder | End of season |
| Achievement | First blood, 100 captures | one-time | Claim |

Paid-match missions require **on-chain join** events (indexer), not self-reported lobby state — reduces farming. All mission/season payouts additionally respect per-wallet daily/weekly caps (section 5.3).

**Anti-Sybil rules (freeze-committed, not slogans):**
- Wash-trade break-even: a 1v1 self-match cycle costs ≈7% fees+burn while manufacturing "paid wins" + volume score. Missions counting paid wins require **≥N distinct opponents per period** (e.g. 5) + minimum ELO/activity floor — repeat-pairing graphs and stake-cycling velocity are monitored off-chain, and the scorer authorization (section 4.8) withholds eligibility on detection.
- Poke loops: mutual-poke detection (A↔B same-period pairs pay once, capped); referral rewards have a per-referrer ceiling + referee-uniqueness proof (one reward per verified wallet, ever).
- Daily mission redemption itself requires a paid-volume floor (even tiny, e.g. 1 paid join/week) — free-only farms earn RXP, not CHIPS. **Welcome grant (Phase-0 locked): ship 50 CHIPS** — one-time from play budget at first wallet link + first free online match (not a recurring faucet). Amount + rule live in `TOKEN_PARAMS.md`.
- Season ladder headcount model: each tier publishes **floor + max-claimants** before S1 locks (e.g. Diamond: floor X paid-volume, ≤N claimants). The S1 400M budget is allocated across tiers × headcount, not vibes.

### 7.3 Ranked seasons

| Item | Design |
| --- | --- |
| Length | 3 months (align `season_id`) |
| Reset | Soft reset 30% RXP |
| Economy | Paid ranked uses MatchPool; free ranked = RXP only |
| Season claim | Merkle from Playing Rewards budget. Eligibility = rank tier **and** paid-pool volume floor (rank alone is farmable — ~10–25 days of dailies ≈ Bronze at the S1 ladder below). Publish the floor per season. |
| Titles | Off-chain + optional B20 extraMetadata / future badge |

Indicative season claim ladder (S1 Sepolia calibration):

| Tier | CHIPS |
| --- | --- |
| Bronze | 500 |
| Silver | 1,500 |
| Gold | 4,000 |
| Platinum | 9,000 |
| Diamond | 20,000 |
| Arena Master | 50,000 + exclusive cosmetic |

### 7.4 Marketplace (on-chain spend + burn)

| Item class | Pay | Burn | Notes |
| --- | --- | --- | --- |
| Common cosmetics | CHIPS | market burn % | Equip themes/dice/tokens |
| Rare / legendary | CHIPS | higher burn % | Limited supply windows |
| Collectibles | CHIPS | burn + treasury | Later ERC-1155 optional |
| Boosts | CHIPS | boost tax | LXP only, no dice odds |
| Vanity | CHIPS | vanity burn | Names, frames |

**CHIPS catalog price band (Phase-0 draft — Phase 2 may tune, published before launch):** after legacy conversion (100 coins = 1 CHIPS), old 100–2,000 coin items become ~1–20 CHIPS — **too cheap to matter**. Draft band: common **50–200**, rare **500–2,000**, legendary/prestige **5,000–50,000**, boosts **100–1,000**, vanity **200–5,000**. Aligns with Standard stake (1,000) so cosmetics compete with stake for attention. Written into TOKEN_PARAMS before marketplace build.

Purchase flow: EIP-5792 batched `approve + Marketplace.buy(listingId)` via `useSendCalls`
(EOA permit fallback) with builder-code attribution → fee + burn + treasury split in one tx.
Burn leg uses `burnWithMemo(keccak("market:burn"))` from Marketplace custody.

Authorities: marketplace fee-split parameters change only via Treasury-multisig + timelock (section 8.10); listing/curation policy (what may list, takedown rule) is published pre-Phase-2 and enforced by a named curator key with revocation.

### 7.5 Tournaments

Existing SQL tables stay for **bracket operations**. Economics go on-chain:

- Entry pulled into tournament pool
- Visible prize pool on Arena tab
- Results signed by tournament authority (named key/threshold + timelock in section 8.10; bracket outcomes feed the same dual-sign settle path as pools)
- Winners pull individual claims

### 7.6 Spectator / Arena

- Low-stakes predict can still use match pool sibling
- All CHIPS
- Same settle authority + 3s window (ADR-001) **with on-chain entry cutoff** (section 4.10)
- Winning predictors pull claims
- Protocol burn on predict gross

### 7.7 Onboarding track (1K core + gated extended tracks)

New players earn a **1,000 CHIPS core package** — never a lump sum for signing up, always tranched across gated milestones. Gameplay pays first; social pays last (Galxe outages must never block earnings).

#### Core package (1,000 CHIPS, all one-time, `is_claimed`-locked per wallet)

| Order | Track | Milestones | CHIPS | Verified by |
| --- | --- | --- | --- | --- |
| **A. Tutorial** | Finish interactive tutorial (all lessons, incl. one practice capture + one home-stretch finish) | **100** | Server-side tutorial progress flags |
| **B. AI gauntlet** | Finish one AI match in **each** mode: Classic, Power, Snakes | 3 × 100 = **300** | Online-recorded match (`/api/match/record` with matchId); min ≥15 turns + ≥5 min duration; loss counts, quit/AFK-forfeit doesn't |
| **C. First Blood (PvP)** | Complete first online multiplayer match | **150** (100 finish / 150 win) | Match record + participant check |
| **D. Playtime** | 60 cumulative minutes in completed online matches | **150** | Server match durations (forfeited/AFK-struck matches excluded) |
| **E. Social (Galxe)** | Follow X · Like + repost quest tweet · Join Discord + verify role · Galxe Passport verified | 4 × 75 = **300** | Galxe quest completion via custom API credential callback |

**Anti-lockout rule:** Track E unlocks as soon as A is done — it sits last in the checklist but runs in parallel, so a Galxe verification outage never blocks gameplay earnings. Users bank up to 700 and claim the 300 when Galxe recovers.

**Day-2 / Day-3 free-match eligibility (hygiene):** the return streak requires **any completed online match that day** (free online, paid, or tournament) — free online is enough; Offline/AI alone does **not** count (stays consistent with section 3.2). One wallet, one Day-2 and one Day-3 reward, lifetime.

**AI carve-out (fenced):** section 3.2 bans CHIPS for offline/AI play; onboarding is the single sanctioned "capped online claim" exception. Track B matches must be **online-recorded** (server matchId, duration/turn floors) — pure-local bot-farming earns nothing.

**Package expiry:** 30 days from wallet-first-seen. Bounds liability, kills dormant-wallet farming.

#### Extended tracks (global gate: own 1K core complete)

No extended-track reward is earnable or claimable until the user's own core package is fully claimed. Progress may accrue, but **claims stay locked behind the core-complete flag**:

| # | Track | Payout | Rules |
| --- | --- | --- | --- |
| 1 | **Referral kicker** | 50 per successful referee for the first 10 successes (= 500), then 10 per success; 5,000 slots per user (max 50,400/user) | A referee counts as successful only on completing their full 1K core + Passport verification. See slot engine + dashboard below. |
| 2 | **Day-2 / Day-3 return** | Day-2: **50**, Day-3: **100** (consecutive days, ≥1 match each) | Streak days counted from core-completion day (Day 1 = completion day), so slow onboarders are never punished; streak resets on a miss; each wallet earns once |
| 3 | **Friend + DM** | 10 per friend-add or first-DM conversation, capped at 10 actions (**100 max**) | Friend must accept (no self-adds, no duplicate pairs); DM needs ≥1 message each way. |
| 4 | **Clan join** | **100** | Join a partner guild's cup lobby (partners budget converts to acquisition; Phase-2 surface). |

All extended tracks are one-time per wallet, voucher-issued under section 6.1 (EIP-712, consumed-hash guard, 30-day deadlines), and count toward season accounting.

#### Referral slot engine (5,000 slots/user, consumed on link)

- **Reserve = consume:** a slot is permanently consumed when a referee links the referrer's code/invite (at onboarding start, before core). Linking never pays, and dead referees **eat cap** — incomplete, expired, or flagged referees never free the slot. Referrers should invite people who will actually finish.
- **Resolve successful:** referee completes full 1K core + Passport → payout tier by success order (first 10 successes = 50 each, 11th+ = 10 each). Earnings accrue to a claimable referral balance (voucher path, pull-based). Non-completing referees resolve as unsuccessful with no payout and no refund of the slot.
- **Dashboard** (`GET /api/referrals/dashboard?wallet=`, cached read): two numbers — **successful count** (completed 1K core) and **unsuccessful count** (linked but not completed: in-progress + expired + flagged) — plus slots remaining of 5,000 and a claim button for matured earnings. Nothing more.

```text
referral_links (
  referrer_wallet, referee_wallet, code,
  status text,            -- pending | successful | unsuccessful
  tier_paid int,          -- 50 | 10 | null
  claim_tx text,
  created_at, completed_at,
  unique (referrer_wallet, referee_wallet)
)
```

#### Galxe integration

- Galxe Space "Ludo Base": native quests (X follow / like / repost, Discord join + role verify) plus **custom API credentials** Ludo exposes for tutorial / AI-per-mode / playtime / PvP / core-complete / referral-success.
- Galxe Passport (humanity-score threshold) + minimum X/Discord account ages required before any Track E or referral payout.
- **OAT issuance is non-transferable / soulbound (Strix M5).** If Galxe cannot enforce soulbound OATs for a collection, **do not** use that OAT as Sybil identity input — drop the claim and rely on Passport + scorer only. Tradable OATs are collectible flair at most.
- **Callback authenticity (Strix M4):** Galxe → Ludo webhooks must verify **HMAC shared-secret over the raw body** (or Galxe-signed payload if provided) + timestamp nonce + replay cache. Unverified callbacks are ignored (fail-closed). Shared secret lives in the Edge/server secret store only.
- **Galxe outage fallback:** Track E is already parallel (never blocks A–D). For **extended** Galxe downtime (>24h), open a **manual review queue** (ops form + screenshot/X proof) to complete Track E at the same 75×4 amounts, rate-limited and scorer-gated; queue drains when Galxe returns. Galxe remains a single point of delivery, not a single point of lockout.
- One OAT per completed track (A–E + referral tier-up) — soulbound OATs may serve as Sybil-resistant identity input for future seasons; transferable ones may not (see above).

#### Budget (50k-user gate)

| Line | Math | CHIPS |
| --- | --- | --- |
| Core packages | 50,000 × 1,000 | **50.0M** (hard sub-ceiling, FCFS counter in UI) |
| Referrals | ~20% refer ~3 avg × 50 (tail bounded by 10/success rate) | ~1.5–2.0M |
| Day-2/Day-3 | 40% hit Day-2 × 50 + 25% hit Day-3 × 100 | ~2.25M |
| Friend/DM | ~60% avg 3 actions × 10 | ~0.9M |
| Clan join | ~30% × 100 | ~1.5M |
| **Total ask** | | **~56–57M → 60M S1 sub-ceiling** |

60M = 15% of S1's 400M. The FCFS cap + circuit breaker pause issuance past the ceiling instead of breaching the budget; the season ladder (section 7.3) is sized against ~340M net of onboarding at full uptake.

#### Onboarding KPIs

Funnel completion per track (A→E drop-off), referral slot conversion (successful / reserved), cost-per-activated-user in CHIPS, Sybil reject rate (Passport fails + scorer denials + flagged slots), D7 retention lift of core-completers vs non-completers. If completion collapses past Track B, the tutorial is the problem, not the rewards.

---

## 8. Technical architecture

### 8.1 B20 create (Chips) — `base-std` encoders, `base-forge` toolchain

> Toolchain: `base-forge` / `base-cast` / `base-anvil` (B20-aware Foundry build).
> Standard `forge` cannot simulate calls to precompile addresses and aborts with
> `call to non-contract address`. Deploy scripts import `base-std`
> (`B20Constants`, `B20FactoryLib`, `IB20Factory`, `StdPrecompiles`).

```solidity
// script/CreateChips.s.sol (base-forge)
import {Script, console} from "forge-std/Script.sol";
import {B20Constants} from "base-std/lib/B20Constants.sol";
import {B20FactoryLib} from "base-std/lib/B20FactoryLib.sol";
import {IB20Factory} from "base-std/interfaces/IB20Factory.sol";
import {StdPrecompiles} from "base-std/StdPrecompiles.sol";

contract CreateChips is Script {
    function run() external returns (address token) {
        address multisig = vm.envAddress("CHIPS_ADMIN_MULTISIG");
        address distributor = vm.envAddress("SEASON_DISTRIBUTOR");
        address matchPool = vm.envAddress("MATCH_POOL");
        address marketplace = vm.envAddress("MARKETPLACE");
        address securityMsig = vm.envAddress("SECURITY_MULTISIG");
        address opsMsig = vm.envAddress("OPS_MULTISIG");

        bytes32 salt = keccak256(abi.encode("ludo-base-chips-v1", block.chainid));
        // NOTE: salt embeds chainId — Sepolia and mainnet get DISTINCT token addresses.
        // NOTE: encoder takes (name, symbol, admin, decimals) ONLY — no supplyCap field.
        bytes memory params =
            B20FactoryLib.encodeAssetCreateParams("Chips", "CHIPS", multisig, 18);

        bytes[] memory initCalls = new bytes[](10);
        initCalls[0] = B20FactoryLib.encodeUpdateSupplyCap(10_000_000_000e18);
        // initCalls may grant MINT_ROLE to distributor ONLY for the bootstrap mint
        // of the full 10B; the SAME runbook revokes it before Phase-1 exit so
        // post-bootstrap assert is: MINT_ROLE holders == ∅ (never "distributor only").
        initCalls[1] = B20FactoryLib.encodeGrantRole(B20Constants.MINT_ROLE, distributor);
        initCalls[2] = B20FactoryLib.encodeGrantRole(B20Constants.BURN_ROLE, matchPool);
        initCalls[3] = B20FactoryLib.encodeGrantRole(B20Constants.BURN_ROLE, marketplace);
        initCalls[4] = B20FactoryLib.encodeGrantRole(B20Constants.PAUSE_ROLE, securityMsig);
        initCalls[5] = B20FactoryLib.encodeGrantRole(B20Constants.UNPAUSE_ROLE, securityMsig);
        initCalls[6] = B20FactoryLib.encodeGrantRole(B20Constants.METADATA_ROLE, opsMsig);
        initCalls[7] = B20FactoryLib.encodeGrantRole(B20Constants.OPERATOR_ROLE, securityMsig);
        initCalls[8] = B20FactoryLib.encodeUpdateContractURI("https://ludobase.xyz/token/chips.json");
        initCalls[9] = B20FactoryLib.encodeUpdateExtraMetadata("game", "ludo-base");
        // NEVER granted: SEIZE_ROLE, BURN_BLOCKED_ROLE (assert both absent post-deploy).
        // OPERATOR granted SOLELY for announcements; multiplier stays pinned at 1× forever —
        // no scheduled/instant updates, ever; deploy script asserts multiplier == 1×.
        // TreasuryRouter is intentionally absent from BURN_ROLE (it receives protocol fees; it does not burn).

        vm.startBroadcast();
        token = StdPrecompiles.B20_FACTORY.createB20(
            IB20Factory.B20Variant.ASSET, salt, params, initCalls
        );
        vm.stopBroadcast();
        console.log("CHIPS B20:", token); // expect 0xB200… prefix
    }
}
```

Bootstrap allocation (same deploy runbook, `section 8.8`): mint full 10B once (bounded by the
cap above); allocate 2B liquid per section 2.1 (600M play → SeasonDistributor, 500M treasury,
400M vesting, 300M liquidity seed, 200M partners); transfer 8B to the freshly deployed
`SupplyLocker` (per-bucket accounting initialized in the same run); **revoke `MINT_ROLE`
from every address (distributor included)** — `MINT_ROLE` holders = ∅ after bootstrap —
then execute the section 8.1b end-state. Playing Rewards then **draw down** unlocked budget from
the distributor’s pre-minted balance plus locker top-ups — **never new mint**. There is
no burn-and-remint path.

### 8.1b Admin end-state — exact ordered transaction list (freeze-committed)

"Cap-lock" is not a B20 primitive. Immutability comes from this exact sequence — every step timelocked (section 8.10) and announced, verified by a post-deploy assert script:

1. `setRoleAdmin` map: assign each role's admin to the timelock contract (no EOA remains role-admin of anything). Publish the full role→admin→timelock-delay table.
2. Route all future admin-gated calls (`updateSupplyCap`, `grantRole`, `revokeRole`, `updatePolicy`, metadata, OPERATOR announces) through the timelocks. Direct multisig admin calls are disabled by step 1.
3. Assert: `supplyCap() == 10_000_000_000e18`, `SEIZE_ROLE`/`BURN_BLOCKED_ROLE` holders == ∅, multiplier == 1× with no scheduled updates, **`MINT_ROLE` holders == ∅** (full 10B pre-minted; distributor is a budget holder, not a minter), `totalSupply() == 10_000_000_000e18`.
4. Decision — `renounceLastAdmin()`: renouncing makes the cap (and everything admin-gated) **permanently immutable**, including policy updates (geo gating added later becomes impossible) and `revokeRole` (a compromised pool/market `BURN_ROLE` could never be disarmed). Therefore: **do NOT renounce before mainnet policy is final**. Until renounce, admin trust = the multisig set + thresholds + timelocks in section 8.10, published and monitored. The renounce decision (with its freeze trade-offs) is a Phase-4 gate item, not a bootstrap step.
5. Ongoing monitoring: `updateSupplyCap` calls, role grants, `updateName` (rotates the EIP-712 permit domain — outstanding permits brick; renames require a re-issuance window), and multiplier reads are watched with alerts; any deviation from the end-state asserts pages.

Geo/eligibility policy ordering consequence: because renounce would freeze `updatePolicy`, the PolicyRegistry design (sender/executor-scope only — never receiver-scope, which would trap winners' claims) must ship *before* any renounce. See section 8.10.

### 8.2 Settlement trust model (do not regress)

From project AGENTS.md, still binding:

- 2v2 teams via `TEAM_PAIRINGS`
- Engine math for legality
- Edge `roll-dice` / `move-auth` / match sessions
- `/api/match/record` signature-gated; no free-form client payout
- `resolve-bet` host-signed + `live_matches.host_address`
- RLS locks on player money columns
- DMs ECDH

**New binding rules:**

1. MatchPool settle verifies **EIP-712 `ChipsMatchSettle`** (not personal-sign text) with chain-gated domain (`chainId` + `MatchPool` address), **dual-signed host + Edge from day one** (Sepolia included). Off-chain match-record/bet-resolve text signatures stay off-chain.
2. `payoutPlan` canonical encoding (ordered addrs, amounts, `chainId`, `poolId`, `nonce`) must hash to `resultHash` (audit field); `sum == prizeFund`; 2v2 sets must satisfy `TEAM_PAIRINGS` via `seatColors` with exact equal-split; winners ⊆ seats; `signer == pool.authority == message.authority`; `deadline` enforced; `settleNonce` consumed.
3. Clients cannot call a privileged `pay(player)` — only `claim*`.
4. Indexer never writes CHIPS balances to Postgres as truth; only cache. All amounts `numeric` (never `bigint`) with reorg-safe upsert on `(chain_id, tx_hash, log_index)`.
5. `check:engine` / engine tests unchanged; pool logic tested in `base-forge` (B20 mocks from `base-std/test/lib/mocks` for unit tests, `base-anvil` fork for integration).
6. Free offline play never hits pool contracts.
7. **Dual-chain auth:** Phase 1 accepts `84532` (Base Sepolia); mainnet adds `8453`. Every signature path (SIWE, match session, move/power, settle, vouchers) validates `chainId` explicitly — the current 8453-only gate must be lifted for Sepolia first. `poolId` commits to `chainId` (no cross-chain replay).
8. **RPC discipline (Base skill):** production RPC via dedicated provider or self-hosted Reth, proxied through backend — never public endpoints in prod, never API keys client-side.
9. **Join-UX chain rule:** pool economics are read from chain pre-approve (section 4.2b); cache-vs-chain mismatch reverts the flow.
10. **Pause matrix** (section 8.10): TRANSFER-pause freezes joins+claims+refunds+market (victims' exits included — pausing to stop fraud has a cost); MINT-pause freezes distributor top-ups; voucher issuance and root updates have their own freeze switches with named callers.

### 8.3 Database (indexer cache)

Migrations under `supabase/migrations/`:

```text
chips_pools (
  pool_id text pk,
  match_id uuid,
  room_code text,
  game_mode text,
  entry_fee numeric,
  max_seats int,
  filled_seats int,
  status text,
  gross numeric, protocol_fee numeric, burn numeric, prize_fund numeric,
  chain_id int, tx_create text,
  settled_at timestamptz, settle_tx text,
  result_hash text,
  updated_at
)

chips_pool_seats (
  pool_id, seat_index, wallet_address,
  join_tx, entry_amount, credited_amount, claimed_tx,
  primary key (pool_id, wallet_address)
  -- pool_id commits chainId (section 4.4), so cross-chain collision is impossible by construction
)

chips_claimable (
  wallet_address,
  source text,           -- match | mission | season | social | tournament | legacy
  ref_id text,           -- poolId | mission key | epoch | legacy-snapshot-id
  amount numeric,
  status text,           -- credited | claimed (no `expired` in v1 — prizes never expire; expiry states arrive only with a plan revision)
  claim_tx text,
  credited_at, claimed_at,
  unique (wallet_address, source, ref_id)
)

chips_events (
  chain_id, tx_hash, log_index,
  event_name, wallet_address, amount, memo_bytes32, memo_tag,
  payload jsonb, ingested_at,
  unique (chain_id, tx_hash, log_index)
)

chips_mission_vouchers (
  wallet_address, mission_id, period_id, amount,
  signature, claimed_tx, created_at,
  unique (wallet_address, mission_id, period_id)
)
```

Deprecate economic writes to `players.coins`. Keep column briefly as mirror + migration flag `coins_source='legacy'|'chain_cache'`.

> **Legacy conversion economics (frozen at spec freeze):** legacy `players.coins` balances convert to CHIPS at **100 legacy = 1 CHIPS**, paid from a **capped 50M CHIPS conversion pool drawn from Treasury** (never from the 3B play budget, never new mint — Treasury pre-holds it at bootstrap). Claim window: **90 days from Phase-1 launch**, pull-based (`claimLegacy` with the legacy-balance snapshot root); unclaimed pool reverts to Treasury on expiry. This is a haircut on whale/paper balances by design (10B CHIPS vs uncapped legacy issuance); the rate, cap, and window are published before Phase 1 and never adjusted after. **Snapshot integrity (hygiene):** the legacy-balance Merkle root is **published (IPFS + TOKEN_PARAMS) with a 7-day challenge window** before claims open; root is frozen after that window (same discipline as SeasonClaim). `coin_ledger` writers are enumerated and frozen alongside (`cash_out_bet`, `settle_match_bets` coin path, `purchase_marketplace`, tournament coin deduct — grep all `coins` writers before the flag).

> Cutover (feature-flagged): freeze legacy writers → backfill `coins_source` flag → open conversion window → UI reads chain/indexer only → RLS denies client coin writes (smoke test). See section 12.

### 8.4 API surface

| Route | Role |
| --- | --- |
| `GET /api/chips/balance?wallet=` | Cached on-chain balance + claimable sum |
| `GET /api/chips/pools?status=` | Lobby pool cache |
| `POST /api/chips/pool/prepare` | Build join calldata + permit payload **+ builder-code suffix** |
| `POST /api/match/settle/propose` | Build EIP-712 settlement for authority (chain-gated) |
| `GET /api/chips/claimable?wallet=` | ClaimHub mirror |
| `POST /api/missions/voucher` | Session-gated mission voucher |
| `GET /api/chips/season/:epoch/proof` | Merkle proof |

All POSTs that move value return **unsigned tx payloads** for the wallet; server never holds player keys.

### 8.5 Frontend

| Area | Change |
| --- | --- |
| Header | CHIPS balance (chain) + **Claimable** badge |
| GameLobby | Free vs Paid; paid shows pool card + batched **Approve & Join** (EIP-5792, one approval); **Mainnet hard-filters/hides stake tiers < 1,000 CHIPS** to protect against gas-negative churn |
| Match end | Win: Dispute countdown timer (`claimUnlockAt - now()`), CTA disabled until unlocked; Claim now / Later; Gross / gas / net estimates + builder-code attribution · Loss: receipt + gas note |
| Arena | Live pools, spectator entry (on-chain cutoff), post-settle claims |
| Marketplace | Batched approve+buy + burn visible + attribution |
| Missions | Progress off-chain · **Claim** wallet tx (attributed) |
| Profile/Season | Rank + season claim window |
| Settings | Token address, B20 factory, explorer links, burn dashboard |
| Terms/Privacy | Rewrite: virtual coins language removed; CHIPS utility on Base; testnet disclaimers |

### 8.6 Indexer job

Watch B20 + pool contracts on Base Sepolia (dedicated RPC, backend-proxied — never public endpoints in prod):

1. `PoolCreated`, `PoolJoined`, `PoolLocked`, `PoolSettled`, `PrizeClaimed`, `ChipsBurned` (+ `Memo` joined via `(txHash, logIndex-1)`), `MissionClaimed`, `SeasonClaimed`
2. Idempotent upsert into `chips_events` / caches on `(chain_id, tx_hash, log_index)` with backfill cursors (cursor durability: last-finalized-block persisted per chain; backfill window covers reorg depth × 3)
3. Reorg handling: confirmations threshold per env (**Base Sepolia/mainnet: 12 blocks ≈ 24s; vibenet: 25 blocks ≈ 5s**) + rewind/replay on reorg; paid-match start requires confirmed `funded` seats (never unconfirmed head). The voucher server applies the SAME thresholds to paid-join proofs before minting — a reorged join must never mint a voucher.
4. Alert if ClaimHub-view sum ≠ chain reads beyond ε (published threshold, e.g. >0.1% or >10k CHIPS absolute) — **and act**: ε-breach freezes voucher issuance and new pool creation (existing claims/refunds keep working) until reconciled. An alarm nobody must obey is decoration.
5. Rebuild lobby pool list for matchmaking UI
6. Timing: explicit `pollingInterval ≈ 100ms` on receipt waits / block watches (viem defaults hide fast chains); indexer lag p95 is a KPI (section 11)
7. **Settlement pipeline & Edge co-sign monitor:** Match-end triggers an idempotent Supabase background task / retry queue for Edge co-signing (<15s target); pages/alerts on co-sign latency >60s, guaranteeing settle payloads are signed and cached well before the dispute window lapses.

### 8.7 Builder Codes — ERC-8021 attribution (Base skill, mandatory)

Every CHIPS transaction carries attribution. Missing suffix = silent, permanent loss of builder tracking/referral fees — no error is raised.

* Source a Builder Code once at `base.dev` → Settings → Builder Codes (do not re-register if `lib/builderCode.ts` exists).
* Stack: `wagmi` (config-level `dataSuffix`) + `viem >= 2.45` + `ox` (`Attribution.toDataSuffix`). Repo wiring: `lib/builderCode.ts` → `DATA_SUFFIX` in `app/Providers.tsx` (`createConfig({ dataSuffix })` covers `useSendTransaction`/`useWriteContract`/`useSendCalls`); EIP-5792 `sendCalls` passes attribution via `capabilities.dataSuffix` (a `sendCalls` wrapper injects it so no call site can forget). Smart-wallet txs are supported by Base analytics; EOA support follows (data preserved either way).
* `POST /api/chips/pool/prepare` returns calldata **plus** the suffix; client-level config is preferred over per-tx plumbing so no call site can forget it.
* Verification: `base.dev` Onchain → Total Transactions; explorer input-data tail (`8021` repeating, last 16 bytes); `builder-code-checker.vercel.app`.
* **Precompile suffix assumption (Strix M11):** trailing ERC-8021 calldata on **B20 precompile** calls is assumed ignored. That is a **Foundry assertion, not a premise** — Phase-1 test proves `approve`/`joinPool`/`claim*`/`burnWithMemo` with a non-empty `dataSuffix` still succeed on `base-anvil` and that the suffix does not alter the 4-byte selector match. If the precompile reverts on unknown trailing data, attribution on B20 token calls falls back to `transferWithMemo`/wrapper hops and TOKEN_PARAMS records the exception.
* Permanent rule (written to project `AGENTS.md`): never send a transaction without the builder-code suffix.

### 8.8 Deploy runbook (Base skill)

* Keys: `cast wallet import <account>` keystores only — never commit keys, never hardcode API keys (env / `foundry.toml` `${}` refs, `.env` gitignored).
* `foundry.toml`: `[etherscan] base-sepolia` + `base` URLs with `${ETHERSCAN_API_KEY}` (BaseScan key from basescan.org/apidashboard).
* Toolchain: `base-forge` / `base-cast` for all B20 txs; unit tests on `base-std` mocks, integration on `base-anvil`.
* Funds: CDP faucet (`base-sepolia`, `eth`) for deployer + test wallets; verify funding on sepolia.basescan.org before broadcasting.
* Deploy: `forge create … --rpc-url <dedicated-https> --account <keystore> --verify`; validate all shell inputs (contract path, rpc-url, account, api key) before constructing commands.
* Record: `docs/tokenomics/TOKEN_PARAMS.md` (factory salt per env, token `0xB200…`, pools, chain IDs, builder-code id, role-admin table, renounce decision).

### 8.9 Sessions & gas sponsorship (vibenet skill — Phase 1 interface, Phase 3 funding)

* The EIP-712 match session stays as the Phase-1 auth fallback. In parallel, prototype **EIP-8130 scoped session keys** (devnet `vibenet` chain `84538453`, `rpc.vibes.base.org` — 8130 is experimental and runs on vibenet only, not Base Sepolia): authorize actors with `tokenLimits` (CHIPS spend cap/period) + `callScopes` (e.g. `transfer` selector → `MatchPool` only), expiry on the actor, byte-identical binding at use time, read-back verification (`isActor`/`getConfigSequence`, never receipt logs). 8130 tooling currently needs the `chunter-cb/viem` fork (`feat/eip-8130-production`, `scripts/setup-viem-8130.sh`) until upstream `wevm/viem#5004` merges — pin this in `contracts/` docs and never ship the fork to prod.
* **ERC-8168 payer** design (hosted payer per env, `context.flow` per surface: `"pool-join"`, `"claim"`, `"market-buy"`): payer covers **gas only, never value** — entry fees/purchases still debit the user; sponsored value calls must be wallet-wrapped (`encodeWalletCalls`). Handle `mode:"send"` (`{ transactionHash }` return shape), budget rejections (`BUDGET_EXHAUSTED`/`SENDER_LIMIT_REACHED` with retry hints), and `actor is not bound` retries after first-tx deploys (`createChange` rides the first tx; `eth_getCode` decides).
* Until sponsorship is funded, claims show gross/gas/net with the user paying gas; gas-negative micro-tiers stay Sepolia-only (section 4.5).

### 8.10 Authority matrix + timelocks + pause matrix (freeze-committed)

Every money-adjacent authority named once — key/threshold/timelock, no orphans:

| Authority | Power | Key / threshold | Timelock |
| --- | --- | --- | --- |
| CHIPS admin (pre-renounce) | `updateSupplyCap`, `grantRole`, `revokeRole`, `updatePolicy`, metadata, OPERATOR announces | Admin multisig (signer set + threshold published at deploy) | 7d large / 48h standard |
| Security multisig | `pause`/`unpause`, OPERATOR announces (multiplier pinned 1×) | SecurityMultisig (distinct signer set from admin) | pause: immediate (incident); unpause: 24h |
| Treasury multisig | fee-tier tuning (section 4.5), liquidity unlock proposal, grants | Treasury multisig | 48h standard / 7d large |
| SeasonDistributor | epoch budget function only (coded; parameter changes timelocked) | contract (no EOA control) | parameter changes 7d |
| SupplyLocker | quarterly tranche releases iff section 2.2 gates pass | coded gates (no EOA control). **Top-up caller (hygiene):** only `SupplyLocker.release()` itself may push CHIPS into `SeasonDistributor` / Treasury / vesting / vault / partner distributor — a whitelisted `lockerRelease` function; no EOA `topUp` on the distributor. | pause immediate (SecurityMultisig); accelerate 14d announced timelock |
| Voucher op-keys | sign vouchers within on-chain ceilings | registry, multisig-rotatable | rotation immediate + old-key revoke atomic |
| Merkle root setter | set epoch root (once; epoch freezes after) | multisig | 48h + 48h public leaf window before activation |
| Claim scorer | sign claim-eligibility authorizations for **mission/season/partner play-rewards only** (never match prizes or pool refunds — section 4.8) | named scorer key, nonce-consumed; **mainnet: threshold or HSM** (single-key OK on Sepolia only) | rotation immediate |
| Tournament authority | bracket outcomes → dual-sign settle | named key/threshold | results final on settle |
| Partner oracle | release `claimGrant` against milestones | named oracle identity | per-release timelock |
| Edge co-signer | co-sign settles (Mode A) + **Edge-only Mode B settle after effective settleBy** + lobby tickets + authority rotations + abandon evidence (Edge-only = refund-only; dual = burn split) | **threshold/HSM on Sepolia and mainnet from day one** (Strix HIGH-2); key-separated from op-keys | signing-policy bound (attests poolId/winnerSet/planHash/seqRange/lobbyTicket/unresolvable only) |
| Host bond slash | on Mode B host-withhold timeout | coded in MatchPool (no EOA) | — |
| Upgrade admin (UUPS) | `upgradeToAndCall` on MatchPool / ClaimHub / MissionClaim / SeasonClaim / Marketplace / TreasuryRouter / SeasonDistributor / SupplyLocker | **ProxyAdminMultisig** (distinct from Admin/Security/Treasury) | **7d upgrade timelock**; post-audit optional `upgradeTo` to an immutable stub (upgrade-renounce) per section 8.1c |
| Marketplace curator | listing policy, takedowns | named curator key, revocable | takedown immediate, fee changes 7d |
| `windowClosedAt` writer | none — committed at predict-pool creation, immutable; **bounded at creation** (section 4.2b) | — | — |
| Security `attestUnresolvable` | last-resort Edge-down unstick of refunds | SecurityMultisig | only after Edge SLA (e.g. 30 min past effective settleBy); announced |

Pause matrix (pausing to stop fraud also freezes victims' exits — priced in):

| Pause | Freezes | Unfreezes via |
| --- | --- | --- |
| TRANSFER | joins, claims, refunds, marketplace buys. **`settleBy` auto-extends by pause-delta** while TRANSFER is paused (settle path also needs transfers for fee/burn legs) | 24h-timelocked unpause; max-pause SLA published (e.g. 72h) then automatic review |
| MINT | distributor top-ups from locker, batchMint (dead after bootstrap) | same |
| BURN | settle's burn leg → full `settlePool` reverts while paused (credits are recorded before burn in step order, but the tx reverts wholesale — no partial settle). **`settleBy` auto-extends by pause-delta (section 4.3)** so pause ≠ refund conversion | same |
| Voucher issuance | `MissionClaim` funding + voucher server | named caller, immediate |
| Root updates | `SeasonClaim.setRoot` | epoch freeze is permanent |

Geo/age enforcement point (committed): eligibility is enforced at **sender/executor scope only** (`TRANSFER_SENDER_POLICY`, `TRANSFER_EXECUTOR_POLICY`) — never receiver scope, which would trap winners' claims and refunds. Policy admin = named in the matrix above with update timelock; oracle method (how chain knows jurisdiction/age) specified before mainnet value. Until the oracle exists, geo-gating is testnet-honor + legal gate, not an on-chain claim.

### 8.1c Upgradeability matrix (Strix HIGH-4 — no unnamed upgrade key)

| Contract | Pattern | Upgrade admin | Upgrade timelock | Post-audit |
| --- | --- | --- | --- | --- |
| `Chips` (B20) | **Immutable implementation** (precompile). Role/policy/supply admin is the B20 admin path (section 8.1b) — **not** a Solidity proxy | — | — | `renounceLastAdmin()` Phase-4 gate |
| `MatchPool` | **UUPS** | ProxyAdminMultisig | 7d | Prefer `upgradeTo` → immutable stub after external audit |
| `ClaimHub` | **UUPS** | ProxyAdminMultisig | 7d | same |
| `MissionClaim` | **UUPS** | ProxyAdminMultisig | 7d | same |
| `SeasonClaim` | **UUPS** | ProxyAdminMultisig | 7d | same |
| `Marketplace` | **UUPS** | ProxyAdminMultisig | 7d | same |
| `TreasuryRouter` | **UUPS** | ProxyAdminMultisig | 7d | same |
| `SeasonDistributor` | **UUPS** | ProxyAdminMultisig | 7d | same |
| `SupplyLocker` | **UUPS** (gates coded; upgrade is emergency-only) | ProxyAdminMultisig | 7d | same |
| Vesting (OZ) | **Transparent proxy or immutable VestingWallet** at deploy | Vesting admin multisig | per OZ | no game-logic upgrades |
| Timelocks | Immutable delay; admin handoff only | named multisigs | n/a | — |

**Rules:** every implementation address + `proxiableUUID` is recorded in TOKEN_PARAMS at deploy. `upgradeToAndCall` events are monitored like `updateSupplyCap`. **There is no EOA upgrade key.** Renouncing upgrades (immutable stub) is an explicit Phase-4 decision per contract, not automatic.

---

## 9. Security & anti-abuse

| Risk | Mitigation |
| --- | --- |
| Fake settle / Edge outage | Dual-sign (host + Edge) Mode A before effective `settleBy`; **Mode B Edge-only settle after** (Strix HIGH-1); **`settlePool` permissionless**; `settleNonce` consumption + `deadline` + `signer == authority` + winners-⊆-seats + floor/dust equal-split + Edge lobby-ticket authority (HIGH-5); async Edge co-sign retry queue (<15s, alert >60s); refunds only on Edge-`unresolvable` / SLA attest — silent host cannot force refunds |
| Host signature withhold grief | Mode B Edge-fallback settle pays winners; optional `hostBond` slashed on withhold timeout; refund requires Edge unresolvable (HIGH-1) |
| Abandon burn on one key | **Edge-only abandon → 100% refund, no burn**; 50% burn requires dual-sign (HIGH-2); Edge threshold/HSM on Sepolia+mainnet |
| Upgrade rug | section 8.1c matrix: UUPS + ProxyAdminMultisig + 7d timelock only; no EOA upgrade key; optional post-audit upgrade-renounce (HIGH-4) |
| Double claim / batch reentrancy | Strict batch-level CEI: all touched credits zeroed across `MatchPool`, `MissionClaim`, `SeasonClaim` before any ERC-20 transfer; global `nonReentrant` on `ClaimHub`; `claimMatch`/`claimAll`/`refundJoin` consume one shared record; `ClaimHub` acts only via `MatchPool.claimFor` allowlist; unique `(wallet, source, ref)`; Foundry cross-path + forbidden-transition tests |
| Client mint | No client mint path; **`MINT_ROLE` holders = ∅ after bootstrap** (full 10B pre-minted; distributor only draws pre-minted budget); `batchMint` dead (M6) |
| Mint-cap change | Renounce-or-timelock end-state (section 8.1b); every admin call monitored; no down-only primitive claimed |
| Seize / rebase backdoor | `SEIZE_ROLE` + `BURN_BLOCKED_ROLE` never granted (deploy assert); `OPERATOR` multisig+timelock, multiplier pinned 1×, raw-balance discipline everywhere |
| Mission farm | EIP-712 vouchers with on-chain signer registry + revoke + per-period ceilings + deadlines + consumed-hash replay guard; paid-join proofs wait N confirmations; distinct-opponent minimums; poke/referral loop caps; **paid-volume floor (free-only = no mission CHIPS)**; Sybil-profitability model gates S1 budgets |
| Self-match exploit | Wash break-even analysis + distinct-opponent minimums + stake-cycling detection + paid-volume-weighted rewards (not slogans — section 7.2 rules) |
| Host collusion on pots | Dual-sign Mode A + **Edge-only Mode B settle** (HIGH-1); hostBond slash on withhold; effective `settleBy + pauseDelta + refundGrace`; pre-lock-only cancel; abandon burn only dual-signed (HIGH-2); slashing not in v1 beyond hostBond (accepted residual) |
| RLS regression | Chain is truth; Postgres money columns service-only cache; legacy writers frozen behind flag; conversion pool capped from Treasury |
| Pause abuse | Pause matrix with max-pause SLA + unpause quorum (section 8.10); TRANSFER-pause-freezes-claims stated; victims'-exit cost priced in |
| Permit phishing | Train users to check the **spender field** (B20 permit domain is the token's own `(name, version, chainId, token)` — MatchPool appears as `spender` in the message, not the domain); exact-allowance + short-deadline first-party defaults; batch-first UX so permit is rarely needed; frame-relay join-intent binding (Phase 3) |
| Missing attribution | Client-level `dataSuffix` + `sendCalls` wrapper + prepare-endpoint suffix + `AGENTS.md` permanent rule; verify on base.dev |
| Smart-wallet gaps | Batch-first join (permit is EOA-only); 1271/6492 verify paths on all signed routes; EIP-712 domains include `verifyingContract` where a verifier contract exists |
| Eligibility bypass | Reward-surface eligibility enforced on-chain (scorer-signed authorization), never UI-only; **match prizes/refunds are scorer-free**; geo scoped to sender/executor only (never receiver — would trap claims/refunds); named policy admins + timelocks |
| Regulatory | **Pre-freeze legal issue-spot** producing acceptance criteria (permitted/blocked geos, product adjustments per geo, age threshold + verification method, Phase-4 gate artifacts) — before Phase-1 build, not Phase 4; testnet first; age gate; no “investment returns” marketing; predict pools need their own sportsbook sign-off |

---

## 10. Roadmap

### Phase 0 — Spec freeze (v4.3 · Strix applied)
- Approve single-currency + B20 + 10B split + pool claim model
- Legal wording for utility token + testnet
- **Freeze gates (exit criteria for Phase 0 — all must be written down before any Phase-1 build):**
  1. Pre-freeze legal issue-spot with geo/product acceptance criteria (predict sportsbook called out separately)
  2. Sybil-profitability model at 22k/100k-wallet scale + **S1 budget decision** (lock 400M or reduce)
  3. **Stall-path:** **elected = automatic S2-draw reduction** (locked in v4.3). Treasury bridge only via superseding TOKEN_PARAMS decision; if used, repayment from **Treasury bucket**, never play rewards.
  4. Liquidity unlock thresholds: numeric KPIs + **named owner + date** in TOKEN_PARAMS
  5. `isActivated(ASSET)` read recorded in TOKEN_PARAMS
  6. **Mint end-state:** bootstrap runbook revokes all `MINT_ROLE`s; post-deploy assert `MINT_ROLE holders == ∅` and `totalSupply == 10B`
  7. **Pause/settleBy policy:** auto-extend by pause-delta (section 4.3) — already locked in this doc; copy into incident runbook
  8. **Scorer scope:** rewards-only (section 4.8) — already locked; copy into MissionClaim/SeasonClaim interfaces only
  9. **Predict deferral:** Phase 1 ships match pools only; predict join-policy + legal sign-off are Phase-2 **entry** criteria
  10. Marketplace CHIPS price-band **draft** (post-legacy-conversion scale) — even if tuned in Phase 2
  11. Welcome grant: **SHIP 50 CHIPS** (locked 2026-09-22) — see `TOKEN_PARAMS.md`

### Phase 1 — Base Sepolia foundation
1. Confirm B20 Asset activation on Sepolia via ActivationRegistry — **OPEN (deploy-time)**
2. ✅ Dual-chain auth (done): `lib/chains.ts` allowlist (84532/8453); SIWE + match-session + move-auth verify per-chain with cross-chain replay rejection (`scripts/chain-gate.test.ts`, `scripts/verify-6492-gate.mjs` parity gate). Smart-wallet path uses `SIWE_VERIFY_RPC_URL_SEPOLIA` on Sepolia. Builder-code `dataSuffix` in `app/Providers.tsx`.
3. `createB20` Chips via `base-forge` script (section 8.1) + allocation bootstrap (2B liquid + 8B `SupplyLocker`) + **revoke all `MINT_ROLE`s** + section 8.1b end-state txs (assert `MINT_ROLE holders == ∅`, `totalSupply == 10B`) — **script stub ready; broadcast OPEN**
4. ✅ Source: `MatchPool` (funds holder) + `ClaimHub` (router) + `MissionClaim` in `contracts/src/` — **deploy via `script/DeployGame.s.sol` OPEN**
5. ✅ `forge test` 10/10: join/settle/claim/burn/refund + Mode B bond slash + Edge-only abandon + dual-abandon burn + M9 + ticket/squat/fee-tier — **remaining:** pause-delta, gas benchmarks, B20+8021 suffix assertion
6. Indexer + pool cache — **OPEN**
7. ✅ Lobby paid join UX (`PaidPoolJoinButton` / `usePoolJoin` approve→join) + builder-code attribution — **EIP-5792 batch OPEN**
8. ✅ Post-match claim UX (`usePoolClaim` in `MatchStatsOverlay`) — **gas/net + countdown + `claimAll` OPEN**
9. Mission voucher claim — **contract only; API OPEN**
10. Paymaster **interface** design (section 8.9; funding stays Phase 3) + 8130 session-key prototype on vibenet — **OPEN**
11. Terms/settings copy (utility-token language + testnet disclaimers) — **OPEN**
12. Migrate `players.coins` to cache-only (feature flag + legacy-writer freeze) — **OPEN**
13. Onboarding track (section 7.7): tutorial flags, AI/PvP/playtime mission set, Galxe Space + API credentials + OATs, referral slot engine + dashboard, 60M sub-ceiling + FCFS counter

**Exit criteria:** Player funds a visible pool on Sepolia, match settles with dual-signed EIP-712 (Mode A) or Edge-only (Mode B), winner claims CHIPS after the dispute window, `bytes32`-memo burn visible on explorer, attribution verified on base.dev, **post-bootstrap `MINT_ROLE` holders == ∅**. Test gates: Foundry double-claim across paths + forbidden-transition table + seat-squat revert + dispute-deny + **M9 cancelled-refund immediate** + timeout-refund after `refundGrace` + **host-withhold Mode B + hostBond slash** + **Edge-only abandon full refund (no burn)** + pause-delta extension + reorg/ε handling + **B20+8021 suffix assertion**; per-entrypoint gas benchmarks published; scorer **not** required on `claimMatch`/`refundJoin` (negative test).

### Phase 2 — Full online economy
- **Entry gate (before any predict build):** predict join-policy spec (open/allowlist, min/max stake, not match `seatWallets`) + sportsbook legal sign-off from Phase-0 issue-spot
- Ranked paid queue + tiers (per-wallet caps enforced; scorer on season/mission only)
- Tournaments on-chain pools
- Spectator predict pools (on-chain entry cutoff, `poolKind` inside MatchPool)
- Marketplace batched buys + burns + attribution; **CHIPS catalog prices** from Phase-0 draft band
- Season 1 merkle claims from 3B budget draw (rank **and** paid-volume eligibility; scorer on SeasonClaim)
- Burn dashboard (bytes32 memos)
- Hide gas-negative tiers on mainnet lobby until paymaster funding (Phase 3)

### Phase 3 — Growth
- Farcaster frames joining pools (frame-wallet relay; batch-first, attribution intact)
- Creator cups / partner grants (milestone-gated `claimGrant`)
- Funded claim/join paymaster (ERC-8168, gas-only; `context.flow` budgets) + 8130 session keys → mainnet path
- Optional badges / collectibles

### Phase 4 — Base mainnet
- External audit (B20 integration + pools + claims + settle EIP-712 + TEAM_PAIRINGS + cross-path double-claim)
- Multisig + timelock on treasury/admin (active before value); renounce decision taken with section 8.1b trade-offs
- Skill-vs-chance legal opinion + geo/age-gate sign-off (acceptance criteria from the Phase-0 issue-spot)
- Dual-sign custody hardened (threshold/HSM — interface unchanged since Sepolia); Sepolia balances **do not** migrate as value (commemorative only; distinct factory salts per env back this at the address level)
- Liquidity unlock only against numeric thresholds (published in TOKEN_PARAMS with owner + date from Phase 0)

---

## 11. KPIs

| Metric | Healthy | Alarm |
| --- | --- | --- |
| Paid pool fill rate | Rising; p50 lock < 5 min | Pools stuck empty 24h+ |
| Claim rate (24h after settle) | 40–70% | <20% (abandoned claims) or ~100% instant (bot drain) |
| Burn / season emission | Trending up with volume | Near zero with high emissions |
| Free online retention | Stable after paid launch | Free mode dies |
| Avg CHIPS in open pools | Depth without deadlock | Dead capital (open > 48h unfilled) |
| Mission voucher abuse | Voucher reject rate < 1% | Spike after reward raise |
| Treasury runway | Funded by protocol fees | Fees zero, ops burn |
| Unlock utilization | Envelopes release as monthly drips on gated demand (utilization ≥75%; sink ratio decelerates, never blocks); dashboard reconciles locked/designated/circulating | Drips into idle wallets; envelopes paused >2 windows; reconciliation breaks |
| Offline share | Minority of sessions | Everyone hides in AI |
| Indexer lag p95 | < 30s behind head | > 5 min or ε-breach on ClaimHub-vs-chain |
| Settle latency, lock → settled (excludes dispute window) | p95 < 10 min | Stuck locked pools |
| Locked-but-unsettled pools | ~0 older than **effective** `settleBy + pauseDelta` | Any pool past effective deadline without timeout-refund (liveness breach) |

---

## 12. Immediate engineering checklist

**Status key:** `[x]` done · `[~]` partial · `[ ]` open  
**Last progress pass:** 2026-09-25 — **engineering track COMPLETE.** Real B20 E2E (create→join→lock→settle+burn→claim), 51/51 Foundry, tsc clean. Remaining `[~]` rows are **ops/external/mainnet** (not plan gaps): mainnet addresses + multisigs, Edge HSM, Mission op-key rotation, season propose/activate runbooks, legacy `--set-root` after 2026-10-02, Galxe HMAC secret, vibenet paymaster, legal/Sybil/liquidity gates. Section 12.1 Phase-1 testnet exit criteria are met.

- [x] Phase-0 freeze gates recorded in `docs/tokenomics/TOKEN_PARAMS.md` (11 gates: stall-path S2-cut LOCKED; welcome grant 50 LOCKED; scorer/mint/pause/predict/price-band LOCKED; legal issue-spot + Sybil model + liquidity owner/date + `isActivated` remain OPEN in that file before mainnet value / S1 final lock)
- [~] `docs/tokenomics/TOKEN_PARAMS.md` **deploy fill-in** — Sepolia B20 token + MatchPool/ClaimHub + smoke/claim txs recorded. **Still open:** mainnet addresses, factory salts, role-admin table
- [x] `contracts/` Foundry project (`foundry.toml`, `src/`, `test/`, `script/`, `DEPS.md`, `forge-std` + `base-std` installed). Use `base-forge` for B20 precompiles
- [~] Keystore deployer (`cast wallet import` / `mydeployer`), CDP faucet funding, dedicated RPC via backend — keystore live on this machine; dedicated backend RPC still ops
- [x] B20 create + bootstrap — `createB20` + 10B mint + `MINT_ROLE` revoked on Sepolia (`0xB200…d05B`); `GrantBurnRole` to MatchPool; env swapped to real CHIPS
- [x] `MatchPool` + `ClaimHub` implemented + tests — **51/51 Foundry** incl. `ForbiddenTransitions`, `MissionClaimTest`, `Host1271`, pause-delta, gas/suffix
- [x] Dual-chain auth: SIWE / match-session / move-auth accept `84532` (`lib/chains.ts`, `lib/sessionProof.ts`, `lib/walletVerify.ts`); builder-code `dataSuffix` wired (`lib/builderCode.ts` + `app/Providers.tsx`)
- [~] Settlement signer service (EIP-712 `ChipsMatchSettle` Mode A + Mode B) — **ERC-1271 host settle landed** (`MatchPool._verifyHost` + `Host1271.t.sol`). Still open: Edge HSM/threshold custody; ERC-6492 counterfactual (deploy wallet first)
- [~] Mission voucher path — contracts + smoke + ArenaPanel. **Sepolia B20 MissionClaim `0x01abff6c…`**. `SetOpKey.s.sol` added. Still open: rotate op-key off deployer EOA, registry/HSM, ceiling fill-in
- [~] Merkle season pipeline — contracts + tests + `buildSeasonLeaves.ts` wired to SeasonClaim `0x83ae…` (leafHash matches chain). `SetSeasonRoot.s.sol` + `propose-season-root.sh` added. Still open: DB-backed season export, fund budgets, 48h propose→activate ops run, claim UI mount
- [x] Indexer — `lib/chipsIndexer.ts` + `scripts/chips-indexer-worker.ts` (chunked getLogs → `chips_events`; live pull 9/9)
- [x] Lobby paid join UX — EIP-5792 batch-first (`useSendCalls` approve+join) + two-tx fallback
- [x] Claim UX — dispute countdown + gas estimate + Claim CHIPS; `useClaimAll` paginated ClaimHub
- [x] RLS static smoke — `node scripts/check-rls.mjs` clean (8 migrations)
- [x] Multi-winner / 2v2 settle — `useSettlePool.settleFromWinners` + `SettlePoolButton` (2v2 50/50, 4P 75/25)
- [x] Mission voucher live path — `MissionClaim` on Sepolia + `scripts/mission-claim-smoke.ts` + ArenaPanel voucher claim
- [~] Legacy conversion — **snapshot rebuilt 2026-09-25** for live LegacyClaim `0x140b790e…` (B20) root `0x44cb6fd4…`, challenge ends **2026-10-02**. Claim UI `MerkleClaimPanel` + `useMerkleClaim`. Still open: fund 50M CHIPS, `publish-legacy-root.sh --set-root` after challenge, public hosting of JSON in prod
- [~] Onboarding / Galxe — SQL + voucher + **API routes done** (`onboarding/progress|referral|claim`, `galxe/callback` HMAC, `OnboardingPanel` + tests). Still open: Galxe account/HMAC secret, game-side progress writers
- [x] Explorer + burn dashboard — `/burn` + `chips-indexer-worker.ts` live feed
- [~] 8130 / paymaster — **`lib/paymaster.ts`** (gas-only sponsor + ActorScope). Still open: vibenet prototype + funding
- [x] Watcher runbook — **`docs/ops/CHIPS_WATCHER_RUNBOOK.md`**
- [x] Smoke — engine tests (`npm test` 62/62) + Foundry suite + **real B20 Sepolia E2E 2026-09-25** (create/join/lock/settle+burn/claim)
- [x] Rewrite Terms section 1 economic language for CHIPS — **`app/terms/page.tsx` updated**

### 12.1 Phase-1 exit remaining (from section 10)

| # | Item | Status |
| --- | --- | --- |
| 1 | Live contracts on Base Sepolia | **DONE 2026-09-22** — MockChips + MatchPool + ClaimHub + MissionClaim + SeasonClaim + LegacyClaim; `setClaimHub` wired. Real B20 `createB20` still optional. |
| 2 | Edge settlement signer service + lobby-ticket issuer | **lib + APIs + host settle glue done**; HSM custody + multi-winner plans open |
| 3 | Indexer + settle pipeline (Mode A/B) | **Worker live** (`chips-indexer-worker.ts` → `chips_events`); settle pipeline glue done |
| 4 | Mission voucher API + legacy conversion + Terms copy | **API + LegacyClaim + Terms done** |
| 5 | Gas benchmarks + B20+8021 suffix assertion + pause-delta tests | **DONE** (`PauseDeltaTest`, `GasAndSuffix`, `MissionClaimTest`, `forge snapshot`) |
| 6 | E2E fund→settle→claim→burn on Sepolia | **DONE** — MockChips 2026-09-22 (`0xb2f1f27d…`). **Real B20 2026-09-25:** create/join/lock/settle(+`burnWithMemo` 40)/claim on MatchPool `0x879E…` poolId `0xde2d…`; claim `0xd4653204…` 1860 CHIPS to winner; supply 10B−40. See `TOKEN_PARAMS.md` B20 smoke progress. |

---

## 13. Decision log (v4.3 — freeze · Strix audit applied)

| Decision | Choice |
| --- | --- |
| Currency model | **Single: CHIPS only** |
| Offline/AI | Off-chain, zero CHIPS |
| Standard | **B20 Asset**, 18 decimals (`base-std` encoders; `base-forge` toolchain; distinct factory salts per env) |
| Name / symbol | **Chips / CHIPS** |
| Supply | **10B max cap; 2B initial liquid; 8B in gated `SupplyLocker`** (quarterly 500M envelopes as monthly ~166.7M drips: time + ≥75% utilization hard gates, sink ratio decelerates, no compounding; section 2.2) |
| Admin | Exact tx list: role-admin map → timelocks → asserts; **`MINT_ROLE` holders = ∅ after full pre-mint**; `SEIZE`/`BURN_BLOCKED` never; OPERATOR multisig+timelock, multiplier 1×; renounce deferred to Phase 4 with policy-first ordering |
| Allocation | 30 / 20 / 20 / 20 / 10 (play / treasury / team / liq / partners); coded distributor; team 12-mo cliff + 36-mo linear; named oracles; timelocked unlocks |
| Play emissions | Draw from pre-minted unlocked budget (600M initial + tranche top-ups toward 3B lifetime); season + per-wallet caps + hard epoch stops; S1–S3 net-inflationary by design; Sybil-profitability gate before S1 locks; **no mint after bootstrap** |
| Legacy conversion | 100:1 from capped 50M Treasury pool, 90-day window, unclaimed reverts |
| Burns | Pool burn + market + sinks; `bytes32`-memo-tagged; dashboard; pool/market burn from contract custody |
| Claims | **Pull-only** (match now or ClaimHub-batch later, paginated); funds in `MatchPool`; shared credit record incl. refunds; no expiry/dust-sweep of user credits in v1 |
| Dispute | On-chain `claimUnlockAt` per tier (2/5/10 min) with real-time countdown timer; **`refundJoin` immediate on cancelled/expired**, unlock only when settled (M9); timeout-refund by anyone past **effective** `settleBy + pauseDelta + refundGrace`; cancel pre-lock-only; BURN/TRANSFER pause auto-extends settle deadline |
| Paid match | Seat-allowlisted creation + **Edge lobby ticket** + **batch-first** EIP-5792 approve+join (permit EOA fallback) → **visible pool** → settle **Mode A dual-sign** (before effective deadline) / **Mode B Edge-only** (after) → **individual claim**; `settlePool` permissionless |
| Settle liveness | Mode B kills host-withhold grief; refund only on Edge-`unresolvable`; hostBond slash on withhold (HIGH-1) |
| Abandon | Edge-only → 100% refund; dual-sign → 50% burn / 50% prize (HIGH-2); Edge threshold/HSM day one |
| Upgrades | UUPS + ProxyAdminMultisig + 7d; B20 immutable; named in section 8.1c (HIGH-4) |
| Sink gate | On-chain cumulative counters only (HIGH-3) |
| Authority | Edge lobby ticket at createPool (HIGH-5) |
| 2v2 | `seatColors` committed; TEAM_PAIRINGS + exact equal-split enforced on-chain |
| Predict | **Phase 1 out of scope**; Phase 2 entry = join-policy (open/allowlist + min/max stake, not match seats) + sportsbook legal sign-off; then `poolKind` in MatchPool, creation-committed cutoff, parimutuel, pinned triggers |
| Free tables | **No MatchPool** when entry is free |
| Pause vs settle | **Auto-extend `settleBy` by `pauseDelta`** (TRANSFER/BURN) — pause does not convert wins into refunds |
| Mission CHIPS | Free-only accounts earn RXP not mission CHIPS; paid-volume floor required (e.g. ≥1 paid join/week); **welcome grant = 50 CHIPS one-time** (locked) |
| Vouchers/seasons | On-chain signer registry + revoke + ceilings + deadlines + consumed-hash guard; bound merkle leaves + frozen epochs; scorer on these surfaces only |
| Attribution | ERC-8021 Builder Codes on every tx (client-level `dataSuffix` + `sendCalls` wrapper); rule lives in project `AGENTS.md` |
| Sessions / gas | EIP-712 match session now; 8130 scoped keys (vibenet prototype, fork never ships) + ERC-8168 gas-only paymaster (interface Phase 1, funding Phase 3) |
| Balance authority | Chain; Supabase cache + game authority; legacy coin writers frozen behind flag |
| Eligibility | On-chain scorer for **mission/season/partner rewards only** (match claims/refunds scorer-free); geo sender/executor-only; named policy admins; mainnet scorer = threshold/HSM |
| Mint end-state | Full 10B pre-minted; **`MINT_ROLE` holders = ∅** after bootstrap (distributor draws only) |
| Edge settle SLO | Co-sign at match completion (async via idempotent Supabase retry queue, <15s target, alert >60s); settle-ready payload before claim CTA; timeout-refund past effective `settleBy` if Edge-down |
| resultHash | Audit log of settled payout only — not a pre-lock commitment or security oracle |
| Gas micro-tiers | 100-CHIPS tier **excluded from mainnet createPool allowlist** (chain-scoped, M10); lobby hard-filters/hides tiers below 1,000 CHIPS gas floor until paymaster |
| Standard rejected | Custom ERC-20 clone; dual soft currency; push payouts; single-host settle; UI-only eligibility; scorer on match prizes; mint-after-bootstrap; **host-withhold via timeout-refund as sole fallback** (HIGH-1); **single-Edge abandon burn** (HIGH-2); **Postgres sink-ratio gate** (HIGH-3); **unnamed upgrade key** (HIGH-4); **creator-declared authority without Edge ticket** (HIGH-5); UI-only gas-floor; exact 2v2 wei equality that bricks odd pots |

---

## 14. Open calibration points (defaults chosen in v4.3)

| Question | Default in this plan |
| --- | --- |
| Symbol display | `CHIPS` (name still “Chips”) |
| Fee bands | Protocol fees 4–5% by tier (hard cap 5%), burn 1–2% max (hard cap 2%); marketplace 5% protocol + 1% burn |
| Initial supply / unlocks | 2B liquid at bootstrap; 8B in `SupplyLocker`, quarterly 500M tranches gated on time + utilization + sink ratchet (section 2.2) |
| Mint end-state | Full 10B pre-minted; `MINT_ROLE` holders = ∅ after bootstrap |
| Stall-path | **Elected (v4.3): automatic S2-draw reduction.** Treasury bridge ≤100M only via superseding TOKEN_PARAMS decision; repayment from Treasury bucket only (M7/M8 closed) |
| Host grief / withhold | Mode B Edge-fallback settle; permissionless submit; hostBond on Standard+; refundGrace 3 min (M1 HIGH-1) |
| Abandon burn | Edge-only = 100% refund; dual-sign = 50/50 burn split (HIGH-2); Edge threshold/HSM Sepolia+mainnet |
| Upgradeability | section 8.1c: UUPS + ProxyAdminMultisig + 7d; B20 immutable; no EOA upgrade key (HIGH-4) |
| Authority binding | Edge-signed lobby ticket at `createPool` (HIGH-5) |
| 2v2 odd prize | floor + dust to first winning seat (M2) |
| Predict cutoff | `windowClosedAt` bounded to parent lock + 10 min (M3) |
| Galxe | HMAC-signed callbacks; soulbound OATs or drop identity claim; manual review queue on outage (M4/M5) |
| batchMint | Dead after bootstrap — distributions are transfers of pre-minted supply (M6) |
| Gas tiers | 100-CHIPS allowlist **omitted on mainnet chain config** + UI hide (M10) |
| B20 + 8021 suffix | Foundry assertion, not a premise (M11) |
| Sink ratio | On-chain `cumulativeBurned` / `cumulativeDrawn` only (HIGH-3) |
| Legacy snapshot | Root published + 7d challenge before claims |
| Locker top-up | Only `SupplyLocker.release()` — no EOA top-up |
| Tournament no-show | 100% burned (`tour:forfeit`) |
| Day-2/3 return | Any completed online match counts; Offline/AI does not |
| 1v1 vs FFA prize split | Winner-take-prize-fund; top-3 experimental later |
| Dispute delay | On-chain per tier: casual 2 min / standard 5 min / high+ tournament 10 min; timeout-refund past **effective** `settleBy + pauseDelta` |
| Pause vs settle | Auto-extend `settleBy` by `pauseDelta` (locked; product copy: pause delays, does not refund) |
| Cancel | Pre-lock, creating host only; post-lock funds move only via settle or timeout-refund |
| Scorer scope | Rewards-only (mission/season/partner); match prizes/refunds never need scorer |
| Mission CHIPS gate | Paid-volume floor (e.g. ≥1 paid join/week); free-only = RXP only |
| Welcome grant | **Ship 50 CHIPS** one-time (Phase-0 locked 2026-09-22) |
| Marketplace CHIPS prices | Draft band section 7.4 (common 50–200 … prestige 5k–50k) — finalize in TOKEN_PARAMS |
| Gasless claims | Paymaster **interface** Phase 1, funding Phase 3 (section 8.9); gas-negative micro-tiers Sepolia-only; mainnet lobby hides them until funded |
| Offline → reward bridge | None for missions; free-only = RXP; welcome grant 50 CHIPS one-time only |
| Predict | **Phase 1 out of scope**; Phase 2 entry = join-policy + sportsbook sign-off; then creation-committed cutoff + parimutuel |
| Predict legal | Own sportsbook sign-off — never inherited from match-pool analysis |
| Edge co-sign SLO | Async co-sign at match completion; UI delays payout copy if missing |
| Admin renounce | Deferred to Phase 4 with policy-first ordering (section 8.1b); pause stays on multisig + max-pause SLA |
| Legacy conversion | 100:1, 50M Treasury pool, 90-day window — published pre-Phase-1, never adjusted |
| Builder code | Single code from `base.dev`; never re-register if `builderCode.ts` exists; rule in `AGENTS.md` |
| 8130 dependency | Prototype on vibenet only (not Sepolia); fork never ships; `wevm/viem#5004` tracked |
| Sepolia session default | Callers on 84532 must pass `chainId: 84532` explicitly (never rely on mainnet default in `sessionProof`) |

---

*This is the production planning baseline (v4.3 freeze · Strix audit applied) for Ludo Base’s on-chain economy: one token (Chips/CHIPS on B20), 10B max with 2B initial liquid + gated locker, pull-based claims, visible match pools, Mode A/B settle liveness, dual-sign-only abandon burns, named upgrade matrix, and memo-tagged burns. Implementation starts at Phase 1 contracts + join/settle/claim UX on Base Sepolia — after Phase-0 freeze gates — not at a token announcement.*
