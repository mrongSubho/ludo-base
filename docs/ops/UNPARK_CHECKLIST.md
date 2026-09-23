# Un-park checklist — voice / i18n / ads

| Field | Value |
| --- | --- |
| **Status note** | Stable-build verification snapshot |
| **Scope** | Gate for un-parking **Voice · i18n · ads** (plan `docs/planning/RECOMMENDED_IMPLEMENTATION_PLAN.md` section 8) |
| **Last verified** | 2026-09-22 |
| **Verdict** | **Code gate largely green** — un-park still needs **device + live-drill** sign-off |

---

## Automated soak (2026-09-22)

| Check | Result |
| --- | --- |
| `npm test` ×3 soak | **58/58 pass** (engine, network-boundary, chain-gate, props, foundation, chaos, hardening, gameplay-gaps) |
| `npx tsc -p tsconfig.json --noEmit` | **0 errors** |
| `npm run lint` | **0 errors** (336 style warnings — burn-down only) |
| `npm run test:chaos` | **7/7** intent flood, schema drops, seq-gap/stale, host-elect, backoff, abandon grace, replay noise |
| `npm run bench:ai` | **0 illegal picks** (rookie/pro/master) |
| `npm run check:engine` | **In sync** after `sync-edge-engine.mjs` (parity gate held) |

---

## Plan section 10 checklist

### Engine

| Item | State |
| --- | --- |
| Replay log + golden hash (`lib/replay/`) | **Done** — `npm run replay inspect/verify/export` |
| fast-check properties in CI | **Done** — `scripts/engine.props.test.ts` |
| Match FSM sole transition authority | **Done** — `lib/matchFsm.ts` wired in `TeamUpContext` (`matchPhase` / `matchFsmIllegal`) |
| AI in Web Worker + timeout fallback | **Done** — `lib/ai/worker.ts` + `client.ts` |
| AI calibration bands | **Done** — `npm run bench:ai` (hard-fails on illegal picks) |

### Netcode

| Item | State |
| --- | --- |
| Named `net_*` counters | **Done** — `lib/netcode/counters.ts` |
| `resyncMatch()` single path | **Done** — `lib/netcode/resync.ts` + `useMatchStates` |
| All inbound payloads schema-parsed | **Done** — `lib/protocol` + intent parse-or-drop |
| Chaos: drop PeerJS / broadcast / host fail | **Code done** — `scripts/net.chaos.ts`; **live drills pending** |
| Connection badge (N5) | **Done** — `ConnectionBadge` in `BoardHeaderCompact` |
| **N0** peerjs pinned (no CDN) + resync session proof | **Done** — `lib/peerFactory.ts`, `lib/netcode/resyncProof.ts`, Edge `resync` · notes `docs/ops/SIGNALING.md` |
| **N6** spectator schema + resync + counters | **Done** — `useSpectatorSync` + `lib/protocol` spectator schemas |

### Quality

| Item | State |
| --- | --- |
| Lint + typecheck + engine tests + properties | **Done / green** — rules `error`; legacy quarantine in `eslint.config.mjs` |
| Telemetry + play funnel | **Done** — `lib/telemetry.ts` + Q7 scrub/sample policy (`lib/telemetryPolicy.ts`) |
| **Q7 standing SLOs + telemetry policy** | **Done** — `docs/ops/SLOS.md` · `scripts/q7.test.ts` |
| **Q6 deploy + data ops** | **Done** — `lib/edgeOps.ts` · `docs/ops/DEPLOY_OPS.md` · `npm run check:rls` in CI |
| **C0 freeze pack** | **Draft** — `docs/tokenomics/C0_FREEZE_PACK.md` (counsel/analytics sign-off still external) |
| Hop frame budget (Q2) | **Code done** — `measureHop` on TokenPiece; **device measurement pending** |
| Multiplayer harness (Q4) | **Done** — `scripts/mp.harness.ts` (4P seat→capture→resync→end + 1v1) · `npm run test:mp` |
| Smoke doc | **Done** — `docs/ops/NETCODE_DRILLS.md` |

### Gameplay (this plan’s G set)

| Item | State |
| --- | --- |
| G1 Match receipt | **Done** — overlay + `lib/receipt/buildMatchReceipt.ts` |
| G2 Pass & Play + share link | **Done** — Offline panel + `lib/localRoom.ts` |
| G3 Abandon grace + AFK honesty | **Done** — `lib/netcode/abandon.ts` (burn split flag **off**) |
| G4 Notice strip | **Done** — `/api/notices` + `NoticeStrip` |
| G5 Emotes | **Done** — preset tray + `EMOTE` bus |

### Explicitly not required for stable (still parked)

Voice · i18n · ads / rewarded · native shell · CHIPS contracts · Sepolia value

---

## Remaining before un-park decision

**2026-09-23 update:** CI half of 1–2 is done (`npm run bench:hop`, `npm run drill:deep`). Decision note pre-filled in `UNPARK_DECISION.md` as **DEFER** until physical gates close.

1. **Q2 device pass** — CI proxy PASS (p95 5ms). **Still need:** one run on a low-end Android phone (`/token-move-test` + `__ludoPerf.markdown()`) pasted into `DEVICE_PASS.md`.
2. **N3 live drills** — auto + deep sim green. **Still need:** D1–D4 on **two real browsers/phones** (PeerJS drop, Realtime drop, host kill, airplane).
3. **Sentry DSN** — transport + `.env.example` ready. **Still need:** create project, set `NEXT_PUBLIC_SENTRY_DSN` in `.env.local`, confirm first event.
4. **Optional style burn-down** — lint warnings → 0 before turning rules back to `error`.
5. **C0 freeze pack** — `TOKEN_PARAMS.md` exists; Sybil model + legal issue-spot if CHIPS resumes.

---

## Un-park decision board (when the boxes above close)

Use the fill-in note: **`docs/ops/UNPARK_DECISION.md`** (paste evidence → pick UN-PARK / DEFER / PARTIAL → choose one growth slice).

| Track | Un-park when | First slice |
| --- | --- | --- |
| **Voice** | Stable gate + session-length data says chat/voice is the drop-off | Push-to-talk spike (LiveKit), not full Agora |
| **i18n** | Stable gate + a distribution plan that needs locales | Pipeline + 2–4 locales (es, pt-BR), not 110 |
| **Ads** | Stable gate + free-tier revenue decision | Seam only (`FreeAdSurface` → RXP), never ads→CHIPS |

Record the un-park as a dated row in `RECOMMENDED_IMPLEMENTATION_PLAN.md` decision table — do not sneak work in early.

---

## One-line status

**Ship-quality core is in (58/58 soak, typed, lint-clean errors, chaos green, edge engine synced).** Un-park is waiting on one low-end device pass and one live multi-player drill session — not on more features.
