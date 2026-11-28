import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AfkPlayerStats, KickReason, PlayerColor } from '@/lib/types';
import { AFK_MAX_TRIGGERS, getKickReasonMessage } from '@/lib/afkPolicy';
import { Player } from '@/hooks/useGameEngine';
import { emoteById, EMOTE_TTL_MS, type EmoteEvent } from '@/lib/emotes';
import { getEmoteGlyph } from './EmoteTray';
import { chatTtlMs } from '@/lib/chat';
import { getTeam } from '@/lib/gameLogic';
import { ChatContent } from './EmojiPicker';
import { CyberSticker } from './emotes/CyberStickers';
import Button from './Button';
import { HudCornerTicks } from './HudPrimitives';
import { ArenaBladesIcon, ProximityMineIcon, OverdriveBoltIcon, WarningHexIcon } from './icons';

interface StatusNotificationProps {
    message: string | null;
}

function resolveStatusTone(message: string): 'bomb' | 'capture' | 'info' {
    const m = message.toLowerCase();
    if (m.includes('bomb') || m.includes('mine') || m.includes('trap') || m.includes('nuke')) return 'bomb';
    if (m.includes('captured') || m.includes('kicked') || m.includes('eliminated')) return 'capture';
    return 'info';
}

export function StatusNotification({ message }: StatusNotificationProps) {
    const tone = message ? resolveStatusTone(message) : 'info';
    return (
        <div className="capture-toast-anchor pointer-events-none" aria-live="polite">
            <AnimatePresence>
                {message && (
                    <motion.div
                        key={message}
                        initial={{ opacity: 0, y: 10, scale: 0.94 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -6, scale: 0.94 }}
                        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                        className={`capture-toast capture-toast-${tone}`}
                    >
                        {tone === 'bomb' ? (
                            <ProximityMineIcon className="w-4 h-4 text-negative shrink-0" />
                        ) : tone === 'capture' ? (
                            <ArenaBladesIcon className="w-4 h-4 text-warn shrink-0" active />
                        ) : (
                            <OverdriveBoltIcon className="w-4 h-4 text-accent shrink-0" active />
                        )}
                        <span>{message}</span>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

interface AfkReclaimBarProps {
    afkStats: AfkPlayerStats;
    getNow: () => number;
    onReclaim: () => void;
    reducedMotion?: boolean;
}

function formatCountdownMs(ms: number): string {
    const totalSecs = Math.max(0, Math.ceil(ms / 1000));
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function AfkReclaimBar({
    afkStats,
    getNow,
    onReclaim,
    reducedMotion = false,
}: AfkReclaimBarProps) {
    const [nowMs, setNowMs] = useState<number>(() => getNow());

    useEffect(() => {
        setNowMs(getNow());
        const iv = window.setInterval(() => setNowMs(getNow()), 250);
        return () => window.clearInterval(iv);
    }, [getNow, afkStats.afkDeadlineAt]);

    const deadlineAt = typeof afkStats.afkDeadlineAt === 'number' ? afkStats.afkDeadlineAt : nowMs;
    const windowMs = Math.max(1000, Number(afkStats.afkWindowMs ?? 600_000));
    const remainingMs = Math.max(0, deadlineAt - nowMs);
    const progress = Math.min(1, Math.max(0, remainingMs / windowMs));
    const triggers = Number(afkStats.afkTriggers ?? afkStats.totalTriggers ?? 1);
    const urgent = remainingMs <= 60_000 || triggers >= AFK_MAX_TRIGGERS - 1;

    return (
        <motion.div
            initial={reducedMotion ? false : { opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.92 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
                e.stopPropagation();
                onReclaim();
            }}
            role="button"
            tabIndex={0}
            aria-label={`AFK ${triggers}/${AFK_MAX_TRIGGERS} — Resume (${formatCountdownMs(remainingMs)} left)`}
            title={`Reclaim within ${formatCountdownMs(remainingMs)}`}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    onReclaim();
                }
            }}
            data-testid="afk-reclaim-bar"
            className={`relative z-40 shrink-0 rounded-lg border px-2 py-1 shadow-md backdrop-blur-md cursor-pointer select-none overflow-hidden transition-colors ${
                urgent
                    ? 'bg-red-950/90 border-red-400/70 text-red-50'
                    : 'bg-amber-950/90 border-amber-400/70 text-amber-50'
            }`}
        >
            <div className="flex items-center justify-center gap-1.5">
                <span
                    className={`inline-flex items-center gap-1 font-mono text-ludo-xs font-black uppercase tracking-wider whitespace-nowrap ${
                        urgent ? 'text-red-200' : 'text-amber-200'
                    }`}
                >
                    <WarningHexIcon className="w-3 h-3 shrink-0" />
                    AFK {triggers}/{AFK_MAX_TRIGGERS}
                </span>
                <span
                    className={`px-2 py-0.5 rounded font-mono text-ludo-xs font-black uppercase tracking-wider whitespace-nowrap ${
                        urgent
                            ? 'bg-red-500 text-white'
                            : 'bg-amber-400 text-black'
                    }`}
                >
                    Resume
                </span>
            </div>
            <div className="mt-1 h-1 w-full rounded-full bg-black/40 overflow-hidden">
                <div
                    className={`h-full origin-left ${urgent ? 'bg-red-400' : 'bg-amber-400'}`}
                    style={{ transform: `scaleX(${progress})` }}
                />
            </div>
        </motion.div>
    );
}

interface KickedAlertModalProps {
    kickReason?: KickReason | null;
    canWatchLiveArena: boolean;
    onReturnToLobby: () => void;
    onWatchLiveArena?: () => void;
}

export function KickedAlertModal({
    kickReason,
    canWatchLiveArena,
    onReturnToLobby,
    onWatchLiveArena,
}: KickedAlertModalProps) {
    const isExplicitLeave = kickReason === 'explicit_leave';
    return (
        <div
            data-testid="kicked-alert-modal"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            className="fixed inset-0 z-[90] flex items-center justify-center bg-black/75 backdrop-blur-md p-4"
        >
            <motion.div
                initial={{ scale: 0.94, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                className="panel-shell-3077 relative overflow-hidden w-full max-w-sm rounded-2xl border border-red-500/60 bg-surface-panel/95 p-6 text-center shadow-[0_0_40px_rgba(239,68,68,0.28)] flex flex-col items-center gap-4"
            >
                <HudCornerTicks />
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-500/20 border border-red-400/50 text-ludo-xs font-mono font-black uppercase tracking-[0.18em] text-red-300">
                    <WarningHexIcon className="w-3.5 h-3.5" />
                    {isExplicitLeave ? 'Match Forfeited' : 'Removed for AFK'}
                </span>

                <div className="space-y-2">
                    <h2 className="text-lg font-extrabold text-white tracking-tight">
                        {isExplicitLeave ? 'You Left the Match' : 'Permanent Bot Takeover'}
                    </h2>
                    <p className="text-sm text-red-200 font-medium">
                        {getKickReasonMessage(kickReason)}
                    </p>
                    <p className="text-ludo-xs text-ink-muted leading-relaxed">
                        You have been recorded as loser (4th), forfeit 100% of entry fees, and earn 0 LXP, RXP, and CHIPS. Your seat continues running in Live Arena.
                    </p>
                </div>

                <div className="w-full flex flex-col gap-2 pt-1">
                    {canWatchLiveArena && onWatchLiveArena && (
                        <Button
                            variant="secondary"
                            size="lg"
                            fullWidth
                            onClick={onWatchLiveArena}
                            className="uppercase tracking-[0.14em] border-red-400/40"
                        >
                            Watch in Live Arena
                        </Button>
                    )}
                    <Button
                        variant="primary"
                        size="lg"
                        fullWidth
                        onClick={onReturnToLobby}
                        className="uppercase tracking-[0.14em] bg-red-600 hover:bg-red-500 text-white"
                    >
                        Return to Lobby
                    </Button>
                </div>
            </motion.div>
        </div>
    );
}

interface CelebrationOverlayProps {
    winner: string | null;
    onReset: () => void;
}

/** Legacy compact card — MatchStatsOverlay owns the post-match surface now. */
export function CelebrationOverlay({ winner, onReset }: CelebrationOverlayProps) {
    return (
        <AnimatePresence>
            {winner && (
                <div className="winner-overlay">
                    <motion.div
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        className="winner-card"
                    >
                        <span className="celebration-tile">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-8 h-8 text-warn">
                                <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"></path>
                                <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"></path>
                                <path d="M4 22h16"></path>
                                <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"></path>
                                <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"></path>
                                <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"></path>
                            </svg>
                        </span>
                        <h2 style={{ textTransform: 'capitalize' }}>{winner} Wins!</h2>
                        <p>Masterful play!</p>
                        <Button variant="primary" fullWidth onClick={onReset}>Rematch</Button>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
}

interface NameOverlayProps {
    uiSlots: Record<string, PlayerColor | null>;
    players: Player[];
    getDisplayName: (player: Player) => string;
    /** Latest lobby chat line per seat color (same map as name pills). */
    chatBubbles?: { text: string; color: PlayerColor; audience?: 'all' | 'team'; t: number }[];
    emoteFloats?: EmoteEvent[];
    viewerColor?: PlayerColor;
    playerCount?: string;
}

export function NameOverlay({ uiSlots, players, getDisplayName, counterRotationDeg = 0, chatBubbles, emoteFloats = [], viewerColor, playerCount = '4P' }: NameOverlayProps & { counterRotationDeg?: number }) {
    const renderLabel = (corner: 'TL' | 'TR' | 'BL' | 'BR', className: string, style: React.CSSProperties) => {
        const color = uiSlots[corner];
        const p = players.find(pl => pl.color === color);
        if (!p) return null;
        const team = playerCount === '2v2' ? getTeam(p.color, playerCount) : null;
        return (
            <div className={`home-player-label ${className} ${color} ${team === 1 ? 'team-a-label' : team === 2 ? 'team-b-label' : ''}`} style={style}>
                {team && (
                    <span className="team-crest" aria-label={team === 1 ? 'Team A' : 'Team B'}>
                        {team === 1 ? 'A' : 'B'}
                    </span>
                )}
                <span className="player-name-label">{getDisplayName(p)}</span>
            </div>
        );
    };

    // Bubble uses the SAME seat geometry as the name pill for that corner.
    const renderBubble = (corner: 'TL' | 'TR' | 'BL' | 'BR') => {
        const color = uiSlots[corner];
        if (!color || !chatBubbles?.length) return null;
        const msg = [...chatBubbles].reverse().find((c) => c.color === color && (
            c.audience !== 'team' ||
            !viewerColor ||
            getTeam(c.color, playerCount) === getTeam(viewerColor, playerCount)
        ));
        if (!msg) return null;
        const isTop = corner === 'TL' || corner === 'TR';
        const left = corner === 'TL' || corner === 'BL' ? '20%' : '80%';
        return (
            <div
                key={`${msg.color}-${msg.t}`}
                className={`chat-bubble ${msg.audience === 'team' ? 'chat-bubble-team' : ''} ${isTop ? 'below' : 'above'}`}
                style={{
                    position: 'absolute',
                    left,
                    transform: 'translateX(-50%)',
                    top: isTop ? 30 : undefined,
                    bottom: isTop ? undefined : 30,
                    '--chat-duration': `${chatTtlMs(msg.text)}ms`,
                } as React.CSSProperties}
            >
                <ChatContent value={msg.text} className="chat-bubble-text" />
                <span className="emote-float-glyph chat-bubble-glyph" aria-hidden="true">✦</span>
            </div>
        );
    };

    const renderEmotes = (corner: 'TL' | 'TR' | 'BL' | 'BR') => {
        const color = uiSlots[corner];
        if (!color) return null;
        const isTop = corner === 'TL' || corner === 'TR';
        const left = corner === 'TL' || corner === 'BL' ? '20%' : '80%';
        return emoteFloats
            .filter((event) => event.color === color && Date.now() - event.t < EMOTE_TTL_MS)
            .map((event) => {
                const def = emoteById(event.emoteId);
                const label = event.emoteId === 'custom' ? (event.customText || 'Reaction') : def?.text;
                if (!label) return null;
                return (
                    <div
                        key={`${event.color}-${event.t}`}
                        className={`emote-float emote-float-${event.emoteId} board-emote-${isTop ? 'top' : 'bottom'}`}
                        style={{
                            left,
                            top: isTop ? 34 : undefined,
                            bottom: isTop ? undefined : 34,
                        }}
                        data-emote={event.emoteId}
                        data-color={event.color}
                        aria-label={label}
                        role="status"
                    >
                        {event.assetUrl?.includes('/cyber-orb/') ? (
                            <CyberSticker id={event.assetUrl} size={64} alt={label} />
                        ) : event.assetUrl ? (
                            <img className="emote-float-media" src={event.assetUrl} alt={label} width={64} height={64} />
                        ) : (
                            <>
                                <span className="emote-float-glyph" aria-hidden="true">{getEmoteGlyph(event.emoteId)}</span>
                                <span className="emote-float-label">{label}</span>
                            </>
                        )}
                    </div>
                );
            });
    };

    return (
        <div
            className="board-name-overlay"
            style={{
                position: 'absolute',
                inset: 0,
                pointerEvents: 'none',
                zIndex: 15,
                // Lives inside the rotated board-wrapper — keep glyphs upright.
                transform: counterRotationDeg ? `rotate(${counterRotationDeg}deg)` : undefined,
            }}
        >
            {renderLabel('TL', 'label-top-inside', { position: 'absolute', top: 0, left: '20%', width: '34%', transform: 'translateX(-50%)' })}
            {renderLabel('TR', 'label-top-inside', { position: 'absolute', top: 0, left: '80%', width: '34%', transform: 'translateX(-50%)' })}
            {renderLabel('BL', 'label-bottom-inside', { position: 'absolute', bottom: 0, left: '20%', width: '34%', transform: 'translateX(-50%)' })}
            {renderLabel('BR', 'label-bottom-inside', { position: 'absolute', bottom: 0, left: '80%', width: '34%', transform: 'translateX(-50%)' })}
            {renderBubble('TL')}
            {renderBubble('TR')}
            {renderBubble('BL')}
            {renderBubble('BR')}
            {renderEmotes('TL')}
            {renderEmotes('TR')}
            {renderEmotes('BL')}
            {renderEmotes('BR')}
        </div>
    );
}
