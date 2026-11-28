"use client";

import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getSoundEngine } from '@/lib/audio/SoundEngine';
import type { Hex } from 'viem';
import {
    LuSwords,
    LuShieldAlert,
    LuTrophy,
    LuChevronDown,
    LuChevronUp,
    LuFileText,
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
import RankTierIcon, { getTierColorClass } from './RankTierIcon';
import { PilotAvatar } from './PilotAvatar';
import { TerminalTypeText } from './TerminalTypeText';
import { usePreferences } from '@/hooks/usePreferences';
import { HudCornerTicks, HudProgressGauge } from './HudPrimitives';
import { ApexRankIcon, ChipsHexIcon, WarningHexIcon } from './icons';

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

const COLOR_ACCENT_3077: Record<string, string> = {
    green: '#00FF66',
    red: '#FF0055',
    yellow: '#FFD000',
    blue: '#0099FF',
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

export interface RematchOverlayState {
    status: 'idle' | 'proposing' | 'invited' | 'searching' | 'starting' | 'declined';
    proposerName?: string;
    secondsLeft: number;
    acceptedCount: number;
    totalHumans: number;
    myVote: 'pending' | 'accepted' | 'declined';
    statusMessage?: string;
    onAccept: () => void;
    onDecline: () => void;
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
    /** Online post-match rematch vote state (omitted offline / bot matches). */
    rematchState?: RematchOverlayState | null;
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
    rematchState = null,
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
    const { preferences } = usePreferences();
    const is3077 = preferences.theme === '3077';
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
                getSoundEngine().play('ui_copy');
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
            });
        }
    }, [receipt]);

    useEffect(() => {
        if (!open || !gameState.winner) return;
        const engine = getSoundEngine();
        const timers = [
            setTimeout(() => engine.play('stats_tick', { step: 0 }), 140),
            setTimeout(() => engine.play('stats_tick', { step: 1 }), 230),
            setTimeout(() => engine.play('stats_tick', { step: 2 }), 320),
        ];
        return () => timers.forEach(clearTimeout);
    }, [open, gameState.winner]);

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
                        <HudCornerTicks />
                        {/* Result ribbon — compact horizontal banner */}
                        <div className={`match-stats-ribbon ${iWon ? 'win' : 'lose'}`}>
                            <div className="match-stats-crown" aria-hidden>
                                {iWon ? (
                                    <ApexRankIcon className="w-5 h-5" active />
                                ) : (
                                    <WarningHexIcon className="w-5 h-5" />
                                )}
                            </div>
                            <div className="flex flex-col items-start min-w-0">
                                <h2 className="match-stats-title">
                                    {iWon ? 'Victory' : 'Defeat'}
                                </h2>
                                <p className="match-stats-sub truncate max-w-full">
                                    {gameMode.toUpperCase()} · {playerCount} ·{' '}
                                    {isPaid ? `Entry ${formatChips(wager)}` : 'Free table'}
                                </p>
                            </div>
                        </div>

                        {/* XP strip (local player) */}
                        <div className="match-stats-xp">
                            <span className="match-stats-lv">Lv.{myLevel}</span>
                            <HudProgressGauge percent={xpPct} tone="accent" className="flex-1" />
                            <span className="match-stats-xp-num tabular-nums">
                                {xpInto}/{xpNeed}
                            </span>
                            {lxpGain != null && lxpGain > 0 && (
                                <span className="match-stats-xp-gain tabular-nums">+{lxpGain} XP</span>
                            )}
                        </div>

                        {/* Player table */}
                        <div className="match-stats-table">
                            {rows.map((row, idx) => {
                                const accent = (is3077 ? COLOR_ACCENT_3077 : COLOR_ACCENT)[row.player.color] || '#00E5FF';
                                const isMe = myPlayer?.color === row.player.color;
                                const displayName = getDisplayNameHelper(row.player);
                                const wallet = row.player.walletAddress;
                                const isClickable = Boolean(wallet) && /^0x[a-f0-9]{40}$/i.test(wallet!);
                                const tier = row.player.isAi
                                    ? 'Bot Squad'
                                    : getTierInfo(row.player.rxp || 0).tier;

                                return (
                                    <motion.div
                                        key={row.player.color}
                                        initial={{ opacity: 0, y: 8 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ duration: 0.2, delay: 0.06 + idx * 0.04, ease: [0.22, 1, 0.36, 1] }}
                                        className={`match-stats-row ${row.won ? 'won' : ''} ${isMe ? 'me' : ''}`}
                                    >
                                        {/* Line 1: Rank + Avatar + Inline Identity/Tier on left, Outcome badge on right */}
                                        <div className="flex items-center justify-between gap-1.5 min-w-0">
                                            <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                                <div
                                                    className={`w-5 h-5 rounded-md flex items-center justify-center text-ludo-xs font-mono font-bold shrink-0 ${
                                                        row.won
                                                            ? 'bg-warn/20 border border-warn/40 text-warn'
                                                            : 'bg-surface-recessed border border-line-soft text-ink-faint'
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
                                                    className={`flex items-center gap-1.5 min-w-0 flex-1 group text-left ${
                                                        isClickable
                                                            ? 'cursor-pointer hover:opacity-90'
                                                            : 'cursor-default'
                                                    }`}
                                                    title={isClickable ? 'Inspect combatant profile' : undefined}
                                                >
                                                    <div
                                                        className="hud-avatar-frame w-6 h-6 rounded-full flex items-center justify-center shrink-0 overflow-hidden border transition-colors group-hover:border-accent"
                                                        style={{
                                                            borderColor: accent,
                                                            backgroundColor: 'rgba(10, 14, 24, 0.85)',
                                                        }}
                                                    >
                                                        <PilotAvatar
                                                            avatarUrl={row.player.avatar}
                                                            name={displayName}
                                                            size="xs"
                                                            className="!w-full !h-full !border-0 !rounded-none !bg-transparent"
                                                        />
                                                    </div>

                                                    <div className="flex items-center gap-1 min-w-0 flex-1">
                                                        <span
                                                            className={`text-ludo-sm font-bold text-ink-strong truncate transition-colors ${
                                                                isClickable
                                                                    ? 'group-hover:text-accent group-hover:underline'
                                                                    : ''
                                                            }`}
                                                        >
                                                            {displayName}
                                                        </span>
                                                        {isMe && (
                                                            <span className="px-1 py-0 rounded bg-accent-soft text-accent text-ludo-xs font-mono font-bold label-chrome uppercase shrink-0">
                                                                You
                                                            </span>
                                                        )}
                                                        {row.player.isAi && (
                                                            <span className="px-1 py-0 rounded bg-warn/20 text-warn text-ludo-xs font-mono font-bold label-chrome uppercase shrink-0">
                                                                AI
                                                            </span>
                                                        )}
                                                        <span className="inline-flex items-center gap-0.5 min-w-0 shrink-0 opacity-85">
                                                            <RankTierIcon
                                                                tier={tier}
                                                                isAi={row.player.isAi}
                                                                className="w-3 h-3 shrink-0"
                                                            />
                                                            <span
                                                                className={`text-ludo-xs font-mono font-semibold tracking-tight uppercase truncate max-w-[68px] sm:max-w-[96px] ${getTierColorClass(
                                                                    tier,
                                                                    row.player.isAi
                                                                )}`}
                                                            >
                                                                {tier}
                                                            </span>
                                                        </span>
                                                    </div>
                                                </button>
                                            </div>

                                            <div className="shrink-0">
                                                {row.won ? (
                                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-warn/10 border border-warn/30 text-ludo-xs font-mono font-bold text-warn uppercase whitespace-nowrap">
                                                        <LuTrophy className="w-3 h-3 shrink-0" />
                                                        {isPaid && estClaim > 0 ? (
                                                            <span>
                                                                {formatChips(Math.floor(estClaim))} CHIPS
                                                                {winnerCount > 1 && (
                                                                    <span className="hidden sm:inline text-ludo-xs text-warn/80 ml-1">
                                                                        ({payoutShareLabel(shape, idx + 1, winnerCount)})
                                                                    </span>
                                                                )}
                                                            </span>
                                                        ) : (
                                                            'Winner'
                                                        )}
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-surface-recessed border border-line-soft text-ludo-xs font-mono font-bold text-ink-faint uppercase whitespace-nowrap">
                                                        Defeated
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                        {/* Line 2: Compact Telemetry Strip (Home, Kicked, Captured) */}
                                        <div className="flex items-center flex-wrap gap-1.5 pl-6 text-ludo-xs font-mono leading-none">
                                            <span
                                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface-recessed border border-line-soft font-bold text-positive"
                                                title="Tokens Home"
                                            >
                                                <FiHome className="w-2.5 h-2.5 text-positive shrink-0" />
                                                <span className="tabular-nums font-bold">{row.home}/4</span>
                                                <span className="text-ludo-xs text-ink-faint uppercase tracking-tight">
                                                    Home
                                                </span>
                                            </span>

                                            <span
                                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface-recessed border border-line-soft font-bold text-warn"
                                                title="Captures / Kicks made"
                                            >
                                                <LuSwords className="w-2.5 h-2.5 text-warn shrink-0" />
                                                <span className="tabular-nums font-bold">{row.kicks}</span>
                                                <span className="text-ludo-xs text-ink-faint uppercase tracking-tight">
                                                    Kicked
                                                </span>
                                            </span>

                                            <span
                                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface-recessed border border-line-soft font-bold text-negative"
                                                title="Times token was captured / kicked"
                                            >
                                                <LuShieldAlert className="w-2.5 h-2.5 text-negative shrink-0" />
                                                <span className="tabular-nums font-bold">{row.gotKicked}</span>
                                                <span className="text-ludo-xs text-ink-faint uppercase tracking-tight">
                                                    Captured
                                                </span>
                                            </span>
                                        </div>
                                    </motion.div>
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

                        {/* CHIPS claim slot — compact 1-line status when lost, full claim slot when won */}
                        {showClaimSlot && !iWon && (
                            <div className="match-stats-claim compact-line dim">
                                <span className="inline-flex items-center gap-1.5 min-w-0">
                                    <ChipsHexIcon className="w-3.5 h-3.5 text-accent shrink-0" active />
                                    <span className="match-stats-claim-tag">CHIPS</span>
                                    <span className="match-stats-claim-note truncate">No pool credit</span>
                                </span>
                                <span className="match-stats-claim-amount shrink-0">—</span>
                            </div>
                        )}

                        {showClaimSlot && iWon && (
                            <div className="match-stats-claim ready">
                                <div className="match-stats-claim-head">
                                    <span className="match-stats-claim-tag inline-flex items-center gap-1">
                                        <ChipsHexIcon className="w-3.5 h-3.5 text-accent" active />
                                        CHIPS
                                    </span>
                                    <span className="text-ludo-xs font-mono text-ink-muted truncate flex-1 text-right">
                                        {claimUnlocksInMin != null
                                            ? `Unlocks in ${claimUnlocksInMin}m`
                                            : poolLive
                                              ? secondsLeft > 0
                                                ? `Unlocks in ${mmss}`
                                                : `Gas ~${gasEth ?? '…'} ETH`
                                              : 'Pool pending'}
                                    </span>
                                    <span className="match-stats-claim-amount">
                                        {estClaim > 0 ? formatChips(estClaim) : '—'}
                                    </span>
                                </div>
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
                                {claimError && (
                                    <p className="match-stats-claim-note text-negative">
                                        {claimError}
                                    </p>
                                )}
                            </div>
                        )}

                        {!showClaimSlot && iWon && (
                            <div className="match-stats-claim compact-line dim">
                                <p className="match-stats-claim-note center w-full">
                                    Free / offline table · progression only
                                </p>
                            </div>
                        )}

                        {/* G1 match receipt — sleek collapsible toggle so card stays single-viewport */}
                        {receipt && (
                            <div className="flex flex-col gap-1.5" style={{ textAlign: 'left' }}>
                                <button
                                    type="button"
                                    className="match-stats-receipt-toggle"
                                    onClick={() => setShowReceipt((v) => !v)}
                                    aria-expanded={showReceipt}
                                >
                                    <span className="inline-flex items-center gap-1.5 text-ink-muted">
                                        <LuFileText className="w-3.5 h-3.5 text-accent shrink-0" />
                                        {showReceipt ? 'Hide match receipt' : 'Match receipt'}
                                    </span>
                                    {showReceipt ? (
                                        <LuChevronUp className="w-3.5 h-3.5 text-ink-faint shrink-0" />
                                    ) : (
                                        <LuChevronDown className="w-3.5 h-3.5 text-ink-faint shrink-0" />
                                    )}
                                </button>
                                {showReceipt && (
                                    <div className="match-stats-claim text-ludo-xs leading-relaxed text-ink-strong">
                                        <div className="font-mono break-all">
                                            hash · {receipt.finalHash}
                                        </div>
                                        {receipt.lastRollId && (
                                            <div className="font-mono break-all">
                                                roll · {receipt.lastRollId}
                                            </div>
                                        )}
                                        <div className="mt-1 text-ink-muted">
                                            Net — gaps {receipt.net.seqGaps} · resyncs {receipt.net.resyncs} ·
                                            dup {receipt.net.intentDup} · schema drops {receipt.net.schemaDrops}
                                        </div>
                                        <div className="mt-1 text-ink-muted">
                                            {receipt.players.map((p) => (
                                                <div key={p.color}>
                                                    {p.name}: {p.afk.copy}
                                                </div>
                                            ))}
                                        </div>
                                        <button
                                            type="button"
                                            className="match-stats-receipt-toggle mt-1.5 justify-center"
                                            onClick={copyReceipt}
                                        >
                                            {copied ? 'Copied' : 'Copy receipt'}
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Inline Rematch Vote / Fallback Banner (online multiplayer only) */}
                        {rematchState && rematchState.status !== 'idle' && (
                            <div className="match-stats-claim ready" style={{ marginBottom: 8 }}>
                                <div className="match-stats-claim-head">
                                    <span className="match-stats-claim-tag">
                                        {rematchState.status === 'invited'
                                            ? 'REMATCH REQUEST'
                                            : rematchState.status === 'searching'
                                              ? 'QUICK SEARCH FALLBACK'
                                              : rematchState.status === 'starting'
                                                ? 'LAUNCHING REMATCH'
                                                : rematchState.status === 'declined'
                                                  ? 'REMATCH ENDED'
                                                  : 'WAITING FOR PLAYERS'}
                                    </span>
                                    {rematchState.secondsLeft > 0 &&
                                        (rematchState.status === 'invited' || rematchState.status === 'proposing') && (
                                            <span className="text-ludo-xs font-mono font-extrabold text-accent tabular-nums">
                                                {rematchState.secondsLeft}s · {rematchState.acceptedCount}/
                                                {rematchState.totalHumans} Ready
                                            </span>
                                        )}
                                </div>
                                <div className="text-ludo-xs font-mono font-semibold text-ink-strong">
                                    <TerminalTypeText
                                        key={`${rematchState.status}-${rematchState.acceptedCount}-${rematchState.statusMessage || ''}`}
                                        text={
                                            rematchState.statusMessage ||
                                            (rematchState.status === 'invited'
                                                ? `${rematchState.proposerName || 'Opponent'} wants a rematch (${gameMode.toUpperCase()} · ${playerCount})`
                                                : rematchState.status === 'searching'
                                                  ? 'Finding new players with same mode & fee...'
                                                  : rematchState.status === 'starting'
                                                    ? 'All players ready · booting new table...'
                                                    : 'Waiting for opponent confirmation...')
                                        }
                                        charMs={16}
                                    />
                                </div>
                                {rematchState.status === 'invited' && rematchState.myVote === 'pending' && (
                                    <div className="grid grid-cols-2 gap-2 mt-1.5">
                                        <button
                                            type="button"
                                            className="match-stats-cta ghost"
                                            onClick={rematchState.onDecline}
                                        >
                                            Decline
                                        </button>
                                        <button
                                            type="button"
                                            className="match-stats-cta primary"
                                            onClick={rematchState.onAccept}
                                        >
                                            Accept
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
                            <button
                                type="button"
                                className="match-stats-cta primary"
                                onClick={onRematch}
                                disabled={
                                    rematchState?.status === 'proposing' ||
                                    rematchState?.status === 'searching' ||
                                    rematchState?.status === 'starting' ||
                                    (rematchState?.status === 'invited' && rematchState.myVote === 'accepted')
                                }
                            >
                                {rematchState?.status === 'proposing' ||
                                (rematchState?.status === 'invited' && rematchState.myVote === 'accepted')
                                    ? `Waiting… (${rematchState.acceptedCount}/${rematchState.totalHumans})`
                                    : rematchState?.status === 'searching'
                                      ? 'Searching…'
                                      : rematchState?.status === 'starting'
                                        ? 'Starting…'
                                        : 'Restart'}
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
