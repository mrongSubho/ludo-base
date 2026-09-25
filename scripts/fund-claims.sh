#!/usr/bin/env bash
# Fund LegacyClaim (50M Treasury budget) and optional SeasonClaim with B20 CHIPS.
# Usage:
#   bash scripts/fund-claims.sh              # 50M to LegacyClaim
#   SEASON_BUDGET=1000000 bash scripts/fund-claims.sh   # also 1M CHIPS to SeasonClaim
# Env: contracts/.env (SEPOLIA_RPC, DEPLOYER_ADDRESS, CHIPS_ADDRESS…)
set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/contracts"
source ./.env

export CHIPS_ADDRESS="${CHIPS_ADDRESS:-0xB200000000000000000000821408122b9Ed3d05B}"
LEGACY=${LEGACY_CLAIM_ADDRESS:-0x140b790ea880ca7da31f88db75058964699e7ebd}
SEASON=${SEASON_CLAIM_ADDRESS:-0x83ae874e85c94920540f43fc6706ee485be44cbe}
DEPLOYER=${DEPLOYER_ADDRESS:-0xbcCa5DcBF293D98A627fD3814D5AE8249bB1DFaF}
RPC=${SEPOLIA_RPC:-https://sepolia.base.org}

# 50_000_000 * 1e18
LEGACY_AMOUNT=${LEGACY_AMOUNT:-50000000000000000000000000}
SEASON_AMOUNT_WEI=${SEASON_BUDGET:-0}

echo "chips=$CHIPS_ADDRESS"
echo "deployer=$DEPLOYER"
echo "legacy=$LEGACY amount=$LEGACY_AMOUNT"
echo "season=$SEASON amount=$SEASON_AMOUNT_WEI"

echo "== balances (pre) =="
base-cast call "$CHIPS_ADDRESS" "balanceOf(address)(uint256)" "$DEPLOYER" --rpc-url "$RPC"
base-cast call "$CHIPS_ADDRESS" "balanceOf(address)(uint256)" "$LEGACY" --rpc-url "$RPC"

echo "== transfer 50M CHIPS -> LegacyClaim =="
base-cast send "$CHIPS_ADDRESS" "transfer(address,uint256)" "$LEGACY" "$LEGACY_AMOUNT" \
  --rpc-url "$RPC" --account mydeployer

if [[ "$SEASON_AMOUNT_WEI" != "0" ]]; then
  echo "== transfer $SEASON_AMOUNT_WEI wei CHIPS -> SeasonClaim =="
  base-cast send "$CHIPS_ADDRESS" "transfer(address,uint256)" "$SEASON" "$SEASON_AMOUNT_WEI" \
    --rpc-url "$RPC" --account mydeployer
fi

echo "== balances (post) =="
base-cast call "$CHIPS_ADDRESS" "balanceOf(address)(uint256)" "$DEPLOYER" --rpc-url "$RPC"
base-cast call "$CHIPS_ADDRESS" "balanceOf(address)(uint256)" "$LEGACY" --rpc-url "$RPC"
base-cast call "$CHIPS_ADDRESS" "balanceOf(address)(uint256)" "$SEASON" --rpc-url "$RPC"
