"use client";

import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { useGameData } from '@/hooks/GameDataContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAppSession } from '@/hooks/useAppSession';
import { describeSendFailure } from '@/lib/sendErrors';
import { useTeamUpContext } from '@/hooks/TeamUpContext';
import { LobbyState, LobbySlot } from '@/lib/types';
import { canStartMatch } from '@/lib/gameLogic';
import { useSoundEffects } from '../hooks/useSoundEffects';
import { getSoundEngine } from '@/lib/audio/SoundEngine';
import { GamePanelShell } from './GamePanelShell';
import { PanelTabs } from './PanelTabs';
import { Button } from './Button';
import { useToast } from './Toast';
import { ThinkingOrb } from './ThinkingOrb';
import { HudCornerTicks, HudSectionLabel } from './HudPrimitives';
import { CheckGlyphIcon, CloseReticleIcon, SquadRoomIcon } from './icons';

interface OnlinePlayer {
    wallet_address: string;
    username?: string | null;
    avatar_url?: string | null;
    status?: string | null;
}

interface TeamUpMatchPanelProps {
    onClose: () => void;
    onJoin: (code: string, secret?: string) => void;
    onHost: () => void;
    currentRoomId: string;
    isHost: boolean;
    isLobbyConnected: boolean;
    lobbyState: LobbyState | null;
    onStartMatch: () => void;
    onSwapPlayers: (indexA: number, indexB: number) => void;
    onKickPlayer: (slotIndex: number) => void;
    onSendInvite: (friendId: string, friendName?: string, role?: 'teammate' | 'opponent') => void;
    onQuickMatch: () => void;
    /** Host-only: step entry fee down one preset. */
    onLowerFee?: () => void;
    hunting?: boolean;
    huntExpired?: boolean;
    huntTimeoutS?: number;
    onCancelHunt?: () => void;
    matchType?: '1v1' | '2v2' | '4P';
    gameMode?: 'classic' | 'power';
    entryFee?: number;
}

const LinkIcon = ({ className }: { className?: string }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
);

const DashedRadarRing = ({ className = "" }: { className?: string }) => (
    <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        className={`absolute inset-0 w-full h-full pointer-events-none text-accent ${className}`}
    >
        <motion.svg
            viewBox="0 0 100 100"
            className="w-full h-full"
            animate={{ rotate: 360 }}
            transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
        >
            <circle cx="50" cy="50" r="48" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="4 4" opacity="0.45" />
            <circle cx="50" cy="50" r="38" fill="none" stroke="currentColor" strokeWidth="0.5" strokeDasharray="2 2" opacity="0.25" />
            <circle cx="50" cy="50" r="28" fill="none" stroke="currentColor" strokeWidth="0.5" opacity="0.14" />
        </motion.svg>

        <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
            className="absolute inset-0 rounded-full bg-gradient-to-r from-accent/15 to-transparent"
            style={{ clipPath: 'polygon(50% 50%, 100% 0, 100% 50%)' }}
        />
    </motion.div>
);

const COLOR_DOT: Record<string, string> = {
    green: '#22c55e',
    red: '#ef4444',
    yellow: '#eab308',
    blue: '#3b82f6',
};

const TeamTile = () => (
    <div className="hud-chamfer-sm w-6 h-6 rounded-lg bg-accent-soft border border-accent/35 flex items-center justify-center">
        <SquadRoomIcon className="w-3.5 h-3.5 text-accent" />
    </div>
);

const HuntView = ({ empty, total, isHost, onCancel, expired, timeoutS }: {
    empty: number; total: number; isHost: boolean; onCancel: () => void;
    expired?: boolean; timeoutS?: number;
}) => {
    const span = timeoutS ?? 40;
    const [secsLeft, setSecsLeft] = useState(span);
    useEffect(() => {
        if (expired) return;
        if (secsLeft <= 0) return;
        const t = setTimeout(() => setSecsLeft(s => Math.max(0, s - 1)), 1000);
        return () => clearTimeout(t);
    }, [secsLeft, expired]);
    if (expired) {
        return (
            <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-2.5 p-5 mx-5 rounded-2xl bg-surface-panel border border-line-soft backdrop-blur-lg overflow-hidden animate-in fade-in duration-200">
                <span className="text-sm font-extrabold text-ink-strong uppercase tracking-[0.2em]">
                    No players found
                </span>
                <span className="text-ludo-xs font-bold text-ink-faint tracking-wide">
                    The pool stayed empty — back to invites…
                </span>
            </div>
        );
    }
    return (
        <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-2.5 p-5 mx-5 rounded-2xl bg-accent-soft/40 border border-accent/30 backdrop-blur-lg overflow-hidden animate-in fade-in duration-200">
            <span className="px-2.5 py-0.5 rounded-full bg-surface-recessed border border-line-soft text-ludo-xs font-extrabold tabular-nums text-ink-strong tracking-[0.2em]">
                0:{String(secsLeft).padStart(2, '0')}
            </span>
            <div className="relative w-20 h-20">
                <DashedRadarRing />
                <div className="absolute inset-0 flex items-center justify-center">
                    <span className="w-2.5 h-2.5 rounded-full bg-accent animate-ping" />
                </div>
                <div className="absolute inset-0 flex items-center justify-center">
                    <span className="w-2.5 h-2.5 rounded-full bg-accent" />
                </div>
            </div>
            <p className="text-sm font-extrabold text-ink-strong uppercase tracking-[0.2em]">
                Hunting {empty} player{empty === 1 ? '' : 's'}…
            </p>
            <p className="text-ludo-xs font-extrabold text-accent uppercase tracking-[0.25em]">
                {total - empty}/{total} seated · room live
            </p>
            <p className="text-ludo-xs font-bold text-ink-faint tracking-wide">
                Strangers join straight into this room
            </p>
            {isHost && (
                <Button
                    variant="secondary"
                    size="sm"
                    onClick={onCancel}
                    className="mt-1 rounded-full px-5 uppercase tracking-[0.2em]"
                >
                    Cancel hunt
                </Button>
            )}
        </div>
    );
};

const PersonPlusIcon = ({ className }: { className?: string }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <line x1="19" y1="8" x2="19" y2="14" /><line x1="22" y1="11" x2="16" y2="11" />
    </svg>
);

const TeamDisc = ({ slot, tint, you, onInvite, onKick, onDragStart, onDrop, selected, onSelect, entryFee = 0, showLowBadge = false }: {
    slot: LobbySlot | null | undefined;
    tint: 'accent' | 'rival';
    you?: boolean;
    onInvite?: () => void;
    onKick?: () => void;
    onDragStart?: () => void;
    onDrop?: () => void;
    selected?: boolean;
    onSelect?: () => void;
    entryFee?: number;
    showLowBadge?: boolean;
}) => {
    const filled = !!slot && slot.status === 'joined';
    const invited = !!slot && slot.status === 'invited';
    const canKick = filled && !!onKick && !you && slot?.role !== 'host';
    const lowBalance = showLowBadge
        && filled
        && entryFee > 0
        && typeof slot?.playerCoins === 'number'
        && slot.playerCoins < entryFee;
    const ring = selected
        ? 'border-warn shadow-[0_0_20px_rgba(252,211,77,0.45)]'
        : filled
            ? (tint === 'accent' ? 'border-accent/70 shadow-[0_0_18px_color-mix(in_srgb,var(--accent)_28%,transparent)]' : 'border-negative/60 shadow-[0_0_18px_rgba(251,113,133,0.28)]')
            : invited
                ? 'border-dashed border-line-strong bg-surface-recessed'
                : 'border-dashed border-line-soft bg-surface-recessed hover:border-accent/70 active:scale-90 cursor-pointer';
    return (
        <div className="relative flex flex-col items-center gap-1 min-w-0">
            <button
                type="button"
                disabled={!filled && !onInvite && !onDrop}
                draggable={!!onDragStart}
                onDragStart={(e) => {
                    if (!onDragStart) return;
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', slot?.slotIndex != null ? String(slot.slotIndex) : '');
                    onDragStart();
                }}
                onDragOver={(e) => { if (onDrop) e.preventDefault(); }}
                onDrop={(e) => {
                    if (!onDrop) return;
                    e.preventDefault();
                    onDrop();
                }}
                onClick={filled ? onSelect : onInvite}
                className="flex flex-col items-center gap-1 min-w-0"
            >
                <span className={`relative w-16 h-16 rounded-full overflow-hidden flex items-center justify-center border-2 transition-all ${ring} bg-surface-recessed ${selected ? 'scale-105' : ''}`}>
                    {filled && slot?.playerAvatar ? (
                        <img src={slot.playerAvatar} alt={slot.playerName || 'player'} className="w-full h-full object-cover" width={96} height={96} />
                    ) : filled ? (
                        <span className="text-xl font-extrabold text-ink-muted uppercase">{slot?.playerName?.[0] || 'P'}</span>
                    ) : invited ? (
                        <span className="text-ludo-xs font-extrabold uppercase tracking-[0.15em] text-warn px-1 text-center leading-tight">Sent…</span>
                    ) : (
                        <PersonPlusIcon className="w-6 h-6 text-ink-faint" />
                    )}
                    {you && (
                        <span className="absolute bottom-0 inset-x-0 py-px bg-accent text-ludo-xs font-extrabold uppercase tracking-[0.2em] text-accent-ink">
                            You
                        </span>
                    )}
                    {lowBalance && (
                        <span
                            className="absolute top-0 inset-x-0 py-px bg-warn text-ludo-xs font-extrabold uppercase tracking-[0.12em] text-accent-ink text-center"
                            title={`${slot?.playerName || 'Player'} has ${(slot?.playerCoins ?? 0).toLocaleString()} · entry ${entryFee.toLocaleString()}`}
                        >
                            Low
                        </span>
                    )}
                </span>
                <span className="text-ludo-xs font-extrabold text-ink-strong uppercase tracking-wider truncate max-w-[72px]">
                    {filled ? slot?.playerName : invited ? 'Invited' : 'Invite'}
                </span>
                <span className="flex items-center gap-1 text-ludo-xs font-bold uppercase tracking-[0.15em] text-ink-faint">
                    {slot?.color && <span className="w-1.5 h-1.5 rounded-full" style={{ background: COLOR_DOT[slot.color] || '#94a3b8' }} />}
                    {slot?.role === 'teammate' ? 'Partner' : slot?.role === 'opponent' ? 'Rival' : slot?.role === 'host' ? 'Host' : 'Open'}
                </span>
            </button>
            {canKick && (
                <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onKick?.(); }}
                    aria-label={`Kick ${slot?.playerName || 'player'}`}
                    title="Remove from seat"
                    className="absolute -top-0.5 -right-0.5 w-6 h-6 rounded-full bg-surface-panel border border-negative/60 text-negative text-ludo-sm font-extrabold flex items-center justify-center hover:bg-negative hover:text-accent-ink transition-all z-10"
                >
                    ×
                </button>
            )}
        </div>
    );
};

const TeamSplitView = ({ slots, mode, isSelfHost, onInviteSlot, onSwapPlayers, onKickPlayer, entryFee = 0, showLowBadges = false }: {
    slots: LobbySlot[];
    mode: '1v1' | '2v2' | '4P';
    isSelfHost: boolean;
    onInviteSlot: (slot: LobbySlot) => void;
    onSwapPlayers?: (a: number, b: number) => void;
    onKickPlayer?: (slotIndex: number) => void;
    entryFee?: number;
    showLowBadges?: boolean;
}) => {
    const [selectedSeat, setSelectedSeat] = useState<number | null>(null);
    const dragFromRef = useRef<number | null>(null);
    const mine = Array.isArray(slots) ? slots.filter(s => s && (s.role === 'host' || s.role === 'teammate')) : [];
    const theirs = Array.isArray(slots) ? slots.filter(s => s && s.role === 'opponent') : [];
    const mineTitle = mode === '2v2' ? 'Your team' : 'You';
    const theirsTitle = mode === '1v1' ? 'Rival' : 'Rivals';

    const handleSeatClick = (s: LobbySlot) => {
        if (!isSelfHost || !onSwapPlayers) return;
        if (s.status !== 'joined') return;
        if (s.role === 'host') return;
        if (selectedSeat === null) {
            setSelectedSeat(s.slotIndex);
            return;
        }
        if (selectedSeat === s.slotIndex) {
            setSelectedSeat(null);
            return;
        }
        onSwapPlayers(selectedSeat, s.slotIndex);
        setSelectedSeat(null);
    };

    const dropOn = (s: LobbySlot) => {
        if (!isSelfHost || !onSwapPlayers) return;
        const from = dragFromRef.current;
        dragFromRef.current = null;
        if (from === null || from === s.slotIndex) return;
        onSwapPlayers(from, s.slotIndex);
        setSelectedSeat(null);
    };

    const half = (title: string, tone: 'accent' | 'rival', list: LobbySlot[]) => (
        <div className={`flex-1 min-w-0 rounded-2xl border backdrop-blur-lg px-2 py-3 flex flex-col items-center gap-2.5 ${tone === 'accent' ? 'bg-accent-soft/45 border-accent/30' : 'bg-negative/10 border-negative/30'}`}>
            <span className={`text-ludo-xs font-extrabold uppercase tracking-[0.25em] ${tone === 'accent' ? 'text-accent' : 'text-negative'}`}>
                {title}
            </span>
            <div className="flex items-start justify-center gap-3 flex-wrap">
                {list.map(s => (
                    <TeamDisc
                        key={s.slotIndex}
                        slot={s}
                        tint={tone}
                        you={isSelfHost && s.role === 'host'}
                        onInvite={s.status === 'empty' ? () => onInviteSlot(s) : undefined}
                        onKick={isSelfHost && onKickPlayer && s.status === 'joined' && s.role !== 'host'
                            ? () => onKickPlayer(s.slotIndex)
                            : undefined}
                        onDragStart={isSelfHost && s.status === 'joined' && s.role !== 'host'
                            ? () => { dragFromRef.current = s.slotIndex; setSelectedSeat(s.slotIndex); }
                            : undefined}
                        onDrop={isSelfHost && onSwapPlayers ? () => dropOn(s) : undefined}
                        selected={selectedSeat === s.slotIndex}
                        onSelect={() => handleSeatClick(s)}
                        entryFee={entryFee}
                        showLowBadge={showLowBadges}
                    />
                ))}
            </div>
        </div>
    );
    return (
        <div className="flex-1 min-h-0 flex items-stretch gap-0 animate-in fade-in duration-200">
            {half(mineTitle, 'accent', mine)}
            <div className="w-px self-stretch mx-1.5 bg-gradient-to-b from-transparent via-line-strong to-transparent -skew-x-12 shrink-0" aria-hidden />
            {half(theirsTitle, 'rival', theirs)}
        </div>
    );
};

export const TeamUpMatchPanel = ({
    onClose,
    onJoin,
    onHost,
    currentRoomId,
    isHost,
    isLobbyConnected,
    lobbyState,
    onStartMatch,
    onSendInvite,
    onSwapPlayers,
    onKickPlayer,
    onQuickMatch,
    onLowerFee,
    hunting = false,
    huntExpired = false,
    huntTimeoutS = 40,
    onCancelHunt,
    matchType = '4P',
    gameMode = 'classic',
    entryFee = 0,
}: TeamUpMatchPanelProps) => {
    const toast = useToast();
    const { playSelect, playClick } = useSoundEffects();
    const { address } = useCurrentUser();
    const { roomSecret } = useTeamUpContext();
    const { peekAppSession, ensureAppSession } = useAppSession();
    const canAnnounceRoom = !roomSecret;

    const hostSlot = lobbyState?.slots[0];
    const roomCodeValue = lobbyState?.roomCode || currentRoomId || '';
    const totalSeats = lobbyState?.slots.length ?? (matchType === '1v1' ? 2 : 4);
    const joinedCount = lobbyState
        ? lobbyState.slots.filter(s => s.status === 'joined').length
        : 1;
    const prevRoomRef = useRef<string>(roomCodeValue);
    const prevJoinedRef = useRef<number>(joinedCount);

    useEffect(() => {
        if (roomCodeValue && roomCodeValue !== prevRoomRef.current) {
            getSoundEngine().play('lobby_room_created');
        }
        prevRoomRef.current = roomCodeValue;
    }, [roomCodeValue]);

    useEffect(() => {
        if (joinedCount > prevJoinedRef.current) {
            getSoundEngine().play('lobby_player_join');
        } else if (joinedCount < prevJoinedRef.current) {
            getSoundEngine().play('lobby_player_leave');
        }
        prevJoinedRef.current = joinedCount;
    }, [joinedCount]);

    useEffect(() => {
        if (!hunting) return;
        const engine = getSoundEngine();
        engine.pushQueueing();
        return () => engine.popQueueing();
    }, [hunting]);
    const isSelfHost = hostSlot?.playerId
        ? !!address && hostSlot.playerId.toLowerCase() === address.toLowerCase()
        : true;
    const [view, setView] = useState<'console' | 'join'>('console');
    const [_roomCode, setRoomCode] = useState('');
    const [joinSecret, setJoinSecret] = useState('');
    const [copiedKey, setCopiedKey] = useState<string | null>(null);
    const [ftab, setFtab] = useState<'social' | 'global'>('social');
    const [invitePopup, setInvitePopup] = useState<{ role: 'teammate' | 'opponent'; seat: number } | null>(null);

    const [announceCd, setAnnounceCd] = useState(0);
    const announced = announceCd > 0;
    useEffect(() => {
        if (announceCd <= 0) return;
        const t = setTimeout(() => setAnnounceCd(c => Math.max(0, c - 1)), 1000);
        return () => clearTimeout(t);
    }, [announceCd]);
    const announcedRef = useRef(false);
    const lastPostAt = useRef(0);
    const lastCount = useRef(-1);
    const lobbyCountsRef = useRef({ joined: 0, total: 0 });
    lobbyCountsRef.current = {
        joined: lobbyState?.slots.filter(s => s.status === 'joined').length ?? 0,
        total: lobbyState?.slots.length ?? 0,
    };

    const modeLabel = (lobbyState?.gameMode ?? gameMode) === 'power' ? 'Power' : 'Classic';
    const fee = lobbyState?.entryFee ?? entryFee;
    const feeLabel = fee > 0 ? fee.toLocaleString() : 'Free';

    const postAnnounce = async (content: string, open: boolean) => {
        if (!roomCodeValue || !address) return false;
        try {
            const sid = peekAppSession() ?? (await ensureAppSession());
            const res = await fetch('/api/live-chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(sid ? { Authorization: `Bearer ${sid}`, 'x-session-id': sid } : {}),
                },
                body: JSON.stringify({ wallet: address, content, roomCode: roomCodeValue, roomOpen: open, sessionId: sid ?? undefined }),
            });
            if (!res.ok) {
                const { message } = await describeSendFailure(res);
                console.warn('[room-announce] failed:', message);
            }
            return res.ok;
        } catch {
            console.warn('[room-announce] unreachable — network error');
            return false;
        }
    };
    const announceContent = (joined: number, total: number) =>
        `${matchType} · ${modeLabel} · ${feeLabel} · ${joined}/${total} · join`;
    const announceRoom = async () => {
        if (announced || !roomCodeValue || !address) return;
        if (!canAnnounceRoom) {
            console.warn('🚫 Private room — use invite link (with secret), not live-chat announce');
            return;
        }
        const joined = lobbyState?.slots.filter(s => s.status === 'joined').length ?? 0;
        const total = lobbyState?.slots.length ?? 0;
        if (total > 0 && joined >= total) return;
        playSelect();
        const ok = await postAnnounce(announceContent(joined, total), true);
        if (!ok) return;
        announcedRef.current = true;
        lastCount.current = joined;
        lastPostAt.current = Date.now();
        setAnnounceCd(10);
    };

    useEffect(() => {
        if (!announcedRef.current || !roomCodeValue || !address) return;
        const joined = lobbyState?.slots.filter(s => s.status === 'joined').length ?? 0;
        const total = lobbyState?.slots.length ?? 0;
        if (joined === lastCount.current) return;
        if (Date.now() - lastPostAt.current < 10000) return;
        lastCount.current = joined;
        lastPostAt.current = Date.now();
        void postAnnounce(announceContent(joined, total), true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [lobbyState, roomCodeValue, address]);

    useEffect(() => {
        if (!roomCodeValue || !address) return;
        const t = setInterval(() => {
            if (!announcedRef.current) return;
            const { joined, total } = lobbyCountsRef.current;
            void postAnnounce(announceContent(joined, total), true);
            lastPostAt.current = Date.now();
        }, 60000);
        return () => clearInterval(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [roomCodeValue, address]);

    useEffect(() => {
        const onUnload = () => {
            if (!announcedRef.current || !roomCodeValue || !address) return;
            try {
                navigator.sendBeacon?.('/api/live-chat', JSON.stringify({
                    wallet: address,
                    roomCode: roomCodeValue,
                    roomOpen: false,
                    content: `${matchType} · ${modeLabel} · ${feeLabel} · Closed`,
                }));
            } catch { /* best effort */ }
        };
        window.addEventListener('beforeunload', onUnload);
        return () => window.removeEventListener('beforeunload', onUnload);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [roomCodeValue, address]);

    const markClosed = (label: 'Started' | 'Closed') => {
        if (!announcedRef.current) return;
        announcedRef.current = false;
        setAnnounceCd(0);
        void postAnnounce(`${matchType} · ${modeLabel} · ${feeLabel} · ${label}`, false);
    };
    const handleClose = () => {
        if (isHost && roomCodeValue) markClosed('Closed');
        onClose();
    };

    const [globalOnline, setGlobalOnline] = useState<OnlinePlayer[]>([]);
    const [loadingOnline, setLoadingOnline] = useState(false);
    const PAGE_SIZE = 25;
    const [onlinePage, setOnlinePage] = useState(0);
    const [onlineHasMore, setOnlineHasMore] = useState(false);
    const cancelledRef = useRef(false);

    const fetchOnlinePage = async (page: number, append: boolean) => {
        setLoadingOnline(true);
        try {
            const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
            if (address) params.set('walletAddress', address);
            const res = await fetch(`/api/presence/online?${params.toString()}`);
            if (!res.ok) throw new Error(`Presence directory failed: ${res.status}`);
            const { players, hasMore } = await res.json();
            if (!cancelledRef.current) {
                setGlobalOnline(prev => append ? [...prev, ...((players || []) as OnlinePlayer[])] : ((players || []) as OnlinePlayer[]));
                setOnlinePage(page);
                setOnlineHasMore(!!hasMore);
            }
        } catch {
            if (!cancelledRef.current && !append) setGlobalOnline([]);
        } finally {
            if (!cancelledRef.current) setLoadingOnline(false);
        }
    };

    useEffect(() => {
        if (!invitePopup) return;
        cancelledRef.current = false;
        setGlobalOnline([]);
        setOnlinePage(0);
        setOnlineHasMore(false);
        void fetchOnlinePage(0, false);
        return () => { cancelledRef.current = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [invitePopup, address]);

    const ensureRoom = () => {
        if (!roomCodeValue) onHost();
    };

    const openInvitePopup = (slot: LobbySlot) => {
        playSelect();
        ensureRoom();
        if (slot.role !== 'teammate' && slot.role !== 'opponent') return;
        setInvitePopup({ role: slot.role, seat: slot.slotIndex });
    };

    const rankOf = (f: OnlinePlayer) => {
        const s = (f.status || 'offline').toLowerCase();
        if (s.includes('online')) return 0;
        if (s.includes('match') || s.includes('play') || s.includes('busy') || s.includes('game')) return 1;
        return 2;
    };

    const { friends: friendsData, isBooting: isLoadingFriends } = useGameData();
    const isReady = lobbyState ? canStartMatch(lobbyState) : false;

    const prevFeeRef = useRef<number | null>(null);
    const [feeDropNotice, setFeeDropNotice] = useState<number | null>(null);
    useEffect(() => {
        if (!lobbyState || isHost) {
            prevFeeRef.current = lobbyState?.entryFee ?? null;
            return;
        }
        const next = lobbyState.entryFee;
        const prev = prevFeeRef.current;
        prevFeeRef.current = next;
        if (prev !== null && next < prev) {
            setFeeDropNotice(next);
            const t = setTimeout(() => setFeeDropNotice(null), 4500);
            return () => clearTimeout(t);
        }
    }, [lobbyState?.entryFee, isHost, lobbyState]);

    const lowBalanceCount = (lobbyState?.slots ?? []).filter(
        s => s.status === 'joined'
            && fee > 0
            && typeof s.playerCoins === 'number'
            && s.playerCoins < fee,
    ).length;

    const copyText = async (text: string, key: string) => {
        try { (window as unknown as { __ludoLastInvite?: string }).__ludoLastInvite = text; } catch { /* ignore */ }
        let ok = false;
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(text);
                ok = true;
            }
        } catch {
            /* fall through */
        }
        if (!ok) {
            try {
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.select();
                ok = document.execCommand('copy');
                document.body.removeChild(ta);
            } catch {
                ok = false;
            }
        }
        if (!ok) {
            getSoundEngine().play('ui_error');
            toast('Copy failed — tap the copy button beside the invite link again.', 'error');
            return;
        }
        getSoundEngine().play('ui_copy');
        setCopiedKey(key);
        setTimeout(() => setCopiedKey(cur => (cur === key ? null : cur)), 1500);
    };

    const inviteLinkFor = (seat?: number) => {
        if (typeof window === 'undefined' || !roomCodeValue) return '';
        const s = roomSecret ? `&s=${encodeURIComponent(roomSecret)}` : '';
        return `${window.location.origin}${window.location.pathname}?room=${roomCodeValue}${s}${seat !== undefined ? `&seat=${seat}` : ''}`;
    };

    const [inviteBurst, setInviteBurst] = useState<Record<string, { at: number; count: number }>>({});
    const INVITE_MAX = 3;
    const INVITE_GAP_MS = 10_000;

    const handleInvite = (friend: OnlinePlayer) => {
        const key = (friend.wallet_address || '').toLowerCase();
        const now = Date.now();
        const rec = inviteBurst[key];
        if (rec && rec.count >= INVITE_MAX) return;
        if (rec && now - rec.at < INVITE_GAP_MS) return;
        playSelect();
        onSendInvite(friend.wallet_address, friend.username ?? undefined, invitePopup?.role);
        setInviteBurst(prev => {
            const prevRec = prev[key];
            return {
                ...prev,
                [key]: {
                    at: now,
                    count: (prevRec?.count ?? 0) + 1,
                },
            };
        });
        setInvitePopup(null);
    };

    const [, setInviteTick] = useState(0);
    useEffect(() => {
        if (Object.keys(inviteBurst).length === 0) return;
        const t = setInterval(() => setInviteTick(x => x + 1), 1000);
        return () => clearInterval(t);
    }, [inviteBurst]);

    const inviteStateFor = (wallet?: string) => {
        const key = (wallet || '').toLowerCase();
        const rec = inviteBurst[key];
        if (!rec) return { label: 'Invite', disabled: false, left: 0, used: 0 };
        const elapsed = Date.now() - rec.at;
        if (rec.count >= INVITE_MAX) return { label: 'Max invites', disabled: true, left: 0, used: rec.count };
        if (elapsed < INVITE_GAP_MS) {
            const left = Math.max(1, Math.ceil((INVITE_GAP_MS - elapsed) / 1000));
            return { label: `${left}s`, disabled: true, left, used: rec.count };
        }
        return { label: rec.count > 0 ? `Invite again (${rec.count}/${INVITE_MAX})` : 'Invite', disabled: false, left: 0, used: rec.count };
    };

    return (
        <>
            {/* Guest: host lowered the entry fee */}
            {feeDropNotice !== null && !isHost && (
                <div className="fixed inset-0 z-[230] flex items-start justify-center px-4 pt-20 sm:items-center sm:pt-0 pointer-events-none">
                    <div
                        className="ludo-teamup-scope panel-shell-3077 pointer-events-auto relative w-full max-w-[360px] rounded-[24px] border border-warn/45 bg-surface-panel px-6 py-6 text-center shadow-2xl overflow-hidden"
                        style={{ backdropFilter: 'blur(32px)' }}
                    >
                        <HudCornerTicks />
                        <p className="text-ludo-xs font-extrabold uppercase tracking-[0.3em] text-warn">
                            Entry fee updated
                        </p>
                        <p className="mt-2 text-lg font-extrabold text-ink-strong">
                            Host lowered entry to{' '}
                            <span className="text-warn tabular-nums">
                                {feeDropNotice > 0 ? feeDropNotice.toLocaleString() : 'Free'}
                            </span>
                        </p>
                        <p className="mt-1.5 text-ludo-sm text-ink-muted font-bold uppercase tracking-wider">
                            You’re still seated · waiting for host to start
                        </p>
                    </div>
                </div>
            )}

            <GamePanelShell
                scopeClass="ludo-teamup-scope"
                kicker="// SQUAD LOBBY"
                title={(
                    <span className="inline-flex items-center gap-2">
                        <TeamTile />
                        <span>Team Up</span>
                    </span>
                )}
                subtitle={(
                    <span className="inline-flex items-center gap-2 uppercase tracking-wide">
                        <span className="inline-flex items-center gap-1.5">
                            <span className={`w-1.5 h-1.5 rounded-full ${isLobbyConnected ? 'hud-status-breath bg-accent shadow-[0_0_8px_color-mix(in_srgb,var(--accent)_85%,transparent)]' : 'bg-line-strong'}`} />
                            <span className={`font-extrabold ${isLobbyConnected ? 'text-accent' : 'text-ink-faint'}`}>
                                {isLobbyConnected ? 'Online' : 'Offline'}
                            </span>
                        </span>
                        <span className="w-1 h-1 rounded-full bg-line-strong" />
                        <span className="font-extrabold text-ink-muted tabular-nums">
                            {joinedCount} of {totalSeats}
                        </span>
                    </span>
                )}
                onClose={handleClose}
                hideOrbs
            >
                <div className="relative flex-1 min-h-0 flex flex-col overflow-hidden">
                    {/* Room Info */}
                    <div className="px-5 pt-3 relative z-10 shrink-0">
                        <div className="flex items-center justify-between gap-2">
                            <span className="text-ludo-sm font-extrabold text-ink-strong tracking-wide uppercase truncate">
                                {modeLabel} • {feeLabel}
                                {isHost && fee > 0 && onLowerFee && (
                                    <button
                                        onClick={(e) => { e.stopPropagation(); playSelect(); onLowerFee(); }}
                                        className="ml-2 px-2 py-0.5 rounded-lg bg-warn/15 border border-warn/40 text-warn text-ludo-xs font-extrabold uppercase tracking-[0.12em] hover:bg-warn/25 transition-all"
                                        title="Step entry fee down one preset"
                                    >
                                        Lower fee
                                    </button>
                                )}
                            </span>
                            {roomCodeValue ? (
                                <div className="flex flex-col items-end gap-1">
                                    <button
                                        onClick={(e) => { e.stopPropagation(); playSelect(); void copyText(roomCodeValue, 'room'); }}
                                        className="shrink-0 bg-surface-recessed border border-line-soft px-2.5 py-1.5 rounded-xl text-ludo-xs font-extrabold tracking-[0.1em] text-ink-muted uppercase hover:text-ink-strong transition-colors"
                                    >
                                        {copiedKey === 'room' ? 'Code copied' : `Copy code · ${roomCodeValue}`}
                                    </button>
                                    {roomSecret && (
                                        <button
                                            onClick={(e) => { e.stopPropagation(); playSelect(); void copyText(inviteLinkFor(), 'link'); }}
                                            className="text-ludo-xs font-bold text-accent hover:opacity-80 underline underline-offset-2"
                                        >
                                            {copiedKey === 'link' ? 'Link copied' : 'Copy invite link'}
                                        </button>
                                    )}
                                </div>
                            ) : (
                                <Button
                                    variant="primary"
                                    size="sm"
                                    onClick={(e) => { e.stopPropagation(); playSelect(); onHost(); }}
                                    className="shrink-0 px-3 tracking-[0.12em] uppercase"
                                >
                                    Create room
                                </Button>
                            )}
                        </div>
                        {roomCodeValue && (
                            <p className="mt-1.5 text-ludo-xs text-ink-faint leading-snug">
                                Friends join with this code from Team Up → Join with code.
                            </p>
                        )}
                    </div>

                    {/* Core Context View */}
                    <div className="flex-1 w-full flex flex-col overflow-hidden relative z-10 min-h-0">
                        {hunting ? (
                            <HuntView
                                empty={lobbyState?.slots.filter(s => s.status === 'empty').length ?? 0}
                                total={lobbyState?.slots.length ?? 0}
                                isHost={isHost}
                                expired={huntExpired}
                                timeoutS={huntTimeoutS}
                                onCancel={() => { playClick(); onCancelHunt?.(); setInvitePopup(null); setView('console'); }}
                            />
                        ) : (
                            <>
                                {view === 'console' && (
                                    <div className="flex-1 min-h-0 flex flex-col gap-2 animate-in fade-in duration-200 px-5 pt-2 pb-2">
                                        <HudSectionLabel className="mt-1 mb-1">
                                            {joinedCount} of {totalSeats} players
                                        </HudSectionLabel>
                                        <TeamSplitView
                                            mode={matchType}
                                            slots={lobbyState?.slots ?? [
                                                { slotIndex: 0, role: 'host', color: 'green', status: 'joined' } as LobbySlot,
                                                ...(matchType === '1v1'
                                                    ? [{ slotIndex: 1, role: 'opponent', color: 'yellow', status: 'empty' } as LobbySlot]
                                                    : matchType === '2v2'
                                                        ? [
                                                            { slotIndex: 1, role: 'teammate', color: 'yellow', status: 'empty' } as LobbySlot,
                                                            { slotIndex: 2, role: 'opponent', color: 'red', status: 'empty' } as LobbySlot,
                                                            { slotIndex: 3, role: 'opponent', color: 'blue', status: 'empty' } as LobbySlot,
                                                        ]
                                                        : [
                                                            { slotIndex: 1, role: 'opponent', color: 'red', status: 'empty' } as LobbySlot,
                                                            { slotIndex: 2, role: 'opponent', color: 'yellow', status: 'empty' } as LobbySlot,
                                                            { slotIndex: 3, role: 'opponent', color: 'blue', status: 'empty' } as LobbySlot,
                                                        ]),
                                            ]}
                                            isSelfHost={!!isSelfHost}
                                            onInviteSlot={(slot) => openInvitePopup(slot)}
                                            onSwapPlayers={onSwapPlayers ? (a, b) => {
                                                getSoundEngine().play('lobby_seat_swap');
                                                onSwapPlayers(a, b);
                                            } : undefined}
                                            onKickPlayer={onKickPlayer ? (slotIdx) => {
                                                getSoundEngine().play('lobby_player_kick');
                                                onKickPlayer(slotIdx);
                                            } : undefined}
                                            entryFee={fee}
                                            showLowBadges={isHost}
                                        />

                                        {/* Join with Code */}
                                        <Button
                                            variant="secondary"
                                            size="lg"
                                            onClick={() => { playSelect(); setView('join'); }}
                                            leftIcon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="icon-md"><rect x="4" y="10" width="16" height="10" rx="2" /><path d="M8 15h.01M12 15h.01M16 15h.01M7 10V7a5 5 0 0 1 10 0v3" /></svg>}
                                            className="shrink-0 justify-center tracking-[0.25em] uppercase"
                                        >
                                            Join with Code
                                        </Button>
                                    </div>
                                )}

                                {view === 'join' && (
                                    <div className="flex-1 min-h-0 flex flex-col items-center justify-center p-5 bg-surface-panel mx-5 mt-3 rounded-2xl border border-line-soft animate-in zoom-in-95 duration-200 overflow-y-auto no-scrollbar">
                                        <div className="text-center mb-4">
                                            <h4 className="text-xl font-bold text-ink-strong uppercase tracking-wide mb-1">Join Game</h4>
                                            <p className="text-ludo-xs font-extrabold text-ink-faint uppercase tracking-[0.2em]">Paste invite or room code</p>
                                        </div>
                                        <div className="w-full flex flex-col gap-3">
                                            <label className="flex flex-col gap-1">
                                                <input
                                                    type="text"
                                                    value={joinSecret}
                                                    onChange={(e) => setJoinSecret(e.target.value.trim())}
                                                    placeholder="Paste invite link or Z5VVAR"
                                                    autoComplete="off"
                                                    autoCorrect="off"
                                                    autoCapitalize="none"
                                                    spellCheck={false}
                                                    autoFocus
                                                    className="w-full bg-surface-recessed border-2 border-line-soft rounded-2xl p-4 text-center text-ludo-lg font-mono text-accent placeholder:text-ink-faint focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/40 outline-none transition-all break-all"
                                                />
                                                <span className="text-ludo-xs text-ink-faint leading-snug text-center">
                                                    Type the room code (e.g. U8HJEO). Invite links work too.
                                                </span>
                                            </label>
                                            <div className="flex flex-col gap-2">
                                                <Button
                                                    variant="primary"
                                                    size="lg"
                                                    fullWidth
                                                    onClick={() => {
                                                        const raw = joinSecret.trim();
                                                        if (!raw) return;
                                                        let code = '';
                                                        let secret: string | undefined;
                                                        try {
                                                            if (raw.includes('room=') || raw.includes('?')) {
                                                                const u = new URL(raw, window.location.origin);
                                                                const r = u.searchParams.get('room');
                                                                const s = u.searchParams.get('s');
                                                                if (r) code = r.toUpperCase();
                                                                if (s) secret = s;
                                                            } else if (raw.includes('=') || raw.includes('&')) {
                                                                const u = new URLSearchParams(raw.replace(/^\?/, ''));
                                                                const r = u.get('room');
                                                                const s = u.get('s');
                                                                if (r) code = r.toUpperCase();
                                                                if (s) secret = s;
                                                            }
                                                        } catch { /* fall through */ }
                                                        if (!code) {
                                                            const cleaned = raw.replace(/[^A-Za-z0-9-]/g, '');
                                                            const m = cleaned.match(/^([A-Za-z0-9]{4,8})(?:[sS=]*([A-Fa-f0-9-]{16,}))?/);
                                                            if (m) {
                                                                code = m[1].toUpperCase();
                                                                if (m[2]) secret = m[2].toLowerCase();
                                                            } else {
                                                                code = cleaned.slice(0, 6).toUpperCase();
                                                            }
                                                        }
                                                        if (code.length < 3) return;
                                                        setRoomCode(code);
                                                        onJoin(code, secret);
                                                    }}
                                                    disabled={joinSecret.trim().length < 3}
                                                    className="uppercase tracking-[0.2em]"
                                                >
                                                    Join Game
                                                </Button>
                                                <Button variant="ghost" size="sm" onClick={() => { setRoomCode(''); setJoinSecret(''); setView('console'); }} className="uppercase tracking-[0.3em]">
                                                    Back
                                                </Button>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                    </div>

                    {/* Invite popup: bottom sheet pre-targeted at the tapped seat */}
                    {invitePopup && (
                        <div className="absolute inset-0 z-30 flex flex-col justify-end">
                            <div
                                className="absolute inset-0 bg-surface-page/75 backdrop-blur-[2px]"
                                onClick={() => setInvitePopup(null)}
                                aria-hidden
                            />
                            <div className="relative mx-3 mb-3 rounded-3xl border border-line-strong bg-surface-panel backdrop-blur-xl p-4 flex flex-col gap-2.5 max-h-[78%] shadow-2xl animate-in slide-in-from-bottom-4 duration-200">
                                <div className="flex items-center justify-between">
                                    <span className="text-ludo-sm font-extrabold uppercase tracking-[0.2em] text-ink-strong">
                                        Invite {invitePopup.role === 'teammate' ? 'Partner' : 'Rival'}
                                        <span className="ml-2 px-1.5 py-0.5 rounded-md bg-surface-recessed border border-line-soft text-ludo-xs text-ink-muted">
                                            Seat {invitePopup.seat + 1}
                                        </span>
                                    </span>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => setInvitePopup(null)}
                                        aria-label="Close invite sheet"
                                        className="h-8 w-8 rounded-full p-0 justify-center"
                                        leftIcon={<CloseReticleIcon className="icon-sm" />}
                                    />
                                </div>
                                {roomCodeValue && (
                                    <button
                                        onClick={() => void copyText(inviteLinkFor(invitePopup.seat), 'popup-link')}
                                        className="flex items-center justify-between px-4 py-2.5 rounded-2xl bg-accent-soft border border-accent/30 hover:bg-accent/20 transition-all"
                                    >
                                        <span className="text-ludo-xs font-extrabold text-accent uppercase tracking-widest truncate">
                                            {inviteLinkFor(invitePopup.seat)}
                                        </span>
                                        {copiedKey === 'popup-link' ? (
                                            <CheckGlyphIcon className="w-4 h-4 text-positive shrink-0 ml-2" />
                                        ) : (
                                            <LinkIcon className="w-4 h-4 text-accent shrink-0 ml-2" />
                                        )}
                                    </button>
                                )}
                                {roomCodeValue && (
                                    <button
                                        onClick={() => void copyText(inviteLinkFor(), 'popup-room-link')}
                                        className="-mt-1 text-ludo-xs font-bold text-ink-faint hover:text-accent tracking-wide transition-colors"
                                    >
                                        {copiedKey === 'popup-room-link' ? 'Room link copied!' : 'Copy room link instead — fills any open seat'}
                                    </button>
                                )}
                                <PanelTabs
                                    value={ftab}
                                    onPick={setFtab}
                                    options={[
                                        { value: 'social', label: `Social (${(friendsData.gameFriends || []).filter((f: OnlinePlayer) => rankOf(f) < 2).length})` },
                                        { value: 'global', label: `Global (${globalOnline.length}${onlineHasMore ? '+' : ''})` },
                                    ]}
                                />
                                <div className="flex-1 min-h-[140px] overflow-y-auto overscroll-contain no-scrollbar flex flex-col gap-2 pb-1">
                                    {(ftab === 'global' ? (loadingOnline && globalOnline.length === 0) : isLoadingFriends) ? (
                                        <div className="py-8 flex items-center justify-center">
                                            <ThinkingOrb state="searching" size={32} tone="accent" label="Loading players" />
                                        </div>
                                    ) : (
                                        (() => {
                                            const pool = (ftab === 'social' ? friendsData.gameFriends : globalOnline) as OnlinePlayer[];
                                            const visible = pool
                                                .filter((f) => rankOf(f) < 2)
                                                .sort((a, b) => rankOf(a) - rankOf(b));
                                            return visible.length > 0 ? (
                                                visible.map((f, i) => (
                                                    <div key={f.wallet_address || i} className="flex items-center justify-between p-3 rounded-2xl bg-surface-recessed border border-line-soft hover:border-accent/40 transition-colors group">
                                                        <div className="flex items-center gap-3 min-w-0">
                                                            <div className="w-10 h-10 bg-surface-panel rounded-xl overflow-hidden border border-line-soft shrink-0">
                                                                {f.avatar_url ? (
                                                                    <img src={f.avatar_url} alt="friend" className="w-full h-full object-cover" width={96} height={96} />
                                                                ) : (
                                                                    <div className="w-full h-full flex items-center justify-center text-ink-faint font-extrabold">{(f.username?.[0] || '?').toUpperCase()}</div>
                                                                )}
                                                            </div>
                                                            <div className="flex flex-col min-w-0">
                                                                <span className="text-xs font-bold text-ink-strong uppercase tracking-tight truncate">
                                                                    {(f.username && !f.username.startsWith('0x')) ? f.username : `User ${f.wallet_address.slice(-4).toUpperCase()}`}
                                                                </span>
                                                                <span className={`text-ludo-xs font-extrabold uppercase tracking-widest ${rankOf(f) === 0 ? 'text-positive' : 'text-warn'}`}>
                                                                    {rankOf(f) === 0 ? 'ONLINE · FREE TO PLAY' : 'IN MATCH'}
                                                                </span>
                                                            </div>
                                                        </div>
                                                        {(() => {
                                                            const inv = inviteStateFor(f.wallet_address);
                                                            return (
                                                                <button
                                                                    disabled={inv.disabled}
                                                                    onClick={() => handleInvite(f)}
                                                                    className={`shrink-0 ml-2 min-w-[72px] px-3 py-2 rounded-xl text-ludo-xs font-extrabold uppercase transition-all tabular-nums ${inv.disabled
                                                                        ? inv.label === 'Max invites'
                                                                            ? 'bg-negative/15 border border-negative/40 text-negative cursor-default'
                                                                            : 'bg-warn/15 border border-warn/40 text-warn cursor-default'
                                                                        : 'bg-surface-panel border border-line-soft text-ink-strong hover:bg-accent hover:text-accent-ink'}`}
                                                                >
                                                                    {inv.label}
                                                                </button>
                                                            );
                                                        })()}
                                                    </div>
                                                ))
                                            ) : (
                                                <div className="py-6 flex flex-col items-center justify-center gap-1.5 text-center">
                                                    <span className="text-ludo-xs font-extrabold uppercase tracking-widest text-ink-muted">
                                                        {ftab === 'global' ? 'No players online' : 'No friends online'}
                                                    </span>
                                                    <span className="text-ludo-xs font-bold text-ink-faint max-w-[240px]">
                                                        Only live players list here — free first, in-match second. Share the seat link above instead.
                                                    </span>
                                                </div>
                                            );
                                        })()
                                    )}
                                    {ftab === 'global' && loadingOnline && globalOnline.length > 0 && (
                                        <div className="py-3 flex items-center justify-center">
                                            <ThinkingOrb state="searching" size={20} label="Loading more players" />
                                        </div>
                                    )}
                                    {ftab === 'global' && onlineHasMore && !loadingOnline && (
                                        <Button
                                            variant="secondary"
                                            fullWidth
                                            onClick={() => void fetchOnlinePage(onlinePage + 1, true)}
                                            className="mt-1 tracking-[0.18em] uppercase"
                                        >
                                            Show more online players
                                        </Button>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Footer: Announce | Hunt + Start */}
                    {roomCodeValue && (
                        <div className="w-full mt-1 flex flex-col gap-2 px-5 pb-5 pt-3 border-t border-line-soft relative z-10 shrink-0">
                            {isHost && !isReady && !hunting && (
                                <div className="grid grid-cols-2 gap-2">
                                    {(lobbyState?.slots.some(s => s.status === 'empty')) && (
                                        <button
                                            onClick={announceRoom}
                                            disabled={announced || !canAnnounceRoom}
                                            title={canAnnounceRoom ? 'Announce in live chat' : 'Private room — share the invite link instead'}
                                            className={`announce-btn py-2.5 rounded-2xl border transition-all active:scale-95 flex flex-col items-center justify-center gap-0.5 ${announced ? 'announce-live bg-positive/15 border-positive/35 text-positive cursor-default' : 'bg-warn/15 border-warn/35 text-warn hover:bg-warn/25'}`}
                                        >
                                            <span className="flex items-center gap-1.5 font-extrabold tracking-[0.18em] text-ludo-sm uppercase">
                                                {announced ? (
                                                    <>
                                                        <CheckGlyphIcon className="w-3.5 h-3.5" />
                                                        Announced
                                                    </>
                                                ) : (
                                                    <>
                                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><path d="M3 11l18-7-7 18-2.5-7.5L3 11z" /></svg>
                                                        Announce
                                                    </>
                                                )}
                                            </span>
                                            <span className="text-ludo-xs font-bold tracking-wide text-ink-faint">
                                                {announced ? `next in ${announceCd}s` : 'in Live chat'}
                                            </span>
                                        </button>
                                    )}
                                    {lobbyState && (
                                        <button
                                            onClick={(e) => { e.stopPropagation(); playSelect(); onQuickMatch(); }}
                                            className="py-2.5 rounded-2xl bg-accent-soft border border-accent/35 text-accent transition-all hover:bg-accent/20 active:scale-95 flex flex-col items-center justify-center gap-0.5"
                                        >
                                            <span className="flex items-center gap-1.5 font-extrabold tracking-[0.18em] text-ludo-sm uppercase">
                                                <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5"><path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" /></svg>
                                                Hunt
                                            </span>
                                            <span className="text-ludo-xs font-bold tracking-wide text-ink-muted">Autofill with online players</span>
                                        </button>
                                    )}
                                </div>
                            )}

                            {hunting && isHost && (
                                <Button
                                    variant="secondary"
                                    size="md"
                                    fullWidth
                                    onClick={() => { playClick(); onCancelHunt?.(); setInvitePopup(null); setView('console'); }}
                                    className="flex-col py-2.5"
                                >
                                    <span className="font-extrabold tracking-[0.2em] text-xs uppercase">Cancel hunt</span>
                                    <span className="text-ludo-xs font-bold normal-case tracking-wide text-ink-faint">Back to invites</span>
                                </Button>
                            )}

                            {isHost && lowBalanceCount > 0 && (
                                <p className="px-1 pb-1 text-ludo-xs font-bold text-warn leading-snug">
                                    {lowBalanceCount === 1 ? '1 player is' : `${lowBalanceCount} players are`} short on coins for this entry. Lower the fee or start anyway.
                                </p>
                            )}

                            <Button
                                variant="primary"
                                size="lg"
                                fullWidth
                                disabled={!isHost || !isReady}
                                onClick={() => {
                                    if (isHost && isReady) {
                                        getSoundEngine().play('lobby_countdown_go');
                                        markClosed('Started');
                                        onStartMatch();
                                    }
                                }}
                                className="uppercase tracking-[0.2em]"
                            >
                                {!isHost ? 'Waiting for Host…' : isReady ? 'Start Game' : 'Waiting for Players…'}
                            </Button>
                        </div>
                    )}
                </div>
            </GamePanelShell>
        </>
    );
};
