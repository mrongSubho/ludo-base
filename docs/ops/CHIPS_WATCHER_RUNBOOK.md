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
