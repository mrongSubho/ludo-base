"use client";

import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { useGameData } from '@/hooks/GameDataContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useTeamUpContext } from '@/hooks/TeamUpContext';
import { supabase } from '@/lib/supabase';
import { LobbyState, LobbySlot } from '@/lib/types';
import { canStartMatch } from '@/lib/gameLogic';
import { useSoundEffects } from '../hooks/useSoundEffects';
import { FiX } from 'react-icons/fi';
import { PanelTabs } from './PanelTabs';

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
    hunting?: boolean;
    huntExpired?: boolean;
    huntTimeoutS?: number;
    onCancelHunt?: () => void;
    matchType?: '1v1' | '2v2' | '4P';
    gameMode?: 'classic' | 'power';
    entryFee?: number;
}

// --- ICONS ---
const LinkIcon = ({ className }: { className?: string }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
);

const CheckIcon = ({ className }: { className?: string }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={className}>
        <polyline points="20 6 9 17 4 12" />
    </svg>
);

const DashedRadarRing = ({ color = "#22d3ee", className = "" }) => (
    <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        className={`absolute inset-0 w-full h-full pointer-events-none ${className}`}
    >
        <motion.svg
            viewBox="0 0 100 100"
            className="w-full h-full"
            animate={{ rotate: 360 }}
            transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
        >
            <circle cx="50" cy="50" r="48" fill="none" stroke={color} strokeWidth="1" strokeDasharray="4 4" opacity="0.4" />
            <circle cx="50" cy="50" r="38" fill="none" stroke={color} strokeWidth="0.5" strokeDasharray="2 2" opacity="0.2" />
            <circle cx="50" cy="50" r="28" fill="none" stroke={color} strokeWidth="0.5" opacity="0.1" />
        </motion.svg>

        {/* Scanning Sweep */}
        <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
            className="absolute inset-0 rounded-full bg-gradient-to-r from-cyan-500/10 to-transparent"
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

// ─── Theme-agnostic contract (holds for current + future themes) ───────────
// Same as the other synced panels: this sheet always renders on the shared
// dark-glass sandwich shell, so content uses only white-ink + white-opacity
// surfaces + cyan/status accents (amber kept for the host accent only).
// No font-family is set (inherits the active theme's display font). Spacing
// inside `.ludo-teamup-scope` is re-asserted in globals.css (the global
// unlayered reset zeroes Tailwind utilities).

// Icon tile: cyan glow square shared with the other synced panels.
const TeamTile = () => (
    <div className="w-7 h-7 rounded-xl bg-cyan-500/15 border border-cyan-400/40 flex items-center justify-center shadow-[0_0_16px_rgba(34,211,238,0.25)]">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-cyan-300">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
            <circle cx="9" cy="7" r="4"></circle>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
            <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
        </svg>
    </div>
);

// Section label: pill + gradient rule (marketplace vocabulary)
const SectionLabel = ({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) => (
    <div className="mt-1 mb-1 flex items-center gap-2.5">
        <span className="px-2 py-0.5 rounded-md bg-white/[0.07] border border-white/10 text-[10px] font-black tracking-[0.18em] text-white/60 font-mono uppercase">
            {children}
        </span>
        <div className="flex-1 h-px bg-gradient-to-r from-white/15 to-transparent" />
        {right}
    </div>
);

// Mini hunt radar: compact hybrid-search view embedded in the TeamUp page.
// The search engine itself mounts hidden in GameLobby; this is pure status.
const HuntView = ({ empty, total, isHost, onCancel, expired, timeoutS }: {
    empty: number; total: number; isHost: boolean; onCancel: () => void;
    expired?: boolean; timeoutS?: number;
}) => {
    // Display countdown (the stop itself is owned by the lobby).
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
            <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-2.5 p-5 mx-5 rounded-2xl bg-white/[0.03] border border-white/10 backdrop-blur-lg overflow-hidden animate-in fade-in duration-200">
                <span className="text-sm font-black text-white/70 uppercase tracking-[0.2em]">
                    No players found
                </span>
                <span className="text-[10px] font-bold text-white/35 tracking-wide">
                    The pool stayed empty — back to invites…
                </span>
            </div>
        );
    }
    return (
    <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-2.5 p-5 mx-5 rounded-2xl bg-cyan-500/[0.06] border border-cyan-500/25 backdrop-blur-lg overflow-hidden animate-in fade-in duration-200">
        <span className="px-2 py-0.5 rounded-full bg-black/30 border border-white/10 text-[10px] font-black tabular-nums text-white/70 tracking-[0.2em]">
            0:{String(secsLeft).padStart(2, '0')}
        </span>
        <div className="relative w-20 h-20">
            <DashedRadarRing color="#22d3ee" />
            <div className="absolute inset-0 flex items-center justify-center">
                <span className="w-2.5 h-2.5 rounded-full bg-cyan-300 animate-ping" />
            </div>
            <div className="absolute inset-0 flex items-center justify-center">
                <span className="w-2.5 h-2.5 rounded-full bg-cyan-300" />
            </div>
        </div>
        <p className="text-sm font-black text-white uppercase tracking-[0.2em]">
            Hunting {empty} player{empty === 1 ? '' : 's'}…
        </p>
        <p className="text-[10px] font-black text-cyan-300 uppercase tracking-[0.25em]">
            {total - empty}/{total} seated · room live
        </p>
        <p className="text-[9px] font-bold text-white/35 tracking-wide">
            Strangers join straight into this room
        </p>
        {isHost && (
            <button
                onClick={onCancel}
                className="mt-1 px-5 py-2 rounded-full bg-white/5 border border-white/15 text-white/60 text-[10px] font-black uppercase tracking-[0.2em] hover:bg-white/10 hover:text-white active:scale-95 transition-all"
            >
                Cancel hunt
            </button>
        )}
    </div>
    );
};

// Faceoff split (1v1 + 2v2): your team vs rivals, glass discs per seat.
// Our take on the classic A/B-team faceoff — terminal glass, cyan vs ember,
// diagonal divider. Empty disc tap opens the roster pre-targeted at that side.
const PersonPlusIcon = ({ className }: { className?: string }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <line x1="19" y1="8" x2="19" y2="14" /><line x1="22" y1="11" x2="16" y2="11" />
    </svg>
);

const TeamDisc = ({ slot, tint, you, onInvite, onKick, onDragStart, onDrop, selected, onSelect }: {
    slot: LobbySlot | null | undefined;
    tint: 'cyan' | 'ember';
    you?: boolean;
    onInvite?: () => void;
    /** Host only: kick a joined non-host seat */
    onKick?: () => void;
    /** Host only: drag source */
    onDragStart?: () => void;
    /** Host only: drop target (swap into this seat) */
    onDrop?: () => void;
    selected?: boolean;
    onSelect?: () => void;
}) => {
    const filled = !!slot && slot.status === 'joined';
    const invited = !!slot && slot.status === 'invited';
    const canKick = filled && !!onKick && !you && slot?.role !== 'host';
    const ring = selected
        ? 'border-amber-300 shadow-[0_0_20px_rgba(252,211,77,0.45)]'
        : filled
            ? (tint === 'cyan' ? 'border-cyan-400/70 shadow-[0_0_18px_rgba(34,211,238,0.35)]' : 'border-rose-400/60 shadow-[0_0_18px_rgba(251,113,133,0.3)]')
            : invited
                ? 'border-dashed border-white/25 bg-white/[0.03]'
                : 'border-dashed border-white/20 bg-white/[0.03] hover:border-cyan-300/70 active:scale-90 cursor-pointer';
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
                <span className={`relative w-16 h-16 rounded-full overflow-hidden flex items-center justify-center border-2 transition-all ${ring} bg-slate-800 ${selected ? 'scale-105' : ''}`}>
                    {filled && slot?.playerAvatar ? (
                        <img src={slot.playerAvatar} alt={slot.playerName || 'player'} className="w-full h-full object-cover" />
                    ) : filled ? (
                        <span className="text-xl font-black text-white/40 uppercase">{slot?.playerName?.[0] || 'P'}</span>
                    ) : invited ? (
                        <span className="text-[8px] font-black uppercase tracking-[0.15em] text-amber-300 px-1 text-center leading-tight">Sent…</span>
                    ) : (
                        <PersonPlusIcon className="w-6 h-6 text-white/30" />
                    )}
                    {you && (
                        <span className="absolute bottom-0 inset-x-0 py-px bg-cyan-500/90 text-[7px] font-black uppercase tracking-[0.2em] text-slate-950">
                            You
                        </span>
                    )}
                </span>
                <span className="text-[10px] font-black text-white uppercase tracking-wider truncate max-w-[72px]">
                    {filled ? slot?.playerName : invited ? 'Invited' : 'Invite'}
                </span>
                <span className="flex items-center gap-1 text-[8px] font-bold uppercase tracking-[0.15em] text-white/35">
                    {slot?.color && <span className="w-1.5 h-1.5 rounded-full" style={{ background: COLOR_DOT[slot.color] || '#fff' }} />}
                    {slot?.role === 'teammate' ? 'Partner' : slot?.role === 'opponent' ? 'Rival' : slot?.role === 'host' ? 'Host' : 'Open'}
                </span>
            </button>
            {canKick && (
                <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onKick?.(); }}
                    aria-label={`Kick ${slot?.playerName || 'player'}`}
                    title="Remove from seat"
                    className="absolute -top-0.5 -right-0.5 w-6 h-6 rounded-full bg-black/70 border border-rose-400/60 text-rose-300 text-[11px] font-black flex items-center justify-center hover:bg-rose-500 hover:text-white transition-all z-10"
                >
                    ×
                </button>
            )}
        </div>
    );
};

const TeamSplitView = ({ slots, mode, isSelfHost, onInviteSlot, onSwapPlayers, onKickPlayer }: {
    slots: LobbySlot[];
    mode: '1v1' | '2v2' | '4P';
    isSelfHost: boolean;
    // Empty-disc tap: open the invite popup pre-targeted at THAT seat.
    onInviteSlot: (slot: LobbySlot) => void;
    onSwapPlayers?: (a: number, b: number) => void;
    onKickPlayer?: (slotIndex: number) => void;
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
        // Swap works across teams (partner ↔ rival) and onto empty seats.
        onSwapPlayers(from, s.slotIndex);
        setSelectedSeat(null);
    };

    const half = (title: string, tone: 'cyan' | 'ember', list: LobbySlot[]) => (
        <div className={`flex-1 min-w-0 rounded-2xl border backdrop-blur-lg px-2 py-3 flex flex-col items-center gap-2.5 ${tone === 'cyan' ? 'bg-cyan-500/[0.07] border-cyan-500/25' : 'bg-rose-500/[0.06] border-rose-500/25'}`}>
            <span className={`text-[9px] font-black uppercase tracking-[0.25em] ${tone === 'cyan' ? 'text-cyan-300' : 'text-rose-300'}`}>
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
                    />
                ))}
            </div>
        </div>
    );
    return (
        <div className="flex-1 min-h-0 flex items-stretch gap-0 animate-in fade-in duration-200">
            {half(mineTitle, 'cyan', mine)}
            {/* Angled divider */}
            <div className="w-px self-stretch mx-1.5 bg-gradient-to-b from-transparent via-white/25 to-transparent -skew-x-12 shrink-0" aria-hidden />
            {half(theirsTitle, 'ember', theirs)}
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
    hunting = false,
    huntExpired = false,
    huntTimeoutS = 40,
    onCancelHunt,
    matchType = '4P',
    gameMode = 'classic',
    entryFee = 0,
}: TeamUpMatchPanelProps) => {
    const { playSelect, playClick, playDiceLand } = useSoundEffects();
    // Identity first: everything below (effects, deps, handlers) may read it.
    // (A use-before-declare here is a mount-time TDZ crash — see 5b964f1.)
    const { address } = useCurrentUser();
    const { roomSecret } = useTeamUpContext();
    // Public announce only when there is no room secret (hybrid/open join).
    // Private invite lobbies must not publish joinable room codes.
    const canAnnounceRoom = !roomSecret;
    // Data mapping FIRST: effects and dep arrays below read these during
    // render — anything declared after first use is a mount-time TDZ crash.
    const hostSlot = lobbyState?.slots[0];
    const roomCodeValue = lobbyState?.roomCode || currentRoomId || '';
    const totalSeats = lobbyState?.slots.length ?? (matchType === '1v1' ? 2 : 4);
    const joinedCount = lobbyState
        ? lobbyState.slots.filter(s => s.status === 'joined').length
        : 1;
    const isSelfHost = hostSlot?.playerId
        ? !!address && hostSlot.playerId.toLowerCase() === address.toLowerCase()
        : true;
    const [view, setView] = useState<'console' | 'join'>('console');
    const [roomCode, setRoomCode] = useState('');
    const [joinSecret, setJoinSecret] = useState('');
    const [copiedKey, setCopiedKey] = useState<string | null>(null);
    const [ftab, setFtab] = useState<'social' | 'global'>('social');
    // Invite popup: tapping an empty seat disc opens this sheet pre-targeted
    // at THAT seat — no separate roster page, no role tabs. The disc IS the
    // targeting (partner seat vs rival seat), in every match type.
    const [invitePopup, setInvitePopup] = useState<{ role: 'teammate' | 'opponent'; seat: number } | null>(null);
    // Live-chat announce: one tap posts the room as a joinable card —
    // no copy-paste-post chore. ONE row per room (upserted): seat fills
    // rewrite its content so counts stay live; start/close flips it to
    // Started/Closed instead of deleting, so history survives.
    // 10s re-announce countdown (ticks for display, clears the lock at 0).
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
    // Fresh seat counts for the heartbeat interval (avoids stale closure).
    const lobbyCountsRef = useRef({ joined: 0, total: 0 });
    lobbyCountsRef.current = {
        joined: lobbyState?.slots.filter(s => s.status === 'joined').length ?? 0,
        total: lobbyState?.slots.length ?? 0,
    };
    const postAnnounce = async (content: string, open: boolean) => {
        if (!roomCodeValue || !address) return false;
        try {
            const res = await fetch('/api/live-chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ wallet: address, content, roomCode: roomCodeValue, roomOpen: open }),
            });
            return res.ok;
        } catch { return false; }
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
    // Seat fills rewrite the row (10s min gap — matches the re-announce ask).
    useEffect(() => {
        if (!announcedRef.current || !roomCodeValue || !address) return;
        const joined = lobbyState?.slots.filter(s => s.status === 'joined').length ?? 0;
        const total = lobbyState?.slots.length ?? 0;
        if (joined === lastCount.current) return;
        if (Date.now() - lastPostAt.current < 10000) return;
        lastCount.current = joined;
        lastPostAt.current = Date.now();
        postAnnounce(announceContent(joined, total), true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [lobbyState, roomCodeValue, address]);
    // Liveness heartbeat: while this room is announced+open, refresh the
    // row every 60s. Discovery surfaces trust recency (5min cutoff), so a
    // host that vanishes without closing fades instead of haunting the feed.
    useEffect(() => {
        if (!roomCodeValue || !address) return;
        const t = setInterval(() => {
            if (!announcedRef.current) return;
            const { joined, total } = lobbyCountsRef.current;
            postAnnounce(announceContent(joined, total), true);
            lastPostAt.current = Date.now();
        }, 60000);
        return () => clearInterval(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [roomCodeValue, address]);
    // App-kill backstop: beacon a close so the row doesn't ghost.
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
            } catch { /* last breath — best effort */ }
        };
        window.addEventListener('beforeunload', onUnload);
        return () => window.removeEventListener('beforeunload', onUnload);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [roomCodeValue, address]);
    // Start/leave marks the row Started/Closed (never deleted). Host-only:
    // a guest closing the panel doesn't kill the room.
    const markClosed = (label: 'Started' | 'Closed') => {
        if (!announcedRef.current) return;
        announcedRef.current = false;
        setAnnounceCd(0);
        postAnnounce(`${matchType} · ${modeLabel} · ${feeLabel} · ${label}`, false);
    };
    const handleClose = () => {
        if (isHost && roomCodeValue) markClosed('Closed');
        onClose();
    };
    // Global strangers: live online players (presence heartbeat, 30s cadence).
    // Fetched fresh on every popup open — the Farcaster intersection the old
    // roster used is empty for most users, which read as a broken list.
    const [globalOnline, setGlobalOnline] = useState<any[]>([]);
    const [loadingOnline, setLoadingOnline] = useState(false);
    // Paged volume: 25 per page, append on demand. Rendered rows stay in the
    // low hundreds at most — no virtualization lib needed inside a popup;
    // paging the source is the future-proof half, capping the DOM is free.
    const PAGE_SIZE = 25;
    const [onlinePage, setOnlinePage] = useState(0);
    const [onlineHasMore, setOnlineHasMore] = useState(false);
    const fetchOnlinePage = async (page: number, append: boolean) => {
        setLoadingOnline(true);
        try {
            const me = address?.toLowerCase();
            let q = supabase
                .from('players')
                .select('wallet_address, username, avatar_url, status, last_seen_at')
                .eq('status', 'Online')
                .order('last_seen_at', { ascending: false })
                .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
            if (me) q = q.neq('wallet_address', me);
            const { data, error } = await q;
            if (error) throw error;
            // Freshness guard: heartbeat missed twice (>2min) = ghost.
            const cutoff = Date.now() - 2 * 60 * 1000;
            const live = (data || []).filter(p => p.last_seen_at && new Date(p.last_seen_at).getTime() >= cutoff);
            if (!cancelledRef.current) {
                setGlobalOnline(prev => append ? [...prev, ...live] : live);
                setOnlinePage(page);
                setOnlineHasMore((data || []).length === PAGE_SIZE);
            }
        } catch {
            if (!cancelledRef.current && !append) setGlobalOnline([]);
        } finally {
            if (!cancelledRef.current) setLoadingOnline(false);
        }
    };
    const cancelledRef = useRef(false);
    useEffect(() => {
        if (!invitePopup) return;
        cancelledRef.current = false;
        // Fresh open (or tab switch back): reset to page 0.
        setGlobalOnline([]);
        setOnlinePage(0);
        setOnlineHasMore(false);
        fetchOnlinePage(0, false);
        return () => { cancelledRef.current = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [invitePopup, address]);
    const openInvitePopup = (slot: LobbySlot) => {
        playSelect();
        ensureRoom();
        if (slot.role !== 'teammate' && slot.role !== 'opponent') return;
        setInvitePopup({ role: slot.role, seat: slot.slotIndex });
    };

    // Online-only roster: free players first, engaged/playing second.
    // Offline contacts never list — an invite nobody can accept is noise.
    const rankOf = (f: any) => {
        const s = (f.status || 'offline').toLowerCase();
        if (s.includes('online')) return 0;
        if (s.includes('match') || s.includes('play') || s.includes('busy') || s.includes('game')) return 1;
        return 2;
    };

    const { friends: friendsData, isBooting: isLoadingFriends } = useGameData();
    const isReady = lobbyState ? canStartMatch(lobbyState) : false;

    // Data Mapping lives top-of-component (see above).

    const modeLabel = (lobbyState?.gameMode ?? gameMode) === 'power' ? 'Power' : 'Classic';
    const fee = lobbyState?.entryFee ?? entryFee;
    const feeLabel = fee > 0 ? fee.toLocaleString() : 'Free';

    const copyText = async (text: string, key: string) => {
        // Debug / test hook: always expose the last copied invite payload.
        try { (window as unknown as { __ludoLastInvite?: string }).__ludoLastInvite = text; } catch { /* ignore */ }
        let ok = false;
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(text);
                ok = true;
            }
        } catch {
            /* fall through to legacy path (in-app webviews) */
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
            // Last resort: native prompt always allows manual copy.
            window.prompt('Copy invite link:', text);
            return;
        }
        setCopiedKey(key);
        setTimeout(() => setCopiedKey(cur => (cur === key ? null : cur)), 1500);
    };

    const inviteLinkFor = (seat?: number) => {
        if (typeof window === 'undefined' || !roomCodeValue) return '';
        const s = roomSecret ? `&s=${encodeURIComponent(roomSecret)}` : '';
        return `${window.location.origin}${window.location.pathname}?room=${roomCodeValue}${s}${seat !== undefined ? `&seat=${seat}` : ''}`;
    };

    // First tap on an empty seat hosts the room (wires up the dead onHost),
    // so invite links have a code to share.
    const ensureRoom = () => {
        if (!roomCodeValue) onHost();
    };

    // Seats holding a sent invite — rows reflect it back instead of
    // offering a duplicate ping.
    const invitedIds = new Set(
        (lobbyState?.slots ?? [])
            .filter(s => s.status === 'invited' && s.playerId)
            .map(s => s.playerId!.toLowerCase())
    );
    // Just-pinged friends: address → timestamp. Rows count down 10s.
    const [recentInvites, setRecentInvites] = useState<Record<string, number>>({});

    const handleInvite = (friend: any) => {
        playSelect();
        // Seat-targeted: the engine only honors roles in 2v2 and fails
        // closed on taken kinds — the popup only opens on empty seats.
        onSendInvite(friend.wallet_address, friend.username, invitePopup?.role);
        setRecentInvites(prev => ({ ...prev, [(friend.wallet_address || '').toLowerCase()]: Date.now() }));
        setInvitePopup(null);
    };
    // Per-friend re-invite cooldown (10s): the row counts down, then frees.
    const [, setInviteTick] = useState(0);
    useEffect(() => {
        if (Object.keys(recentInvites).length === 0) return;
        const t = setInterval(() => {
            const now = Date.now();
            setRecentInvites(prev => {
                const next: Record<string, number> = {};
                for (const [k, v] of Object.entries(prev)) {
                    if (now - v < 10000) next[k] = v;
                }
                return Object.keys(next).length === Object.keys(prev).length ? prev : next;
            });
            setInviteTick(x => x + 1);
        }, 1000);
        return () => clearInterval(t);
    }, [recentInvites]);

    return (
        <>
            {/* Blurring Overlay */}
            <div
                className="fixed top-[64px] bottom-[80px] left-0 right-0 z-40 bg-transparent"
                onClick={handleClose}
            />

            {/* Main Panel Container */}
            <div className="fixed inset-0 z-[110] flex justify-center pointer-events-none">
                <div className="w-full max-w-[500px] relative h-full">
                    <div
                        className="ludo-teamup-scope pointer-events-auto absolute top-[64px] bottom-[80px] left-[8px] right-[8px] border border-white/10 rounded-[32px] flex flex-col shadow-2xl overflow-hidden"
                        style={{ background: 'var(--panel-bg-image, var(--ludo-bg-cosmic))', backgroundColor: 'var(--panel-bg, rgba(13,13,13,0.92))', backdropFilter: 'blur(32px)' }}
                    >
                        {/* Authentic Subdued Cosmic Orbs */}
                        <div className="absolute top-[-20%] left-[-20%] w-full h-full cosmic-orb cosmic-orb-1 opacity-20 scale-150 pointer-events-none" />
                        <div className="absolute bottom-[-20%] right-[-20%] w-full h-full cosmic-orb cosmic-orb-2 opacity-15 scale-150 pointer-events-none" />

                        {/* Handle Bar */}
                        <div className="w-full flex justify-center pt-2 pb-1 relative z-10">
                            <div className="w-12 h-1.5 bg-white/20 rounded-full" />
                        </div>

                        {/* Header */}
                        <div className="px-5 pb-3 border-b border-white/10 relative z-10">
                            <div className="flex items-center justify-between mb-1 mt-1">
                                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                    <TeamTile />
                                    Team Up
                                </h2>
                                <button
                                    onClick={handleClose}
                                    aria-label="Close team up"
                                    className="w-11 h-11 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-all ring-1 ring-white/10 shadow-sm shrink-0"
                                >
                                    <FiX className="w-4 h-4" />
                                </button>
                            </div>
                            <div className="flex items-center gap-2 px-0.5">
                                <span className="flex items-center gap-1.5">
                                    <span className={`w-1.5 h-1.5 rounded-full ${isLobbyConnected ? 'bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.9)] animate-pulse' : 'bg-white/25'}`} />
                                    <span className={`text-[11px] font-black tracking-wide uppercase ${isLobbyConnected ? 'text-cyan-300' : 'text-white/40'}`}>
                                        {isLobbyConnected ? 'Online' : 'Offline'}
                                    </span>
                                </span>
                                <span className="w-0.5 h-0.5 rounded-full bg-white/25" />
                                <span className="text-[11px] font-black text-white/70 tracking-wide uppercase tabular-nums">
                                    {joinedCount} of {totalSeats}
                                </span>
                            </div>
                        </div>

                        {/* Room Info */}
                        <div className="px-5 pt-3 relative z-10">
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-[11px] font-black text-white/70 tracking-wide uppercase truncate">
                                    {modeLabel} • {feeLabel}
                                </span>
                                {roomCodeValue ? (
                                    <div className="flex flex-col items-end gap-1">
                                        <button
                                            onClick={(e) => { e.stopPropagation(); playSelect(); copyText(roomCodeValue, 'room'); }}
                                            className="shrink-0 bg-white/5 border border-white/10 px-2.5 py-1.5 rounded-xl text-[10px] font-black tracking-[0.1em] text-white/60 uppercase hover:text-white transition-colors"
                                        >
                                            {copiedKey === 'room' ? 'Code copied' : `Copy code · ${roomCodeValue}`}
                                        </button>
                                        {roomSecret && (
                                            <button
                                                onClick={(e) => { e.stopPropagation(); playSelect(); copyText(inviteLinkFor(), 'link'); }}
                                                className="text-[9px] font-bold text-cyan-300/70 hover:text-cyan-200 underline underline-offset-2"
                                            >
                                                {copiedKey === 'link' ? 'Link copied' : 'Copy invite link'}
                                            </button>
                                        )}
                                    </div>
                                ) : (
                                    <button
                                        onClick={(e) => { e.stopPropagation(); playSelect(); onHost(); }}
                                        className="shrink-0 min-h-[36px] px-3 rounded-xl bg-cyan-400 text-black text-[10px] font-black tracking-[0.12em] uppercase hover:bg-cyan-300 active:scale-95 transition-all"
                                    >
                                        Create room
                                    </button>
                                )}
                            </div>
                            {roomCodeValue && (
                                <p className="mt-1.5 text-[10px] text-white/35 leading-snug">
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
                                    <SectionLabel>
                                        {joinedCount} of {totalSeats} players
                                    </SectionLabel>
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
                                        onSwapPlayers={onSwapPlayers}
                                        onKickPlayer={onKickPlayer}
                                    />

                                    {/* Join with Code */}
                                    <button
                                        onClick={() => { playSelect(); setView('join'); }}
                                        className="flex items-center justify-center gap-2 py-3 rounded-2xl border border-white/15 text-white/60 text-[10px] font-black uppercase tracking-[0.25em] hover:text-white hover:border-white/30 hover:bg-white/5 transition-all shrink-0"
                                    >
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><rect x="4" y="10" width="16" height="10" rx="2" /><path d="M8 15h.01M12 15h.01M16 15h.01M7 10V7a5 5 0 0 1 10 0v3" /></svg>
                                        Join with Code
                                    </button>

                                </div>
                            )}

                            {view === 'join' && (
                                <div className="flex-1 min-h-0 flex flex-col items-center justify-center p-5 bg-white/[0.04] mx-5 rounded-2xl border border-white/10 animate-in zoom-in-95 duration-200 overflow-y-auto no-scrollbar">
                                    <div className="text-center mb-4">
                                        <h4 className="text-xl font-bold text-white uppercase tracking-wide mb-1">Join Game</h4>
                                        <p className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em]">Paste invite or room code</p>
                                    </div>
                                    <div className="w-full flex flex-col gap-3">
                                        <label className="flex flex-col gap-1">
                                            <input
                                                type="text"
                                                value={joinSecret}
                                                onChange={(e) => setJoinSecret(e.target.value.trim())}
                                                placeholder="Paste invite link or Z5VVAR"
                                                autoComplete="off"
                                                spellCheck={false}
                                                autoFocus
                                                className="w-full bg-slate-900 border-2 border-white/10 rounded-2xl p-4 text-center text-[15px] font-mono text-cyan-300 placeholder:text-white/20 focus:border-cyan-500 focus-visible:ring-2 focus-visible:ring-cyan-400/60 outline-none transition-all break-all"
                                            />
                                            <span className="text-[10px] text-white/30 leading-snug text-center">
                                                Type the room code (e.g. U8HJEO). Invite links work too.
                                            </span>
                                        </label>
                                        <div className="flex flex-col gap-2">
                                            <button
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
                                                        // Bare token: first 6 alnum = room; rest optional secret
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
                                                className="w-full min-h-[48px] bg-white text-slate-900 text-sm font-black uppercase tracking-[0.2em] rounded-2xl shadow-xl hover:scale-[1.02] active:scale-95 disabled:opacity-20 transition-all"
                                            >
                                                Join Game
                                            </button>
                                            <button onClick={() => { setRoomCode(''); setJoinSecret(''); setView('console'); }} className="text-[9px] font-black text-white/20 uppercase tracking-[0.3em] hover:text-white">
                                                Back
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}
                            </>
                            )}
                        </div>

                        {/* Invite popup: bottom sheet pre-targeted at the tapped
                            seat. Friends + link tabs only — no separate page. */}
                        {invitePopup && (
                            <div className="absolute inset-0 z-30 flex flex-col justify-end">
                                <div
                                    className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
                                    onClick={() => setInvitePopup(null)}
                                    aria-hidden
                                />
                                <div className="relative mx-3 mb-3 rounded-3xl border border-white/10 bg-white/[0.04] backdrop-blur-xl p-4 flex flex-col gap-2.5 max-h-[78%] shadow-2xl animate-in slide-in-from-bottom-4 duration-200"
                                    style={{ background: 'var(--panel-bg-image, var(--ludo-bg-cosmic))', backgroundColor: 'var(--panel-bg, rgba(13,13,13,0.95))' }}
                                >
                                    <div className="flex items-center justify-between">
                                        <span className="text-[11px] font-black uppercase tracking-[0.2em] text-white">
                                            Invite {invitePopup.role === 'teammate' ? 'Partner' : 'Rival'}
                                            <span className="ml-2 px-1.5 py-0.5 rounded-md bg-white/10 text-[9px] text-white/50">
                                                Seat {invitePopup.seat + 1}
                                            </span>
                                        </span>
                                        <button
                                            onClick={() => setInvitePopup(null)}
                                            aria-label="Close invite sheet"
                                            className="w-8 h-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-all"
                                        >
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                        </button>
                                    </div>
                                    {roomCodeValue && (
                                        <button
                                            onClick={() => copyText(inviteLinkFor(invitePopup.seat), 'popup-link')}
                                            className="flex items-center justify-between px-4 py-2.5 rounded-2xl bg-cyan-500/10 border border-cyan-500/25 hover:bg-cyan-500/20 transition-all"
                                        >
                                            <span className="text-[10px] font-black text-cyan-300 uppercase tracking-widest truncate">
                                                {inviteLinkFor(invitePopup.seat)}
                                            </span>
                                            {copiedKey === 'popup-link' ? (
                                                <CheckIcon className="w-4 h-4 text-emerald-400 shrink-0 ml-2" />
                                            ) : (
                                                <LinkIcon className="w-4 h-4 text-cyan-300 shrink-0 ml-2" />
                                            )}
                                        </button>
                                    )}
                                    {roomCodeValue && (
                                        <button
                                            onClick={() => copyText(inviteLinkFor(), 'popup-room-link')}
                                            className="-mt-1 text-[9px] font-bold text-white/35 hover:text-cyan-300 tracking-wide transition-colors"
                                        >
                                            {copiedKey === 'popup-room-link' ? 'Room link copied!' : 'Copy room link instead — fills any open seat'}
                                        </button>
                                    )}
                                    <PanelTabs
                                        value={ftab}
                                        onPick={setFtab}
                                        options={[
                                            { value: 'social', label: `Social (${(friendsData.gameFriends || []).filter((f: any) => rankOf(f) < 2).length})` },
                                            { value: 'global', label: `Global (${globalOnline.length}${onlineHasMore ? '+' : ''})` },
                                        ]}
                                    />
                                    <div className="flex-1 min-h-[140px] overflow-y-auto overscroll-contain no-scrollbar flex flex-col gap-2 pb-1">
                                        {(ftab === 'global' ? (loadingOnline && globalOnline.length === 0) : isLoadingFriends) ? (
                                            <div className="py-8 flex items-center justify-center opacity-30"><div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin" /></div>
                                        ) : (
                                            (() => {
                                                // Social = recent opponents, online-only. Global = live
                                                // online strangers (presence heartbeat), always fresh.
                                                const pool = ftab === 'social' ? friendsData.gameFriends : globalOnline;
                                                const visible = pool
                                                    .filter((f: any) => rankOf(f) < 2)
                                                    .sort((a: any, b: any) => rankOf(a) - rankOf(b));
                                                return visible.length > 0 ? (
                                                    visible.map((f: any, i: number) => (
                                                    <div key={i} className="flex items-center justify-between p-3 rounded-2xl bg-white/[0.04] border border-white/10 hover:border-cyan-500/30 transition-colors group">
                                                        <div className="flex items-center gap-3 min-w-0">
                                                            <div className="w-10 h-10 bg-slate-800 rounded-xl overflow-hidden border border-white/10 shrink-0">
                                                                {f.avatar_url ? (
                                                                    <img src={f.avatar_url} alt="friend" className="w-full h-full object-cover" />
                                                                ) : (
                                                                    <div className="w-full h-full flex items-center justify-center text-white/20 font-black">{(f.username?.[0] || '?').toUpperCase()}</div>
                                                                )}
                                                            </div>
                                                            <div className="flex flex-col min-w-0">
                                                                <span className="text-xs font-bold text-white uppercase tracking-tight truncate">{(f.username && !f.username.startsWith('0x')) ? f.username : `User ${f.wallet_address.slice(-4).toUpperCase()}`}</span>
                                                                <span className={`text-[8px] font-black uppercase tracking-widest ${rankOf(f) === 0 ? 'text-emerald-400' : 'text-amber-400'}`}>{rankOf(f) === 0 ? 'ONLINE · FREE TO PLAY' : 'IN MATCH'}</span>
                                                            </div>
                                                        </div>
                                                        {(() => {
                                                            const key = (f.wallet_address || '').toLowerCase();
                                                            const recentTs = recentInvites[key];
                                                            const cooling = recentTs !== undefined && Date.now() - recentTs < 10000;
                                                            const left = cooling ? Math.max(1, Math.ceil(10 - (Date.now() - (recentTs as number)) / 1000)) : 0;
                                                            const already = invitedIds.has(key);
                                                            return (
                                                                <button
                                                                    disabled={cooling || already}
                                                                    onClick={() => handleInvite(f)}
                                                                    className={`shrink-0 ml-2 px-4 py-2 rounded-xl text-[9px] font-black uppercase transition-all tabular-nums ${cooling ? 'bg-amber-500/15 border border-amber-500/40 text-amber-300 cursor-default' : already ? 'bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 cursor-default' : 'bg-white/5 border border-white/10 text-white/60 hover:bg-cyan-500 hover:text-slate-950'}`}
                                                                >
                                                                    {cooling ? `${left}s` : already ? 'Invited' : 'Invite'}
                                                                </button>
                                                            );
                                                        })()}
                                                    </div>
                                                    ))
                                                ) : (
                                                    <div className="py-6 flex flex-col items-center justify-center gap-1.5 text-center">
                                                        <span className="text-[10px] font-black uppercase tracking-widest text-white/50">{ftab === 'global' ? 'No players online' : 'No friends online'}</span>
                                                        <span className="text-[9px] font-bold text-white/30 max-w-[240px]">Only live players list here — free first, in-match second. Share the seat link above instead.</span>
                                                    </div>
                                                );
                                            })()
                                        )}
                                        {ftab === 'global' && loadingOnline && globalOnline.length > 0 && (
                                            <div className="py-3 flex items-center justify-center opacity-40"><div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" /></div>
                                        )}
                                        {ftab === 'global' && onlineHasMore && !loadingOnline && (
                                            <button
                                                onClick={() => fetchOnlinePage(onlinePage + 1, true)}
                                                className="mt-1 w-full py-2.5 rounded-2xl bg-white/[0.04] border border-white/10 text-white/60 text-[10px] font-black uppercase tracking-[0.18em] hover:bg-white/10 hover:text-white active:scale-[0.99] transition-all"
                                            >
                                                Show more online players
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Footer: one fill row (Announce | Hunt) + Start.
                            Mode/fee live once in the header — never repeated.
                            No room, no footer actions (discs host on demand). */}
                        {roomCodeValue && (
                        <div className="w-full mt-1 flex flex-col gap-2 px-5 pb-5 pt-3 border-t border-white/10 relative z-10 shrink-0">
                            {isHost && !isReady && !hunting && (
                                <div className="grid grid-cols-2 gap-2">
                                    {(lobbyState?.slots.some(s => s.status === 'empty')) && (
                                        <button
                                            onClick={announceRoom}
                                            disabled={announced || !canAnnounceRoom}
                                            title={canAnnounceRoom ? 'Announce in live chat' : 'Private room — share the invite link instead'}
                                            className={`announce-btn py-2.5 rounded-2xl border transition-all active:scale-95 flex flex-col items-center justify-center gap-0.5 ${announced ? 'announce-live bg-emerald-500/10 border-emerald-500/30 text-emerald-300 cursor-default' : 'bg-amber-500/10 border-amber-500/30 text-amber-200 hover:bg-amber-500/20'}`}
                                        >
                                    <span className="flex items-center gap-1.5 font-black tracking-[0.18em] text-[11px] uppercase">
                                        {announced ? (
                                            <>
                                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><polyline points="20 6 9 17 4 12" /></svg>
                                                Announced
                                            </>
                                        ) : (
                                            <>
                                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><path d="M3 11l18-7-7 18-2.5-7.5L3 11z" /></svg>
                                                Announce
                                            </>
                                        )}
                                    </span>
                                    <span className="text-[8px] font-bold tracking-wide text-white/35">
                                        {announced ? `next in ${announceCd}s` : 'in Live chat'}
                                    </span>
                                        </button>
                                    )}
                                    {lobbyState && (
                                        <button
                                            onClick={(e) => { e.stopPropagation(); playSelect(); onQuickMatch(); }}
                                            className="py-2.5 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-200 transition-all hover:bg-cyan-500/20 active:scale-95 flex flex-col items-center justify-center gap-0.5"
                                        >
                                            <span className="flex items-center gap-1.5 font-black tracking-[0.18em] text-[11px] uppercase">
                                                <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5"><path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" /></svg>
                                                Hunt
                                            </span>
                                            <span className="text-[8px] font-bold tracking-wide text-cyan-400/60">Autofill with online players</span>
                                        </button>
                                    )}
                                </div>
                            )}

                            {hunting && isHost && (
                                <button
                                    onClick={() => { playClick(); onCancelHunt?.(); setInvitePopup(null); setView('console'); }}
                                    className="w-full py-3 rounded-2xl bg-white/[0.06] border border-white/15 text-white/70 transition-all hover:bg-white/10 hover:text-white active:scale-95 flex flex-col items-center justify-center gap-0.5"
                                >
                                    <span className="font-black tracking-[0.2em] text-xs uppercase">Cancel hunt</span>
                                    <span className="text-[9px] font-bold normal-case tracking-wide text-white/35">Back to invites</span>
                                </button>
                            )}

                                <button
                                    onClick={() => {
                                        if (isHost && isReady) {
                                            playDiceLand();
                                            if (typeof window !== 'undefined' && navigator.vibrate) navigator.vibrate([40, 60, 40]);
                                            markClosed('Started');
                                            onStartMatch();
                                        }
                                    }}
                                disabled={!isHost || !isReady}
                                className={`w-full py-3 rounded-2xl font-black tracking-[0.2em] text-sm uppercase transition-all duration-300 relative overflow-hidden border active:scale-95
                                    ${isHost && isReady
                                        ? 'bg-white text-slate-950 shadow-[0_0_30px_rgba(255,255,255,0.3)] hover:shadow-[0_0_50px_rgba(255,255,255,0.5)]'
                                        : 'bg-white/[0.07] text-white/40 border-white/15 cursor-not-allowed'
                                    }
                                `}
                            >
                                {!isHost ? 'Waiting for Host…' : isReady ? 'Start Game' : 'Waiting for Players…'}
                            </button>
                        </div>
                        )}
                    </div>
                </div>
            </div>
        </>
    );
};
