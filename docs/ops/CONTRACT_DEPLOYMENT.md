# Contract deployment — Foundry runbook

| | |
|---|---|
| **Chains** | anvil (local) · Base Sepolia (84532) · Base mainnet (8453) |
| **Toolchain** | Foundry (`forge` / `cast`), solc 0.8.24, optimizer 200 runs, `evm_version = cancun` — all pinned in `contracts/foundry.toml` |
| **Covers** | environment setup, network configuration, compile, test, deploy, verify, and the mission-claim sequence end to end |

All commands run from `contracts/` unless stated. Nothing here needs the Next.js app.

## 1. Environment setup

```bash
# 1a. Foundry (once per machine)
curl -L https://foundry.paradigm.xyz | bash
foundryup                       # installs forge + cast at the pinned versions

# 1b. Repo scaffold: foundry check, contracts/.env from the example, deployer keystore
npm run setup:foundry

# 1c. Dependencies (vendored already, but re-pin if lib/ is stale)
cd contracts
forge install foundry-rs/forge-std --no-commit   # only if lib/forge-std is missing

# 1d. Deployer identity — testnet-only key, never a mainnet key
cast wallet import deployer --interactive       # or: cast wallet new --keystore keystore/deployer
cast wallet list

# 1e. Fund it (Sepolia)
#    https://docs.base.org/docs/tools/faucets  ·  https://www.alchemy.com/faucets/base-sepolia
cast balance <deployer-address> --rpc-url "$SEPOLIA_RPC"
```

`contracts/.env` (from `.env.example`) is loaded by forge automatically. Two traps the example
file calls out, both of which produce silent failures:

- **A stale value in `.env` beats an inline one.** After any deploy, update the `*_ADDRESS`
  values; otherwise you broadcast against the previous deployment.
- **Trailing `# comments` on a value line become part of the value** and break `--verify`.
  Keep comments on their own line.

## 2. Network configuration

RPC endpoints and the verifier are declared in `contracts/foundry.toml`:

```toml
[rpc_endpoints]
base_sepolia = "${SEPOLIA_RPC}"
base         = "${BASE_RPC}"
anvil        = "http://127.0.0.1:8545"

[etherscan]
base_sepolia = { key = "${ETHERSCAN_API_KEY}", url = "https://api.etherscan.io/v2/api?chainid=84532" }
base         = { key = "${ETHERSCAN_API_KEY}", url = "https://api.etherscan.io/v2/api?chainid=8453" }
```

`contracts/.env` (never commit):

```bash
SEPOLIA_RPC=https://sepolia.base.org        # or your Alchemy/QuickNode URL
BASE_RPC=https://mainnet.base.org
ETHERSCAN_API_KEY=                          # Etherscan V2 key — required for --verify
FOUNDRY_ACCOUNT=deployer
DEPLOYER_ADDRESS=0x…                        # the address the deploy key controls
CHIPS_ADDRESS=0xB200000000000000000000821408122b9Ed3d05B   # real CHIPS, never a mock
MISSION_OP_KEY=0x…                          # address derived from MISSION_OP_PRIVATE_KEY
GAME_OWNER=0x…                              # defaults to DEPLOYER_ADDRESS
```

> **Env-name trap:** `foundry.toml` reads `SEPOLIA_RPC` / `BASE_RPC` (not `…_URL`). Passing
> `--rpc-url "$SEPOLIA_RPC"` always works; the named shortcut `--rpc-url base_sepolia` only
> resolves if that exact variable is exported — `source .env` before you start.

> **Verifier note:** the V2 endpoint needs `chainid` in the URL, which is already baked in above.
> Forge 1.8.x silently drops a `chainid` *key* in this table, so don't try to add it as a key —
> the URL form is the working one.

## 3. Compile and test

```bash
cd contracts

forge build                                  # compiles src/, test/, script/
forge build --sizes                          # + contract size report (24 KB EIP-170 limit)
forge fmt --check                            # formatting gate (line_length 100, 4-space, no bracket spacing)

forge test                                   # full suite
forge test --match-contract MissionClaim -vvv  # the claim suite
npm run test:contracts                       # anvil + the E2E fund→settle→claim flow
```

`npm run test:contracts` needs anvil running (`anvil &`); the script starts its own when it can.

## 4. Deploy

### The deployment script

`contracts/script/DeployMissionClaim.s.sol` — the minimal contract needed to make claiming
operational: MissionClaim against the **existing** CHIPS token, with the voucher signer and owner
wired in the constructor. (Use `script/DeployStack.s.sol` when you want the whole economy, or
`script/RedeployPool.s.sol` for MatchPool + ClaimHub only.)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {MissionClaim} from "../src/MissionClaim.sol";
import {IChips} from "../src/interfaces/IChips.sol";

contract DeployMissionClaim is Script {
    function run() external {
        address chipsAddr = vm.envAddress("CHIPS_ADDRESS");
        if (chipsAddr == address(0)) revert("CHIPS_ADDRESS is mandatory - never a mock token");
        address opKey = vm.envAddress("MISSION_OP_KEY");
        if (opKey == address(0)) revert("MISSION_OP_KEY is mandatory - set the voucher signer");

        address owner_ = vm.envOr("GAME_OWNER", address(0));
        address deployer = vm.envOr("DEPLOYER_ADDRESS", msg.sender);
        if (owner_ == address(0)) owner_ = deployer;

        vm.startBroadcast(deployer);                       // stale DEPLOYER_ADDRESS fails loudly
        MissionClaim missions = new MissionClaim(IChips(chipsAddr), opKey, owner_);
        vm.stopBroadcast();

        console.log("CHIPS (existing)", chipsAddr);
        console.log("opKey (voucher signer)", opKey);
        console.log("owner", owner_);
        console.log("MissionClaim", address(missions));
    }
}
```

### Execution

Prefer the runner — it holds the account id, the preflight and the per-target
required env in one place, and dry-runs by default:

```bash
source contracts/.env                      # CHIPS_ADDRESS, GAME_OWNER, DEPLOYER_ADDRESS, …

# one contract at a time (dry run first, always)
./scripts/deploy-contracts.sh matchpool                       # simulate
./scripts/deploy-contracts.sh matchpool --broadcast           # deploy + verify

# all four most recently changed contracts, in order
./scripts/deploy-contracts.sh all                             # simulate all four
./scripts/deploy-contracts.sh all --broadcast                 # deploy + verify all four

# overrides
./scripts/deploy-contracts.sh seasonclaim --account mydeployer --rpc "$BASE_RPC"
```

Targets: `missionclaim` · `matchpool` · `seasonclaim` · `legacyclaim` · `all`.
The deployer account defaults to **`mydeployer`** (`FOUNDRY_ACCOUNT` overrides it, as
does `--account`), so the keystore imported under that name is what signs. The runner
refuses to start when `forge` is missing, when no RPC is resolvable, or when a target's
required env is unset (e.g. `matchpool` needs `EDGE_SIGNER`) — it never half-deploys.

The equivalent raw commands, if you prefer to drive forge directly:

```bash
cd contracts && source .env

# ── Local (anvil) ────────────────────────────────────────────────────────────
anvil &                                 # chain 31337, funded dev keys
forge script script/DeployMissionClaim.s.sol:DeployMissionClaim \
  --rpc-url anvil \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  --broadcast

# ── Base Sepolia: dry run first (no broadcast) ───────────────────────────────
forge script script/DeployMissionClaim.s.sol:DeployMissionClaim \
  --rpc-url "$SEPOLIA_RPC" --account mydeployer        # prints what it would do

# ── Base Sepolia: deploy + verify ────────────────────────────────────────────
forge script script/DeployMissionClaim.s.sol:DeployMissionClaim \
  --rpc-url "$SEPOLIA_RPC" --account mydeployer --broadcast --verify

# ── Base mainnet: broadcast AS THE OWNER when it differs from the deployer ───
forge script script/DeployMissionClaim.s.sol:DeployMissionClaim \
  --rpc-url "$BASE_RPC" --account mydeployer --broadcast --verify \
  --sender "$GAME_OWNER"
```

The same shape works for `DeployMatchPool`, `DeploySeasonClaim` and `DeployLegacyClaim`
(`script/Deploy<Name>.s.sol:Deploy<Name>`), and for the full stack in one shot via
`script/DeployStack.s.sol`.

Flags that matter: `--account mydeployer` is the deploy keystore (prompts for the password — `deployer`
is NOT used here); `--broadcast` sends the transaction (without it you only simulate); `--sender` overrides
who the script broadcasts as, which is how an owner-multisig deploy works; `--verify` waits for the
broadcast and submits the source to Basescan.

> **Deployment record:** the canonical, dated list of deployed addresses + tx hashes lives in
> [`docs/ops/CONTRACT_DEPLOYMENTS.md](./CONTRACT_DEPLOYMENTS.md). `contracts/.env` holds the live values.

Verify a contract that was deployed without `--verify`:

```bash
forge verify-contract <address> src/MissionClaim.sol:MissionClaim \
  --chain 84532 --etherscan-api-key "$ETHERSCAN_API_KEY"
```

## 5. Make claiming operational (post-deploy, in this order)

A deployed MissionClaim pays nothing until it is initialised and funded:

```bash
# 5a. Register missions, open today's windows, set ceiling/floor/relayer.
#     Requires MISSION_CLAIM_ADDRESS set to what the deploy printed.
npm run claim:init

# 5b. Fund the reward reserve (FUND_AMOUNT is whole CHIPS, default 500).
FUND_AMOUNT=1000 npm run claim:fund

# 5c. Sanity-check the wiring on-chain
cast call "$MISSION_CLAIM_ADDRESS" "opKey()(address)"        --rpc-url "$SEPOLIA_RPC"
cast call "$MISSION_CLAIM_ADDRESS" "paused()(bool)"          --rpc-url "$SEPOLIA_RPC"
cast call "$MISSION_CLAIM_ADDRESS" "availableReserves()(uint256)" --rpc-url "$SEPOLIA_RPC"
cast call "$MISSION_CLAIM_ADDRESS" "perPeriodCeiling()(uint256)"  --rpc-url "$SEPOLIA_RPC"
cast call "$CHIPS_ADDRESS"      "balanceOf(address)(uint256)" "$MISSION_CLAIM_ADDRESS" --rpc-url "$SEPOLIA_RPC"

# 5d. Record the addresses where the rest of the system reads them
#     contracts/.env        MISSION_CLAIM_ADDRESS=0x…
#     app env              NEXT_PUBLIC_MISSION_CLAIM_ADDRESS=0x…   (+ redeploy the worker)
```

Re-run `npm run claim:init` whenever the day or week rolls over — the script computes the current
UTC-day and ISO-week windows from the block it is mined in.

## 6. Pre-flight checklist

- [ ] `CHIPS_ADDRESS` is the real token and `USE_MOCK=false` — a mock minted to the owner is the
      classic testnet→mainnet footgun.
- [ ] `MISSION_OP_KEY` is the address derived from `MISSION_OP_PRIVATE_KEY` (the server signer).
      A mismatch means every voucher reverts `BadSig` and the app reports "Voucher signing failed".
- [ ] The deployer is funded (`cast balance`) and `DEPLOYER_ADDRESS` is current.
- [ ] Dry run executed and read before `--broadcast`.
- [ ] `claim:init` + `claim:fund` ran, and `availableReserves()` covers the period's expected payout.
- [ ] Addresses written back into `contracts/.env` and the app env; the op key never leaves the
      server (HSM/threshold before mainnet volume).

## 7. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Missing chainid parameter (required for v2 api)` | Etherscan V2 needs the chainid in the URL — use the pinned `[etherscan]` table in `foundry.toml` as-is. |
| Verification "pending"/not found | The block explorer indexes a few blocks late; re-run `forge verify-contract`. |
| `insufficient funds for gas * price + value` | Deployer needs ETH on that chain, or `--sender` points at an unfunded account. |
| Script reverts with a script message | Intentional guard (missing `CHIPS_ADDRESS` / `MISSION_OP_KEY`), not a bug. |
| Deployed from the wrong account / wiring skipped | Stale `DEPLOYER_ADDRESS` in `.env` — it beats inline env and makes `owner != deployer`. |
| Claim reverts `BadSig` | `MISSION_OP_KEY` ≠ the signer of `MISSION_OP_PRIVATE_KEY`, or the chain id in the voucher domain differs from the chain you deployed to. |
| Claim reverts `InsufficientReserves` | `claim:fund` has not run or the reserve is depleted — fund again; `ReservesLow` events in the log are the early warning. |
| Script reverts `EvmError: OpcodeNotFound` on `CHIPS.approve` | CHIPS is the **B20** token — run the script under **`base-forge`**, not `forge`. Vanilla forge lacks the Base precompiles and reverts; any script that *calls* CHIPS (e.g. `claim:fund`) needs `base-forge`. Scripts that only pass `CHIPS_ADDRESS` to a constructor are fine with `forge`. |
