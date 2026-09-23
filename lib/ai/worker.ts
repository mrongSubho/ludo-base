/**
 * E4 AI Web Worker — pure heuristics off the render thread.
 * Messages: { id, kind: 'move'|'power', payload } → { id, ok, result } | { id, ok:false, error }
 */

import { getBestMove, getBestPowerUsage } from '../aiEngine';
import type { BestMoveArgs, BestPowerArgs } from './client';

type MoveMsg = { id: number; kind: 'move'; payload: BestMoveArgs };
type PowerMsg = { id: number; kind: 'power'; payload: BestPowerArgs };
type InMsg = MoveMsg | PowerMsg;

self.onmessage = (ev: MessageEvent<InMsg>) => {
    const msg = ev.data;
    try {
        if (msg.kind === 'move') {
            const a = msg.payload;
            const result = getBestMove(
                a.positions,
                a.playerId,
                a.roll,
                a.colorCorner,
                a.playerCount,
                a.powerTiles,
                a.state,
                a.difficulty
            );
            self.postMessage({ id: msg.id, ok: true, result });
            return;
        }
        if (msg.kind === 'power') {
            const a = msg.payload;
            const result = getBestPowerUsage(a.state, a.playerId, a.colorCorner, a.playerCount, a.difficulty);
            self.postMessage({ id: msg.id, ok: true, result });
            return;
        }
        self.postMessage({ id: (msg as { id: number }).id, ok: false, error: 'unknown kind' });
    } catch (err) {
        self.postMessage({
            id: (msg as { id: number }).id,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
        });
    }
};
