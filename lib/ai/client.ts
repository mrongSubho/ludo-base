/**
 * E4 — AI off the main thread.
 * Web Worker when available; deterministic sync fallback (timeout / SSR / tests).
 */

import type { PlayerColor, PowerType, GameState } from '../types';
import type { ColorCorner } from '../boardLayout';
import type { BotDifficulty } from '../constants';
import { getBestMove, getBestPowerUsage } from '../aiEngine';
import { captureException, track } from '../telemetry';

export type BestMoveArgs = {
    positions: Record<PlayerColor, number[]>;
    playerId: PlayerColor;
    roll: number;
    colorCorner: ColorCorner;
    playerCount: string;
    powerTiles: { r: number; c: number }[];
    state?: GameState;
    difficulty: BotDifficulty;
};

export type BestPowerArgs = {
    state: GameState;
    playerId: PlayerColor;
    colorCorner: ColorCorner;
    playerCount: string;
    difficulty: BotDifficulty;
};

export type AiTimeoutMs = number;

const DEFAULT_TIMEOUT_MS = 250;

type Pending = {
    resolve: (v: unknown) => void;
    reject: (e: unknown) => void;
    timer: ReturnType<typeof setTimeout>;
};

let worker: Worker | null = null;
let workerBroken = false;
let nextId = 1;
const pending = new Map<number, Pending>();

function canUseWorker(): boolean {
    return !workerBroken && typeof Worker !== 'undefined' && typeof window !== 'undefined';
}

function ensureWorker(): Worker | null {
    if (!canUseWorker()) return null;
    if (worker) return worker;
    try {
        worker = new Worker(new URL('./worker.ts', import.meta.url));
        worker.onmessage = (ev: MessageEvent) => {
            const data = ev.data as { id: number; ok: boolean; result?: unknown; error?: string };
            const p = pending.get(data.id);
            if (!p) return;
            clearTimeout(p.timer);
            pending.delete(data.id);
            if (data.ok) p.resolve(data.result);
            else p.reject(new Error(data.error ?? 'ai worker error'));
        };
        worker.onerror = () => {
            workerBroken = true;
            for (const [, p] of pending) {
                clearTimeout(p.timer);
                p.reject(new Error('ai worker crashed'));
            }
            pending.clear();
            worker?.terminate();
            worker = null;
        };
        return worker;
    } catch (err) {
        workerBroken = true;
        captureException(err, { where: 'ai_worker_boot' });
        return null;
    }
}

function callWorker<T>(kind: 'move' | 'power', payload: unknown, timeoutMs: number): Promise<T> {
    const w = ensureWorker();
    if (!w) return Promise.reject(new Error('no worker'));
    const id = nextId++;
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
            pending.delete(id);
            // Do not permanently break the worker — just fail this request.
            reject(new Error('ai worker timeout'));
        }, timeoutMs);
        pending.set(id, {
            resolve: resolve as (v: unknown) => void,
            reject,
            timer,
        });
        w.postMessage({ id, kind, payload });
    });
}

/** Best token index or null. Never throws — falls back to sync then null. */
export async function getBestMoveAsync(
    args: BestMoveArgs,
    timeoutMs: AiTimeoutMs = DEFAULT_TIMEOUT_MS
): Promise<number | null> {
    try {
        if (canUseWorker()) {
            return await callWorker<number | null>('move', args, timeoutMs);
        }
    } catch (err) {
        track('net_degraded', { reason: 'ai_worker_fallback', kind: 'move' });
        captureException(err, { where: 'ai_move_async' });
    }
    try {
        return getBestMove(
            args.positions,
            args.playerId,
            args.roll,
            args.colorCorner,
            args.playerCount,
            args.powerTiles,
            args.state,
            args.difficulty
        );
    } catch {
        return null;
    }
}

export async function getBestPowerUsageAsync(
    args: BestPowerArgs,
    timeoutMs: AiTimeoutMs = DEFAULT_TIMEOUT_MS
): Promise<{ type: PowerType; tokenIdx?: number } | null> {
    try {
        if (canUseWorker()) {
            return await callWorker<{ type: PowerType; tokenIdx?: number } | null>('power', args, timeoutMs);
        }
    } catch (err) {
        track('net_degraded', { reason: 'ai_worker_fallback', kind: 'power' });
        captureException(err, { where: 'ai_power_async' });
    }
    try {
        return getBestPowerUsage(args.state, args.playerId, args.colorCorner, args.playerCount, args.difficulty);
    } catch {
        return null;
    }
}

/** Test/SSR helper — force sync path. */
export function resetAiClientForTests(): void {
    worker?.terminate();
    worker = null;
    workerBroken = false;
    for (const [, p] of pending) {
        clearTimeout(p.timer);
        p.reject(new Error('reset'));
    }
    pending.clear();
}
