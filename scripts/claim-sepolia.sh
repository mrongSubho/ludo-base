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
RPC=${SEPOLIA_RPC:-https://sepolia.base.org}

# The claim must be submitted by the winner — p2 in the smoke flow — so this has
# to be p2's real key.
#
# It was previously hardcoded to anvil #1, whose private key is published in the
# Hardhat/Anvil docs. That means a live Base Sepolia `claimMatch` was signed by
# an account anybody could act as: the transaction either failed for lack of
# funds or, worse, moved a real prize to a known address. This is the same
# published-key class as the SmokeSepolia `P2_PK` constant, and it was the only
# remaining live-network occurrence in the repo.
#
# Take it from the same source smoke-sepolia.sh uses: the p2 keystore, or an
# explicitly exported SMOKE_P2_PK if this is run as a follow-up in the same shell.
KEYSTORE_DIR="${FOUNDRY_KEYSTORE_DIR:-$HOME/.foundry/keystores}"
P2_ACCOUNT="${SMOKE_P2_ACCOUNT:-smoke-p2}"
if [[ -n "${SMOKE_P2_PK:-}" ]]; then
  P2_PK="$SMOKE_P2_PK"
elif [[ -f "$KEYSTORE_DIR/$P2_ACCOUNT" ]]; then
  P2_PK=$(cast wallet private-key --keystore "$KEYSTORE_DIR/$P2_ACCOUNT")
else
  echo "no key for the claim: set SMOKE_P2_PK, or import the $P2_ACCOUNT keystore" >&2
  echo "  cast wallet import $(basename "$P2_ACCOUNT") --keystore-dir $KEYSTORE_DIR --interactive" >&2
  exit 1
fi

# shellcheck disable=SC1091
source "$ROOT/scripts/lib-dev-keys.sh"
assert_not_dev_key_on_live_network \
  "$(cast wallet address --private-key "$P2_PK")" "Base Sepolia"
export CHIPS_ADDRESS="${CHIPS_ADDRESS:-0xB200000000000000000000821408122b9Ed3d05B}"

echo "claim pool=$POOL_ID"
echo "hub=$CLAIM_HUB_ADDRESS chips=$CHIPS_ADDRESS"
base-cast send "$CLAIM_HUB_ADDRESS" "claimMatch(bytes32)" "$POOL_ID" \
  --rpc-url "$RPC" --private-key "$P2_PK"

echo "p2 CHIPS:"
base-cast call "$CHIPS_ADDRESS" "balanceOf(address)(uint256)" \
  0x70997970C51812dc3A010C7d01b50e0d17dc79C8 --rpc-url "$RPC"
