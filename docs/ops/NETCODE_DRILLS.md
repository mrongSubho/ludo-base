# Netcode drills

Recurring reliability drills for Ludo Base multiplayer. These are **not** a substitute for live smoke tests — they lock the contract of resync, intent dedup, abandon grace, and FSM authority so regressions fail in CI.

## Run

```bash
npm run test:chaos    # scripts/net.chaos.ts
npm run drill:live    # scripts/drill.runner.ts — automated rows + sign-off sheet
npm test              # includes chaos + properties + foundation + checklist
```

## Drill matrix

| Drill | Script case | Pass criteria |
| --- | --- | --- |
| Intent flood + duplicates | `intent flood + duplicates are metered` | 10 unique applies, 90 `net_intent_dup` |
| Schema garbage | `schema drops reject garbage envelopes` | malformed envelopes increment `net_schema_drop` |
| Seq gap + stale reject | `seq gap then resync applies only forward` | gap metered; stale snapshot does not regress `appliedSeq` |
| Host election churn | `host election churn stays legal on FSM` | 20× `HOST_ELECT` in `live`, `illegalTransitions === 0` |
| Reconnect backoff | `reconnect backoff stays within cap` | delays ∈ [500, ~10s] with jitter |
| Abandon grace | `abandon grace rejects early…` | &lt;60s rejected; Edge-only = full refund; dual burn flag-gated |
| Replay under noise | `replay survives a noisy reconnect drill` | JSONL round-trip after whitespace noise |

## Manual / staging drills (do before stable-build gate)

1. **Drop PeerJS 10s** mid-match — expect `reconnecting` badge → `resync_ok` → timers resume only after snapshot.
2. **Drop Supabase Realtime** — dual-path intents still seat/move via the surviving path.
3. **Kill host / elect compute-host** — `net_authority_switch` increments; no illegal FSM transition; no double-apply (`intentId` dedup).
4. **Airplane mode 30s** — abandon grace countdown visible (G3); no abandon accepted before `ABANDON_GRACE_MS`.
5. **Duplicate join** (same guest twice) — one seat; second `JOIN_REQUEST` is a no-op.

## Counters to graph during drills

`net_heartbeat_ok` · `net_heartbeat_timeout` · `net_reconnect_attempt` · `net_reconnect_success` · `net_seq_gap` · `net_authority_switch` · `net_resync_applied` · `net_schema_drop` · `net_intent_dup` · `net_intent_ok`

See `lib/netcode/counters.ts` and `docs/planning/RECOMMENDED_IMPLEMENTATION_PLAN.md` Track N.

## Un-park note

Voice / i18n / ads stay parked until the stable-build checklist is green. These drills are on the critical path for that gate.
