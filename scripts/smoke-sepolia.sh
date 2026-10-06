#!/usr/bin/env bash
# Live Base Sepolia smoke: create -> join x2 -> lock -> settle -> claim
#
# SECURITY: this targets a LIVE network, so it must not use the well-known Anvil
# default keys. It previously did (SMOKE_PK was anvil #0), which meant anyone
# could act as the smoke host and read the flow. Roles now come from keystores.
#
# Prerequisites:
#   cast wallet import smoke-host  --keystore-dir ~/.foundry/keystores --interactive
#   cast wallet import smoke-p2    --keystore-dir ~/.foundry/keystores --interactive
#   fund both on Sepolia, then set MATCH_POOL edgeSigner to the smoke host:
#     cast send <MATCH_POOL_ADDRESS> "setEdgeSigner(address)" <smoke-host> --account mydeployer
set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT/contracts"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib-load-env.sh"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib-dev-keys.sh"

KEYSTORE_DIR="${FOUNDRY_KEYSTORE_DIR:-$HOME/.foundry/keystores}"
HOST_ACCOUNT="${SMOKE_HOST_ACCOUNT:-smoke-host}"
P2_ACCOUNT="${SMOKE_P2_ACCOUNT:-smoke-p2}"
RPC=${SEPOLIA_RPC:-https://sepolia.base.org}

for f in "$KEYSTORE_DIR/$HOST_ACCOUNT" "$KEYSTORE_DIR/$P2_ACCOUNT"; do
  if [[ ! -f "$f" ]]; then
    echo "missing keystore: $f" >&2
    echo "  cast wallet import $(basename "$f") --keystore-dir $KEYSTORE_DIR --interactive" >&2
    exit 1
  fi
done

HOST=$(cast wallet address --keystore "$KEYSTORE_DIR/$HOST_ACCOUNT")
P2=$(cast wallet address --keystore "$KEYSTORE_DIR/$P2_ACCOUNT")

assert_not_dev_key_on_live_network "$HOST" "Base Sepolia"
assert_not_dev_key_on_live_network "$P2" "Base Sepolia"

# SmokeSepolia.s.sol calls vm.startBroadcast(<pk>) with an explicit key, which
# overrides forge's --account on the command line. It reads these two from the
# environment, so they have to be exported here or `run()` reverts on
# vm.envUint before broadcasting anything.
#
# This was the remaining half of the published-key problem: the host leg was
# already read from env, but the player-2 leg still broadcast with a hardcoded
# anvil default, and neither variable was exported at all, so the live smoke run
# could not have completed. Derive both from the same keystores whose addresses
# were just checked against the dev-key list above.
SMOKE_HOST_PK=$(cast wallet private-key --keystore "$KEYSTORE_DIR/$HOST_ACCOUNT")
SMOKE_P2_PK=$(cast wallet private-key --keystore "$KEYSTORE_DIR/$P2_ACCOUNT")
export SMOKE_HOST_PK SMOKE_P2_PK

# Belt and braces: the guard above ran on the derived addresses, but the keys
# themselves are what get signed with, so check the actual values too.
assert_not_dev_key_on_live_network "$(cast wallet address --private-key "$SMOKE_HOST_PK")" "Base Sepolia"
assert_not_dev_key_on_live_network "$(cast wallet address --private-key "$SMOKE_P2_PK")" "Base Sepolia"

echo "host(smoke)=$HOST"
echo "p2=$P2"
echo "pool=$MATCH_POOL_ADDRESS chips=$CHIPS_ADDRESS hub=$CLAIM_HUB_ADDRESS"

echo "== fund smoke accounts (0.01 ETH each from mydeployer) =="
cast send "$HOST" --value 0.01ether --rpc-url "$RPC" --account mydeployer
cast send "$P2" --value 0.01ether --rpc-url "$RPC" --account mydeployer

echo "== SmokeSepolia =="
forge script script/SmokeSepolia.s.sol --rpc-url "$RPC" \
  --account "$HOST_ACCOUNT" --broadcast
