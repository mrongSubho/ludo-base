# Device pass protocol (Q2)

One low-end phone, one Classic match vs AI (or Pass & Play), one report pasted below.

## Target device (fill in)

| Field | Value |
| --- | --- |
| Device | e.g. Pixel 4a / Redmi 9 |
| OS | Android __ |
| Browser | Chrome __ |
| Date | YYYY-MM-DD |
| Tester | |

## Steps

1. `npm run dev` on LAN or use the staging URL.
2. Open the game on the phone (same Wi‑Fi).
3. Start **Offline → vs AI → Rookie** (or Pass & Play).
4. Complete **≥6 token hops** (moves of 1–6 cells).
5. In the console run: `await __ludoPerf.markdown()` (installed via `installPerfDebugHook`).
6. Paste the markdown block under **Results**.
7. Verdict rule: **PASS** if p95 compose ≤16ms and fail rate ≤10%. Otherwise file canvas-layer escalation ticket.

## Results

### CI proxy (2026-09-23) — `npm run bench:hop` · **not** a physical phone

```text
### Device pass — 2026-09-23T19:16:21.849Z

| Field | Value |
| --- | --- |
| Verdict | **PASS** |
| UA | node-hop-bench/nominal |
| Viewport | 0×0 @1x |
| Samples | 30 |
| p50 / p95 compose | 3.0ms / 5.0ms |
| Budget | compose ≤16ms · longtask ≤50ms |
| Fail rate | 0% |
```

### Physical device — **REQUIRED before un-park**

Paste block (from phone console after ≥6 hops on `/token-move-test`):

```text
await __ludoPerf.markdown()
→ [paste here]
```

Device: ____________   OS/Browser: ____________

Then copy into `docs/ops/UNPARK_DECISION.md` §1.1.

## Sign-off

- [x] CI hop bench PASS (proxy)
- [ ] **Physical Q2 device pass recorded above**
- [ ] Verdict PASS on device **or** canvas escalation ticket linked
- [ ] Copied into `UNPARK_DECISION.md` §1.1

See also: `docs/ops/UNPARK_CHECKLIST.md` · `docs/ops/UNPARK_DECISION.md` · `lib/perf/budget.ts` · `lib/perf/report.ts`
