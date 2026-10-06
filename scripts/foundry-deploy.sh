#!/usr/bin/env bash
# Foundry deploy helper — local anvil or Base Sepolia.
set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT/contracts"

echo "== Foundry =="
forge --version | head -1

# Shared loader (scripts/lib-load-env.sh): inline env wins over contracts/.env.
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib-load-env.sh"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib-dev-keys.sh"

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

# A live-network deploy is a chain write that costs money and cannot be undone.
# Run the simulation first, then require an explicit opt-in to broadcast: this
# script is easy to invoke by accident (a test, a stray shell history entry, a
# "just checking" run), and `forge script --broadcast` will happily spend real
# ETH on whatever is in contracts/.env at that moment.
redeploy_pool() {
  local rpc="$1" network="$2"
  require_env CHIPS_ADDRESS EDGE_SIGNER GAME_OWNER DEPLOYER_ADDRESS
  # Bail out rather than deploy MockChips-style test contracts to a live chain.
  if [[ "${USE_MOCK:-false}" == "true" ]]; then
    echo "  refusing: USE_MOCK=true is set, but this deploys against a real CHIPS token" >&2
    exit 1
  fi
  # A dev key as an on-chain role is fatal: anyone can sign as edge signer and
  # authorize settlement, or as owner and drain the pool. The anvil verbs bypass
  # this because they only target a throwaway local chain.
  assert_not_dev_key_on_live_network "${EDGE_SIGNER:-}" "$network"
  assert_not_dev_key_on_live_network "${GAME_OWNER:-}" "$network"
  assert_not_dev_key_on_live_network "${DEPLOYER_ADDRESS:-}" "$network"

  local broadcast=()
  if [[ "${LUDO_CONFIRM_DEPLOY:-}" == "yes" ]]; then
    broadcast=(--broadcast)
  fi

  echo "== Redeploying MatchPool + ClaimHub on $network =="
  echo "   CHIPS    : $CHIPS_ADDRESS"
  echo "   owner    : ${GAME_OWNER}"
  echo "   edge     : ${EDGE_SIGNER}"
  echo "   chips RPC: $rpc"
  if [[ ${#broadcast[@]} -eq 0 ]]; then
    echo "   MODE     : SIMULATION (nothing will be sent)"
  else
    echo "   MODE     : BROADCAST"
  fi
  echo

  forge script script/RedeployPool.s.sol:RedeployPool \
    --rpc-url "$rpc" \
    --account "$ACCOUNT" \
    "${broadcast[@]}" \
    "${VERIFY_FLAG[@]}"

  echo
  if [[ ${#broadcast[@]} -eq 0 ]]; then
    echo "Simulation only — no transaction was sent."
    echo "Check the output above, then re-run with LUDO_CONFIRM_DEPLOY=yes to broadcast:"
    echo "  LUDO_CONFIRM_DEPLOY=yes FOUNDRY_ACCOUNT=$ACCOUNT scripts/foundry-deploy.sh ${network,,}-pool"
  else
    echo "Verify the line above reads 'setClaimHub: done in this transaction'."
    echo "If it says SKIPPED, run setClaimHub from $GAME_OWNER."
    echo "Then: scripts/verify-contracts.sh ${network,,}"
  fi
}

cmd="${1:-help}"
case "$cmd" in
  status)
    # NOTE: `cast wallet list` takes no --keystore-dir in Foundry 1.8.x, and an
    # earlier version of this script passed it anyway; the resulting exit code 2
    # was swallowed by `|| echo "(no keystore yet)"` and reported a false
    # negative. List the directory directly instead.
    echo "== Keystore dir: $KEYSTORE_DIR =="
    KS_COUNT=0
    if [[ -d "$KEYSTORE_DIR" ]]; then
      for f in "$KEYSTORE_DIR"/*; do
        [[ -f "$f" ]] || continue
        KS_COUNT=$((KS_COUNT + 1))
        printf "  %s%s\n" "$(basename "$f")" "$([[ "$(basename "$f")" == "$ACCOUNT" ]] && echo '   <- FOUNDRY_ACCOUNT')"
      done
      [[ $KS_COUNT -eq 0 ]] && echo "  (directory exists but holds no keystore files)"
    else
      echo "  (directory does not exist)"
    fi

    KS_FILE="$KEYSTORE_DIR/$ACCOUNT"
    if [[ -f "$KS_FILE" ]]; then
      # Encrypted keystores keep no plaintext address, so this prompts for the
      # password once and the result is reused for both balance lookups.
      ADDR=$(cast wallet address --keystore "$KS_FILE" 2>/dev/null || true)
    else
      ADDR=""
    fi

    if [[ -z "$ADDR" ]]; then
      if [[ -f "$KS_FILE" ]]; then
        echo "  $ACCOUNT exists at $KS_FILE but the address could not be read."
        echo "  (no plaintext address is stored; the password prompt was declined or wrong)"
      elif [[ $KS_COUNT -gt 0 ]]; then
        echo "  \$ACCOUNT='$ACCOUNT' has no keystore at $KS_FILE"
        echo "  try another: FOUNDRY_ACCOUNT=<name> scripts/foundry-deploy.sh status"
      else
        echo "  no keystore found; create one with: cast wallet import $ACCOUNT --interactive"
      fi
    else
      echo "  $ACCOUNT = $ADDR"
      if [[ -n "${DEPLOYER_ADDRESS:-}" ]]; then
        if [[ "$(tr 'A-Z' 'a-z' <<<"$ADDR")" == "$(tr 'A-Z' 'a-z' <<<"$DEPLOYER_ADDRESS")" ]]; then
          echo "    matches DEPLOYER_ADDRESS  OK (setClaimHub will wire in-transaction)"
        else
          echo "    !! does NOT match DEPLOYER_ADDRESS ($DEPLOYER_ADDRESS)"
          echo "       setClaimHub would be SKIPPED. Either broadcast with the"
          echo "       DEPLOYER_ADDRESS key, or fix DEPLOYER_ADDRESS in contracts/.env."
        fi
      fi
      for pair in "Base Sepolia:${SEPOLIA_RPC:-}" "Base mainnet:${BASE_RPC:-}"; do
        label="${pair%%:*}"
        rpc="${pair#*:}"
        [[ -z "$rpc" ]] && continue
        printf "    %-14s %s ETH\n" "$label" "$(cast balance "$ADDR" --rpc-url "$rpc" --ether 2>/dev/null || echo '?')"
      done
    fi
    ;;
  anvil)
    # Anvil's default key is used here on purpose: this chain is local, ephemeral
    # and holds no value. scripts/lib-dev-keys.sh blocks it on every live verb.
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
    # DeployStack mints MockChips and funds the owner with 1,000,000 CHIPS, so it
    # must never run against a live network even by accident.
    if [[ "${USE_MOCK:-false}" == "true" ]]; then
      echo "  refusing: USE_MOCK=true would deploy a MockChips token to Base Sepolia" >&2
      echo "  use 'sepolia-pool' for a real redeploy, or set USE_MOCK=false deliberately" >&2
      exit 1
    fi
    assert_not_dev_key_on_live_network "${EDGE_SIGNER:-}" "Base Sepolia"
    assert_not_dev_key_on_live_network "${GAME_OWNER:-}" "Base Sepolia"
    assert_not_dev_key_on_live_network "${DEPLOYER_ADDRESS:-}" "Base Sepolia"
    local broadcast=()
    [[ "${LUDO_CONFIRM_DEPLOY:-}" == "yes" ]] && broadcast=(--broadcast)
    if [[ ${#broadcast[@]} -eq 0 ]]; then
      echo "   MODE: SIMULATION (nothing will be sent; re-run with LUDO_CONFIRM_DEPLOY=yes)"
    fi
    forge script script/DeployStack.s.sol \
      --rpc-url "${SEPOLIA_RPC:-https://sepolia.base.org}" \
      --account "$ACCOUNT" \
      "${broadcast[@]}" \
      "${VERIFY_FLAG[@]}"
    ;;
  sepolia-pool)
    redeploy_pool "${SEPOLIA_RPC:-https://sepolia.base.org}" "Sepolia"
    ;;
  base-pool)
    redeploy_pool "${BASE_RPC:-https://mainnet.base.org}" "Base"
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
the address your deploy key controls, and none of the three may be a well-known
Anvil/Hardhat dev key (scripts/lib-dev-keys.sh enforces this).

-pool verbs SIMULATE by default. Broadcasting is opt-in:

  LUDO_CONFIRM_DEPLOY=yes FOUNDRY_ACCOUNT=deployer scripts/foundry-deploy.sh sepolia-pool
EOF
    ;;
esac
