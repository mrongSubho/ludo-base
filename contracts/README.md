# CHIPS contracts (Phase 1)

Implements the freeze baseline in `docs/tokenomics/CHIPS_PLANNING.md` (v4.3) and `docs/tokenomics/TOKEN_PARAMS.md`.

## Toolchain

Prefer **base-forge / base-cast / base-anvil** (B20-aware Foundry). Standard `forge` cannot simulate B20 precompile calls.

This machine currently has **no `forge` / `base-forge` on PATH**. After install (`DEPS.md`):

```bash
cd contracts
forge install foundry-rs/forge-std --no-commit
base-forge build   # or forge build for mock-only unit tests
base-forge test
```

If only vanilla Foundry is available, MatchPool/ClaimHub/MissionClaim unit tests that mock `IChips` still run; B20 factory scripts require `base-forge` + `base-std`.

### Optional `base-std` (B20 encoders)

```bash
# pin the Base Standard Library for CreateChips.s.sol
# git submodule or lib install per Base docs (v1.0.0 interfaces)
```

## Layout

| Path | Role |
| --- | --- |
| `src/MatchPool.sol` | Visible match pools: create/join/lock/settle Mode A+B/claim/refund/abandon |
| `src/ClaimHub.sol` | Allowlisted claim router + batch pull |
| `src/MissionClaim.sol` | EIP-712 mission vouchers + op-key registry |
| `src/interfaces/IChips.sol` | B20/ERC-20 surface used by pools (incl. `burnWithMemo`) |
| `script/CreateChips.s.sol` | B20 factory create + initCalls bootstrap (base-forge) |
| `script/InitMissions.s.sol` | Post-deploy: register missions, open period windows, set ceiling/reserve/relayer |
| `script/FundMissionClaim.s.sol` | Post-deploy: fund the reward reserve, print the funding picture |
| `test/` | Foundry tests (double-claim, Mode B, abandon, M9, …) |

## Claiming, end to end

`MissionClaim.claim(...)` is the only entry point the app uses, and nothing about it
is implicit. Run these four steps once per deployment:

1. **Deploy** (see order below) with `MISSION_OP_KEY` set to the server's op-key
   address (the signer of `MISSION_OP_PRIVATE_KEY` in `lib/missionVoucher.ts`).
2. **Init** — `npm run claim:init` (`script/InitMissions.s.sol`). Registers all 23
   missions (6 daily · 6 weekly · 11 onboarding) with their fixed CHIPS rewards,
   opens today's daily and weekly claim windows, and sets the per-period ceiling,
   the reserve floor and (optionally) the ClaimHub relayer. Mission ids are
   `keccak256(bytes(id))`, matching `missionIdBytes32` on the server; period ids are
   `keccak256` of the UTC day / ISO-week labels, matching `periodIdDay` /
   `periodIdWeek`. Re-run it whenever the day or week rolls over (the script
   computes the windows for the block it is mined in).
3. **Fund** — `npm run claim:fund` (`script/FundMissionClaim.s.sol`). Pulls CHIPS
   into the reserve via `fund()` (the contract mints nothing) and prints
   balance / headroom / floor. Fund more whenever `availableReserves()` drops
   below the next period's expected payout — a claim under the floor still pays
   but emits `ReservesLow`.
4. **Claim** — the server issues an EIP-712 voucher (`POST /api/missions/voucher`,
   one per wallet per mission per period, enforced by `mission_vouchers`
   uniqueness *and* on-chain by `claimedInPeriod`); the wallet submits
   `claim(wallet, missionId, amount, periodId, deadline, nonce, sig)`.

What the contract enforces on-chain (so a server bug cannot become a payout):
pause · voucher deadline · caller is the wallet or an allowlisted relayer ·
mission registered + active · amount equals the fixed reward or is inside
`minClaimAmount`/`maxClaimAmount` · the period window is open · signature
recovers to the current `opKey` · the nonce is unspent · one claim per wallet per
mission per period · per-period issuance ceiling · the reserve can pay. Every
state change precedes the transfer (CEI) and the whole function is
`nonReentrant`. Withdrawals can never breach `minReserve`, so the reserve cannot
be drained out from under pending claims.

Testing: `npm run test:contracts` (anvil + E2E) and `forge test
--match-contract MissionClaim` cover replay, rotation, ceilings, windows,
one-per-period, funding and the relayer matrix. Full history diff-scoped guards
run in CI.

## Deploy order (Phase 1)

1. Confirm `isActivated(ASSET)` on ActivationRegistry — record in `TOKEN_PARAMS.md`.
2. `CreateChips` (token + allocation + revoke mint) via `base-forge`.
3. Deploy `MatchPool`, `ClaimHub`, `MissionClaim` (wire `setClaimHub` / `setEdgeSigner` / fee tiers).
4. Fill addresses in `TOKEN_PARAMS.md`.
5. Run `base-forge test` + gas benchmarks.

## Notes

- Phase-1 implementations are **non-proxy**. Production wraps them as **UUPS** with ProxyAdminMultisig + 7d timelock per section 8.1c.
- Edge co-signer must be **threshold/HSM** before any Sepolia paid pool goes live.
- Never grant `SEIZE_ROLE` / `BURN_BLOCKED_ROLE`; keep multiplier at 1×.
