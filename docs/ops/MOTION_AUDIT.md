# Ludo Base — Site-Wide Motion Audit

| | |
|---|---|
| **Date** | 2026-10-16 |
| **Question answered** | "Have all animation effects been removed? Report every animation still active and where it occurs — the lobby dice, the whole-board animations, the radar in Quick Match, and the match hunt." |
| **Verdict** | **No removal ever happened, and none was planned.** Motion is a deliberate, load-bearing part of this app. What the motion work actually did — and this is the part that is real — is make every animation (a) respect `prefers-reduced-motion`, (b) compositor-only (no layout-property animation), and (c) tamed where an infinite pulse was decorative noise. |
| **Method** | Static inventory (`@keyframes`, `animation:`, framer `animate=`, GSAP, confetti) + the two machine gates run live against a dev server on 2026-10-16 |

---

## 1. Empirical evidence (run 2026-10-16, dev server on :3001)

```
$ VISUAL_BASE_URL=http://127.0.0.1:3001 npm run check:reduce-motion
  reduce:        0 animations (0 looping), matchMedia=true
  no-preference: 7 animations (5 looping), matchMedia=false
✓ reduced-motion gate clean (reduce stops all motion; no-preference still animates)

$ npm run check:motion
  motion gate: 111 files scanned (3 css, 108 tsx)
  keyframes allowlist: 2 (loading-bar, shimmer)
  framer layout-animation allowlist: 3 (UserProfilePanel, SpectatorHUD, QuickMatchPanel)
  css kill-switch blocks: 4 · framer files: 34 (covered by MotionConfig reducedMotion="user")
  gsap files: board/TokenPiece.tsx, board/TokenVisual.tsx
  confetti files: BoardHome.tsx, SnakesBoard.tsx, page.tsx
  js motion files honoring prefers-reduced-motion: 5/5
✓ motion gate clean
```

The second assertion is the important one: the gate **requires motion to be present** under normal settings — an app that had removed its animations would fail it as a vacuous pass.

**Static totals:** 35 `@keyframes` · 44 CSS `animation:` declarations (**23 of them `infinite`**) · 82 `animate-*` Tailwind utility uses in TSX · 34 framer-motion files · 2 GSAP board files · 3 canvas-confetti sites.

---

## 2. The four surfaces asked about

### 2.1 The lobby dice — `ActionDice` (`app/components/GameLobby.tsx:530`)

**Active, fully animated.** A 3D CSS-transform die:

| Effect | Where |
|---|---|
| Roll: spring `rotateX/rotateY` to the target face (`stiffness: 50, damping: 20`) + a 1.1 s `easeInOut` roll | `ActionDice.tsx:160-170` |
| Post-roll settle spring (`stiffness: 300, damping: 25`) | `ActionDice.tsx:198-202` |
| Glow orb scaling 1.8 → 0.5 / opacity 0.6 → 0 while rolling | `ActionDice.tsx:248-253` |
| Two side chevrons, `repeat: Infinity, duration: 1.5` | `ActionDice.tsx:231, 239` |
| Rolling sheen sweeping `x/y: -120% → 120%`, `repeat: Infinity, duration: 0.4` | `ActionDice.tsx:322-323` |
| Six `DiceFace`s positioned with `translateZ(var(--tz))` / `rotateY/X` | `ActionDice.tsx:270-277` |
| Lobby search spinner `animate-spin` | `GameLobby.tsx:554` |

Reduced-motion path: framer-motion → covered by `<MotionConfig reducedMotion="user">` (`app/Providers.tsx`), which neutralises transform animations; opacity/colour feedback stays.

### 2.2 The whole board — GSAP token movement + board CSS effects

**Active.** Two GSAP timelines plus a large CSS effect layer:

- **`app/components/board/TokenPiece.tsx`** — hop `fromTo` + shadow `fromTo` (`:84-87`), settle/shade timelines (`:105-109`), `killTweensOf` + reset (`:120-122`), per-step glide timeline (`:206-223`).
- **`app/components/board/TokenVisual.tsx`** — travel `gsap.set(xPercent/yPercent)` per step (`:324-331`), hop reset, completion timeline (`:336`).
  Under reduced motion both **collapse to instant repositioning** — `lib/motion.ts` states the rule: *"reduced motion removes translation, never information"* (positions are engine state rendered from `boardLayout`).
- **CSS board effects** (`app/globals.css`): `token-target-pulse` 0.8 s ∞ (`:6034`) · `nuke-blink` 0.35 s ∞ (`:6045`) · `token-boost-trail` 0.5 s ∞ (`:6055`) · `mystery-breathe` 2.2 s ∞ / `mystery-spin` 3.2 s ∞ (`:6088-6096`) · `pulsePower` 2 s alternate (`:5294`) · `blockadePulse` 2 s ∞ (`:3521`) · `pulse-draggable-svg` 2 s ∞ (`:3438-3450`) · `active-pulse` 2 s ∞ (`:2274`) · `level-up-flash` 0.8 s (`:2239`) · `shake` 0.5 s (`:2702`) · `ping-glow` 1.5 s ∞ (`:1265`) · `spin` 0.8 s ∞ (`:1865`) · `pulse` 1.4 s ∞ (`:9721`).
- **Board chrome/celebration**: `chat-bubble-arrive` / `chat-bubble-text-in` (`:10115-10176`), `emote-float-rise` 2.2 s (`:10199`), `emote-glyph-pop` 0.5 s (`:9638, 10140, 10510, 10533`), `fadeUp` 0.4 s (`:3400`), `slideUp` 0.3 s (`:4587`), `drawerSlideIn/FadeIn` (`:4327-4356`).
- **Confetti on wins** — `BoardHome.tsx:203`, `SnakesBoard.tsx:208-209`, `page.tsx:330-344`: capped at 1.5 s, single loop, **skipped entirely** under reduced motion.
- **Avatar blink while awaiting a move** — `.avatar-circle.await-move { animation: avatar-await-pulse 1.6s ease-in-out infinite }` (`globals.css:5857`), consumed by `PlayerInfoRow.tsx:71`. Still active.

### 2.3 The radar in Quick Match — `DashedRadarRing` (`QuickMatchPanel.tsx:59-84`)

**Active — this is the single most animated surface in the app.**

| Effect | Where |
|---|---|
| Dashed ring + inner circles rotating `duration: 20, repeat: Infinity` | `:66-75` |
| **Scanning sweep** (clipped gradient wedge) rotating `duration: 4, repeat: Infinity` | `:78-83` |
| Per-ring counter-rotations `15 + ring*5` s ∞ (alternating direction) | `:503-506` |
| Orbit dots rotating `10 + i*2` s ∞ | `:517-520` |
| Core rotation 3 s ∞ | `:529-531` |
| Scan-line `top: ['-20%','120%']` 2.5 s ∞ | `:544-546` |
| `animate-pulse` status dot / `animate-pulse-slow` cosmic orb / `animate-pulse` borders | `:561, 841, 897, 944` |
| Equalizer bars `height: ['20%','100%','40%']` 1 s ∞ | `:573-575` |
| Three-dot opacity cascade `[0.3,1,0.3]` 1 s ∞ | `:593-596` |
| Rival-scan dots + `animate-spin` spinners | `:924, 986-989` |
| Amber "widening the search" badge, `animate-pulse` | `:976` |

### 2.4 The match hunt — `TeamUpMatchPanel` mini radar + the live feeds

**Active.** "Hunt" is the codebase's own name for the hybrid search (`GameLobby.tsx:105-118`: *"Embedded hunt: the hybrid radar lives INSIDE the TeamUp page (mini view)"*; `hunting` / `huntExpired` / `HUNT_TIMEOUT_S`; the "Cancel hunt" CTA at `TeamUpMatchPanel.tsx:1176`).

- **Mini hunt radar** (`TeamUpMatchPanel.tsx:120-160`): rotating dashed ring 20 s ∞ + sweep 4 s ∞ (`:61-79`), live dot `animate-ping` (`:155`), connection dot `animate-pulse` (`:799`).
- **Entrance choreography** (`animate-in fade-in / zoom-in-95 / slide-in-from-bottom-4`, 200 ms): `:137, 148, 370, 875, 920, 1003`.
- **Spinners** while loading rivals: `:1055, 1107`.
- **Live matchmaking feed** (`LiveMatchmakingFeed.tsx`, `ActivityFeed.tsx` searching rows) — polls `status='searching'` tickets; rows flip STARTED→JOINED with transitions.
- **Lobby searching spinner**: `GameLobby.tsx:554` `animate-spin`.

---

## 3. What *was* actually removed or changed (the real, much smaller list)

1. **`pulse 1s infinite` on the diagnostic chip** → a single 3-flash `diag-warn-flash 900ms ... 3` (`globals.css:531-532`). Design audit item 1.5.2 — a dev-only warning had been pulsing forever.
2. **Confetti loops capped** 2 s/5 s → 1.5 s, and skipped under reduced motion (`CSS_LAYOUT_ANIMATION_PLAN` §3.3/§3.4).
3. **GSAP board translation** → instant repositioning under reduced motion (translation removed, information kept).
4. **`layout-property` animations banned for new code** — the motion gate fails on *new* `transition/animation` on width/height/top/left/right/margin/padding; the pre-existing two (`loading-bar`, `shimmer`) are allowlisted as measured as-found cases with a burn-down note.
5. **`.ai-thinking-tag`'s `pulse 1.5s infinite`** disappeared on 2026-10-15 — not as a motion decision, but because the whole legacy CSS family was deleted in the Phase C sweep and its six call sites became static `Chip`s (`SnakesBoard.tsx`). This is the only place where an animation was genuinely lost, and it was incidental.
6. **CSS `transition`s that lived inside deleted legacy families** (`.bet-chip { transition: all .2s }`, `.btn-main`, `.wl-btn`, …) went away with their families; the shared `Button`/`Chip` primitives re-supply equivalent transitions (`transition-[background-color,color,opacity,transform]` + the `--motion-*` tokens), so the interaction feel is preserved.

## 4. Why the motion policy exists (the reasoning)

From `CSS_LAYOUT_ANIMATION_PLAN.md` §5, `lib/motion.ts`, and the design audit's P2-10 — three separate concerns, none of which is "animations are bad":

1. **Accessibility.** The CSS kill-switch only covered CSS animation; framer components, the GSAP timelines and confetti never saw the OS setting, so a `prefers-reduced-motion` user still got full translation and particle bursts. The fix was to *make the preference reach JS*, not to delete the motion. Rule: **translation is removed, information is not.**
2. **Frame rate on mid-range phones.** Animating layout properties forces reflow on every frame. The gate enforces **compositor-only** motion (transform/opacity) for new code so the 4P board stays smooth on a mid-range Android — which is also why production builds with webpack and why the board uses GSAP transforms.
3. **Taste, not removal.** `DESIGN.md` asks for *"one clear moment over constant pulse"*. That produced exactly two edits (the diagnostic pulse, the confetti caps) — every other loop was kept.

## 5. Conclusion

- **The removal is not complete — because it was never started.** Any report claiming a site-wide animation removal is describing something that does not exist in this codebase: 35 keyframes, 23 infinite loops, 34 framer files, 2 GSAP board timelines and 3 confetti sites are all live today.
- **What is intentional and enforced:** every animation is *preference-aware* (verified live: 7 active normally → 0 under `reduce`) and *compositor-only* for new code (gate-enforced). The deliberate keeps are the two allowlisted keyframes (`loading-bar`, `shimmer`) and the three allowlisted framer layout-animation sites.
- **Where a claim of "removed" may have come from:** the 2026-10-15 legacy-family sweep deleted ~40 CSS families, and several of them carried `transition`/`animation` declarations (`.ai-thinking-tag`'s pulse among them). The *families* were removed and their animations went with them; the *surfaces* were re-implemented on `Button`/`Chip`, which animate. Anyone diffing the CSS would see hundreds of removed `animation:`/`transition:` lines without seeing the replacements.

**Re-run any time:** `npm run check:motion` (census + compositor rule) · `VISUAL_BASE_URL=http://127.0.0.1:3001 npm run check:reduce-motion` (the live 0-vs-7 assertion).
