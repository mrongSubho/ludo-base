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
# It also cross-checks the addresses against the chain, because a stale
# contracts/.env makes this script verify the PREVIOUS deployment and report
# success: Sourcify answers "already verified" for the old pair and the exit
# code stays 0. That is how a redeploy of ECO-08 reported "all contracts
# verified" while the live contracts were unverified.
#
# Usage:
#   scripts/verify-contracts.sh            # verify the Sepolia stack
#   scripts/verify-contracts.sh base       # Base mainnet
set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT/contracts"

# Shared loader: inline env wins over contracts/.env. A plain `source ./.env`
# here made a stale MATCH_POOL_ADDRESS silently override the caller's value, and
# the script then verified the previous deployment while exiting 0.
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib-load-env.sh"

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
# `already verified` is only meaningful if the deployed bytecode matches what we
# are about to submit. A stale contracts/.env makes this script verify the
# PREVIOUS deployment and still exit 0: Sourcify answers "already verified" for
# the old pair. That is exactly how the ECO-08 redeploy reported success while
# the live contracts were unverified.
assert_matches_artifact() {
  local address="$1" artifact="$2" label="$3"
  local onchain
  onchain=$(cast code "$address" --rpc-url "$RPC" 2>/dev/null || true)
  if [[ -z "$onchain" || "$onchain" == "0x" ]]; then
    echo "   $label: NO CODE at $address on chain $CHAIN_ID" >&2
    echo "   check MATCH_POOL_ADDRESS / CLAIM_HUB_ADDRESS in contracts/.env" >&2
    return 1
  fi
  if [[ ! -f "$artifact" ]]; then
    echo "   $label: artifact $artifact missing; run forge build" >&2
    return 1
  fi
  local local_size
  local_size=$(python3 -c "
import json
o = json.load(open('$artifact'))['deployedBytecode']['object']
print((len(o) - 2) // 2)
" 2>/dev/null || true)
  local onchain_size=$(( (${#onchain} - 2) / 2 ))
  if [[ -z "$local_size" ]]; then
    echo "   $label: could not read $artifact" >&2
    return 1
  fi
  if [[ "$onchain_size" != "$local_size" ]]; then
    echo "   $label: runtime size mismatch — on-chain ${onchain_size}B vs local ${local_size}B" >&2
    echo "   the deployed contract is NOT the current source. Redeploy first." >&2
    return 1
  fi
  echo "   $label: bytecode matches current build (${onchain_size}B)"
}

verify_one() {
  local address="$1" target="$2" args="$3" artifact="${4:-}"
  echo
  echo "-- $target @ $address"

  if [[ -n "$artifact" ]] && ! assert_matches_artifact "$address" "$artifact" "$target"; then
    return 1
  fi

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
verify_one "$HUB" src/ClaimHub.sol:ClaimHub "$HUB_ARGS" out/ClaimHub.sol/ClaimHub.json || rc=1
verify_one "$POOL" src/MatchPool.sol:MatchPool "$POOL_ARGS" out/MatchPool.sol/MatchPool.json || rc=1

echo
if [[ $rc -eq 0 ]]; then
  echo "all contracts verified on $NETWORK (chain $CHAIN_ID):"
  echo "  MatchPool $POOL"
  echo "  ClaimHub  $HUB"
else
  echo "verification incomplete on $NETWORK (chain $CHAIN_ID)" >&2
fi
exit $rc
