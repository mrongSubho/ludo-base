/**
 * G1 — match receipt / post-mortem (debug + trust artifact).
 * Spine for later CHIPS settle receipts; no chain coupling yet.
 */

import type { GameState, BoardPlayer, MatchCaptureStats, PlayerColor, AfkPlayerStats } from '../types';
import { hashGameState, gameStateDigest } from '../replay/hash';
import type { ReplayEvent, ReplayLog } from '../replay/log';
import { getNetCounters } from '../netcode/counters';
import { afkHonestyView } from '../netcode/abandon';

export interface MatchReceiptPlayer {
    color: PlayerColor;
    name: string;
    isAi: boolean;
    walletAddress?: string;
    afk: {
        label: string;
        copy: string;
        totalTriggers: number;
        isKicked: boolean;
    };
    captures: { kicks: number; gotKicked: number };
}

export interface MatchReceipt {
    version: 1;
    generatedAt: string;
    matchId: string;
    playerCount: '1v1' | '4P' | '2v2';
    status: GameState['status'];
    winner: string | null;
    winners: string[];
    players: MatchReceiptPlayer[];
    finalHash: string;
    digest: Record<string, unknown>;
    lastRollId: string | null;
    seq: number | null;
    net: {
        seqGaps: number;
        resyncs: number;
        intentDup: number;
        reconnects: number;
        schemaDrops: number;
    };
    events?: ReplayEvent[];
}

export function buildMatchReceipt(params: {
    state: GameState;
    players: BoardPlayer[];
    seq?: number;
    replay?: ReplayLog;
    includeEvents?: boolean;
}): MatchReceipt {
    const { state, players, seq, replay, includeEvents } = params;
    const counters = getNetCounters();
    const stats = state.matchStats as MatchCaptureStats | undefined;

    const receiptPlayers: MatchReceiptPlayer[] = players.map((p) => {
        const afkStats = state.afkStats?.[p.color] as AfkPlayerStats | undefined;
        const view = afkHonestyView(p.color, afkStats);
        return {
            color: p.color,
            name: p.name,
            isAi: !!p.isAi,
            walletAddress: p.walletAddress,
            afk: {
                label: view.label,
                copy: view.copy,
                totalTriggers: view.totalTriggers,
                isKicked: view.isKicked,
            },
            captures: {
                kicks: stats?.[p.color]?.kicks ?? 0,
                gotKicked: stats?.[p.color]?.gotKicked ?? 0,
            },
        };
    });

    return {
        version: 1,
        generatedAt: new Date().toISOString(),
        matchId: state.matchId ?? 'local',
        playerCount: state.playerCount,
        status: state.status,
        winner: state.winner,
        winners: [...(state.winners ?? [])],
        players: receiptPlayers,
        finalHash: hashGameState(state),
        digest: gameStateDigest(state),
        lastRollId: state.lastRollId ?? null,
        seq: typeof seq === 'number' ? seq : null,
        net: {
            seqGaps: counters.net_seq_gap,
            resyncs: counters.net_resync_applied,
            intentDup: counters.net_intent_dup,
            reconnects: counters.net_reconnect_success,
            schemaDrops: counters.net_schema_drop,
        },
        events: includeEvents && replay ? [...replay.events] : undefined,
    };
}

export function renderReceiptMarkdown(receipt: MatchReceipt): string {
    const lines: string[] = [];
    lines.push(`# Match receipt — ${receipt.matchId}`);
    lines.push('');
    lines.push(`- Generated: ${receipt.generatedAt}`);
    lines.push(`- Mode: ${receipt.playerCount}`);
    lines.push(`- Status: ${receipt.status}`);
    lines.push(`- Winner: ${receipt.winner ?? receipt.winners.join(', ') ?? '—'}`);
    lines.push(`- Final hash: \`${receipt.finalHash}\``);
    if (receipt.seq != null) lines.push(`- match_states.seq: ${receipt.seq}`);
    if (receipt.lastRollId) lines.push(`- last roll id: \`${receipt.lastRollId}\``);
    lines.push('');
    lines.push('## Players');
    for (const p of receipt.players) {
        lines.push(`- **${p.name}** (${p.color}${p.isAi ? ', bot' : ''}): kicks ${p.captures.kicks} / got-kicked ${p.captures.gotKicked} — ${p.afk.copy}`);
    }
    lines.push('');
    lines.push('## Netcode');
    lines.push(`- seq gaps: ${receipt.net.seqGaps}`);
    lines.push(`- resyncs: ${receipt.net.resyncs}`);
    lines.push(`- intent dups dropped: ${receipt.net.intentDup}`);
    lines.push(`- reconnects ok: ${receipt.net.reconnects}`);
    lines.push(`- schema drops: ${receipt.net.schemaDrops}`);
    return lines.join('\n');
}
