"use client";

import React, { useMemo, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Hex } from 'viem';
import {
    LuSwords,
    LuShieldAlert,
    LuTrophy,
} from 'react-icons/lu';
import { FiHome } from 'react-icons/fi';
import { SettlePoolButton } from './SettlePoolButton';
import { buildPayoutPlan, payoutColorsForWinner, payoutShareLabel, type MatchShape } from '@/lib/payoutPlan';
import { BOARD_FINISH_INDEX, TEAM_ID } from '@/lib/constants';
import { GameState, PlayerColor } from '@/lib/types';
import { Player } from '@/hooks/useGameEngine';
import { getDisplayNameHelper } from './PlayerInfoRow';
import { ThinkingOrb } from './ThinkingOrb';
import { buildMatchReceipt, renderReceiptMarkdown, type MatchReceipt } from '@/lib/receipt/buildMatchReceipt';
import { usePoolSummary } from '@/hooks/useChipsPool';
import { getTierInfo } from '@/lib/progression';
import PublicProfileModal from './PublicProfileModal';

// ─── Post-match stats sheet ──────────────────────────────────────────────────
// Terminal-glass treatment of the classic win sheet: result banner, XP strip,
// per-player home/finish table, CHIPS claim slot (UI only — contracts wire
// later per docs/tokenomics/CHIPS_PLANNING.md section 4.8 Path A), then Back/Restart.

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

function matchShapeOf(playerCount: string): MatchShape {
    if (playerCount === '2v2') return '2v2';
    if (playerCount === '1v1') return '1v1';
    return '4P';
}

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
    /** Open user public profile modal callback */
    onOpenProfile?: (address: string) => void;
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
    /** Dispute countdown from chain (seconds / display). */
    claimSecondsLeft?: number;
    claimMmss?: string;
    gasEth?: string | null;
    /** Host/authority settle (Edge + host → settlePool). */
    isPoolHost?: boolean;
    poolAuthority?: `0x${string}` | null;
    /** Winner wallet for single-winner prize plan (Phase-1 1v1 / FFA). */
    winnerAddress?: `0x${string}` | null;
    /** NET-27: authority seq for the receipt (null offline). */
    seq?: number | null;
    /** NET-27: live replay log when one exists (currently none in prod). */
    replay?: import('@/lib/replay/log').ReplayLog | null;
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
    onOpenProfile,
    onClaimChips,
    poolId,
    claimableChips,
    claimUnlocksInMin,
    claimBusy,
    claimError,
    claimSecondsLeft,
    claimMmss,
    gasEth,
    isPoolHost,
    poolAuthority,
    winnerAddress,
    seq,
    replay,
}: MatchStatsOverlayProps) {
    const [selectedProfileAddress, setSelectedProfileAddress] = useState<string | null>(null);
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
    // ECO-02: the authoritative prize fund, straight from MatchPool.
    const poolSummary = usePoolSummary(poolId ?? null);
    const isPaid = wager > 0;
    const showClaimSlot = open && isPaid;
    const poolLive = typeof onClaimChips === 'function' && !!poolId;
    const secondsLeft = claimSecondsLeft ?? 0;
    const mmss = claimMmss ?? '0:00';
    // Locked splits: 2v2 50/50 · 4P top-2 75/25 (lib/payoutPlan + MatchPool).
    const shape = matchShapeOf(playerCount);

    // ECO-02: the prize fund is read from MatchPool, never re-derived from the
    // wager. The old `BigInt(Math.floor(wager * seats * 0.93 * 1e18))` built the
    // amount in IEEE-754 doubles; at CHIPS scale that value is already quantised
    // to ~256 wei, so the plan never summed to the contract's prizeFund and
    // settlePool reverted SumMismatch. When no pool exists (offline / bot) the
    // estimate is display-only and is clearly labelled as such.
    const onChainPrizeFund = poolSummary?.prizeFund;
    const prizeFundWei: bigint =
        onChainPrizeFund && onChainPrizeFund > BigInt(0)
            ? onChainPrizeFund
            : BigInt(0);
    // No pool on chain (offline / bot) => no settleable amount. The display-only
    // per-winner estimate above (estimateClaimChips) still renders, but nothing
    // that feeds a payout plan is derived from it.
    const prizeFundIsEstimate = prizeFundWei === BigInt(0);
    // Only allow the claim path once the fund is known from the chain.
    const claimReady =
        poolLive && !prizeFundIsEstimate && estClaim > 0 && !!iWon && !claimBusy && secondsLeft === 0;

    const settlePlan = useMemo(() => {
        if (!showClaimSlot || !isPoolHost) return null;
        // Refuse to build a plan from an estimated fund: it would be wrong by
        // construction and can only revert on-chain.
        if (prizeFundIsEstimate) return null;
        // ENG-06: a 2v2 engine win is `winner === "Team N"` — map it to both
        // TEAM_ID-N seats before calling buildPayoutPlan. A lone seat on a 2v2
        // pool throws there (it would also sweep the slashed host bond), and a
        // team missing a wallet mapping fails closed here.
        try {
            const teamSeats = payoutColorsForWinner(gameState.winner, playerCount);
            if (shape === '2v2' && teamSeats.length === 2) {
                const addrs = teamSeats.map(
                    (seat) => players.find((p) => p.color === seat)?.walletAddress,
                );
                if (!addrs[0] || !addrs[1]) return null;
                return buildPayoutPlan({
                    shape,
                    prizeFund: prizeFundWei,
                    winners: [
                        { addr: addrs[0] as `0x${string}`, rank: 1, seatIndex: 1 },
                        { addr: addrs[1] as `0x${string}`, rank: 1, seatIndex: 2 },
                    ],
                });
            }
            // Phase-1: single funded winner wallet (1v1 / sole winner). Multi-seat
            // wallets attach per winnerAddress when each seat maps to a wallet.
            if (!winnerAddress) return null;
            return buildPayoutPlan({
                shape,
                prizeFund: prizeFundWei,
                winners: [{ addr: winnerAddress as `0x${string}`, rank: 1, seatIndex: 1 }],
            });
        } catch {
            return null;
        }
    }, [showClaimSlot, winnerAddress, isPoolHost, shape, prizeFundWei, prizeFundIsEstimate, gameState.winner, players, playerCount]);

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
        // NET-27: seq + replay ride into the receipt; counters were reset at
        // match start so the net section describes THIS match, not the session.
        return buildMatchReceipt({ state: gameState, players, seq: seq ?? undefined, replay: replay ?? undefined, includeEvents: !!replay });
    }, [open, gameState, players, seq, replay]);

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
                                {iWon ? 'Win' : 'Defeat'}
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
                                const displayName = getDisplayNameHelper(row.player);
                                const wallet = row.player.walletAddress;
                                const isClickable = Boolean(wallet) && /^0x[a-f0-9]{40}$/i.test(wallet!);
                                const tier = row.player.isAi
                                    ? 'Bot Squad'
                                    : getTierInfo(row.player.rxp || 0).tier;

                                return (
                                    <div
                                        key={row.player.color}
                                        className={`match-stats-row ${row.won ? 'won' : ''} ${isMe ? 'me' : ''}`}
                                    >
                                        {/* Left: Rank Badge + Avatar + Username (Clickable to open profile) */}
                                        <div className="flex items-center gap-2 min-w-0">
                                            <div
                                                className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs font-mono font-black shrink-0 ${
                                                    row.won
                                                        ? 'bg-amber-400/20 border border-amber-400/40 text-amber-300'
                                                        : 'bg-white/5 border border-white/10 text-white/40'
                                                }`}
                                                aria-label={`Rank ${idx + 1}`}
                                            >
                                                {idx + 1}
                                            </div>

                                            <button
                                                type="button"
                                                disabled={!isClickable}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    if (isClickable && wallet) {
                                                        if (onOpenProfile) {
                                                            onOpenProfile(wallet);
                                                        } else {
                                                            setSelectedProfileAddress(wallet);
                                                        }
                                                    }
                                                }}
                                                className={`flex items-center gap-2 min-w-0 group text-left ${
                                                    isClickable
                                                        ? 'cursor-pointer hover:opacity-90'
                                                        : 'cursor-default'
                                                }`}
                                                title={isClickable ? 'Inspect combatant profile' : undefined}
                                            >
                                                <div
                                                    className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 overflow-hidden border transition-colors group-hover:border-cyan-300"
                                                    style={{
                                                        borderColor: accent,
                                                        backgroundColor: `${accent}20`,
                                                    }}
                                                >
                                                    {row.player.avatar &&
                                                    (row.player.avatar.startsWith('http') ||
                                                        row.player.avatar.startsWith('/')) ? (
                                                        <img
                                                            src={row.player.avatar}
                                                            alt={displayName}
                                                            className="w-full h-full object-cover"
                                                            width={28}
                                                            height={28}
                                                        />
                                                    ) : (
                                                        <span
                                                            className="text-ludo-xs font-black uppercase"
                                                            style={{ color: accent }}
                                                        >
                                                            {displayName.slice(0, 1)}
                                                        </span>
                                                    )}
                                                </div>

                                                <div className="min-w-0">
                                                    <div className="flex items-center gap-1.5">
                                                        <span
                                                            className={`text-ludo-xs font-bold text-white truncate transition-colors ${
                                                                isClickable
                                                                    ? 'group-hover:text-cyan-300 group-hover:underline'
                                                                    : ''
                                                            }`}
                                                        >
                                                            {displayName}
                                                        </span>
                                                        {isMe && (
                                                            <span className="px-1.5 py-0.2 rounded bg-cyan-500/20 text-cyan-300 text-ludo-xs font-mono font-black uppercase">
                                                                You
                                                            </span>
                                                        )}
                                                        {row.player.isAi && (
                                                            <span className="px-1.5 py-0.2 rounded bg-amber-400/20 text-amber-300 text-ludo-xs font-mono font-black uppercase">
                                                                AI
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="text-[10px] font-bold text-white/40 uppercase tracking-wider">
                                                        {tier}
                                                    </div>
                                                </div>
                                            </button>
                                        </div>

                                        {/* Right: Individual Telemetry (Home, Kicked, Captured) + Outcome */}
                                        <div className="flex items-center gap-2 shrink-0">
                                            <div className="flex items-center gap-1.5 text-ludo-xs font-mono">
                                                <span
                                                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-white/[0.04] border border-white/5 font-bold text-emerald-300"
                                                    title="Tokens Home"
                                                >
                                                    <FiHome className="w-3 h-3 text-emerald-400 shrink-0" />
                                                    <span className="tabular-nums font-black">{row.home}/4</span>
                                                    <span className="text-[10px] text-white/40 uppercase tracking-tight">
                                                        Home
                                                    </span>
                                                </span>

                                                <span
                                                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-white/[0.04] border border-white/5 font-bold text-amber-300"
                                                    title="Captures / Kicks made"
                                                >
                                                    <LuSwords className="w-3 h-3 text-amber-400 shrink-0" />
                                                    <span className="tabular-nums font-black">{row.kicks}</span>
                                                    <span className="text-[10px] text-white/40 uppercase tracking-tight">
                                                        Kicked
                                                    </span>
                                                </span>

                                                <span
                                                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-white/[0.04] border border-white/5 font-bold text-red-300"
                                                    title="Times token was captured / kicked"
                                                >
                                                    <LuShieldAlert className="w-3 h-3 text-red-400 shrink-0" />
                                                    <span className="tabular-nums font-black">{row.gotKicked}</span>
                                                    <span className="text-[10px] text-white/40 uppercase tracking-tight">
                                                        Captured
                                                    </span>
                                                </span>
                                            </div>

                                            {row.won ? (
                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-400/10 border border-amber-400/30 text-ludo-xs font-mono font-black text-amber-400 uppercase">
                                                    <LuTrophy className="w-3 h-3 shrink-0" />
                                                    {isPaid && estClaim > 0 ? (
                                                        <span>
                                                            {formatChips(Math.floor(estClaim))} CHIPS
                                                            {winnerCount > 1 && (
                                                                <span className="text-[10px] text-amber-400/70 ml-1">
                                                                    ({payoutShareLabel(shape, idx + 1, winnerCount)})
                                                                </span>
                                                            )}
                                                        </span>
                                                    ) : (
                                                        'Winner'
                                                    )}
                                                </span>
                                            ) : (
                                                <span className="px-2 py-0.5 text-ludo-xs font-mono font-bold text-white/35 uppercase">
                                                    Defeated
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Host settle pot — Edge co-sign + host signTypedData + settlePool */}
                        {showClaimSlot && isPoolHost && poolId && poolAuthority && winnerAddress && (
                            <div className="match-stats-claim ready" style={{ marginBottom: 8 }}>
                                <div className="match-stats-claim-head">
                                    <span className="match-stats-claim-tag">SETTLE</span>
                                    <span className="match-stats-claim-amount">Host</span>
                                </div>
                                <p className="match-stats-claim-note">
                                    Edge co-sign, sign, then submit MatchPool.settlePool
                                </p>
                                <SettlePoolButton
                                    poolId={poolId as Hex}
                                    authority={poolAuthority as Hex}
                                    plan={
                                        settlePlan ?? [
                                            {
                                                addr: winnerAddress as Hex,
                                                amount: BigInt(Math.floor(estClaim * 1e18)),
                                            },
                                        ]
                                    }
                                />
                            </div>
                        )}

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
                                              ? secondsLeft > 0
                                                ? `Claim unlocks in ${mmss} · dispute window`
                                                : `Pull-based prize · gas ~${gasEth ?? "…"} ETH`
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
                                                  : secondsLeft > 0
                                                    ? `Dispute window ${mmss}`
                                                    : poolLive
                                                      ? 'Claim unlocks after dispute window'
                                                      : 'Set NEXT_PUBLIC_MATCH_POOL_ADDRESS + poolId'
                                        }
                                    >
                                        {claimBusy ? (
                                            <>
                                                <ThinkingOrb state="solving" size={20} />
                                                Claiming…
                                            </>
                                        ) : secondsLeft > 0
                                              ? `Claim in ${mmss}`
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
                                Restart
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

                        {/* Local Public Profile Modal fallback */}
                        <PublicProfileModal
                            isOpen={Boolean(selectedProfileAddress)}
                            userAddress={selectedProfileAddress}
                            onClose={() => setSelectedProfileAddress(null)}
                            onDM={(userId) => {
                                setSelectedProfileAddress(null);
                                window.dispatchEvent(
                                    new CustomEvent('ludo-open-chat', { detail: { wallet: userId } })
                                );
                            }}
                        />
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
}

export default MatchStatsOverlay;
