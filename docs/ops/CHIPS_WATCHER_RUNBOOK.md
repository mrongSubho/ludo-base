# Watcher runbook — CHIPS pools & settle (Phase 1)

**Owner:** Edge / ops on-call · **Chain:** Base Sepolia then Base  
**Related:** `CHIPS_PLANNING.md` sections 4.3, 8.6, 8.10 · `TOKEN_PARAMS.md`

## 1. What to watch

| Signal | Source | Healthy | Action |
| --- | --- | --- | --- |
| Edge co-sign latency | settle retry queue | p95 < 15s | Alert >60s; drain queue; check Edge key |
| Locked-but-unsettled | `chips_pools` / MatchPool | ~0 past effective `settleBy` | Trigger Mode B or timeout-refund |
| ClaimHub vs chain ε | indexer reconcile | < 0.1% or < 10k CHIPS | Freeze voucher issuance + new pools; claims/refunds stay up |
| Indexer lag | block cursor | p95 < 30s | Restart indexer; backfill × reorg depth |
| Unresolvable hangs | pools past `settleBy + pauseDelta + refundGrace` | none | Edge `attestUnresolvable` → `timeoutRefund` |
| Pause incidents | B20 pause events | none | Follow pause matrix; `pauseDelta` auto-extends settle |

## 2. Timeout-refund (anyone)

After **effective** `settleBy + pauseDelta + refundGrace` (default grace 180s):

1. Prefer **Mode B** `settlePool` with Edge-only sig if the match has a resolvable outcome.
2. Else `timeoutRefund(poolId, true, edgeSig)` with Edge-`unresolvable` attestation.
3. Security multisig `attestUnresolvable` only if Edge is down **>30 min** past effective deadline (announced).
4. Players then `refundJoin` (immediate on cancelled).

## 3. Pause incident checklist

1. Pause `TRANSFER` and/or `BURN` on CHIPS (SecurityMultisig).
2. Confirm pools record `pauseDelta` (settle deadline extends — pause ≠ refunds).
3. Communicate delay in UI (“incident pause — prizes delayed”).
4. Unpause after 24h timelock (or documented emergency).
5. Resume Mode A/B settle; watch backlog.

## 4. ε-breach response

1. Freeze mission voucher issuance (`MissionClaim.setPaused` or server flag).
2. Stop `createPool` promotions (lobby hide).
3. Reconcile `burnedTotal` / pool credits vs chain via `lib/chipsIndexer.ts`.
4. Only after match: resume; never force-push user credits.

## 5. Dispute window

Post-settle `claimUnlockAt` (2/5/10 min by tier). Watchers may flag fraud during the window; they must **not** race players for claims. KPI: settle latency excludes this window.

## 6. Keys

| Key | Custody | Rotate |
| --- | --- | --- |
| `EDGE_SETTLE_PRIVATE_KEY` | Edge secret store; **HSM/threshold before mainnet paid pools** | Immediate revoke + `setEdgeSigner` |
| Mission op-key | On-chain registry | `setOpKey` multisig + old revoke |
| Scorer | Rewards surfaces only | Immediate |

Never log private keys. Never commit `.env`.

## 7. Funding claims (Legacy / Season)

Before any merkle claim opens, contracts must hold B20 CHIPS (pull payouts).

```bash
# 50M CHIPS → LegacyClaim (Treasury budget)
bash scripts/fund-claims.sh

# optional: also fund SeasonClaim
SEASON_BUDGET=1000000000000000000000000 bash scripts/fund-claims.sh   # 1M CHIPS
```

Assert after: `balanceOf(LegacyClaim) >= 50_000_000e18`. Refill if drained; unclaimed legacy reverts to Treasury only after the 90-day window.

## 8. Legacy snapshot → set-root (runbook)

| Step | When | Command / action |
| --- | --- | --- |
| 1 Build snapshot | freeze writers (`202609230003`) | `tsx scripts/build-legacy-snapshot.ts` (sets `publishedAt` + `challengeEndsAt`) |
| 2 Host JSON | same day | `public/legacy-snapshot.json` → IPFS or `https://ludobase.xyz/legacy-snapshot.json` |
| 3 Announce | same day | Social: root hash + challenge ends in 7 days |
| 4 Preflight | anytime | `bash scripts/publish-legacy-root.sh --preflight` |
| 5 Fund | before claims | `bash scripts/fund-claims.sh` |
| 6 set-root | **after** challenge end | `bash scripts/publish-legacy-root.sh --set-root` |
| 7 Record | same day | TOKEN_PARAMS: set-root tx + window end |
| 8 Claims | 90 days | `MerkleClaimPanel` / `LegacyClaim.claim` |

**Current snapshot:** root `0x44cb6fd4…857b` · LegacyClaim `0x140b790e…7ebd` · challenge ends **2026-10-02T05:03:46Z**.

Rules:
- Never `--set-root` before the 7-day challenge (preflight fails closed).
- Rebuild the snapshot if the claim contract address changes (leaf binds `address(this)`).
- `setSnapshotRoot` freezes the root forever — wrong root means a new LegacyClaim deploy.

## 9. Season root propose / activate

```bash
# after building season-leaves-<epoch>.json
SEASON_EPOCH=1 SEASON_ROOT=0x… SEASON_BUDGET=<wei> bash scripts/propose-season-root.sh
# wait 48h challenge
ACTIVATE_ROOT=1 SEASON_EPOCH=1 bash scripts/propose-season-root.sh
```

SeasonClaim `0x83ae874e…` · leaf format matches `buildSeasonLeaves.ts` (verified vs `leafHash`).
