# Smart-contract deployment record

Canonical, dated record of on-chain deployments for `ludo-base`.

> **Source of truth for live values:** `contracts/.env` (gitignored). Grep it for
> `*_ADDRESS` (backend / forge) or `NEXT_PUBLIC_*_ADDRESS` (Next.js app). This file is the
> **committed "last known good as of `<date>`" snapshot** used for verification, handoff, and
> disaster recovery. It WILL lag a redeploy — always re-grep `.env` before acting on an address,
> and update this file after every (re)deploy.

## How to maintain this file

After any deploy (`--broadcast`):
1. Update `contracts/.env`, `.env.local`, and `contracts/.env.content-only` with the new `*_ADDRESS` values.
2. Append a row to **History** (date · action · tx hash / note).
3. Refresh the **Current deployment** block and bump the "as of" date.
4. (Optional) update `BASE_RPC`/`SEPOLIA_RPC` references if the network changed.

## Networks

| Name | Chain ID | RPC (`$SEPOLIA_RPC` / `$BASE_RPC`) | Explorer | Notes |
|---|---|---|---|---|
| Base Sepolia | 84532 | `https://sepolia.base.org` | `sepolia.basescan.org` | testnet target; EVM `cancun` + Base precompiles (use **`base-forge`** for B20 CHIPS) |
| Base mainnet | 8453 | `https://mainnet.base.org` | `basescan.org` | production — not yet deployed here |

## Accounts & keystores

| Role | Keystore | Address |
|---|---|---|
| Deployer / Owner / Op / Voucher signer | `mydeployer` | `0xbcCa5DcBF293D98A627fD3814D5AE8249bB1DFaF` |

- This one address is `DEPLOYER_ADDRESS`, `GAME_OWNER`, and `MISSION_OP_KEY` in `contracts/.env`.
- `MISSION_OP_PRIVATE_KEY` (backend voucher signer) **is** the `mydeployer` private key — keep it in
  server env only; never commit it.
- The deploy keystore is named **`mydeployer`** (NOT `deployer`). The runner and npm scripts default to it.

## Current deployment — Base Sepolia (as of 2026-10-16)

| Contract | Address | Env var(s) | Verify |
|---|---|---|---|
| CHIPS (B20 token) | `0xB200000000000000000000821408122b9Ed3d05B` | `CHIPS_ADDRESS`, `NEXT_PUBLIC_CHIPS_ADDRESS` | existing |
| ClaimHub | `0x15dF536466Ef58f77e95D7432089DeEBDf276821` | `CLAIM_HUB_ADDRESS`, `NEXT_PUBLIC_CLAIM_HUB_ADDRESS` | existing |
| MatchPool | `0x4740048bdBAF5A5bbD37c7ce6dce666910993091` | `MATCH_POOL_ADDRESS`, `NEXT_PUBLIC_MATCH_POOL_ADDRESS` | Basescan · Sourcify |
| MissionClaim | `0x1A3371805ACff5eea1B1A5C9A231a7d9d78Cacd9` | `MISSION_CLAIM_ADDRESS`, `NEXT_PUBLIC_MISSION_CLAIM_ADDRESS` | Basescan · Sourcify |
| SeasonClaim | `0x1A27120eab8638e40ed8eEf60fAe13cC18277bd3` | `SEASON_CLAIM_ADDRESS`, `NEXT_PUBLIC_SEASON_CLAIM_ADDRESS` | Basescan · Sourcify |
| LegacyClaim | `0x6f9E12D5F9d81132214cdA8369410ab7c187227F` | `LEGACY_CLAIM_ADDRESS`, `NEXT_PUBLIC_LEGACY_CLAIM_ADDRESS` | Basescan · Sourcify |

**Wiring:** `MatchPool.setClaimHub → ClaimHub (0x15dF…821)`. The three claim contracts are
independent (they do **not** reference the hub); each is configured via its own `Init`/`Set*` script.

**MissionClaim state (2026-10-16):** 23 missions registered (6 daily + 6 weekly + 11 onboarding);
per-period ceiling 100,000 CHIPS; `minReserve` 500 CHIPS; funded 500 CHIPS (reserve floor = deposit,
so `availableReserves` = 0); `opKey` = `0xbcCa5…`; `paused` false.

## History

| Date | Action | Detail |
|---|---|---|
| 2026-10-16 | Deploy MatchPool, MissionClaim, SeasonClaim, LegacyClaim | `--broadcast --verify` on 84532; all verified on Basescan + Sourcify |
| 2026-10-16 | `npm run claim:init` | 23 missions, ceiling 100k, minReserve 500, day+week windows opened |
| 2026-10-16 | `npm run claim:fund` (500 CHIPS) | `approve` + `fund` landed on 84532 |

## Tooling conventions (non-obvious — capture so they aren't re-learned)

- **Deploy keystore is `mydeployer`**, not `deployer`. The deploy runner (`scripts/deploy-contracts.sh`)
  and the `claim:*` npm scripts default to it.
- **CHIPS is the B20 token.** Any forge script that *calls* CHIPS (`approve`, `transferFrom`, `fund`)
  must run under **`base-forge`**, not `forge` — vanilla forge's EVM does not implement the Base
  precompiles and reverts with `EvmError: OpcodeNotFound` on `CHIPS.approve`. Deploy/configure scripts
  that only *pass* `CHIPS_ADDRESS` to a constructor are fine with `forge`. (`base-forge` is the
  Base build of forge with `FOUNDRY_BASE=true`; see `contracts/foundry.toml`.)
- **npm scripts self-resolve foundry** (`PATH=$HOME/.foundry/bin:$PATH`) and **self-load `contracts/.env`**
  (`set -a && . ./.env`), so there is no need to `source .env` or `export PATH` before `npm run claim:*`.
- **EVM version** is pinned to `cancun` in `contracts/foundry.toml`; the `OpcodeNotFound` issue was a
  *B20 precompile*, not a hardfork mismatch (bumping `--evm-version prague` did not fix it).

## Verify a live contract

```bash
cast call "$MISSION_CLAIM_ADDRESS" "opKey()(address)"                 --rpc-url "$SEPOLIA_RPC"
cast call "$MISSION_CLAIM_ADDRESS" "availableReserves()(uint256)"     --rpc-url "$SEPOLIA_RPC"
cast call "$CHIPS_ADDRESS" "balanceOf(address)(uint256)" "$MISSION_CLAIM_ADDRESS" --rpc-url "$SEPOLIA_RPC"
```
