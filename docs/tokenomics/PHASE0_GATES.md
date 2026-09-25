# Phase-0 open gates (legal · Sybil · liquidity)

Companion to `TOKEN_PARAMS.md` section 5. Status as of 2026-09-22.

## 1. Legal issue-spot (OPEN — counsel)

**Questions for counsel (acceptance criteria, not opinions):**

| Topic | Question | Acceptance |
| --- | --- | --- |
| Utility token | Is CHIPS a utility token for gameplay on Base? | Written yes/no + required disclaimers |
| Skill vs chance | Ludo dice + optional power tiles — skill/chance classification per geo? | Geo matrix |
| Paid pools | Entry fees → prize pool (rake/burn) — gambling or skill contest? | Legal basis per geo |
| Predict / spectator | Parimutuel outcomes = sportsbook-like | Separate sign-off; may ship **off** |
| Age | 18+ or 21+ per geo? | Verification method (wallet age ≠ age) |
| Marketing | Ban “investment / yield / returns” language | ToS + ad copy checklist |
| Testnet | Sepolia MockChips = no monetary value | Keep until mainnet legal clears |

**Ship rule:** Sepolia testnet OK with disclaimers. **Mainnet value + predict** require written acceptance of items 1–6.

## 2. Sybil-profitability model (OPEN — analytics)

Goal: prove S1 400M draw cannot be farm-drained.

| Input | Formula | Status |
| --- | --- | --- |
| Farm revenue | 50 welcome + ~200–800 mission/week × wallets | Need live numbers |
| Cost | wallet create + gas (Base ≈ $0.01) + 7% wash take | Model |
| Break-even | revenue ≤ cost | Target: **not profitable** |
| Scale cases | 22k wallets (full S1 drain), 100k wallets | **Must run before S1 locks** |

Controls already in plan: paid-volume floor, per-wallet caps, scorer, distinct opponents, welcome 50 CHIPS once.

**Deliverable:** `docs/tokenomics/SYBIL_MODEL.md` with spreadsheet inputs + pass/fail before S1 budget lock.

## 3. Liquidity unlock owner (OPEN — product)

| Field | Proposed default | Owner name |
| --- | --- | --- |
| Approver | Treasury multisig proposes → SecurityMultisig approves | **TBD person/role** |
| Earliest date | Mainnet + 90 days | **TBD date** |
| KPIs | D7 ≥25%, fill rate ≥40%, weekly paid joins ≥10k | Locked in plan section 11 |

Record in `TOKEN_PARAMS.md` section 5 once named.

---

**Lock order:** legal (mainnet/predict) → Sybil model (S1 lock) → liquidity owner (unlock schedule).
