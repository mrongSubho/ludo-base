#!/usr/bin/env bash
# Fund MissionClaim so onboarding/mission vouchers can pay out.
# Usage: bash scripts/fund-mission.sh [amount_wei]
#   default 10_000_000 CHIPS = 10000000000000000000000000
set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/contracts"
source ./.env

CHIPS=0xB200000000000000000000821408122b9Ed3d05B
MISSION=0x01abff6c58a25b80bfd68cb563b54c1155aa1def
AMOUNT=${1:-10000000000000000000000000}
DEPLOYER=${DEPLOYER_ADDRESS:-0xbcCa5DcBF293D98A627fD3814D5AE8249bB1DFaF}

echo "chips=$CHIPS"
echo "mission=$MISSION amount=$AMOUNT"
echo "deployer=$DEPLOYER"
base-cast send "$CHIPS" "transfer(address,uint256)" "$MISSION" "$AMOUNT" \
  --rpc-url "${SEPOLIA_RPC:-https://sepolia.base.org}" \
  --account mydeployer
echo "MissionClaim balance:"
base-cast call "$CHIPS" "balanceOf(address)(uint256)" "$MISSION" --rpc-url "${SEPOLIA_RPC:-https://sepolia.base.org}"
