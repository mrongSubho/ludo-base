# Planning Review — Server Authority Migration Plan & Workload Placement Matrix

**Independent review of `docs/planning/SERVER_AUTHORITY_MIGRATION_PLAN.md` (Doc A) and `docs/architecture/WORKLOAD_PLACEMENT_MATRIX.md` (Doc B).**

| Field | Value |
|---|---|
| Review date | 2026-10-13 |
| Scope | Completeness · internal consistency · cross-document consistency · technical feasibility · risk coverage · citation accuracy |
| Method | Full re-read of both documents; sample citation audit against the working tree; verification of the single highest-risk integration assumption |
| Overall verdict | **Conditionally ready.** P0 and P1 may proceed after document reconciliation. **P3+ must not start** until the Durable Object integration spike passes. |

---

## 1. Verdict summary

| Dimension | Doc A — Migration Plan | Doc B — Placement Matrix |
|---|---|---|
| Goal conformance | Strong (8/10) | Strong (8/10) |
| Completeness | Good (7/10) | Fair (6.5/10) |
| Internal consistency | Fair (6.5/10) | Good (8/10) |
| Cross-document consistency | **Weak (5/10)** | **Weak (5/10)** |
| Technical feasibility | Fair (6/10) | Fair (6.5/10) |
| Risk coverage | Good (7/10) | **Weak (4/10)** |
| Citation accuracy | Strong (9/10) | Good (7.5/10) |
| Actionability | Strong (9/10) | Strong (9/10) |

**The one-sentence verdict:** the *diagnosis* in both documents is sound and evidence-based, and the *target architecture* is coherent — but the two documents disagree about where validation runs in P3, the plan's phase list is missing work the matrix assigns to it, and the single most important implementation assumption (a Durable Object inside an OpenNext-generated Worker) is unwired and unproven. That last item is a P0 spike, not a documentation fix.

---

## 2. What each document is measured against

| Document | Stated goal | Verdict |
|---|---|---|
| **Doc A** | "Full deep-dive planning" for migrating host-centric auth + PeerJS + Edge Functions to full server-based auth, from the perspective of system architect / engineer / product manager | **Met.** Covers architecture, engineering, security, product rollout, risk, sequencing and decisions. Product section is the thinnest of the three perspectives (see G-6). |
| **Doc B** | Check the existing schemas, then recommend which parts need a rewrite, which move Supabase → Cloudflare, which stay, and which help production grade results | **Met.** Placement verdicts are explicit and schema-grounded, with a rubric, data rules and anti-moves. Its own risk treatment is the gap (R-B1). |

---

## 3. Strengths

### Doc A
1. **Evidence-grounded problem register.** Every problem carries a `file:line`; the citation sample I audited was accurate (§6).
2. **Correct framing.** Recognising that the rules path is *already* server-authoritative reframes a rewrite as a completion — the single most valuable judgement in either document.
3. **Explicit non-goals and a "what not to do" appendix.** Rare and effective at preventing scope creep.
4. **Observe-only rollout for winner derivation** (log mismatch, then enforce). This is genuinely good rollout engineering — it measures disagreement before it can break a match.
5. **Gates mapped onto the existing harness** rather than inventing a parallel quality system, and the 154-finding suite treated as non-negotiable.
6. **Invariant checklist (Appendix B)** and an **ADR-002 draft** that make the change reviewable and reversible on paper.

### Doc B
1. **The reframing that shrinks the problem** — "compute is already on Cloudflare" — is correct and materially changes the decision.
2. **The eight-rule rubric** with a stated conflict-resolution order (lower number wins) is what makes the verdicts reproducible rather than taste.
3. **Data placement rules (§5)** are hard, checkable statements ("the ledger never leaves Postgres", "the room proposes; the RPC disposes"). These are the most valuable lines in either document.
4. **The `match_commit_action` insight** — collapsing the CAS plus its confirmation into one transaction — is the highest-value engineering finding in the whole exercise, and it came from reading `confirmSequenceAfterWrite` rather than from theory.
5. **Anti-move table (§7)** pre-empts the wrong migrations, including the tempting one (ledger to D1).
6. **D1 resolved with a stated reason** (no per-match clock under `pg_cron`), not a preference.

---

## 4. Findings — cross-document

| ID | Sev | Finding | Fix |
|---|---|---|---|
| **XD-1** | **High** | **Contradiction on where validation runs in P3.** Doc A §4.4 and §5-P3: the room "delegates to the existing Edge authority" (Design B) and in-process validation is deferred to "P4+". Doc B §3B and §10: `roll-dice` / `move-auth` / `resolve-bet` are **moved in P3**. Doc A §4.4 also contradicts *itself*: the "Rules validation" row says delegate, the "Roll minting" row says the room mints server-side. | Decide once: **P3 = transport, seq, fan-out, reconnect (delegate to Edge); P4 = relocate validation + minting into the room.** Then correct Doc B §10 to match, or move the relocation to P4 in Doc B. |
| **XD-2** | **High** | **P1 scope divergence.** Doc B §10 assigns the distributed rate limiter (G1) and CF Cron (G2) to P1; Doc A's P1 contains neither, and P1 was already sized **L**. | Add G1/G2 to Doc A's P1 (they are cheap and independent — a good early win) and re-size P1 to **L+**, or split P1 into P1a (sessions) and P1b (platform hygiene). |
| **XD-3** | Medium | **Disjoint problem ID spaces.** Doc A has F1–F4 and P1–P12; Doc B has G1–G11. No cross-map. Problems present in only one document: Doc A's P6 (chat impersonation) and P7 (onboarding fabrication) have no G-number; Doc B's G1, G2, G7, G8, G9, G10 have no P-number in Doc A. | Publish one merged register (Appendix of Doc A) with a single ID space and a mapping column. Readers cannot currently audit coverage without doing set arithmetic. |
| **XD-4** | Medium | **Doc A's P6 retirement list is incomplete against Doc B.** Doc B makes the three Edge Functions moot (§3B); Doc A P6 lists retiring signatures, election, PeerJS and tables, but never the Edge Functions or `supabase/functions/`. | Add "delete `roll-dice` / `move-auth` / `resolve-bet` and the `_shared` engine copy" to P6, with the `check:engine` target removal in the same commit. |
| **XD-5** | Low | **Invariants and non-moves are duplicated in three places** (Doc A Appendix B, Doc A §4.1 principles, Doc B §5 + §7) with different wording. | Single source of truth: invariants live in Doc A Appendix B; Doc B references them by number and keeps only *data* rules. |
| **XD-6** | Low | **Terminology drift.** "Lifecycle authority" / "room authority" / "match authority" are used interchangeably across both; "Move to Cloudflare" (Doc B) vs "delegates" (Doc A) describe the same intent differently. | Add a two-line terminology block to Doc A and reference it from Doc B. |

---

## 5. Findings — internal

### Doc A (Migration Plan)

| ID | Sev | Finding |
|---|---|---|
| **PI-1** | **High** | **The new wire contract contradicts the live protocol.** Doc A §4.7 declares intents as `kind: 'REQUEST_ROLL' | 'REQUEST_MOVE' | 'REQUEST_POWER'`. The real union in `lib/gameProtocol.ts:12` is `REQUEST_ROLL`, `REQUEST_MOVE`, **`DICE_COMMIT`, `DICE_REVEAL`, `CMD_REQUEST_TRUST`** — there is no `REQUEST_POWER` in `isGameIntent`, and the legacy commit/reveal intents plus a trust command are still accepted. A new contract written against a guessed union is exactly how a migration ships a hole. |
| **PI-2** | Medium | Roll minting ownership is stated twice, differently, in the same section (see XD-1). |
| **PI-3** | Medium | **P3/P4 boundary is blurry.** P3 deliverables include "timers via alarms"; P4 includes "turn/AFK/AI orchestration (alarms)". Which clock-driven behaviours are in which phase is not decidable from the text. |
| **PI-4** | Medium | **No in-flight cutover specification.** The plan covers *rollback* but not matches that straddle the flip: a match seeded on the legacy path, then the flag turns on. Does the room adopt it, refuse it, or does the client finish it locally? |
| **PI-5** | Medium | **No retention/GC for the three new tables** (`auth_challenges`, `sessions`, `match_room_events`) — against a 500 MB free-tier ceiling, `match_room_events` is the fastest-growing new table and the plan only says "monitor". |
| **PI-6** | Low | **Success metrics are placeholders** ("baseline → +X%") with no owner, measurement window, or decision rule. The plan defers thresholds to a P0 baseline that does not exist yet; `docs/ops/SLOS.md` is referenced but no numeric SLO is stated anywhere. |
| **PI-7** | Low | **The Farcaster miniapp manifest domain dependency is absent.** It was raised in conversation (manifest must point at the canonical domain; re-signing needed on change) but never made it into the document, despite the plan changing the session/domain story. |
| **PI-8** | Low | **No compliance note on cookies.** The session cookie is strictly-necessary (no consent banner needed under GDPR), but the document should state that explicitly so nobody adds a banner later "to be safe" and breaks the Farcaster webview. |

### Doc B (Placement Matrix)

| ID | Sev | Finding |
|---|---|---|
| **MI-1** | **High** | **The "17 `SECURITY DEFINER` functions" count does not match its own list.** §3C lists ~19 names and includes trigger functions (`messages_restrict_columns`, `block_coins_mutation`, `prevent_client_player_tampering`, `touch_updated_at`, `update_conversation_summary`). Verified: `scripts/check-schema.mjs:312-322` explicitly excludes `p.prorettype <> 'trigger'::regtype` — the 17 are the **callable** definer functions. The list conflates two categories, which matters because "the 17 must stay" and "trigger functions must stay" are different arguments. |
| **MI-2** | **High** | **The rate-limit store is left undecided, and one of the two options is infeasible.** §3D/§9 offer "DO or KV". KV's free tier is **1,000 writes/day** — unusable for per-IP counters at any real volume. The text hints at this but does not decide. |
| **MI-3** | Medium | **No risk register.** Doc B has cost tables and anti-moves but no risks, mitigations, or triggers; it relies entirely on Doc A's register, which does not cover Doc B's own decisions (vendor concentration, DO free-tier terms, the portability cost of room-local storage). |
| **MI-4** | Medium | **`move-auth` is dispositioned as MOVE with no feasibility caveat** — the same unproven assumption as FE-1 is presented as settled. |
| **MI-5** | Low | Cost table omits Postgres write amplification from lifecycle events and the egress cost of room → PostgREST calls (each accepted action becomes an HTTPS round trip from the edge to the Postgres region). |
| **MI-6** | Low | §2's inventory omits the intent-level protocol surface (`lib/gameProtocol.ts`) even though §3A rewrites the client's authority call sites that consume it. |

---

## 6. Citation audit (verified against the working tree)

I sampled the load-bearing citations rather than trusting them.

| Claim in a document | Verified result |
|---|---|
| `hooks/useAppSession.ts:11` = localStorage key `ludo-siwe-session` | **Exact** (`const STORAGE_KEY = 'ludo-siwe-session';`) |
| Same file `:179` writes localStorage, `:127` uses `APP_SESSION_TTL_MS` | **Exact** |
| `lib/gameProtocol.ts:25,30-35` — `REQUEST_ROLL` carries no face, `REQUEST_MOVE` rejects `diceValue` | **Exact** (line 25 `return !('value' in payload)`, line 35 `!('diceValue' in payload)`) |
| All 7 cited paths exist (`useAppSession`, `useBettingController`, `BootLock`, `api/onboarding/progress`, `gameProtocol`, `sessionProof`, `guest`) | **7/7 present** |
| `check-schema.mjs` DB mode excludes trigger functions from the definer assertion | **Confirmed** at `:312-322` |
| `wrangler.jsonc` has no Durable Object binding or migration | **Confirmed — this is finding FE-1** |
| "17 definer functions" (Doc A §3.5, Doc B §3C) | **Count is from the gate; Doc B's accompanying list is wrong** (MI-1) |

**Result: 6 of 7 sampled claims accurate.** The one defect is MI-1. Citation discipline is a genuine strength of both documents and should be preserved.

---

## 7. Technical feasibility

| ID | Sev | Finding |
|---|---|---|
| **FE-1** | **Critical** | **The Durable Object integration path is unwired and unaddressed by both documents.** Verified: `wrangler.jsonc` declares no `durable_objects` binding and no `migrations`; `open-next.config.ts` is the default; and there is **no custom worker entry** — `main` is the generated `.open-next/worker.js`. Adding a DO to an OpenNext app requires (a) a custom worker entry that re-exports the OpenNext handler plus the DO class, (b) `durable_objects` bindings, (c) a `migrations` entry with `new_sqlite_classes`, (d) using the **hibernation API** (`state.acceptWebSocket`) rather than `webSocket.accept()`, and (e) a WS route that bypasses the Next handler. Both documents describe the room as if this were already wired. It is the single largest technical unknown in the plan and belongs in P0 as a spike with a pass/fail criterion. |
| **FE-2** | High | **`match_commit_action` has gate consequences that no phase scopes.** `check:schema` A1 (a `CREATE OR REPLACE` may not change a return type), A2 (every `.rpc()` call site must resolve to a migration signature), the DB-mode definer assertions, and the `check:routes` matrix all need updating in the same change. Add this to P3's deliverables. |
| **FE-3** | Medium | **The engine third copy is asserted but not scoped.** Both documents say `check:engine` must cover every engine copy; `sync-edge-engine.mjs` currently targets two. "Extend the sync script and the gate" appears in no phase's deliverables. |
| **FE-4** | Medium | **Hibernation API constraint unstated** (see FE-1d). The plan says "hibernating WebSockets" without noting that this requires a specific API and a specific socket-accept path. |
| **FE-5** | Low | **Sound and verified:** the `pg_cron` rejection argument (minute granularity cannot drive a 3-second bet window) is technically correct and is the strongest justification in either document. |
| **FE-6** | Low | **Sound:** private Realtime channels are a documented Supabase capability (`realtime.messages` RLS + `private: true` + `setAuth()`), so NET-03a/b is low-risk once sessions exist. |

---

## 8. Risk coverage

| ID | Sev | Missing risk | Where it belongs |
|---|---|---|---|
| **RK-1** | High | **Vendor concentration.** Moving lifecycle authority onto Cloudflare DOs increases coupling to a single vendor's runtime-specific storage API — the same class of exposure the earlier Vercel/Cloudflare tier analysis flagged for Vercel's ToS. No contingency, portability note, or exit trigger exists in either document. | Doc A register + Doc B §8 |
| **RK-2** | Medium | **Bus factor.** Both documents assume architect / backend / realtime owners. The repo's own notes show outstanding human-dependent gates (device perf trace, live drills) and a single-maintainer pattern. Sequencing should state the realistic staffing assumption. | Doc A §9 |
| **RK-3** | Medium | **In-flight match cutover** (PI-4) is a live-traffic risk, not a documentation detail. | Doc A P3/P4 exit gates |
| **RK-4** | Medium | **Capacity risk from new tables** under the 500 MB cap (PI-5). | Doc A + Doc B cost table |
| **RK-5** | Low | **No abuse model for the room socket:** max sockets per match, per-socket frame rate, matchId enumeration, and the cost of a malicious client holding sockets open. | Doc A §4.10 |
| **RK-6** | Low | **Rollout-cohort interaction with the un-park gates** is asserted ("wagered pools last") but the two schedules are never reconciled with the DEFER decision in `docs/ops/UNPARK_DECISION.md`. | Doc A §7.3 |

---

## 9. Overlapping and missing components

**Overlapping (consolidate):**
- Invariants/non-moves — three copies (XD-5).
- Phase sequencing — Doc A §5 and Doc B §10 both list phases with different contents (XD-2, XD-4).
- Problem registers — two disjoint taxonomies (XD-3).
- Cost/limits — Doc A §4.11 and Doc B §9 restate the same figures; one should own them.

**Missing (add):**
1. A **P0 feasibility spike** with an explicit pass/fail criterion for the DO-in-OpenNext pattern (FE-1).
2. An **in-flight match cutover** rule (PI-4).
3. **Retention/GC policy** for the new tables (PI-5).
4. **Numeric SLOs and decision rules** for the success metrics (PI-6).
5. The **Farcaster manifest domain** dependency (PI-7).
6. An **abuse/DoS model for the room socket** (RK-5).
7. A **single merged risk register** with one ID space (XD-3, MI-3).
8. **Removal of the Edge Functions** in P6 (XD-4).
9. The **engine third copy** work item (FE-3).
10. **Gate updates for the new RPC** (FE-2).

---

## 10. Prioritized recommendations

### Priority 0 — before any code (blocking)

| # | Recommendation | Applies to |
|---|---|---|
| 1 | **Reconcile XD-1:** decide and write down the P3 boundary. Recommended: P3 = transport/seq/fan-out/reconnect delegating to Edge; P4 = relocate validation and minting. Correct Doc B §10 to match. | Both |
| 2 | **Add the DO-in-OpenNext spike to P0** with a pass/fail criterion: a Worker that serves the Next app *and* exposes a hibernatable DO WebSocket, with `durable_objects` bindings and a `new_sqlite_classes` migration in `wrangler.jsonc`. Nothing in P3 is safe to plan further until this passes (FE-1). | Doc A |
| 3 | **Fix PI-1:** re-derive §4.7's intent union from `lib/gameProtocol.ts` — include `DICE_COMMIT`, `DICE_REVEAL`, `CMD_REQUEST_TRUST` and remove the invented `REQUEST_POWER` (or state it as a new addition to the union). | Doc A |
| 4 | **Fix MI-1:** correct the definer-function list to the 17 callable functions and name the trigger functions separately. | Doc B |
| 5 | **Decide MI-2:** rate-limit store = Durable Object counter (KV's 1,000 writes/day free cap rules it out). Verify whether the Workers rate-limiting binding is available on the free plan before choosing it. | Doc B |

### Priority 1 — before P1 ships

| # | Recommendation | Applies to |
|---|---|---|
| 6 | **Absorb XD-2:** move G1 (distributed limiter) and G2 (CF Cron) into P1 and re-size it, or split P1a/P1b. | Doc A |
| 7 | **Merge the problem registers** into one ID space with a mapping column (XD-3) and make Doc B reference it. | Both |
| 8 | **Add the in-flight cutover rule** and its drill to P3/P4 exit gates (PI-4, RK-3). | Doc A |
| 9 | **Specify retention/GC** for `auth_challenges`, `sessions`, `match_room_events` (PI-5, RK-4). | Doc A |
| 10 | **State numeric SLOs** with owners and windows, replacing the `+X%` placeholders (PI-6). | Doc A |
| 11 | **Scope the engine third copy + gate updates for the new RPC** into P3/P4 deliverables (FE-2, FE-3). | Doc A |

### Priority 2 — quality and hygiene

| # | Recommendation | Applies to |
|---|---|---|
| 12 | **Add a risk register to Doc B** covering vendor concentration, portability of room-local storage, and DO free-tier terms (MI-3, RK-1). | Doc B |
| 13 | **Add the room-socket abuse model** (RK-5) and the compliance note on the strictly-necessary session cookie (PI-8). | Doc A |
| 14 | **Add the Farcaster manifest domain** item and reconcile the rollout cohorts with the un-park DEFER decision (PI-7, RK-6). | Doc A |
| 15 | **De-duplicate invariants** to a single owning document and have the other reference by ID (XD-5); unify terminology (XD-6). | Both |
| 16 | **Add the Postgres write-amplification and room→PostgREST egress** lines to the cost model (MI-5). | Doc B |
| 17 | **Add the intent/protocol surface** to Doc B's §2 inventory (MI-6). | Doc B |

---

## 11. Overall verdict

**Conditionally ready to proceed — with a hard gate before P3.**

**What is ready now.** The diagnosis in both documents is trustworthy: it is evidence-based, the citations I sampled hold up, and the central judgement (that the rules path is already server-authoritative, so this is a completion rather than a rewrite) is correct and consequential. Doc B's placement verdicts are reproducible because they come from a stated rubric, and its data placement rules are the right kind of hard. **P0 and P1 can start** once recommendations 1–5 are applied — and P1 in particular is low-risk because sessions, the rate limiter and Cron are all independent of the Durable Object question.

**What is not ready.** Three things block P3:

1. **The documents disagree with each other about P3** (XD-1). Two engineers reading the two documents today would build different systems.
2. **The plan's phase list is incomplete relative to the matrix** (XD-2, XD-4) — P1 is missing assigned work, and P6 is missing the Edge Function removal.
3. **The critical technical assumption is unproven** (FE-1). The Durable Object room is the load-bearing element of the entire target architecture, and the integration path into an OpenNext-generated Worker is not configured, not documented, and not spiked. This is not a documentation defect — it is an unknown that could change the shape of P3.

**Recommended next action:** a short P0 cycle — reconcile the two documents against recommendations 1–5, then run the DO-in-OpenNext spike. If the spike passes, the plan as written is executable and the sequencing holds. If it fails, D1 needs revisiting with real evidence, and the honest fallback is option (b) with an external scheduler for the match clock — which would need its own spike, because `pg_cron`'s minute granularity cannot drive a 3-second bet window.

**On the documents as artefacts:** they are above the bar for a change of this size — traceable claims, explicit non-goals, reversible phasing, and a stated decision list rather than hidden assumptions. The defects found here are concentrated in cross-document reconciliation and one unverified integration assumption, not in the underlying analysis. Fix those and this is a plan worth executing.

---

## Appendix — Resolution status (added 2026-10-13, same day)

Every actionable finding in this review was addressed in a single revision pass. **Both documents are now Rev 2**, each carrying a revision-history table and (for the plan) an Appendix G change record keyed to the finding IDs below.

| Finding | Status | Where resolved |
|---|---|---|
| XD-1 P3 authority contradiction | **Resolved** | Plan §4.4 phase boundary, §5-P3, §5-P4; matrix §3B/§10 |
| XD-2 P1 scope divergence | **Resolved** | Plan §5-P1 (absorbs the limiter + Cron), re-sized L+ |
| XD-3 disjoint ID spaces | **Resolved** | Plan §3.6 single register with `Cross-ref` column; P13–P19 added |
| XD-4 P6 missing Edge Function removal | **Resolved** | Plan §5-P6 |
| XD-5 duplicated invariants | **Resolved** | Plan Appendix B declared the single source; matrix §3C/§5 reference it |
| XD-6 terminology drift | **Resolved** | Plan §0 terminology block, referenced by the matrix |
| PI-1 invented intent kind | **Resolved** | Plan §4.7 + §3.5 — union re-derived from `lib/gameProtocol.ts:12` |
| PI-2 roll-minting contradiction | **Resolved** | Plan §4.4 — P3 calls `roll-dice`, P4 mints |
| PI-3 blurry P3/P4 boundary | **Resolved** | Plan §4.4 — clock-driven work is P4-only |
| PI-4 in-flight cutover unspecified | **Resolved** | Plan §4.12 + D8 drill in the P3 gate |
| PI-5 no retention/GC | **Resolved** | Plan §4.6 retention table + three cleanup RPCs |
| PI-6 placeholder metrics | **Resolved** | Plan §7.2 numeric SLOs with owners and decision rules |
| PI-7 Farcaster manifest absent | **Resolved** | Plan §7.3 + P1 exit gate |
| PI-8 no cookie compliance note | **Resolved** | Plan §4.2 strictly-necessary exemption |
| FE-1 DO integration unwired | **Resolved as a gate** | Plan §5-P0 spike with a five-point pass/fail criterion; P19 in the register |
| FE-2 gate updates for the new RPC | **Resolved** | Plan §5-P3 deliverables |
| FE-3 engine third copy unscoped | **Resolved** | Plan §5-P4 + §5-P6 |
| FE-4 hibernation API constraint | **Resolved** | Plan §4.4 integration prerequisites + spike item 3 |
| FE-5 `pg_cron` rejection sound | No action — confirmed correct | Plan §4.4, matrix §8 |
| FE-6 private Realtime channels sound | No action — confirmed correct | Plan §4.5 |
| MI-1 definer count/list | **Resolved** | Matrix §2/§3C; plan §3.5 + Appendix A |
| MI-2 rate-limit store undecided | **Resolved** | DO counters decided; KV ruled out — matrix §3D, plan §5-P1 |
| MI-3 matrix had no risk register | **Resolved** | Matrix §11 (B-R1…B-R5) |
| MI-4 `move-auth` MOVE had no caveat | **Resolved** | Matrix §3B feasibility gate + phase column |
| MI-5 write amplification / egress | **Resolved** | Plan §4.11; matrix §9 |
| MI-6 protocol surface missing | **Resolved** | Matrix §2; plan §3.5 |
| RK-1 vendor concentration | **Resolved** | Plan R16; matrix §11 B-R1/B-R3 |
| RK-2 bus factor | **Resolved** | Plan §9 staffing assumption |
| RK-3 in-flight cutover risk | **Resolved** | Plan R17 + §4.12 |
| RK-4 capacity risk | **Resolved** | Plan R18 + §4.6 retention |
| RK-5 socket abuse model | **Resolved** | Plan §4.10 + R19 |
| RK-6 un-park reconciliation | **Resolved** | Plan §7.3 ordering stated |

### Revised verdict

**P0 and P1 are now unblocked.** The document-level contradictions that would have caused two engineers to build different systems are closed, and the phase list no longer diverges between the two documents.

**P3 remains gated — correctly.** FE-1 was the review's critical finding and it is not a documentation defect: the Durable Object integration path is genuinely unproven. It is now an explicit P0 deliverable with a five-point pass/fail criterion, which is the right disposition for a real unknown. If the spike fails, D1 is re-decided before any P3 design work — and that outcome is now a stated branch rather than a surprise.

**What still requires a human decision:** D1–D8 in the plan's §10. This review supplied the evidence and the gate for each; the owner still makes the call. D1 and D2 are the two that change the shape of the work.
