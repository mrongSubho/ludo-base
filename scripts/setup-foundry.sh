#!/usr/bin/env bash
# Foundry + deployer keystore setup for Ludo Base contracts.
set -euo pipefail
export PATH="${HOME}/.foundry/bin:${PATH}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/contracts"

echo "== Foundry =="
forge --version
cast --version

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "created contracts/.env — fill SEPOLIA_RPC_URL + ETHERSCAN_API_KEY"
fi

echo ""
echo "== Deployer keystore =="
echo "Create or import a TESTNET-only key (never reuse mainnet keys)."
echo "  1) New:      cast wallet new --keystore keystore/deployer"
echo "  2) Import:   cast wallet import deployer --interactive"
echo "  3) List:     cast wallet list"
echo ""
read -r -p "Create a new local keystore at keystore/deployer? [y/N] " yn
if [[ "${yn:-N}" =~ ^[Yy]$ ]]; then
  mkdir -p keystore
  cast wallet new --keystore keystore/deployer
  echo "Saved keystore/deployer — keep the password safe; use --account deployer after import to ~/.foundry/keystores or cast wallet import."
fi

echo ""
echo "== Fund deployer (Base Sepolia) =="
echo "Get test ETH: https://docs.base.org/docs/tools/faucets (CDP faucet) or https://www.alchemy.com/faucets/base-sepolia"
echo "Then: cast balance <deployer-address> --rpc-url \$SEPOLIA_RPC_URL"

echo ""
echo "== Deploy (MockChips stack) =="
echo "  source .env"
echo "  forge script script/DeployStack.s.sol --rpc-url \$SEPOLIA_RPC_URL --account deployer --broadcast"
echo ""
echo "Done setup scaffold."
