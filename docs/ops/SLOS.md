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
