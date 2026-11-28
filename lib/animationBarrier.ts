import type { ColorCorner, GameState, PlayerColor } from './types';
import { BASE_INDEX, BOARD_FINISH_INDEX } from './constants';
import { getBoardCoordinate, type Point } from './boardLayout';
import { getIntermediatePathCoords } from './gameLogic';
import { computeHopCadence, DEPLOY_ANIMATION_MS } from './tokenMovement';
import type { DiceThemeId } from './diceVisuals';

export const MAX_PRESENTATION_QUEUE = 4;
export const MAX_BARRIER_WATCHDOG_MS = 2500;
export const BARRIER_WATCHDOG_PAD_MS = 350;

const ALL_COLORS: readonly PlayerColor[] = ['green', 'red', 'yellow', 'blue'];

export function computeBarrierWatchdogMs(estimatedMs: number): number {
    return Math.min(MAX_BARRIER_WATCHDOG_MS, Math.max(0, Math.round(estimatedMs)) + BARRIER_WATCHDOG_PAD_MS);
}

/**
 * Shallow-structural check returning true when only timer/metadata fields changed
 * between two authoritative snapshots (no board, turn, dice, power, or status change).
 */
export function isTimerOnlyTransition(prev: GameState, next: GameState): boolean {
    if (prev === next) return true;
    if (
        prev.matchId !== next.matchId ||
        prev.currentPlayer !== next.currentPlayer ||
        prev.diceValue !== next.diceValue ||
        prev.isRolling !== next.isRolling ||
        prev.gamePhase !== next.gamePhase ||
        prev.status !== next.status ||
        prev.winner !== next.winner ||
        prev.abortReason !== next.abortReason ||
        prev.consecutiveSixes !== next.consecutiveSixes ||
        prev.activeBoost !== next.activeBoost ||
        prev.boostPendingDice !== next.boostPendingDice ||
        prev.boostSubMoveBonus !== next.boostSubMoveBonus ||
        prev.boostTrail !== next.boostTrail ||
        prev.powerSpentThisTurn !== next.powerSpentThisTurn ||
        prev.captureMessage !== next.captureMessage
    ) {
        return false;
    }

    for (const c of ALL_COLORS) {
        const pArr = prev.positions?.[c] ?? [];
        const nArr = next.positions?.[c] ?? [];
        if (pArr.length !== nArr.length) return false;
        for (let i = 0; i < pArr.length; i++) {
            if (Number(pArr[i]) !== Number(nArr[i])) return false;
        }
        const pPowers = prev.playerPowers?.[c] ?? [];
        const nPowers = next.playerPowers?.[c] ?? [];
        if (pPowers.length !== nPowers.length) return false;
        for (let i = 0; i < pPowers.length; i++) {
            if (pPowers[i]?.type !== nPowers[i]?.type || pPowers[i]?.expiresAt !== nPowers[i]?.expiresAt) {
                return false;
            }
        }
    }

    if (
        JSON.stringify(prev.winners ?? []) !== JSON.stringify(next.winners ?? []) ||
        JSON.stringify(prev.powerTiles ?? []) !== JSON.stringify(next.powerTiles ?? []) ||
        JSON.stringify(prev.activeShields ?? []) !== JSON.stringify(next.activeShields ?? []) ||
        JSON.stringify(prev.activeTraps ?? []) !== JSON.stringify(next.activeTraps ?? []) ||
        JSON.stringify(prev.nukeFlash ?? []) !== JSON.stringify(next.nukeFlash ?? []) ||
        JSON.stringify(prev.afkStats ?? {}) !== JSON.stringify(next.afkStats ?? {}) ||
        JSON.stringify(prev.idleWarning ?? null) !== JSON.stringify(next.idleWarning ?? null)
    ) {
        return false;
    }

    return true;
}

/**
 * Copy live clock/metadata fields from `source` onto `target` without rewinding
 * the presented board state during an active animation lock.
 */
export function mergeClockFields(target: GameState, source: GameState): GameState {
    return {
        ...target,
        timeLeft: source.timeLeft,
        deadlineAt: source.deadlineAt,
        turnDurationMs: source.turnDurationMs,
        turnPhaseKind: source.turnPhaseKind,
        strikes: source.strikes,
        lastUpdate: source.lastUpdate,
    };
}

/**
 * Estimate how long client presentation of `prev -> next` will take so queued
 * follow-up updates wait cleanly until hops/deploys/captures finish landing.
 */
export function estimateTransitionDurationMs(
    prev: GameState | null,
    next: GameState,
    colorCorner: ColorCorner,
    themeId: DiceThemeId = '3077',
): number {
    if (!prev || next.winner || next.abortReason) return 0;
    if (prev.matchId && next.matchId && prev.matchId !== next.matchId) return 0;

    const msg = next.captureMessage || '';
    const isTeleport = msg !== prev.captureMessage && /TELEPORT!/i.test(msg);
    const isNuke =
        (next.nukeFlash?.length ?? 0) > 0 &&
        ((prev.nukeFlash?.length ?? 0) === 0 || msg !== prev.captureMessage);
    const isBoosted = Boolean(next.boostTrail || next.activeBoost || next.boostPendingDice != null);

    const moverLandings: { pt: Point | null; walkMs: number }[] = [];
    let maxDurationMs = 0;

    for (const color of ALL_COLORS) {
        const pArr = prev.positions?.[color] ?? [];
        const nArr = next.positions?.[color] ?? [];
        for (let i = 0; i < Math.min(pArr.length, nArr.length); i++) {
            const oldPos = Number(pArr[i]);
            const newPos = Number(nArr[i]);
            if (oldPos === newPos) continue;

            if (oldPos === BASE_INDEX && newPos >= 0 && newPos < BOARD_FINISH_INDEX) {
                const pt = getBoardCoordinate(newPos, color, colorCorner);
                moverLandings.push({ pt, walkMs: DEPLOY_ANIMATION_MS });
                maxDurationMs = Math.max(maxDurationMs, DEPLOY_ANIMATION_MS);
            } else if (oldPos >= 0 && oldPos < BOARD_FINISH_INDEX && newPos > BASE_INDEX && newPos <= BOARD_FINISH_INDEX) {
                const pt = getBoardCoordinate(newPos, color, colorCorner);
                const waypoints = isTeleport ? [] : getIntermediatePathCoords(oldPos, newPos, color, colorCorner);
                const cadence = computeHopCadence(Math.max(1, waypoints.length), isBoosted, themeId);
                const walkMs = isTeleport ? 560 : cadence.totalWalkMs;
                moverLandings.push({ pt, walkMs });
                const extraFinishMs = newPos === BOARD_FINISH_INDEX ? 260 : 0;
                maxDurationMs = Math.max(maxDurationMs, walkMs + extraFinishMs);
            }
        }
    }

    for (const color of ALL_COLORS) {
        const pArr = prev.positions?.[color] ?? [];
        const nArr = next.positions?.[color] ?? [];
        for (let i = 0; i < Math.min(pArr.length, nArr.length); i++) {
            const oldPos = Number(pArr[i]);
            const newPos = Number(nArr[i]);
            if (oldPos >= 0 && oldPos < BOARD_FINISH_INDEX && newPos === BASE_INDEX) {
                const pt = getBoardCoordinate(oldPos, color, colorCorner);
                const matchingMover = pt
                    ? moverLandings.find((m) => m.pt && m.pt.r === pt.r && m.pt.c === pt.c)
                    : undefined;
                if (isNuke) {
                    maxDurationMs = Math.max(maxDurationMs, 1400);
                } else {
                    const impactMs = matchingMover ? Math.max(0, matchingMover.walkMs - 30) : 0;
                    maxDurationMs = Math.max(maxDurationMs, impactMs + 460);
                }
            }
        }
    }

    if (maxDurationMs === 0) {
        if (isNuke) {
            maxDurationMs = 1100;
        } else if (prev.diceValue == null && next.diceValue != null && !next.isRolling) {
            // Remote catch-up toss before moving/passing
            maxDurationMs = 360;
        } else if (prev.isRolling && !next.isRolling && next.diceValue != null) {
            // Dice settle snap
            maxDurationMs = 220;
        }
    }

    return Math.min(MAX_BARRIER_WATCHDOG_MS, maxDurationMs);
}

interface LockEntry {
    timer: ReturnType<typeof setTimeout>;
}

interface QueuedPresentation {
    state: GameState;
    resync: boolean;
    estimatedMs: number;
}

export type BarrierSetTimeoutFn = (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
export type BarrierClearTimeoutFn = (id: ReturnType<typeof setTimeout>) => void;

export interface AnimationBarrierOptions {
    initialState: GameState;
    maxQueue?: number;
    onPresent: (state: GameState, meta: { flushed: boolean; resync: boolean }) => void;
    getReducedMotion?: () => boolean;
    isHidden?: () => boolean;
    setTimeoutFn?: BarrierSetTimeoutFn;
    clearTimeoutFn?: BarrierClearTimeoutFn;
}

/**
 * Deadlock-proof FIFO presentation barrier separating immediate authoritative
 * GameState updates (timers, intents, seq) from paced visual board updates.
 */
export class AnimationBarrier {
    private presented: GameState;
    private authoritative: GameState;
    private queue: QueuedPresentation[] = [];
    private locks = new Map<string, LockEntry>();
    private readonly maxQueue: number;
    private readonly onPresent: AnimationBarrierOptions['onPresent'];
    private readonly getReducedMotion: () => boolean;
    private readonly isHidden: () => boolean;
    private readonly setTimeoutFn: BarrierSetTimeoutFn;
    private readonly clearTimeoutFn: BarrierClearTimeoutFn;

    constructor(opts: AnimationBarrierOptions) {
        this.presented = opts.initialState;
        this.authoritative = opts.initialState;
        this.maxQueue = Math.max(1, opts.maxQueue ?? MAX_PRESENTATION_QUEUE);
        this.onPresent = opts.onPresent;
        this.getReducedMotion = opts.getReducedMotion ?? (() => false);
        this.isHidden = opts.isHidden ?? (() => false);
        this.setTimeoutFn = opts.setTimeoutFn ?? ((fn, ms) => globalThis.setTimeout(fn, ms));
        this.clearTimeoutFn = opts.clearTimeoutFn ?? ((id) => globalThis.clearTimeout(id));
    }

    public getPresented(): GameState {
        return this.presented;
    }

    public getAuthoritative(): GameState {
        return this.authoritative;
    }

    public getQueueLength(): number {
        return this.queue.length;
    }

    public getActiveLocks(): string[] {
        return Array.from(this.locks.keys());
    }

    public isLocked(): boolean {
        return this.locks.size > 0;
    }

    /**
     * Acquire a named animation lock backed by a hard upper-bound watchdog
     * (`min(2500, estimatedMs + 350)`) so dropped GSAP callbacks never wedge UI.
     */
    public acquireLock(name: string, estimatedMs: number): void {
        if (this.getReducedMotion() || this.isHidden()) return;
        this.armLockTimer(name, computeBarrierWatchdogMs(estimatedMs));
    }

    /**
     * Acquire a timed pace lock that releases automatically at `durationMs`
     * (used between sequential queued transitions when GSAP owns individual components).
     */
    public acquireTimedLock(name: string, durationMs: number): void {
        if (this.getReducedMotion() || this.isHidden() || durationMs <= 0) return;
        this.armLockTimer(name, Math.min(MAX_BARRIER_WATCHDOG_MS, Math.round(durationMs)));
    }

    private armLockTimer(name: string, timeoutMs: number): void {
        const prev = this.locks.get(name);
        if (prev) this.clearTimeoutFn(prev.timer);
        const timer = this.setTimeoutFn(() => {
            this.locks.delete(name);
            this.drainNextIfUnlocked();
        }, Math.max(0, timeoutMs));
        this.locks.set(name, { timer });
    }

    public releaseLock(name: string): void {
        const entry = this.locks.get(name);
        if (entry) {
            this.clearTimeoutFn(entry.timer);
            this.locks.delete(name);
        }
        this.drainNextIfUnlocked();
    }

    public enqueue(
        nextState: GameState,
        opts?: { resync?: boolean; estimatedMs?: number },
    ): void {
        this.authoritative = nextState;
        const isResync = Boolean(opts?.resync);
        const estimatedMs = Math.max(0, opts?.estimatedMs ?? 0);

        const matchChanged = Boolean(
            nextState.matchId &&
                this.presented.matchId &&
                nextState.matchId !== this.presented.matchId,
        );

        if (
            this.getReducedMotion() ||
            this.isHidden() ||
            isResync ||
            Boolean(nextState.winner || nextState.abortReason) ||
            matchChanged
        ) {
            this.flushNow(nextState, isResync);
            return;
        }

        if (!this.isLocked() && this.queue.length > 0) {
            this.drainNextIfUnlocked();
        }

        const tail = this.queue.length > 0 ? this.queue[this.queue.length - 1].state : this.presented;
        if (isTimerOnlyTransition(tail, nextState)) {
            if (this.queue.length > 0) {
                const last = this.queue[this.queue.length - 1];
                last.state = mergeClockFields(last.state, nextState);
            }
            this.presented = mergeClockFields(this.presented, nextState);
            this.onPresent(this.presented, { flushed: false, resync: false });
            return;
        }

        if (!this.isLocked() && this.queue.length === 0) {
            this.presented = nextState;
            this.onPresent(this.presented, { flushed: false, resync: false });
            if (estimatedMs > 0) {
                this.acquireTimedLock('transition', estimatedMs);
            }
            return;
        }

        this.queue.push({ state: nextState, resync: isResync, estimatedMs });
        while (this.queue.length > this.maxQueue) {
            const dropped = this.queue.shift();
            if (dropped && dropped.estimatedMs > 0 && this.queue.length > 0 && this.queue[0].estimatedMs === 0) {
                this.queue[0].estimatedMs = dropped.estimatedMs;
            }
        }
    }

    public flush(reason?: string): void {
        this.flushNow(this.authoritative, reason === 'resync');
    }

    private flushNow(targetState: GameState, resync: boolean): void {
        this.clearAllLocks();
        this.queue = [];
        this.presented = targetState;
        this.onPresent(this.presented, { flushed: true, resync });
    }

    private drainNextIfUnlocked(): void {
        if (this.isLocked() || this.queue.length === 0) return;

        if (this.getReducedMotion() || this.isHidden()) {
            this.flushNow(this.authoritative, false);
            return;
        }

        while (!this.isLocked() && this.queue.length > 0) {
            const next = this.queue.shift();
            if (!next) break;
            this.presented = next.state;
            this.onPresent(this.presented, { flushed: false, resync: next.resync });
            if (next.estimatedMs > 0 && !next.state.winner && !next.state.abortReason) {
                this.acquireTimedLock('transition', next.estimatedMs);
            }
        }
    }

    private clearAllLocks(): void {
        for (const entry of this.locks.values()) {
            this.clearTimeoutFn(entry.timer);
        }
        this.locks.clear();
    }

    public dispose(): void {
        this.clearAllLocks();
        this.queue = [];
    }
}
