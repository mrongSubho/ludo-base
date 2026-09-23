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

<!-- paste formatDevicePassMarkdown output here -->
_awaiting device pass_

## Sign-off

- [ ] Q2 device pass recorded above
- [ ] Verdict PASS **or** canvas escalation ticket linked

See also: `docs/ops/UNPARK_CHECKLIST.md` · `lib/perf/budget.ts` · `lib/perf/report.ts`
