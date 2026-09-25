#!/usr/bin/env bash
# Propose a season Merkle root (opens 48h challenge), then activate after the window.
# Usage:
#   SEASON_EPOCH=1 SEASON_ROOT=0x… SEASON_BUDGET=1000000000000000000000 \
#     bash scripts/propose-season-root.sh
#   ACTIVATE_ROOT=1 SEASON_EPOCH=1 bash scripts/propose-season-root.sh
set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/contracts"
source ./.env

export SEASON_CLAIM_ADDRESS="${SEASON_CLAIM_ADDRESS:-0x83ae874e85c94920540f43fc6706ee485be44cbe}"
export SEASON_EPOCH="${SEASON_EPOCH:-1}"
export SEASON_ROOT="${SEASON_ROOT:-}"
export SEASON_BUDGET="${SEASON_BUDGET:-0}"
export ACTIVATE_ROOT="${ACTIVATE_ROOT:-0}"
export DEPLOYER_ADDRESS="${DEPLOYER_ADDRESS:-0xbcCa5DcBF293D98A627fD3814D5AE8249bB1DFaF}"

if [[ "$ACTIVATE_ROOT" != "1" && -z "$SEASON_ROOT" ]]; then
  echo "SEASON_ROOT required for propose (or set ACTIVATE_ROOT=1)" >&2
  exit 1
fi

echo "season=$SEASON_CLAIM_ADDRESS epoch=$SEASON_EPOCH activate=$ACTIVATE_ROOT"
base-forge script script/SetSeasonRoot.s.sol \
  --rpc-url "$SEPOLIA_RPC" \
  --account mydeployer \
  --sender "$DEPLOYER_ADDRESS" \
  --broadcast

echo "propose: wait 48h challenge, then ACTIVATE_ROOT=1 SEASON_EPOCH=$SEASON_EPOCH bash scripts/propose-season-root.sh"
