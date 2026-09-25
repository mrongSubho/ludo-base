#!/usr/bin/env bash
# Legacy snapshot publish + challenge + setSnapshotRoot runbook.
#
# Timeline (current snapshot):
#   publishedAt    from public/legacy-snapshot.json
#   challengeEnds  publishedAt + 7d  (currently 2026-10-02T05:03:46Z)
#   set-root       ONLY after challenge ends
#   claim window   90 days from set-root
#
# Usage:
#   bash scripts/publish-legacy-root.sh              # preflight + publish checklist
#   bash scripts/publish-legacy-root.sh --preflight  # checks only (safe anytime)
#   bash scripts/publish-legacy-root.sh --set-root   # after challenge end (broadcast)
set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/contracts"
source ./.env 2>/dev/null || true

export CHIPS_ADDRESS="${CHIPS_ADDRESS:-0xB200000000000000000000821408122b9Ed3d05B}"
LEGACY=${LEGACY_CLAIM_ADDRESS:-0x140b790ea880ca7da31f88db75058964699e7ebd}
RPC=${SEPOLIA_RPC:-https://sepolia.base.org}
DEPLOYER=${DEPLOYER_ADDRESS:-0xbcCa5DcBF293D98A627fD3814D5AE8249bB1DFaF}
SNAP="../legacy-snapshot.json"
MODE="${1:-}"

ROOT_HASH=${LEGACY_ROOT:-$(python3 -c "import json;print(json.load(open('$SNAP'))['root'])" 2>/dev/null || true)}
PUBLISHED=$(python3 -c "import json;print(json.load(open('$SNAP')).get('publishedAt',''))" 2>/dev/null || true)
CHALLENGE_ENDS=$(python3 -c "import json;print(json.load(open('$SNAP')).get('challengeEndsAt',''))" 2>/dev/null || true)

echo "legacy contract=$LEGACY"
echo "snapshot root=$ROOT_HASH"
echo "publishedAt=$PUBLISHED"
echo "challengeEndsAt=$CHALLENGE_ENDS"
echo ""

fail=0
check() {
  local label="$1" ok="$2" detail="${3:-}"
  if [[ "$ok" == "0" ]]; then
    echo "  [OK] $label${detail:+ — $detail}"
  else
    echo "  [FAIL] $label${detail:+ — $detail}"
    fail=1
  fi
}

echo "== Preflight =="
# 1. Snapshot file present and claim address matches contract
CLAIM_IN_SNAP=$(python3 -c "import json;print(json.load(open('$SNAP')).get('claim','').lower())" 2>/dev/null || echo "")
if [[ "$CLAIM_IN_SNAP" == "$(echo "$LEGACY" | tr 'A-F' 'a-f')" ]]; then
  check "snapshot bound to live LegacyClaim" 0 "$CLAIM_IN_SNAP"
else
  check "snapshot bound to live LegacyClaim" 1 "snap=$CLAIM_IN_SNAP contract=$LEGACY — rebuild with LEGACY_CLAIM_ADDRESS=$LEGACY"
fi

# 2. Challenge window elapsed (if timestamps present)
if [[ -n "$CHALLENGE_ENDS" ]]; then
  END_EPOCH=$(python3 -c "from datetime import datetime,timezone;print(int(datetime.fromisoformat('$CHALLENGE_ENDS'.replace('Z','+00:00')).timestamp()))")
  NOW_EPOCH=$(date +%s)
  if [[ "$NOW_EPOCH" -ge "$END_EPOCH" ]]; then
    check "7d challenge window elapsed" 0 "end $CHALLENGE_ENDS"
  else
    LEFT=$(( (END_EPOCH - NOW_EPOCH) / 3600 ))
    check "7d challenge window elapsed" 1 "still ~${LEFT}h left — do NOT set-root yet"
  fi
else
  check "challengeEndsAt recorded in snapshot" 1
fi

# 3. Live root not already frozen
LIVE_ROOT=$(base-cast call "$LEGACY" "snapshotRoot()(bytes32)" --rpc-url "$RPC" 2>/dev/null || echo 0x0)
FROZEN=$(base-cast call "$LEGACY" "rootFrozen()(bool)" --rpc-url "$RPC" 2>/dev/null || echo false)
if [[ "$FROZEN" == "true" || "$FROZEN" == "true" ]]; then
  check "LegacyClaim root not already set" 1 "rootFrozen=true live=$LIVE_ROOT"
else
  check "LegacyClaim root not already set" 0 "snapshotRoot=$LIVE_ROOT"
fi

# 4. Snapshot root matches file
if [[ -n "$ROOT_HASH" && "$LIVE_ROOT" == "$ROOT_HASH" ]]; then
  check "live root already equals snapshot" 0 "(idempotent skip set-root)"
elif [[ -n "$ROOT_HASH" ]]; then
  check "snapshot root available to set" 0 "$ROOT_HASH"
fi

# 5. Contract funded (50M needed)
BAL=$(base-cast call "$CHIPS_ADDRESS" "balanceOf(address)(uint256)" "$LEGACY" --rpc-url "$RPC" 2>/dev/null || echo 0)
BAL_INT=$(python3 -c "print(int('$BAL'.split()[0]))" 2>/dev/null || echo 0)
NEED=50000000000000000000000000
if [[ "$BAL_INT" -ge "$NEED" ]]; then
  check "LegacyClaim funded ≥50M CHIPS" 0 "$BAL"
else
  check "LegacyClaim funded ≥50M CHIPS" 1 "balance=$BAL — run scripts/fund-claims.sh first"
fi

# 6. Public file hosted
if [[ -f "$ROOT/public/legacy-snapshot.json" ]]; then
  check "public/legacy-snapshot.json present" 0 "copy to IPFS / https://ludobase.xyz/legacy-snapshot.json"
else
  check "public/legacy-snapshot.json present" 1
fi

echo ""
if [[ "$MODE" == "--preflight" ]]; then
  exit "$fail"
fi

echo "== Publish checklist =="
echo "1. Host legacy-snapshot.json (IPFS or https://ludobase.xyz/legacy-snapshot.json)"
echo "2. Social: 'Legacy snapshot root $ROOT_HASH — challenge 7 days (ends $CHALLENGE_ENDS)'"
echo "3. TOKEN_PARAMS already records publish/challenge for this root"
echo ""

if [[ "$MODE" == "--set-root" ]]; then
  if [[ "$fail" != "0" ]]; then
    echo "Preflight failed — fix issues before setSnapshotRoot." >&2
    exit 1
  fi
  echo "== setSnapshotRoot =="
  base-cast send "$LEGACY" "setSnapshotRoot(bytes32)" "$ROOT_HASH" \
    --rpc-url "$RPC" \
    --account mydeployer
  echo "Root frozen. 90-day claim window opens."
  echo "Next: record tx in TOKEN_PARAMS · mount MerkleClaimPanel · announce claim URL"
else
  echo "After challenge ends: bash scripts/publish-legacy-root.sh --set-root"
fi
