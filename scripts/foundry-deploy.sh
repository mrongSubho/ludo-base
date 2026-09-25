#!/usr/bin/env bash
# Foundry deploy helper — local anvil or Base Sepolia.
set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/contracts"

echo "== Foundry =="
forge --version | head -1

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "created contracts/.env — set SEPOLIA_RPC + ETHERSCAN_API_KEY"
fi

# shellcheck disable=SC1091
source ./.env 2>/dev/null || true

KEYSTORE_DIR="${FOUNDRY_KEYSTORE_DIR:-$HOME/.foundry/keystores}"
ACCOUNT="${FOUNDRY_ACCOUNT:-deployer}"

cmd="${1:-help}"
case "$cmd" in
  status)
    echo "== Keystore =="
    cast wallet list --keystore-dir "$KEYSTORE_DIR" 2>/dev/null || echo "(no keystore yet)"
    echo "== Balance (needs SEPOLIA_RPC) =="
    if [[ -n "${SEPOLIA_RPC:-}" ]]; then
      ADDR=$(cast wallet address --keystore "$KEYSTORE_DIR/$ACCOUNT" 2>/dev/null || true)
      echo "account=$ACCOUNT addr=${ADDR:-unset}"
    fi
    ;;
  anvil)
    anvil --port 8545 &
    sleep 1
    forge script script/DeployStack.s.sol --rpc-url http://127.0.0.1:8545 \
      --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
      --broadcast
    ;;
  sepolia)
    forge script script/DeployStack.s.sol \
      --rpc-url "${SEPOLIA_RPC:-https://sepolia.base.org}" \
      --account "$ACCOUNT" \
      --broadcast \
      ${ETHERSCAN_API_KEY:+--verify}
    ;;
  *)
    cat <<EOF
usage: scripts/foundry-deploy.sh [status|anvil|sepolia]

  status   — forge version + keystore list
  anvil    — deploy stack to local anvil (MockChips)
  sepolia  — deploy stack with --account \$FOUNDRY_ACCOUNT (default: deployer)

Create keystore (interactive, once):
  cast wallet import deployer --interactive
# or
  cast wallet new --keystore ~/.foundry/keystores/deployer

Fund Base Sepolia ETH, then fill contracts/.env SEPOLIA_RPC / ETHERSCAN_API_KEY.
EOF
    ;;
esac
