#!/usr/bin/env bash
# Foundry deploy helper — local anvil or Base Sepolia.
set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/contracts"

echo "== Foundry =="
forge --version | head -1

# Load contracts/.env without clobbering anything already exported: a plain
# `source ./.env` overrides inline env vars, which makes `FOO=bar ./deploy.sh`
# silently lose. Inline values win here. Trailing "# ..." comments are stripped
# so `ETHERSCAN_API_KEY=abc # note` does not yield "abc # note".
if [[ -f .env ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[[:space:]]*(#|$) ]] && continue
    [[ "$line" != *=* ]] && continue
    __k="${line%%=*}"
    __v="${line#*=}"
    __k="${__k//[[:space:]]/}"
    __v="${__v%%#*}"
    __v="${__v#"${__v%%[![:space:]]*}"}"
    __v="${__v%"${__v##*[![:space:]]}"}"
    [[ -n "$__k" ]] || continue
    [[ -n "${!__k+x}" ]] || export "$__k=$__v"
  done < .env
else
  cp .env.example .env
  echo "created contracts/.env — set CHIPS_ADDRESS, EDGE_SIGNER, GAME_OWNER, DEPLOYER_ADDRESS"
fi

unset __k __v

KEYSTORE_DIR="${FOUNDRY_KEYSTORE_DIR:-$HOME/.foundry/keystores}"
ACCOUNT="${FOUNDRY_ACCOUNT:-deployer}"

# Redeploying the pool is a separate verb from deploying the whole stack, because
# ClaimHub takes the pool address in its constructor and must be deployed with it.
# MissionClaim / SeasonClaim / LegacyClaim have no pool dependency and must NOT be
# redeployed — that orphans the live instances.
VERIFY_FLAG=()
[[ -n "${ETHERSCAN_API_KEY:-}" ]] && VERIFY_FLAG=(--verify)

require_env() {
  local missing=0
  for v in "$@"; do
    if [[ -z "${!v:-}" ]]; then
      echo "  MISSING $v" >&2
      missing=1
    fi
  done
  if [[ $missing -eq 1 ]]; then
    echo "fill these in contracts/.env before deploying" >&2
    exit 1
  fi
}

redeploy_pool() {
  local rpc="$1" network="$2"
  require_env CHIPS_ADDRESS EDGE_SIGNER GAME_OWNER DEPLOYER_ADDRESS
  # Bail out rather than deploy MockChips-style test contracts to a live chain.
  if [[ "${USE_MOCK:-false}" == "true" ]]; then
    echo "  refusing: USE_MOCK=true is set, but this deploys against a real CHIPS token" >&2
    exit 1
  fi
  echo "== Redeploying MatchPool + ClaimHub on $network =="
  echo "   CHIPS : $CHIPS_ADDRESS"
  echo "   owner : ${GAME_OWNER}"
  forge script script/RedeployPool.s.sol:RedeployPool \
    --rpc-url "$rpc" \
    --account "$ACCOUNT" \
    --broadcast \
    "${VERIFY_FLAG[@]}"
  echo
  echo "Verify the line above reads 'setClaimHub: done in this transaction'."
  echo "If it says SKIPPED, run setClaimHub from $GAME_OWNER."
}

cmd="${1:-help}"
case "$cmd" in
  status)
    echo "== Keystore =="
    cast wallet list --keystore-dir "$KEYSTORE_DIR" 2>/dev/null || echo "(no keystore yet)"
    if [[ -n "${SEPOLIA_RPC:-}" ]]; then
      ADDR=$(cast wallet address --keystore "$KEYSTORE_DIR/$ACCOUNT" 2>/dev/null || true)
      echo "account=$ACCOUNT addr=${ADDR:-unset}"
      echo "== Base Sepolia ETH =="
      [[ -n "${ADDR:-}" ]] && cast balance "$ADDR" --rpc-url "$SEPOLIA_RPC" --ether || true
    fi
    if [[ -n "${BASE_RPC:-}" ]]; then
      ADDR=$(cast wallet address --keystore "$KEYSTORE_DIR/$ACCOUNT" 2>/dev/null || true)
      echo "== Base mainnet ETH =="
      [[ -n "${ADDR:-}" ]] && cast balance "$ADDR" --rpc-url "$BASE_RPC" --ether || true
    fi
    ;;
  anvil)
    anvil --port 8545 &
    sleep 1
    forge script script/DeployStack.s.sol --rpc-url http://127.0.0.1:8545 \
      --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
      --broadcast
    ;;
  anvil-pool)
    anvil --port 8545 &
    sleep 1
    CHIPS_ADDRESS="${ANVIL_CHIPS:?set ANVIL_CHIPS to a CHIPS address already on this anvil}" \
    EDGE_SIGNER=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 \
    GAME_OWNER=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 \
    DEPLOYER_ADDRESS=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 \
      forge script script/RedeployPool.s.sol:RedeployPool \
        --rpc-url http://127.0.0.1:8545 \
        --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
        --broadcast
    ;;
  sepolia)
    forge script script/DeployStack.s.sol \
      --rpc-url "${SEPOLIA_RPC:-https://sepolia.base.org}" \
      --account "$ACCOUNT" \
      --broadcast \
      "${VERIFY_FLAG[@]}"
    ;;
  sepolia-pool)
    redeploy_pool "${SEPOLIA_RPC:-https://sepolia.base.org}" "Base Sepolia"
    ;;
  base-pool)
    redeploy_pool "${BASE_RPC:-https://mainnet.base.org}" "Base mainnet"
    ;;
  *)
    cat <<EOF
usage: scripts/foundry-deploy.sh [status|anvil|anvil-pool|sepolia|sepolia-pool|base-pool]

  status        — forge version, keystore list, ETH balance on Sepolia + Base
  anvil         — deploy the FULL stack to local anvil (MockChips)
  anvil-pool    — redeploy MatchPool + ClaimHub on local anvil
  sepolia       — deploy the FULL stack to Base Sepolia
  sepolia-pool  — redeploy MatchPool + ClaimHub to Base Sepolia
  base-pool     — redeploy MatchPool + ClaimHub to Base mainnet

Full stack (anvil/sepolia) redeploys MissionClaim, SeasonClaim and LegacyClaim,
which orphans the live instances. Use the -pool verbs when only MatchPool source
changed: ClaimHub must be redeployed alongside it (the pool address is fixed in
ClaimHub's constructor), but the claim contracts must not be.

Create keystore (interactive, once):
  cast wallet import deployer --interactive

Before any -pool deploy, contracts/.env must have CHIPS_ADDRESS, EDGE_SIGNER,
GAME_OWNER and DEPLOYER_ADDRESS set to the real values. DEPLOYER_ADDRESS must be
the address your deploy key controls.
EOF
    ;;
esac
