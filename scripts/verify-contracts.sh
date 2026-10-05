#!/usr/bin/env bash
# Verify deployed contracts against Etherscan V2 / Sourcify.
#
# Why this exists instead of plain `forge script --verify`:
#   1. Etherscan retired the per-network V1 hosts (api-sepolia.basescan.org),
#      so verification against them fails with "deprecated V1 endpoint".
#      V2 is one endpoint and takes chainid as a query param.
#   2. Forge 1.8.x does not forward a `chainid` key from [etherscan] config --
#      it silently drops it. The chain has to be supplied via --chain-id, which
#      `forge script` cannot do for already-deployed contracts.
#   3. Sourcify succeeds where Etherscan fails, so it is tried as a fallback.
#
# Usage:
#   scripts/verify-contracts.sh            # verify the Sepolia stack
#   scripts/verify-contracts.sh base       # Base mainnet
set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/contracts"

# shellcheck disable=SC1091
[[ -f .env ]] && source ./.env || true

NETWORK="${1:-sepolia}"
case "$NETWORK" in
  sepolia)
    CHAIN_ID=84532
    RPC="${SEPOLIA_RPC:-https://sepolia.base.org}"
    ;;
  base)
    CHAIN_ID=8453
    RPC="${BASE_RPC:-https://mainnet.base.org}"
    ;;
  *)
    echo "usage: scripts/verify-contracts.sh [sepolia|base]" >&2
    exit 1
    ;;
esac

# The addresses to verify. Override from .env when they differ.
POOL="${NEXT_PUBLIC_MATCH_POOL_ADDRESS:?set NEXT_PUBLIC_MATCH_POOL_ADDRESS}"
HUB="${NEXT_PUBLIC_CLAIM_HUB_ADDRESS:?set NEXT_PUBLIC_CLAIM_HUB_ADDRESS}"
CHIPS="${NEXT_PUBLIC_CHIPS_ADDRESS:?set NEXT_PUBLIC_CHIPS_ADDRESS}"
OWNER="${GAME_OWNER:?set GAME_OWNER}"

if [[ -z "${ETHERSCAN_API_KEY:-}" ]]; then
  echo "ETHERSCAN_API_KEY not set; only Sourcify will be attempted" >&2
fi

# Tries Etherscan V2 first, falls back to Sourcify. Skips contracts the
# verifier already has, so reruns are cheap and idempotent.
verify_one() {
  local address="$1" target="$2" args="$3"
  echo
  echo "-- $target @ $address"

  if forge verify-contract "$address" "$target" \
       --chain-id "$CHAIN_ID" --rpc-url "$RPC" --constructor-args "$args" \
       --verifier etherscan 2>&1 | tee /tmp/verify.$$ | grep -qiE "success|already verified|verified on etherscan"; then
    echo "   OK (etherscan)"
    rm -f /tmp/verify.$$
    return 0
  fi

  echo "   etherscan failed; trying sourcify"
  if forge verify-contract "$address" "$target" \
       --chain-id "$CHAIN_ID" --rpc-url "$RPC" --constructor-args "$args" \
       --verifier sourcify --watch 2>&1 | tee /tmp/verify.$$ | grep -qiE "success|already verified"; then
    echo "   OK (sourcify)"
    rm -f /tmp/verify.$$
    return 0
  fi

  echo "   FAILED -- see output above" >&2
  rm -f /tmp/verify.$$
  return 1
}

POOL_ARGS=$(cast abi-encode "constructor(address,address,address)" "$CHIPS" "$EDGE_SIGNER" "$OWNER")
HUB_ARGS=$(cast abi-encode "constructor(address,address,address)" "$CHIPS" "$POOL" "$OWNER")

rc=0
verify_one "$HUB" src/ClaimHub.sol:ClaimHub "$HUB_ARGS" || rc=1
verify_one "$POOL" src/MatchPool.sol:MatchPool "$POOL_ARGS" || rc=1

echo
if [[ $rc -eq 0 ]]; then
  echo "all contracts verified on $NETWORK (chain $CHAIN_ID)"
else
  echo "some contracts are unverified on $NETWORK (chain $CHAIN_ID)" >&2
fi
exit $rc
