#!/usr/bin/env bash
# Deploy the four most recently changed contracts, one target at a time.
#
#   ./scripts/deploy-contracts.sh <target|all> [--broadcast] [--rpc <url>] [--account <name>]
#
#   targets: missionclaim | matchpool | seasonclaim | legacyclaim | all
#
# Dry run by default: without --broadcast forge only simulates and prints what it
# would do. The deployer account defaults to `mydeployer` (override with
# --account or FOUNDRY_ACCOUNT), so the keystore already imported under that name
# is what signs.
#
# Env (contracts/.env is loaded by forge; `source .env` first if you export by hand):
#   CHIPS_ADDRESS   mandatory for every target — the EXISTING token, never a mock
#   GAME_OWNER      owner of the new instances (defaults to DEPLOYER_ADDRESS)
#   DEPLOYER_ADDRESS the address the deploy key controls (stale value = wrong sender)
#   EDGE_SIGNER     matchpool only — the settle co-signer
#   MISSION_OP_KEY  voucher/root signer; also the default ROOT_SETTER / SNAPSHOT_SETTER
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONTRACTS="$ROOT/contracts"

TARGET="${1:-}"
shift || true

BROADCAST=""
RPC=""
ACCOUNT="${FOUNDRY_ACCOUNT:-mydeployer}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --broadcast) BROADCAST="--broadcast --verify" ;;
    --rpc) RPC="${2:-}"; shift ;;
    --account) ACCOUNT="${2:-}"; shift ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
  shift
done

usage() {
  echo "usage: $0 <missionclaim|matchpool|seasonclaim|legacyclaim|all> [--broadcast] [--rpc <url>] [--account <name>]"
  exit 2
}
[[ -n "$TARGET" ]] || usage

command -v forge >/dev/null || { echo "forge not on PATH — run 'foundryup' or npm run setup:foundry" >&2; exit 1; }

if [[ -z "$RPC" ]]; then
  RPC="${SEPOLIA_RPC:-${BASE_RPC:-}}"
fi
[[ -n "$RPC" ]] || { echo "no RPC: set SEPOLIA_RPC/BASE_RPC (or pass --rpc)" >&2; exit 1; }

require_env() {
  for v in "$@"; do
    if [[ -z "${!v:-}" ]]; then
      echo "missing env: $v (source contracts/.env first)" >&2
      exit 1
    fi
  done
}

# target -> "forge script path:Contract | required env"
script_for() {
  case "$1" in
    missionclaim) echo "script/DeployMissionClaim.s.sol:DeployMissionClaim" ;;
    matchpool)    echo "script/DeployMatchPool.s.sol:DeployMatchPool" ;;
    seasonclaim)  echo "script/DeploySeasonClaim.s.sol:DeploySeasonClaim" ;;
    legacyclaim)  echo "script/DeployLegacyClaim.s.sol:DeployLegacyClaim" ;;
    *) return 1 ;;
  esac
}

run_one() {
  local name="$1" target
  target="$(script_for "$name")" || { echo "unknown target: $name" >&2; exit 2; }

  case "$name" in
    matchpool)   require_env CHIPS_ADDRESS EDGE_SIGNER ;;
    *)           require_env CHIPS_ADDRESS ;;
  esac

  echo ""
  echo "== $name =="
  echo "   script : $target"
  echo "   account: $ACCOUNT"
  echo "   rpc    : $RPC"
  echo "   mode   : ${BROADCAST:-dry run (no --broadcast)}"
  cd "$CONTRACTS"
  # shellcheck disable=SC2086
  forge script "$target" --rpc-url "$RPC" --account "$ACCOUNT" $BROADCAST
}

echo "deployer account: $ACCOUNT"
echo "rpc:              $RPC"
echo "broadcast:        ${BROADCAST:-no (dry run)}"

case "$TARGET" in
  all) for t in missionclaim matchpool seasonclaim legacyclaim; do run_one "$t"; done ;;
  *)   run_one "$TARGET" ;;
esac

echo ""
echo "Done. Record the printed addresses in contracts/.env (*_ADDRESS) and the app env"
echo "(NEXT_PUBLIC_*_ADDRESS), then run npm run claim:init && npm run claim:fund for claiming."
