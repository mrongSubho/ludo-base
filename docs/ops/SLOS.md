# Standing SLOs (Q7)

Live definitions: `lib/telemetryPolicy.ts` (`STANDING_SLOS`). Alert when a target is breached for its `alertAfter` window.

| SLO | Target | Alert | Sample |
| --- | --- | --- | --- |
| Match completion | ≥95% started → finished | 1h below | 100% |
| Resync success | ≥90% attempts apply | 15m below | 100% |
| Edge `roll-dice` p95 | &lt; 800ms | 15m above | 25% |
| Settle-ready p95 | &lt; 10min (excl. dispute) | any stuck past effective `settleBy + pauseDelta` | 100% |

## Telemetry policy (enforced in `lib/telemetry.ts`)

1. **Scrub (`beforeSend`)** — deny-list keys (sig / session / seed / nonce / token / ecdh / private…); truncate strings to 200 chars; drop objects/functions.
2. **Sample** — `shouldSample()`: 100% for `session_start`, `resync_ok`, `net_degraded`, `schema_drop`, `match_end`; 25% for funnel noise (`roll_ok`, `move_ok`, …).
3. **Never log** signatures, session ids/keys, ECDH material, DM plaintext (G5 emotes are public preset ids only).

## Ops

- G4 notice strip can carry **status** copy when an SLO is in alert (info/warn/critical).
- Counters backing SLOs: `net_resync_applied` / reconnect attempts (`lib/netcode/counters.ts`) + telemetry funnel events.
- Dashboards: bind Sentry + (optional) Grafana to the same names in `STANDING_SLOS`.

See also: `docs/ops/UNPARK_CHECKLIST.md` · `docs/ops/NETCODE_DRILLS.md`

## Server Authority Migration SLOs (P0 Baseline & Targets)

Captured for the migration cohorts (first 14 days per cohort). Live telemetry bounds defined in `docs/planning/SERVER_AUTHORITY_MIGRATION_PLAN.md §7.2`.

| Metric | Target | Owner | Decision rule | Baseline (P0) |
|---|---|---|---|---|
| Signing prompts per match during play | **0** | Eng | Any non-zero value fails the cohort | 1 (EIP-712 session sign) |
| Match completion rate (terminal / started) | **≥ baseline and ≥ 95%** for 1v1 human | PM | A drop > 5 pp rolls the cohort back | 95.8% |
| Host-disconnect match loss | **≤ 1%** of matches | Eng | Any match lost to host disconnect fails the cohort | 3.2% (legacy P2P) |
| p95 action→state latency | **≤ baseline + 150 ms** | Eng | Exceeding it blocks the P4 relocation until re-measured | 240 ms (Edge CAS) |
| Reconnect success rate | **≥ 98%** within 30 s | Eng | < 95% fails the cohort | 91.5% |
| Spectator join success | **≥ 99%** | Eng | — | 99.1% |
| 401 rate | **≤ 1.5× baseline** | Eng | > 3× baseline triggers rollback (§7.4) | 0.4% |
| CSRF rejections (legitimate clients) | **< 0.1%** of mutations | Eng | A spike means the origin allowlist is wrong | 0.0% |
| Room error rate | **< 1%** of matches | Eng | ≥ 1% triggers rollback (§7.4) | 0.2% |
| Worker CPU p95 | **< 8 ms** of the 10 ms free-tier limit | Eng | ≥ 8 ms means thinning the Worker route or moving to the paid tier | 3.8 ms |
| Abandon rate / AFK-strike distribution | **≤ baseline** | PM | A rise means the server clock disagrees with player expectation | 4.1% |
