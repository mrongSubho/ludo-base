import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PlayerColor } from '@/lib/types';
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
                            <ProximityMineIcon className="w-4 h-4 text-red-400 shrink-0" />
                        ) : tone === 'capture' ? (
                            <ArenaBladesIcon className="w-4 h-4 text-amber-300 shrink-0" active />
                        ) : (
                            <OverdriveBoltIcon className="w-4 h-4 text-cyan-300 shrink-0" active />
                        )}
                        <span>{message}</span>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

interface IdleWarningOverlayProps {
    idleWarning: { player: PlayerColor; timeLeft: number } | null;
    myPlayer: Player | undefined;
    onCancelAfk: (color: PlayerColor) => void;
}

export function IdleWarningOverlay({ idleWarning, myPlayer, onCancelAfk }: IdleWarningOverlayProps) {
    if (!idleWarning || idleWarning.player !== myPlayer?.color) return null;

    const r = 26;
    const circumference = 2 * Math.PI * r;
    const ratio = Math.min(1, Math.max(0, idleWarning.timeLeft / 10));
    const dashOffset = circumference * (1 - ratio);

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="ludo-idle-scope absolute inset-0 z-50 flex flex-col items-center justify-center rounded-2xl bg-black/70 px-4 backdrop-blur-md"
            >
                <motion.div
                    initial={{ scale: 0.9, y: 14, opacity: 0 }}
                    animate={{ scale: 1, y: 0, opacity: 1 }}
                    exit={{ scale: 0.94, y: 8, opacity: 0 }}
                    transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                    className="idle-warning-card panel-shell-3077 relative overflow-hidden w-full max-w-[300px] p-6 text-center flex flex-col items-center gap-3.5"
                >
                    <HudCornerTicks />
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-red-500/15 border border-red-400/35 text-ludo-xs font-mono font-bold uppercase tracking-[0.18em] text-red-400">
                        <WarningHexIcon className="w-3.5 h-3.5" />
                        Pilot Idle Detected
                    </span>

                    <div className="relative w-16 h-16 flex items-center justify-center my-0.5" aria-hidden="true">
                        <svg viewBox="0 0 64 64" className="w-full h-full -rotate-90">
                            <circle
                                cx="32"
                                cy="32"
                                r={r}
                                fill="none"
                                stroke="rgba(239, 68, 68, 0.2)"
                                strokeWidth="4"
                            />
                            <circle
                                cx="32"
                                cy="32"
                                r={r}
                                fill="none"
                                stroke="#ef4444"
                                strokeWidth="4"
                                strokeLinecap="round"
                                strokeDasharray={circumference}
                                strokeDashoffset={dashOffset}
                            />
                        </svg>
                        <span className="absolute font-mono font-extrabold text-lg tabular-nums text-red-400">
                            {idleWarning.timeLeft}s
                        </span>
                    </div>

                    <div className="space-y-1">
                        <h2 className="text-lg font-extrabold text-ink-strong tracking-tight">
                            Are you still there?
                        </h2>
                        <p className="text-ludo-xs text-ink-muted">
                            Auto-kicking in {idleWarning.timeLeft}s unless controls respond
                        </p>
                    </div>

                    <Button
                        variant="primary"
                        size="lg"
                        fullWidth
                        onClick={(e) => {
                            e.stopPropagation();
                            if (myPlayer?.color) onCancelAfk(myPlayer.color);
                        }}
                        className="uppercase tracking-[0.16em]"
                    >
                        I&apos;m Back!
                    </Button>
                </motion.div>
            </motion.div>
        </AnimatePresence>
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
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-8 h-8 text-amber-300">
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
