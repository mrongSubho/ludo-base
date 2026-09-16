# Security Review

**Scope:** Full source review of commit `84be04b702d21b5d725e6f725cbcfd4a8c8f1154`.

The audit identified six actionable source-level authorization/integrity vulnerabilities. Runtime validation was not performed because the required isolated execution sandbox was unavailable; migration deployment state, route reachability, and remote dependency integrity remain explicitly deployment-dependent.

| Severity | Finding | Source |
|---|---|---|
| 🔴 Critical | Anonymous clients can update any `players` row, including economy, progression, identity, and key fields. | `migrations/20260906_social_graph.sql:205-212` |
| 🔴 Critical | Unauthenticated stream updates can overwrite `live_matches.host_address`, affecting settlement authority. | `app/api/match/stream/route.ts:38-77` |
| 🟠 High | An attacker can replace a recipient's published ECDH key and receive future encrypted DMs. | `migrations/20260906_social_graph.sql:205-212`, `hooks/useDataActions.ts:20-26`, `lib/encryption.ts:127-145` |
| 🟠 High | The `move-auth` seed action does not bind the supplied host, seats, room, or state to a canonical match. | `supabase/functions/move-auth/index.ts:368-414` |
| 🟠 High | Anyone who knows a room code can retrieve plaintext lobby validation tokens. | `app/api/lobby/join/route.ts:78-94` |
| 🟡 Medium | Omitting `matchId` allows fabricated completed match records and downstream progression updates. | `app/api/match/record/route.ts:77-145` |

## Recommended remediation order

1. Remove anonymous direct updates to `players`; use wallet-authenticated/server-owned operations with column-level restrictions.
2. Bind stream management and settlement authority to the canonical match host, and make host identity immutable after match creation.
3. Require canonical match existence and stored participant/host validation before seeding match state.
4. Require host authentication for lobby request listing and never return `validation_token`.
5. Require an existing canonical `matchId` for match recording and validate all settlement fields server-side.

Two additional leads require deployment verification: remote Edge Function dependency integrity and the effective production migration/route-authentication state.
