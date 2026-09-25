# Phase-0 open gates (legal · Sybil · liquidity)
# Status: DRAFTS filled 2026-09-24 — need counsel / product sign-off to CLOSE

---

## 1. Legal issue-spot (OPEN — needs counsel)

**Draft for counsel (acceptance criteria):**

| Topic | Draft answer | Needs counsel |
| --- | --- | --- |
| Utility vs security | CHIPS = utility for play/stake/cosmetics/claims. No profit share, no investment language | Formal memo |
| Skill vs chance | Ludo = skill + dice chance; paid pools are skill contests with house fee | Geo classification |
| Paid pools | P2P pot + rake/burn, not banked against house | Geo allowlist |
| Predict | Parimutuel — treat as gambling | Separate sign-off or ship off |
| Age | 18+ | Verification method |
| Testnet | Sepolia MockChips = no monetary value | Keep disclaimer |

**Geo matrix (draft):**

| Geo | Free | Paid pools | Predict | Notes |
| --- | --- | --- | --- | --- |
| US | Y | Pending legal | Pending legal | |
| EU | Y | Pending legal | Pending legal | |
| Other | Case-by-case | Case-by-case | Blocked until legal | |

**Status:** OPEN — copy to counsel; fill acceptance column.

---

## 2. Sybil-profitability model (DRAFT numbers)

| Case | Wallets | Max rev / wallet | Cost / wallet | Break-even? |
| --- | --- | --- | --- | --- |
| A | 22k | 50 welcome + ~200–800 if paid floor fails | gas + faucet friction | **Must be NO** |
| B | 100k | same | same | **Must be NO** |

**Locked controls:** welcome 50 once · paid-volume floor ≥1 join/week · daily/weekly caps · distinct opponents · scorer on rewards only.

**Still open:** live Sepolia claim numbers → `docs/tokenomics/SYBIL_MODEL.md` before S1 lock.

**Status:** OPEN — analytics pass required.

---

## 3. Liquidity unlock owner (PROPOSAL — product confirms)

| Field | Proposal |
| --- | --- |
| Approver | Treasury multisig proposes → SecurityMultisig approves |
| Owner role | Treasury ops lead (multisig signer) |
| Earliest unlock | Mainnet + 90d |
| KPIs | D7 ≥25%, fill ≥40%, weekly paid joins ≥10k |

**Status:** OPEN — product names the person → record in TOKEN_PARAMS section 5.

---

## Lock order
1. Legal (even draft) before mainnet value  
2. Sybil model before S1 budget lock  
3. Liquidity owner before first unlock proposal


---

## 4. Ops / activation (OPEN)

| Item | Status | Owner |
| --- | --- | --- |
| `isActivated(ASSET)` on ActivationRegistry `0x8453…0001` | **OPEN — deploy-time probe** (precompile ABI unclear; confirm via base-cast + base-std docs) | eng |
| MissionClaim production op-key | **OPEN** — Sepolia opKey = deployer EOA; rotate via `SetOpKey.s.sol` + HSM/threshold before prod | ops |
| Edge settle co-signer HSM | **OPEN** — Sepolia smoke key `0xf39F…`; mainnet threshold/HSM | ops |
| Fund LegacyClaim 50M CHIPS | **OPEN** — snapshot root ready; transfer Treasury budget before claims | treasury |
| Fund SeasonClaim budgets | **OPEN** — per-epoch `epochBudget` at `proposeRoot` | treasury |
| Mainnet factory salts + role multisigs | **OPEN** | product/ops |

## 5. Liquidity owner (still product)

Fill TOKEN_PARAMS section 5 table: name + earliest unlock date (not before mainnet+90d).
