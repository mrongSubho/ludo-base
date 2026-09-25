#!/usr/bin/env bash
# Live Base Sepolia smoke: create -> join x2 -> lock -> settle -> claim
# Prerequisite (owner = mydeployer): setEdgeSigner(smoke host 0xf39F6e51...)
set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/contracts"
source ./.env 2>/dev/null || true

SMOKE_PK=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
P2_PK=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
RPC=${SEPOLIA_RPC:-https://sepolia.base.org}
HOST=$(cast wallet address --private-key "$SMOKE_PK")
P2=$(cast wallet address --private-key "$P2_PK")

echo "host(smoke)=$HOST"
echo "p2=$P2"
echo "pool=$MATCH_POOL_ADDRESS chips=$CHIPS_ADDRESS hub=$CLAIM_HUB_ADDRESS"

echo "== fund smoke keys (0.01 ETH each from mydeployer) =="
cast send "$HOST" --value 0.01ether --rpc-url "$RPC" --account mydeployer
cast send "$P2" --value 0.01ether --rpc-url "$RPC" --account mydeployer

echo "== SmokeSepolia =="
forge script script/SmokeSepolia.s.sol --rpc-url "$RPC" \
  --private-key "$SMOKE_PK" --broadcast
