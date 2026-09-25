#!/usr/bin/env bash
# Claim the Sepolia smoke prize after the claim-unlock / dispute window.
# Usage: bash scripts/claim-sepolia.sh <poolId>
#   <poolId> is the 32-byte match id from SmokeRealChips logs (NOT the MatchPool contract address).
set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/contracts"
source ./.env

if [[ $# -lt 1 ]]; then
  echo "usage: bash scripts/claim-sepolia.sh <poolId>" >&2
  echo "  poolId = bytes32 from smoke logs (e.g. 0xde2d…), not MATCH_POOL_ADDRESS 0x879E…" >&2
  exit 1
fi

POOL_ID="$1"
P2_PK=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
RPC=${SEPOLIA_RPC:-https://sepolia.base.org}
export CHIPS_ADDRESS="${CHIPS_ADDRESS:-0xB200000000000000000000821408122b9Ed3d05B}"

echo "claim pool=$POOL_ID"
echo "hub=$CLAIM_HUB_ADDRESS chips=$CHIPS_ADDRESS"
base-cast send "$CLAIM_HUB_ADDRESS" "claimMatch(bytes32)" "$POOL_ID" \
  --rpc-url "$RPC" --private-key "$P2_PK"

echo "p2 CHIPS:"
base-cast call "$CHIPS_ADDRESS" "balanceOf(address)(uint256)" \
  0x70997970C51812dc3A010C7d01b50e0d17dc79C8 --rpc-url "$RPC"
