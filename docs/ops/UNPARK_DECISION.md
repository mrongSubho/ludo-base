# Un-park decision note

| Field | Value |
| --- | --- |
| **Doc** | Dated decision — un-park **Voice / i18n / ads** (or defer) |
| **Companion** | `docs/ops/UNPARK_CHECKLIST.md` · `docs/planning/RECOMMENDED_IMPLEMENTATION_PLAN.md` §8 |
| **Status** | **TEMPLATE — fill and flip to DECIDED** |
| **Decision date** | YYYY-MM-DD |
| **Decider(s)** | |

---

## 1. Gate evidence (paste, don’t paraphrase)

**Auto block:** `npm run unpark:evidence` → paste below.

### Explicit gate links (both remaining human gates)

| Gate | Protocol (open this) | Evidence goes here |
| --- | --- | --- |
| **Q2 phone hop** | [`docs/ops/DEVICE_PASS.md`](./DEVICE_PASS.md) — steps + `__ludoPerf.markdown()` | This file §1.1 |
| **N3 live D1–D4** | [`docs/ops/NETCODE_DRILLS.md`](./NETCODE_DRILLS.md) §Manual — two clients | This file §1.2 |
| **Sentry** | `.env.local` → `NEXT_PUBLIC_SENTRY_DSN` · code: [`lib/telemetrySentry.ts`](../lib/telemetrySentry.ts) | This file §1.3 |
| Status rollup | [`docs/ops/UNPARK_CHECKLIST.md`](./UNPARK_CHECKLIST.md) | Plan [§0b](../planning/RECOMMENDED_IMPLEMENTATION_PLAN.md#0b-live-status-checklist--whats-next) |

### Auto evidence — 2026-09-23 (CI)

```text
tests:            62 pass / 0 fail
drill:live:       8 pass / 0 fail
drill:deep:       5 pass / 0 fail   (D1–D4 in-process simulation)
hop bench:        PASS  p50=3.0ms p95=5.0ms failRate=0%   (node proxy — NOT a phone)
typecheck:        clean (0 errors)
```

### 1.1 Q2 device pass (`docs/ops/DEVICE_PASS.md`)

```text
[CI proxy only — see DEVICE_PASS.md]
Verdict (CI): PASS   p50=3.0ms / p95=5.0ms   UA=node-hop-bench

Physical device: ____________   OS/Browser: ____________
Verdict (phone): PENDING — paste __ludoPerf.markdown()
```

- [x] CI hop bench PASS (proxy)  
- [ ] **Physical** verdict PASS (p95 compose ≤16ms, fail rate ≤10%)  
  _or_ canvas escalation ticket: ____________

### 1.2 N3 live drills (`docs/ops/NETCODE_DRILLS.md`)

| Drill | Pass? | Notes / counter snapshot |
| --- | --- | --- |
| Automated `npm run drill:live` | [x] | 8/8 |
| Sim `npm run drill:deep` D1–D4 | [x] | dual-path, elect dedup, grace/HIGH-2 |
| D1 Drop PeerJS 10s *(real devices)* | [ ] | badge → `resync_ok` → timers resume |
| D2 Drop Supabase Realtime *(real)* | [ ] | dual-path still seats/moves |
| D3 Kill host / elect *(real)* | [ ] | `net_authority_switch`, no double-apply |
| D4 Airplane 30s *(real)* | [ ] | abandon grace visible, no early accept |

```text
[paste two-browser/phone drill notes here — simulation is not sign-off]
```

### 1.3 Sentry

- [x] Project created — **JAVASCRIPT-1** (`ludo-base.sentry.io`, project `4512138573053952`)
- [x] `NEXT_PUBLIC_SENTRY_DSN` set in `.env.local` (verified 2026-09-24; value not committed)
- [ ] First `session_start` / error event visible in Sentry *(open the app once after `npm run dev` and confirm in Issues — sample TypeError can be resolved/ignored)*

```text
Sentry project: JAVASCRIPT-1 / 4512138573053952
DSN configured: yes
First event confirmed: pending visual check in Sentry UI
```

---

## 2. Decision

Pick one:

- [ ] **UN-PARK** — stable-build gate is green; growth tracks may start  
- [x] **DEFER** — outstanding items: **physical Q2 phone pass · D1–D4 on real clients** *(Sentry DSN configured 2026-09-24 — confirm first event in UI)*  
- [ ] **PARTIAL** — un-park only: ☐ Voice ☐ i18n ☐ Ads  

**Rationale (3–5 sentences):**

> CI evidence is green (62 tests, deep drills, hop bench, typecheck). Un-park stays **DEFER** until the three human gates close: physical device hop pass, two-client live drills, and a live Sentry DSN. Simulation and Node hop bench are useful regressions but are not substitutes for phone/network sign-off per `DEVICE_PASS.md` / `NETCODE_DRILLS.md`.

---

## 3. First growth slice (required if UN-PARK or PARTIAL)

Choose **one** primary (plan §8):

| Slice | Chosen? | First deliverable (1–2 weeks) |
| --- | --- | --- |
| **Voice** (push-to-talk spike) | [ ] | LiveKit/WebRTC PTT in 4P lobby only |
| **i18n** (pipeline + locales) | [ ] | `next-intl` (or equiv) + es + pt-BR strings for lobby/board |
| **Ads** (seam only) | [ ] | `FreeAdSurface` → RXP/mission progress; **never** ads→CHIPS |

Secondary (optional, after primary ships): ________________________________

**Explicit non-goals in this cycle:**

- [ ] No ads→CHIPS  
- [ ] No 110-locale vanity freeze  
- [ ] No opaque settle / push payouts  
- [ ] Voice only if session-length data still shows the gap (check telemetry)

---

## 4. Follow-through

| Action | Owner | Due |
| --- | --- | --- |
| Update `RECOMMENDED_IMPLEMENTATION_PLAN.md` §8 / decision table with this date | | |
| Tick `UNPARK_CHECKLIST.md` items 1–3 with evidence links | | |
| File first growth-slice ticket / task list | | |
| Optional: lint burn-down ticket (336 warnings) | | |
| Optional: CHIPS Phase-1 track kickoff (contracts already seeded) | | |

---

## 5. Sign-off

| Role | Name | Date |
| --- | --- | --- |
| Eng lead | | |
| Product | | |

---

*Template rule: never flip Status to DECIDED without pasted evidence in §1. Empty evidence = automatic DEFER.*
