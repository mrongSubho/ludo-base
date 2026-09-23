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

**Auto block:** `npm run unpark:evidence` → paste its `### Auto evidence` output below.

### 1.1 Q2 device pass (`docs/ops/DEVICE_PASS.md`)

```text
[paste formatDevicePassMarkdown / __ludoPerf.markdown() output]

Device: ____________   OS/Browser: ____________
Verdict: PASS / FAIL
```

- [ ] Verdict PASS (p95 compose ≤16ms, fail rate ≤10%)  
  _or_ canvas escalation ticket: ____________

### 1.2 N3 live drills (`docs/ops/NETCODE_DRILLS.md`)

| Drill | Pass? | Notes / counter snapshot |
| --- | --- | --- |
| Automated `npm run drill:live` | [ ] | paste tail of run |
| D1 Drop PeerJS 10s | [ ] | badge → `resync_ok` → timers resume |
| D2 Drop Supabase Realtime | [ ] | dual-path still seats/moves |
| D3 Kill host / elect | [ ] | `net_authority_switch`, no double-apply |
| D4 Airplane 30s | [ ] | abandon grace visible, no early accept |

```text
[paste drill:live sign-off sheet + any screenshots/counter lines]
```

### 1.3 Sentry

- [ ] Project created  
- [ ] `NEXT_PUBLIC_SENTRY_DSN` set in `.env.local` (value itself **not** committed)  
- [ ] First `session_start` / error event visible in Sentry  

```text
Sentry project: ____________
DSN configured: yes / no
First event confirmed: yes / no
```

---

## 2. Decision

Pick one:

- [ ] **UN-PARK** — stable-build gate is green; growth tracks may start  
- [ ] **DEFER** — outstanding items: ________________________________  
- [ ] **PARTIAL** — un-park only: ☐ Voice ☐ i18n ☐ Ads  

**Rationale (3–5 sentences):**

> _e.g. Device pass p95 = 9.2ms on Redmi 9; all four live drills clean; Sentry receiving events. Core is boring — open voice spike first because 4P sessions show chat drop-off._

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
