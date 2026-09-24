#!/usr/bin/env bash
# Anvil dry-run: deploy MockChips + MatchPool + ClaimHub, then forge test E2E.
# Full wallet flow lives in contracts/test/E2EFundSettleClaim.t.sol (fund → settle → claim).
set -euo pipefail
export PATH="${HOME}/.foundry/bin:${PATH}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/contracts"

echo "== forge test E2E (fund → settle → claim) =="
forge test --match-contract E2EFundSettleClaim -vv

echo "== optional: start anvil for manual cast flows =="
if [[ "${WITH_ANVIL:-0}" == "1" ]]; then
  anvil --port 8545 &
  ANVIL_PID=$!
  trap 'kill $ANVIL_PID 2>/dev/null || true' EXIT
  sleep 1
  echo "anvil pid $ANVIL_PID — deploy with: forge script script/DeployGame.s.sol --rpc-url http://127.0.0.1:8545 --broadcast"
fi

echo "done"
