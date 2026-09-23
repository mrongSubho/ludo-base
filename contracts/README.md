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
| `test/` | Foundry tests (double-claim, Mode B, abandon, M9, …) |

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
