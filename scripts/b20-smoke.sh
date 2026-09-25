#!/usr/bin/env bash
# Wire new B20 MatchPool: setEdgeSigner + BURN_ROLE + real-CHIPS smoke.
# Usage:
#   bash scripts/b20-smoke.sh              # full run (setEdgeSigner + grant burn + smoke)
#   bash scripts/b20-smoke.sh --burn-only  # only grant BURN_ROLE to MatchPool
#   bash scripts/b20-smoke.sh --smoke-only # skip setEdgeSigner/grant (already done)
set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/contracts"
source ./.env

export CHIPS_ADDRESS=0xB200000000000000000000821408122b9Ed3d05B
export USE_MOCK=false
export SMOKE_EDGE=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
export DEPLOYER_ADDRESS=0xbcCa5DcBF293D98A627fD3814D5AE8249bB1DFaF
# Marketplace optional; GrantBurnRole skips it when unset or equal to pool.
export MARKETPLACE_ADDRESS="${MARKETPLACE_ADDRESS:-}"

MODE="${1:-full}"

echo "CHIPS=$CHIPS_ADDRESS"
echo "POOL=$MATCH_POOL_ADDRESS"
echo "HUB=$CLAIM_HUB_ADDRESS"
echo "MODE=$MODE"

run_broadcast() {
  local script_path="$1"
  base-forge script "$script_path" \
    --rpc-url "$SEPOLIA_RPC" \
    --account mydeployer \
    --sender "$DEPLOYER_ADDRESS" \
    --broadcast
}

case "$MODE" in
  --burn-only)
    echo "== GrantBurnRole only =="
    run_broadcast script/GrantBurnRole.s.sol
    ;;
  --smoke-only)
    echo "== SmokeRealChips only =="
    run_broadcast script/SmokeRealChips.s.sol
    ;;
  *)
    echo "== setEdgeSigner =="
    run_broadcast script/SetEdgeSigner.s.sol
    # Separate broadcasts can race the RPC nonce; wait for the prior receipt to land.
    sleep 3
    echo "== GrantBurnRole (MatchPool needs BURN_ROLE for settle burn) =="
    run_broadcast script/GrantBurnRole.s.sol
    sleep 3
    echo "== SmokeRealChips =="
    run_broadcast script/SmokeRealChips.s.sol
    ;;
esac

echo "Wait 5 min then: bash scripts/claim-sepolia.sh <poolId>"
