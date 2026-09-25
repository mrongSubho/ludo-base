# SYBIL_MODEL.md — welcome-grant / referral profitability (pre-S1 lock)

**Status:** DRAFT 2026-09-25 · needs live Sepolia claim telemetry before S1 budget is final.  
**Gate:** PHASE0_OPEN_GATES section 2 · CHIPS_PLANNING section 3 / 7.

## Question

At 22k and 100k wallet scale, is farming welcome + referral + mission CHIPS profitable after gas/faucet friction?

**Required answer:** NO for both scales.

## Locked controls (from TOKEN_PARAMS)

| Control | Value |
| --- | --- |
| Welcome grant | **50 CHIPS once** per wallet |
| Paid-volume floor (mission CHIPS) | ≥ 1 paid join / week |
| Referral tiers | 50 CHIPS referee success · 10 CHIPS fallback (capped) |
| Daily / weekly emit caps | server-enforced on voucher issue |
| Distinct opponents | required for playtime / pvp tracks |
| Scorer | rewards-only (never on match claims/refunds) |
| Mint after bootstrap | **none** — draws from pre-minted budget |

## Cost / revenue sketch (fill with live numbers)

| Case | Wallets | Max emit / wallet | Gas + friction / wallet | Net attacker |
| --- | --- | --- | --- | --- |
| A | 22k | 50 welcome + missions if floor fails | Base gas + sybil account cost | **Must be ≤ 0** |
| B | 100k | same | same | **Must be ≤ 0** |

### Sepolia smoke reference points (2026-09-25, real B20)

| Flow | CHIPS |
| --- | --- |
| 1v1 entry | 1,000 |
| Host bond (Standard) | 37.2 |
| Winner prize | 1,860 |
| Protocol 5% | 100 (to treasury path) |
| Burn 2% | 40 (`burnWithMemo`) |
| Welcome grant (planned) | 50 |

Implication: one legitimate paid match moves 2,000 gross and burns 40. Welcome is 2.5% of a single paid pot — farming welcome alone cannot beat paid-volume floors if mission CHIPS require a paid join.

## Live telemetry still required

1. `mission_vouchers` issued vs claimed per track / day  
2. `onboarding_progress` completion rates by track  
3. `referral_links` successful vs pending ratio  
4. Distinct-wallet fan-out (one funder → many claimers)  
5. Gas paid per claim (Base is cheap — include faucet/opportunity cost)

Publish a table of (wallets, emit, cost) for 22k / 100k using 14 days of Sepolia data, then mark this file **LOCKED** before S1 budget final.

## Acceptance

- [ ] 14-day Sepolia extract attached  
- [ ] Attacker net ≤ 0 at 22k and 100k  
- [ ] Caps actually enforced at voucher API (not just UI)  
- [ ] Product + eng sign-off recorded in TOKEN_PARAMS section 5 gate 2
