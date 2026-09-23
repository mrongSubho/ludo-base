# C0 freeze pack — Sybil model + legal issue-spot

| Field | Value |
| --- | --- |
| **Status** | Draft freeze pack (analytics + legal brief) — 2026-09-23 |
| **Companion** | `docs/tokenomics/CHIPS_PLANNING.md` · `docs/tokenomics/TOKEN_PARAMS.md` gates 1–2 |
| **Blocks** | S1 budget **final** lock · any **mainnet value** · predict pools |
| **Does not block** | Sepolia Alpha with provisional 400M play budget |

---

## 1. Sybil-profitability model (gate 2)

### 1.1 Cost stack (per farm wallet)

| Cost | Unit | Source / note |
| --- | --- | --- |
| Wallet create | ~0 (AA/passkey) | Coinbase Smart Wallet — **near-zero create cost is the threat** |
| Gas / paymaster | ≈0 on sponsored claims | ERC-8168 funds claims; farm still pays time/ops |
| Bot runtime | ~$0.01–0.05 / wallet-day | Browser automation + residential proxy share |
| KYC/geo friction | **0 if unenforced** | Policy registry must bite before paid missions |
| 7% wash take (fees+burn) | 7% of volume | Round-trip wash loses 7% + spread |

### 1.2 Revenue stack (per farm wallet)

| Path | Cap (plan) | Farmable? |
| --- | --- | --- |
| Welcome grant ≤50 CHIPS | once | **Yes — if shipped**; keep ≤50 and one-shot |
| Mission CHIPS | paid-volume floor (≥1 paid join/week) | Only with real stake at risk |
| Season merkle | rank + paid-volume eligibility | Expensive to fake at scale |
| Match prizes | dual-sign settle; no scorer | Farm wins vs self = wash loss |
| Marketplace | optional | Circular volume |

### 1.3 Scenarios (to publish as table + spreadsheet)

| Case | Wallets | Honest demand | Farm revenue | Break-even |
| --- | --- | --- | --- | --- |
| **22k full-S1 drain** | 22,000 | 100k DAU × 18k cap → 1.8B demand vs 400M budget | Caps + epoch stop bind | Farm **must** buy paid volume to earn mission CHIPS |
| **100k Sybil** | 100,000 | same | Dilluted; FCFS/onboarding 60M sub-cap | Welcome-grant alone = 5B if 100k × 50 — **never ship uncapped** |

### 1.4 Hard gates (enforce on-chain / Edge — not UI)

1. Per-wallet daily/weekly mission caps + hard **epoch budget stop** (never pro-rata mint).
2. **Paid-volume floor** for mission CHIPS (free-only = RXP).
3. Distinct-opponent minimum for streak missions.
4. Welcome grant: **ship/no-ship + amount** published in TOKEN_PARAMS **before** Phase-1 (default: **no-ship** until post-Sybil table signed).
5. Onboarding voucher ceilings + one-time consumption hashes.

### 1.5 Exit criterion (sign before S1 locks)

- [ ] Spreadsheet published (22k + 100k + break-even) with owner + date  
- [ ] Decision: lock S1 **400M** or reduce  
- [ ] Welcome-grant ship/no-ship recorded in TOKEN_PARAMS  
- [ ] Epoch-stop + paid-floor asserted in contract tests  

---

## 2. Legal issue-spot (gate 1) — brief for counsel

**Product surfaces (all on Base):**

1. **Paid match pools** — entry fee in CHIPS → visible pool → winners pull claims. Skill = Ludo (dice variance exists).
2. **Free / offline / Pass & Play** — no stake, no CHIPS.
3. **Missions / seasons** — performance rewards in CHIPS (marketing/promo).
4. **Marketplace cosmetics** — CHIPS burn + fee (utility).
5. **Predict pools (Phase 2+)** — **separate** sportsbook-class surface; **not** inheriting (1).

**Questions to answer in writing before mainnet value:**

| # | Question | Acceptance criterion |
| --- | --- | --- |
| L1 | Is CHIPS a utility/token in target geos? | Memo + contractURI language OK; no “investment returns” marketing |
| L2 | Are paid Ludo pools skill, chance, or gambling per geo? | Permitted/blocked geo list + product tweaks |
| L3 | Age gate method | Threshold + verification method named |
| L4 | Predict / betting | **Own** sportsbook sign-off; default **blocked** |
| L5 | Sanctions / geo | Policy registry + sender/executor scope |
| L6 | Ads / UA claims | No ROI language; free ads → RXP only (parked) |

**Default posture until signed:** testnet only; no fiat on-ramp claims; Terms updated to utility language (`TOKEN_PARAMS` / Terms §1); geo policy defaults deny for paid pools.

### Exit criterion

- [ ] Written issue-spot memo with L1–L6 answers + geo table  
- [ ] Terms §1 CHIPS utility language reviewed  
- [ ] Predict explicitly **deferred** until separate sign-off  

---

## 3. TOKEN_PARAMS fill-ins this pack enables

| Row | Value to record |
| --- | --- |
| Sybil model published | link + date + owner |
| Welcome grant | ship/no-ship + amount |
| Legal acceptance criteria | memo link + date |
| Liquidity owner + earliest date | name + date (≥ mainnet+90d) |

---

*Preserve AGENTS.md invariants. This pack is Phase-0 only — it does not authorize Sepolia value UI beyond provisional Alpha described in TOKEN_PARAMS.*
