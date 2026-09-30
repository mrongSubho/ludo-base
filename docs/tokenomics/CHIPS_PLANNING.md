# CHIPS_PLANNING.md — shipped record + open list

**Status:** Phase-1 **engineering complete** on Base Sepolia (2026-09-25).  
**Companion docs:** `TOKEN_PARAMS.md` (deploy + freeze) · `PHASE0_OPEN_GATES.md` · `docs/ops/CHIPS_WATCHER_RUNBOOK.md` · `SYBIL_MODEL.md`

This file is a **completed-features record** and a **lean undone checklist**. Locked product decisions are summarized below; full economic derivation lives in git history (pre-2026-09-27).

---

## 1. Locked product decisions (summary)

| Decision | Value |
| --- | --- |
| Currency | **Single: CHIPS** (B20 Asset on Base) |
| Offline / AI | Off-chain · **0 CHIPS** |
| Supply | **10B max** · full pre-mint · `MINT_ROLE` holders = ∅ after bootstrap |
| Allocation | 30 / 20 / 20 / 20 / 10 — play / treasury / team / liquidity / partners |
| Initial liquid | 2B · 8B in gated `SupplyLocker` (quarterly envelopes) |
| Pools | Visible MatchPools · pull-only claims · host bond on Standard+ |
| Payout | 2v2 **50/50** · 4P top-2 **75/25** · 1v1 winner-take prize fund |
| Fees | Protocol 4–5% (cap 5%) · burn 1–2% (cap 2%) |
| Settle | Mode A dual-sign · Mode B Edge-only after `settleBy` |
| Abandon | Edge-only = 100% refund · dual-sign = 50% burn / 50% prize |
| Welcome grant | **50 CHIPS** once |
| Stall-path | Automatic S2-draw reduction |
| Legacy coins | 100:1 · 50M cap · 90-day window · 7d root challenge |
| TEAM_PAIRINGS | **Green+Blue vs Red+Yellow** |
| Builder codes | ERC-8021 `dataSuffix` on txs (`lib/builderCode.ts`) |
| Toolchain | `base-forge` / `base-cast` for B20 · vanilla forge for pool unit tests |

---

## 2. Shipped (completed features)

### 2.1 Contracts (Foundry · 51/51 tests)

| Contract | Role |
| --- | --- |
| **CHIPS (B20)** | `0xB200…d05B` · 10B minted · MINT revoked · supplyCap 10B · 1× multiplier |
| **MatchPool** | `0x879E…b6B3` · create/join/lock/settle/refund · lobby tickets · host bond · ERC-1271 host settle · pause-delta |
| **ClaimHub** | `0x1430…4850` · paginated `claimMany` / `claimMatch` |
| **MissionClaim** | `0x01abff6c…` · EIP-712 vouchers · op-key · ceilings · replay guard |
| **SeasonClaim** | `0x83ae…4cbe` · per-epoch merkle root · 48h propose → activate freeze |
| **LegacyClaim** | `0x140b…7ebd` · 100:1 snapshot claims · 90-day window |

Test coverage includes: join/settle/claim/burn, Mode B + bond slash, M9 cancel refund, forbidden-transition matrix, MissionClaim unit tests, Host1271, PauseDelta, GasAndSuffix, MerkleClaims, E2E fund→settle→claim.

### 2.2 App / UX

- Paid **join** (EIP-5792 batch + fallback) · **claim** (countdown + gas + ClaimAll) · **settle** (host + Edge)
- Multi-winner **2v2 50/50** · **4P 75/25** (`useSettlePool.settleFromWinners`)
- **CHIPS wallet sheet** (Coinbase-style): header pill → balance · account · Refresh/Claim/Feed · daybreak + retro night
- **Burn & Explorer** panel (in-app Feed) · `/burn` deep link
- **Profile panel + public profile modal**: live CHIPS · mode form **wins/played** (Classic / Power / vs AI / Overall)
- **Onboarding**: progress/referral/claim APIs · Galxe HMAC callback · `OnboardingPanel` · guest stash migrate
- **Merkle claim** UI (`MerkleClaimPanel`) for legacy + season
- Terms §1 economic language for CHIPS

### 2.3 Infra / ops

- **Indexer** → Supabase `chips_events` (chunked `eth_getLogs`)
- Dual-chain auth (84532 / 8453) · SIWE · match session · move-auth
- RLS static check clean · legacy coin writers frozen
- Runbook: `docs/ops/CHIPS_WATCHER_RUNBOOK.md` (funding · legacy set-root · season root)
- Scripts: `b20-smoke.sh` · `claim-sepolia.sh` · `fund-claims.sh` · `publish-legacy-root.sh` · `propose-season-root.sh` · `build-legacy-snapshot.ts` · `buildSeasonLeaves.ts`

### 2.4 Proven E2E (Base Sepolia · real B20 · 2026-09-25)

```
createPool → join×2 → lockPool (host bond)
  → settlePool (burnWithMemo 40 CHIPS)
  → claimMatch → 1860 CHIPS to winner
```

- Supply after burn: **10B − 40** · MatchPool has `BURN_ROLE`  
- LegacyClaim funded **50M CHIPS** · snapshot root `0x44cb6fd4…` · challenge ends **2026-10-02T05:03:46Z**

---

## 3. Live addresses (Sepolia 84532)

| Item | Address |
| --- | --- |
| CHIPS (B20) | `0xB200000000000000000000821408122b9Ed3d05B` |
| MatchPool | `0x879E7D5676332964C6aB95d6F357a9C185dbB6B3` |
| ClaimHub | `0x1430E2D4dFAe938098400456e1DE6d3d84934850` |
| MissionClaim | `0x01abff6c58a25b80bfd68cb563b54c1155aa1def` |
| SeasonClaim | `0x83ae874e85c94920540f43fc6706ee485be44cbe` |
| LegacyClaim | `0x140b790ea880ca7da31f88db75058964699e7ebd` |
| Deployer / admin | `0xbcCa5DcBF293D98A627fD3814D5AE8249bB1DFaF` |

Full tx history: `TOKEN_PARAMS.md`.

---

## 4. Lean undone checklist

### Time-gated (calendar)

| # | Item | When / command |
| --- | --- | --- |
| 1 | **Legacy `setSnapshotRoot`** | After **2026-10-02** → `bash scripts/publish-legacy-root.sh --set-root` |
| 2 | Host `legacy-snapshot.json` publicly + announce challenge | Before claims |

### Ops / keys (no new product code)

| # | Item | Notes |
| --- | --- | --- |
| 3 | Rotate **MissionClaim op-key** off deployer EOA | `SetOpKey.s.sol` + HSM/threshold |
| 4 | **Edge settle signer** → HSM/threshold | Replace smoke key `0xf39F…` |
| 5 | **Season** fund + propose/activate | `fund-claims.sh` · `propose-season-root.sh` (48h) |
| 6 | Dedicated **backend RPC** (not public endpoints) | Watcher runbook |
| 7 | **Galxe** account + `GALXE_HMAC_SECRET` | Callback route already ships |

### Mainnet / Phase gates (external)

| # | Item | Owner |
| --- | --- | --- |
| 8 | Legal issue-spot memo + geo matrix | Counsel (`PHASE0_OPEN_GATES.md`) |
| 9 | **Sybil** live telemetry → lock `SYBIL_MODEL.md` | Analytics |
| 10 | Liquidity unlock **owner + earliest date** | Product |
| 11 | Mainnet deploy: addresses, salts, multisigs, timelocks | Eng + ops |
| 12 | 8130 / paymaster **funding** (interface exists) | Ops |

### Optional polish

| # | Item |
| --- | --- |
| 13 | Phase 0a C2–C4 click-through on `/spike/cdp` (Base Account path) |
| 14 | Season claim UI mount from live `season-leaves-<epoch>.json` |
| 15 | Per-mode AI wins in profile form (today: `ai_played` as denominator) |

---

## 5. Phase-1 exit (testnet) — met

| Criterion | Evidence |
| --- | --- |
| Live contracts | Sepolia B20 stack |
| Join → settle → claim | E2E smoke 2026-09-25 |
| Burn memo on explorer | `burnWithMemo` in settle |
| `MINT_ROLE` holders | ∅ after bootstrap |
| Tests | Foundry 51/51 · engine suite · tsc clean |

**Not required for testnet exit:** mainnet, legal sign-off, Edge HSM (Sepolia smoke key is sufficient for alpha).
