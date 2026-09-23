# Deploy + data ops (Q6)

| Control | Implementation | Status |
| --- | --- | --- |
| Edge version tag | `EDGE_API_VERSION` + `x-ludo-edge-version` response header (`lib/edgeOps.ts`) | **Code done** — bump on each `supabase functions deploy` |
| Client version check | `checkEdgeVersion()` — fail closed on STALE/MISMATCH when strict | **Code done** |
| One-command rollback | `supabase functions deploy <name> --project-ref <ref>` at previous git tag | **Ops runbook** (below) |
| Migration RLS regression | `npm run check:rls` (static money-column / anon grant / RLS enable gate) | **Static gate done** — scratch-Postgres apply is follow-up |
| Realtime load targets | `REALTIME_LOAD_TARGETS` in `lib/edgeOps.ts` | **Defined** (200 rooms · 8 msg/s/room) |
| Degraded mode | `shouldDegrade()` drop order: emote → presence → lobby_sync → intent → action | **Defined** — wire into relay next |

## Version bump runbook

1. Edit `EDGE_API_VERSION` (`lib/edgeOps.ts`) — calver `YYYY-MM-DD.N`.
2. `npm run check:rls && npm test`
3. `supabase functions deploy move-auth roll-dice resolve-bet --project-ref <ref>`
4. Confirm `x-ludo-edge-version` on a smoke GET.
5. **Rollback:** `git checkout <previous-tag> -- supabase/functions && supabase functions deploy …`

## Realtime targets

| Knob | Target | Degraded first |
| --- | --- | --- |
| Rooms | 200 | drop emotes |
| Players/room | 4 | drop presence |
| Msg / room / s | 8 steady | drop lobby_sync |

See `docs/ops/SLOS.md` for standing SLOs.
