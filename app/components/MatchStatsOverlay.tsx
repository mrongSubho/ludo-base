"use client";

import React, { useMemo, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { BOARD_FINISH_INDEX, TEAM_ID } from '@/lib/constants';
import { GameState, PlayerColor } from '@/lib/types';
import { Player } from '@/hooks/useGameEngine';
import { getDisplayNameHelper } from './PlayerInfoRow';
import { buildMatchReceipt, renderReceiptMarkdown, type MatchReceipt } from '@/lib/receipt/buildMatchReceipt';

// ─── Post-match stats sheet ──────────────────────────────────────────────────
// Terminal-glass treatment of the classic win sheet: result banner, XP strip,
// per-player home/finish table, CHIPS claim slot (UI only — contracts wire
// later per docs/tokenomics/CHIPS_PLANNING.md section 4.8 Path A), then Back/Rematch.

const COLOR_ACCENT: Record<string, string> = {
    green: '#10b981',
    red: '#ef4444',
    yellow: '#eab308',
    blue: '#3b82f6',
};

function formatChips(n: number): string {
    if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000) return `${+(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
    return n.toLocaleString();
}

function tokensHome(positions: GameState['positions'], color: PlayerColor): number {
    return (positions?.[color] || []).filter((p) => p === BOARD_FINISH_INDEX).length;
}

function playerDidWin(
    player: Player,
    gameState: GameState,
    playerCount: GameState['playerCount']
): boolean {
    const winner = gameState.winner;
    if (!winner) return false;
    if (playerCount === '2v2' || winner.startsWith('Team ')) {
        const myTeam = TEAM_ID[player.color];
        return String(winner).includes(String(myTeam)) || gameState.winners?.includes(player.color);
    }
    return winner === player.color || gameState.winners?.includes(player.color);
}

/** Placeholder pool math until MatchPool is live (CHIPS_PLANNING section 4.5). */
function estimateClaimChips(wager: number, seats: number, winners: number): number {
    if (wager <= 0 || seats <= 0 || winners <= 0) return 0;
    const gross = wager * seats;
    const prize = Math.floor(gross * 0.93); // 5% protocol + 2% burn sketch
    return Math.floor(prize / winners);
}

const RankBadge = ({ rank, won }: { rank: number; won: boolean }) => (
    <div
        className={`match-stats-rank ${won ? 'won' : ''}`}
        aria-label={`Rank ${rank}`}
    >
        {rank}
    </div>
);

const HomeGlyph = () => (
    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 10.5 12 3l9 7.5" />
        <path d="M5 10v10h14V10" />
    </svg>
);

/** Outgoing capture — token you sent home. */
const KickGlyph = () => (
    <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 16c2-1 4-4 4-7V5h3l1 4 3 2 3-1v3l-4 2v4c0 2-2 3-4 3s-4-1-4-3z" />
        <path d="M14 8l3-3M17 12l3 1" />
    </svg>
);

/** Incoming capture — token of yours sent home. */
const KickedGlyph = () => (
    <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2" />
    </svg>
);

function combatFor(
    color: PlayerColor,
    gameState: GameState
): { kicks: number; gotKicked: number } {
    const s = gameState.matchStats?.[color];
    return { kicks: s?.kicks ?? 0, gotKicked: s?.gotKicked ?? 0 };
}

export interface MatchStatsOverlayProps {
    open: boolean;
    gameState: GameState;
    players: Player[];
    myPlayer?: Player;
    playerCount?: GameState['playerCount'];
    wager?: number;
    gameMode?: string;
    /** Post-match XP toast value when engine exposed one. */
    lxpGain?: number | null;
    onRematch: () => void;
    onExit?: () => void;
    /**
     * MatchPool claim (pull). Wired in Board when poolId is known.
     */
    onClaimChips?: () => void;
    /** On-chain MatchPool id for this paid match (0x…). */
    poolId?: `0x${string}` | null;
    /** Overriding estimate (e.g. real pool credit from indexer). */
    claimableChips?: number | null;
    claimUnlocksInMin?: number | null;
    /** Live claim busy / lock from usePoolClaim. */
    claimBusy?: boolean;
    claimError?: string | null;
}

export function MatchStatsOverlay({
    open,
    gameState,
    players,
    myPlayer,
    playerCount = gameState.playerCount || '4P',
    wager = 0,
    gameMode = 'classic',
    lxpGain,
    onRematch,
    onExit,
    onClaimChips,
    poolId,
    claimableChips,
    claimUnlocksInMin,
    claimBusy,
    claimError,
}: MatchStatsOverlayProps) {
    const seats = playerCount === '1v1' ? 2 : 4;

    const rows = useMemo(() => {
        return players
            .map((p) => {
                const home = tokensHome(gameState.positions, p.color);
                const won = playerDidWin(p, gameState, playerCount);
                const combat = combatFor(p.color, gameState);
                return { player: p, home, won, ...combat };
            })
            .sort((a, b) => {
                if (a.won !== b.won) return a.won ? -1 : 1;
                return b.home - a.home;
            });
    }, [players, gameState, playerCount]);

    const winnerCount = Math.max(1, rows.filter((r) => r.won).length);
    const iWon = !!myPlayer && rows.find((r) => r.player.color === myPlayer.color)?.won;
    const estClaim =
        claimableChips != null
            ? claimableChips
            : estimateClaimChips(wager, seats, winnerCount);
    const isPaid = wager > 0;
    const showClaimSlot = open && isPaid;
    const poolLive = typeof onClaimChips === 'function' && !!poolId;
    const claimReady = poolLive && estClaim > 0 && !!iWon && !claimBusy;

    const myLevel = myPlayer?.level ?? 1;
    const myLxp = myPlayer?.lxp ?? 0;
    // Display-only XP bar until progression feed is wired into this sheet.
    const xpInto = myLxp % 1000;
    const xpNeed = 1000;
    const xpPct = Math.min(100, Math.round((xpInto / xpNeed) * 100));

    // G1 — match receipt (debug + trust artifact; CHIPS settle spine later)
    const [showReceipt, setShowReceipt] = useState(false);
    const [copied, setCopied] = useState(false);
    const receipt: MatchReceipt | null = useMemo(() => {
        if (!open || !gameState.winner) return null;
        return buildMatchReceipt({ state: gameState, players });
    }, [open, gameState, players]);

    const copyReceipt = useCallback(() => {
        if (!receipt) return;
        const md = renderReceiptMarkdown(receipt);
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
            void navigator.clipboard.writeText(md).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
            });
        }
    }, [receipt]);

    return (
        <AnimatePresence>
            {open && gameState.winner && (
                <div className="match-stats-overlay" role="dialog" aria-modal="true" aria-label="Match results">
                    <motion.div
                        initial={{ opacity: 0, y: 28, scale: 0.96 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 16, scale: 0.98 }}
                        transition={{ type: 'tween', duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                        className="match-stats-card ludo-stats-scope"
                    >
                        {/* Result ribbon */}
                        <div className={`match-stats-ribbon ${iWon ? 'win' : 'lose'}`}>
                            <div className="match-stats-crown" aria-hidden>
                                {iWon ? (
                                    <svg viewBox="0 0 24 24" className="w-7 h-7" fill="currentColor">
                                        <path d="M3 8l4.5 3L12 5l4.5 6L21 8l-1.5 11h-15L3 8z" />
                                    </svg>
                                ) : (
                                    <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2">
                                        <circle cx="12" cy="12" r="9" />
                                        <path d="M8 15s1.5-2 4-2 4 2 4 2M9 10h.01M15 10h.01" strokeLinecap="round" />
                                    </svg>
                                )}
                            </div>
                            <h2 className="match-stats-title">
                                {iWon ? 'Victory' : 'Defeat'}
                            </h2>
                            <p className="match-stats-sub">
                                {gameMode.toUpperCase()} · {playerCount} ·{' '}
                                {isPaid ? `Entry ${formatChips(wager)}` : 'Free table'}
                            </p>
                        </div>

                        {/* XP strip (local player) */}
                        <div className="match-stats-xp">
                            <span className="match-stats-lv">Lv.{myLevel}</span>
                            <div className="match-stats-xp-track" aria-hidden>
                                <div className="match-stats-xp-fill" style={{ width: `${xpPct}%` }} />
                            </div>
                            <span className="match-stats-xp-num">
                                {xpInto}/{xpNeed}
                            </span>
                            {lxpGain != null && lxpGain > 0 && (
                                <span className="match-stats-xp-gain">+{lxpGain} XP</span>
                            )}
                        </div>

                        {/* Player table */}
                        <div className="match-stats-table">
                            {rows.map((row, idx) => {
                                const accent = COLOR_ACCENT[row.player.color] || '#00E5FF';
                                const isMe = myPlayer?.color === row.player.color;
                                return (
                                    <div
                                        key={row.player.color}
                                        className={`match-stats-row ${row.won ? 'won' : ''} ${isMe ? 'me' : ''}`}
                                    >
                                        <RankBadge rank={idx + 1} won={row.won} />
                                        <div className="match-stats-avatar" style={{ borderColor: accent }}>
                                            {row.player.avatar &&
                                            (row.player.avatar.startsWith('http') || row.player.avatar.startsWith('/')) ? (
                                                // eslint-disable-next-line @next/next/no-img-element
                                                <img src={row.player.avatar} alt="" className="w-full h-full object-cover" />
                                            ) : (
                                                <span className="text-sm font-black" style={{ color: accent }}>
                                                    {getDisplayNameHelper(row.player).slice(0, 1)}
                                                </span>
                                            )}
                                        </div>
                                        <div className="match-stats-id">
                                            <div className="match-stats-name">
                                                {getDisplayNameHelper(row.player)}
                                                {row.player.isAi && <span className="match-stats-ai">AI</span>}
                                            </div>
                                            <div className="match-stats-combat">
                                                <span className="match-stats-home" style={{ color: accent }}>
                                                    <HomeGlyph />
                                                    {row.home}/4
                                                </span>
                                                <span className="match-stats-chip kick" title="Kicks — tokens you sent home">
                                                    <KickGlyph />
                                                    <b>{row.kicks}</b>
                                                </span>
                                                <span className="match-stats-chip kicked" title="Got kicked — your tokens sent home">
                                                    <KickedGlyph />
                                                    <b>{row.gotKicked}</b>
                                                </span>
                                            </div>
                                        </div>
                                        <div className={`match-stats-outcome ${row.won ? 'win' : 'lose'}`}>
                                            {row.won ? (
                                                isPaid ? (
                                                    <>
                                                        <span className="match-stats-outcome-label">Prize</span>
                                                        <span className="match-stats-outcome-val">
                                                            {formatChips(Math.floor(estClaim))}
                                                        </span>
                                                    </>
                                                ) : (
                                                    <span className="match-stats-outcome-val">WIN</span>
                                                )
                                            ) : (
                                                <span className="match-stats-outcome-val muted">LOSE</span>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* CHIPS claim slot — MatchPool.claimMatch (pull, section 4.8 Path A) */}
                        {showClaimSlot && (
                            <div className={`match-stats-claim ${iWon ? 'ready' : 'dim'}`}>
                                <div className="match-stats-claim-head">
                                    <span className="match-stats-claim-tag">CHIPS</span>
                                    <span className="match-stats-claim-amount">
                                        {iWon && estClaim > 0 ? formatChips(estClaim) : '—'}
                                    </span>
                                </div>
                                <p className="match-stats-claim-note">
                                    {iWon
                                        ? claimUnlocksInMin != null
                                            ? `Pull-based claim · unlocks in ${claimUnlocksInMin} min`
                                            : poolLive
                                              ? 'Pull-based prize claim · MatchPool'
                                              : 'Prize needs on-chain pool (pending deploy)'
                                        : 'No pool credit for this seat'}
                                </p>
                                {iWon && (
                                    <button
                                        type="button"
                                        className={`match-stats-cta claim ${claimReady ? '' : 'soon'}`}
                                        onClick={() => {
                                            if (claimReady) onClaimChips?.();
                                        }}
                                        disabled={!claimReady}
                                        title={
                                            claimReady
                                                ? undefined
                                                : claimBusy
                                                  ? 'Claim in flight…'
                                                  : poolLive
                                                    ? 'Claim unlocks after dispute window'
                                                    : 'Set NEXT_PUBLIC_MATCH_POOL_ADDRESS + poolId'
                                        }
                                    >
                                        {claimBusy
                                            ? 'Claiming…'
                                            : claimReady
                                              ? 'Claim CHIPS'
                                              : poolLive
                                                ? 'Claim · locked'
                                                : 'Claim · pool pending'}
                                    </button>
                                )}
                                {claimError && (
                                    <p className="match-stats-claim-note" style={{ color: '#fca5a5' }}>
                                        {claimError}
                                    </p>
                                )}
                            </div>
                        )}

                        {!showClaimSlot && iWon && (
                            <div className="match-stats-claim dim">
                                <p className="match-stats-claim-note center">
                                    Free / offline table · progression only (no CHIPS pool)
                                </p>
                            </div>
                        )}

                        {/* G1 match receipt — post-mortem / trust artifact */}
                        {receipt && (
                            <div className="match-stats-claim" style={{ textAlign: 'left' }}>
                                <button
                                    type="button"
                                    className="match-stats-cta ghost"
                                    style={{ width: '100%', marginBottom: showReceipt ? '8px' : 0 }}
                                    onClick={() => setShowReceipt((v) => !v)}
                                    aria-expanded={showReceipt}
                                >
                                    {showReceipt ? 'Hide match receipt' : 'Match receipt'}
                                </button>
                                {showReceipt && (
                                    <div style={{ fontSize: '11px', lineHeight: 1.5, opacity: 0.9 }}>
                                        <div style={{ fontFamily: 'ui-monospace, monospace', wordBreak: 'break-all' }}>
                                            hash · {receipt.finalHash}
                                        </div>
                                        {receipt.lastRollId && (
                                            <div style={{ fontFamily: 'ui-monospace, monospace', wordBreak: 'break-all' }}>
                                                roll · {receipt.lastRollId}
                                            </div>
                                        )}
                                        <div style={{ marginTop: 6, opacity: 0.85 }}>
                                            Net — gaps {receipt.net.seqGaps} · resyncs {receipt.net.resyncs} ·
                                            dup {receipt.net.intentDup} · schema drops {receipt.net.schemaDrops}
                                        </div>
                                        <div style={{ marginTop: 6, opacity: 0.85 }}>
                                            {receipt.players.map((p) => (
                                                <div key={p.color}>
                                                    {p.name}: {p.afk.copy}
                                                </div>
                                            ))}
                                        </div>
                                        <button
                                            type="button"
                                            className="match-stats-cta ghost"
                                            style={{ marginTop: 8 }}
                                            onClick={copyReceipt}
                                        >
                                            {copied ? 'Copied' : 'Copy receipt'}
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Actions */}
                        <div className="match-stats-actions">
                            <button type="button" className="match-stats-cta ghost" onClick={onExit || onRematch}>
                                Back
                            </button>
                            <button type="button" className="match-stats-cta primary" onClick={onRematch}>
                                Rematch
                            </button>
                            <button
                                type="button"
                                className="match-stats-cta ghost icon"
                                aria-label="Share"
                                title="Share (soon)"
                                disabled
                            >
                                <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7" />
                                    <path d="M12 3v12M8 7l4-4 4 4" />
                                </svg>
                            </button>
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
}

export default MatchStatsOverlay;
