# Ludo World Benchmark: Full Implementation Plan & Execution Roadmap

| Metadata | Details |
| :--- | :--- |
| **Document** | `docs/planning/LUDO_WORLD_BENCHMARK_IMPLEMENTATION_PLAN.md` |
| **Status** | Approved & Ready for Execution |
| **Priority** | **Phase 1: Track 2 (Kinematics & Board Polish)** → **Phase 2: Track 1 (Netcode & Turn Authority)** → **Phase 3: Track 3 & 4 (AI & Emotes)** |
| **Source Benchmark** | `docs/research/LUDO_WORLD_ARCHITECTURE_TEARDOWN.md` (Tencent Ludo World v2.1.10) |
| **Key Invariants** | `AGENTS.md` (Single `TEAM_PAIRINGS`, engine-math legality, DO single authority for ranked, pull-only claims) |

---

## 1. Executive Summary & User Decisions

Following our deep teardown of Ludo World (`com.tencent.ludosuperstar`), we are translating the verified production benchmarks into Ludo Base. Based on the architectural review and user decisions, the execution order is:

1. **Immediate Focus (Phase 1 / Track 2):** **Board Kinematics & Polish**
   * Replace monolithic 1.3s FLIP duration with **0.16s stepped cell hops** (`delay(0.02s) -> moveTo(0.12s) -> delay(0.02s)`).
   * **Multi-token stacking overhaul:** Reduce scale to **`0.45`** when >1 tokens occupy a cell and position in 2×2 quadrants (`[(-17, 12), (15, 12), (-17, -21), (15, -21)]`).
   * **Capture Rewind:** Replace teleportation with high-speed **0.01s per-cell backward rewind** into yard + crying face emote.
   * **Dice Timing:** Tune 3D tumble from 1.2s to **0.3s spin + 0.6s settle = 0.9s total cycle**.
   * **Animation Barrier:** Implement FIFO action queue so rapid network state updates do not interrupt or snap mid-hop tokens.

2. **Subsequent Tracks:**
   * **Phase 2 (Track 1 - Netcode & Authority):** Server-owned 15s turn deadline via DO Alarms (`deadlineAt`), auto-play trust takeover on 1st timeout, typed `RoomError` enum.
   * **Phase 3 (Track 3 - AI Heuristics):** 5-stage decision cascade in `lib/aiEngine.ts` (`eatChess` → `collideChessBack` → `missGrid` → `collideChessBefore` → `getBestMoveIndex`).
   * **Phase 4 (Track 4 - Social / Emotes):** **100% Original Ludo 3077 Animated Sticker Packs** (Cyber Orb & On-Chain Bot sets matching our retro-futuristic / terminal-glass brand) using the benchmarked 8-reaction schema over Supabase Realtime broadcast (zero asset copying).

---

## 2. Phase 1: Track 2 Kinematics & Board Polish Breakdown

### Milestone 2.1: Stepped Token Hops & Per-Cell Audio (`TokenPiece.tsx`)
* **Current Issue:** `TOTAL = 1.3s` is divided equally by `n`. If a token moves 1 step, it floats for 1.3 seconds. If it moves 6 steps, each step is ~0.21s.
* **Benchmark:** Ludo World moves at a constant tempo: **0.16s per cell** (`Checkerboard.js:352`).
  * `LEAP` (airborne travel) = `0.12s`
  * `BEAT` (grounded pause) = `0.04s` (`delay(0.02s)` before + after)
  * Vertical hop: `UP = 0.04s`, `DOWN = 0.08s`, hop height `-18px`.
* **Changes in `app/components/board/TokenPiece.tsx`:**
  * Calculate `cellDur = 0.16`.
  * For $N$ steps, total timeline duration = $N \times 0.16\text{s}$ (e.g. 1 step = 0.16s, 6 steps = 0.96s).
  * Trigger `playJumpSound()` on every hop landing tick.
  * Animate yard take-off with `0.29s` lift-and-land curve (`delay(0.13s) -> moveTo(0.16s)`).

### Milestone 2.2: Capture Rewind Animation (`TokenPiece.tsx` & `TokenVisual.tsx`)
* **Current Issue:** When a token is captured (`pos === BASE_INDEX`), it immediately disappears from the tile and teleports to the yard with only a local `ShatterFX` explosion.
* **Benchmark:** Captured tokens rapidly rewind along the track back into base at **0.01s per cell**, drop into yard (`0.16s`), and spawn a crying reaction (`Checkerboard.js:180-205`).
* **Changes:**
  * When `pos === BASE_INDEX` and `oldPos >= 0`, calculate reverse path from `oldPos` down to `0`.
  * Fast GSAP tween rewinding coordinates at `0.01s` per waypoint.
  * On yard arrival, spawn `CryingEmoteFX` (sad emoji floating from token base).

### Milestone 2.3: 2×2 Quadrant Stacking Geometry (`BoardTokens.tsx`)
* **Current Issue:** `stackScale = 0.88` with slight offsets (`±9px`). When 3 or 4 tokens share a safe star, tokens heavily overlap and obscure the star and player colors.
* **Benchmark:** Ludo World drops token scale to **`0.4`** and positions them into a balanced 2×2 grid (`GameInfoModel.js:414`, `Checkerboard.js:125-130`):
  ```typescript
  const STACK_QUADRANTS: Record<number, { x: number; y: number }[]> = {
    1: [{ x: 0, y: 0 }],
    2: [{ x: -14, y: 0 }, { x: 14, y: 0 }],
    3: [{ x: -14, y: 10 }, { x: 14, y: 10 }, { x: 0, y: -12 }],
    4: [{ x: -14, y: 10 }, { x: 14, y: 10 }, { x: -14, y: -12 }, { x: 14, y: -12 }],
  };
  ```
* **Changes:**
  * In `BoardTokens.tsx`, if `stack.length > 1`, set `stackScale = 0.45` (tuned for high readability on SVG board).
  * Align tokens to 2×2 quadrants with proper DOM z-index (own tokens on top, then arrival order).
  * When a stacked token starts moving, animate scale smoothly back from `0.45` to `1.0` during the first hop.

### Milestone 2.4: Snappy Dice Timing (`LudoDice.tsx`)
* **Current Issue:** 3D dice tumble duration is set to `1.2s` (`transition: { duration: 1.2, ease: "linear" }`), making rolling feel sluggish.
* **Benchmark:** Ludo World roll animation is **`0.3s` spin + `0.6s` settle = `0.9s` total** (`Dice.js:147`).
* **Changes in `app/components/LudoDice.tsx`:**
  * Reduce tumble transition duration from `1.2s` to `0.30s`.
  * Set final face spring settle duration to `0.45s` with `damping: 20, stiffness: 260`.
  * Release move selection highlights at exactly `0.75s–0.80s` post-click.

### Milestone 2.5: Client Animation Barrier & FIFO Action Queue (`useGameEngine.ts`)
* **Current Issue:** If network messages (`MOVE_TOKEN`, `TURN_SWITCH`) arrive while a token is mid-hop, React re-renders with new positions, causing visual popping.
* **Benchmark:** `MessageCenter.setGlobalCacheMessage(true)` holds incoming event dispatching until `MsgID_MoveChessEnd` fires.
* **Changes:**
  * Introduce `isHopAnimating` lock in `useGameEngine.ts`.
  * When a room action arrives during `isHopAnimating === true`, push it to an `actionQueueRef`.
  * On `onHopComplete`, flush the queue sequentially.

---

## 3. Phase 2: Track 1 Netcode & Turn Authority Preview

* **DO Alarm Turn Deadlines (`src/room/MatchRoom.ts`):**
  * Store `deadlineAt = Date.now() + 15_000` on turn start.
  * Schedule Cloudflare DO Alarm: `await this.ctx.storage.setAlarm(this.state.deadlineAt)`.
  * If no `REQUEST_ROLL` or `REQUEST_MOVE` is committed before the alarm fires, execute auto-turn progression and mark `player.isTrust = true`.
* **Client Sync (`useGameTimer.ts`):**
  * Deprecate local `Date.now() + 15s` timer generation.
  * Render countdown strictly from `Math.max(0, state.deadlineAt - Date.now())`.
* **Typed Error Contract (`lib/roomCodes.ts`):**
  * Replace `new Error('[CODE]...')` with structured `{ ok: false, code: RoomErrorCode, seq }`.

---

## 4. Phase 3: Track 3 AI Heuristics Preview

* **5-Stage Cascade in `lib/aiEngine.ts`:**
  1. `eatChess`: Priority 100 — capture opponent on unsafe tile.
  2. `collideChessBack`: Priority 80 — evade enemy 1–6 tiles behind.
  3. `missGrid`: Priority 60 — land on safe star `[0, 8, 13, 21, 26, 34, 39, 47]`.
  4. `collideChessBefore`: Priority 40 — position 1–6 tiles behind enemy to threaten capture.
  5. `getBestMoveIndex`: Priority 20 — advance token furthest along path.

---

## 5. Phase 4: Track 4 Original Social & Animated Sticker Packs

* **Brand Invariant:** Under no circumstances do we copy or imitate competitor art (e.g. Tencent's NiuNiu or Arab characters). Ludo World was analyzed strictly for its **packet schema, message rate limits, and animation hook architecture**.
* **Original Ludo 3077 Sticker Sets:**
  Designed in full alignment with our Cyberpunk / Retro-Futurism (`theme-retro-futurism` / `theme-daybreak`), terminal-glass, and cyan `#00E5FF` visual identity:
  1. **"Cyber-Orb" Pack (8 Animated Reactions):**
     * `ORB_GLITCH`: Static screen glitching out (crying/frustrated equivalent).
     * `ORB_OVERHEAT`: Glowing red core radiating steam (rage/angry).
     * `ORB_LASER_EYES`: Double cyan laser beam burst (hyped/winning).
     * `ORB_SMUG`: Holographic sunglasses dropping onto orb.
     * `ORB_BOUNCE`: Rhythmic joyful pulse (happy/dancing).
     * `ORB_BLUE_SCREEN`: BSOD glitch with digital static (defeated/facepalm).
     * `ORB_DIAMOND`: Faceted diamond shell flash (HODL / flex).
     * `ORB_WAVE`: Holographic ping sonar ring (greeting / gg).
  2. **Technical Pipeline:**
     * Vector SVG / CSS keyframes and Lottie JSON format (lightweight, resolution-independent, zero blurry raster sprites).
     * Transport: Transmitted via Supabase Realtime broadcast on `game-room-<roomCode>` with `actionId` deduplication (0 gas, 0 on-chain latency).
     * Rendered as floating avatar callouts anchored to player seat HUDs.

---

## 6. Verification & Testing Gates

1. **Typecheck & Linter Gate:**
   * `npx tsc -p tsconfig.json --noEmit` must return 0 errors.
   * `npm run lint` must pass cleanly.
2. **Engine Tests:**
   * `npm test` (`npx tsx --test`) verifying move legality, capture rules, and turn cycle clamping.
3. **Kinematics & Visual Verification:**
   * Manual run on `http://localhost:3000` checking:
     * 1-step, 3-step, 6-step movement tempos (snappy 0.16s).
     * 2, 3, and 4-token stacking on star squares (0.45 scale, 2×2 layout).
     * Dice spin feel (0.3s tumble + 0.5s settle).
     * Capture rewind animation into yard.

