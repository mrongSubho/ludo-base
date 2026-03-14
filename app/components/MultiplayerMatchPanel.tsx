import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGameData } from '@/hooks/GameDataContext';
import { LobbyState, LobbySlot } from '@/lib/types';
import { canStartMatch, canQuickMatch } from '@/lib/gameLogic';

// Color map for slot cards
const SLOT_COLORS: Record<string, { bg: string; border: string; text: string; glow: string }> = {
    green: { bg: 'bg-green-500/15', border: 'border-green-500/40', text: 'text-green-400', glow: 'shadow-[0_0_15px_rgba(34,197,94,0.3)]' },
    red: { bg: 'bg-red-500/15', border: 'border-red-500/40', text: 'text-red-400', glow: 'shadow-[0_0_15px_rgba(239,68,68,0.3)]' },
    yellow: { bg: 'bg-yellow-500/15', border: 'border-yellow-500/40', text: 'text-yellow-400', glow: 'shadow-[0_0_15px_rgba(234,179,8,0.3)]' },
    blue: { bg: 'bg-blue-500/15', border: 'border-blue-500/40', text: 'text-blue-400', glow: 'shadow-[0_0_15px_rgba(59,130,246,0.3)]' },
};

const ROLE_LABELS: Record<string, string> = {
    host: '👑 HOST',
    teammate: '🤝 TEAMMATE',
    opponent: '⚔️ OPPONENT',
};

interface MultiplayerMatchPanelProps {
    onClose: () => void;
    onJoin: (code: string) => void;
    onHost: () => void;
    currentRoomId: string;
    isHost: boolean;
    isLobbyConnected: boolean;
    lobbyState: LobbyState | null;
    onStartMatch: () => void;
    onSwapPlayers: (indexA: number, indexB: number) => void;
    onKickPlayer: (slotIndex: number) => void;
    onSendInvite: (friendId: string, friendName?: string) => void;
    onQuickMatch: () => void;
}

// --- Slot Card Component ---
const SlotCard = ({
    slot,
    isHost,
    onKick,
    onSwapWith,
    dragMode,
    onDragStart,
}: {
    slot: LobbySlot;
    isHost: boolean;
    onKick: () => void;
    onSwapWith: () => void;
    dragMode: boolean;
    onDragStart: () => void;
}) => {
    const colors = SLOT_COLORS[slot.color] || SLOT_COLORS.green;

    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`relative p-3 rounded-2xl border ${colors.border} ${colors.bg} ${slot.status === 'joined' ? colors.glow : ''} transition-all`}
        >
            <div className="flex items-center gap-3">
                {/* Avatar */}
                <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${slot.status === 'joined' ? `${colors.bg} border ${colors.border}` : 'bg-white/5 border border-white/10'}`}>
                    {slot.status === 'joined' ? (
                        slot.playerAvatar ? (
                            <img src={slot.playerAvatar} alt="avatar" className="w-full h-full rounded-full object-cover" />
                        ) : (
                            <span className={`text-lg font-black ${colors.text}`}>
                                {(slot.playerName?.[0] || '?').toUpperCase()}
                            </span>
                        )
                    ) : slot.status === 'invited' ? (
                        <motion.div
                            animate={{ opacity: [0.3, 1, 0.3] }}
                            transition={{ duration: 2, repeat: Infinity }}
                            className="w-5 h-5 border-2 border-purple-400 border-t-transparent rounded-full animate-spin"
                        />
                    ) : (
                        <motion.div
                            animate={{ scale: [1, 1.2, 1] }}
                            transition={{ duration: 2, repeat: Infinity }}
                            className="w-3 h-3 bg-white/20 rounded-full"
                        />
                    )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                    <span className={`block text-sm font-bold truncate ${slot.status === 'joined' ? 'text-white' : 'text-white/40'}`}>
                        {slot.status === 'joined'
                            ? slot.playerName || 'Player'
                            : slot.status === 'invited'
                                ? slot.playerName || 'Invited...'
                                : 'Waiting...'}
                    </span>
                    <span className={`block text-[9px] font-black uppercase tracking-widest ${colors.text} opacity-70`}>
                        {ROLE_LABELS[slot.role]}
                    </span>
                </div>

                {/* Host Actions */}
                {isHost && slot.role !== 'host' && slot.status === 'joined' && (
                    <div className="flex gap-1 shrink-0">
                        {dragMode && (
                            <button
                                onClick={onSwapWith}
                                className="p-1.5 bg-white/10 hover:bg-white/20 rounded-lg transition-colors"
                                title="Swap"
                            >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 text-white/70">
                                    <path d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4" />
                                </svg>
                            </button>
                        )}
                        <button
                            onClick={onKick}
                            className="p-1.5 bg-red-500/20 hover:bg-red-500/30 rounded-lg transition-colors"
                            title="Kick"
                        >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-3.5 h-3.5 text-red-400">
                                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                        </button>
                    </div>
                )}

                {isHost && slot.role !== 'host' && slot.status !== 'joined' && (
                    <button
                        onClick={onDragStart}
                        className="p-1.5 bg-white/5 rounded-lg"
                    >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 text-white/30">
                            <circle cx="9" cy="6" r="1" /><circle cx="15" cy="6" r="1" />
                            <circle cx="9" cy="12" r="1" /><circle cx="15" cy="12" r="1" />
                            <circle cx="9" cy="18" r="1" /><circle cx="15" cy="18" r="1" />
                        </svg>
                    </button>
                )}
            </div>
        </motion.div>
    );
};

// --- Main Panel ---
export const MultiplayerMatchPanel = ({
    onClose,
    onJoin,
    onHost,
    currentRoomId,
    isHost,
    isLobbyConnected,
    lobbyState,
    onStartMatch,
    onSwapPlayers,
    onKickPlayer,
    onSendInvite,
    onQuickMatch,
}: MultiplayerMatchPanelProps) => {
    const [activeTab, setActiveTab] = useState<'host' | 'join'>('host');
    const [roomCode, setRoomCode] = useState('');
    const [swapSource, setSwapSource] = useState<number | null>(null);

    // Friends data
    const [friendTab, setFriendTab] = useState<'game' | 'onchain'>('game');
    const { friends: friendsData, isBooting: isLoadingFriends } = useGameData();

    const isReady = lobbyState ? canStartMatch(lobbyState) : false;
    const canHybrid = lobbyState ? canQuickMatch(lobbyState) : false;

    const handleSwap = (targetIndex: number) => {
        if (swapSource !== null && swapSource !== targetIndex) {
            onSwapPlayers(swapSource, targetIndex);
            setSwapSource(null);
        } else {
            setSwapSource(targetIndex);
        }
    };

    // Auto-generate code when switching to Host tab if none exists
    useEffect(() => {
        if (activeTab === 'host' && !currentRoomId && !lobbyState) {
            onHost();
        }
    }, [activeTab, currentRoomId, lobbyState, onHost]);

    return (
        <>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
            />

            <motion.div
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                className="fixed top-[64px] bottom-[80px] left-1/2 -translate-x-1/2 w-[calc(100%-32px)] max-w-[468px] bg-purple-600/20 backdrop-blur-xl border border-white/10 rounded-[32px] z-[110] flex flex-col shadow-2xl overflow-hidden"
            >
                {/* Handle Bar */}
                <div className="w-full flex justify-center pt-4 pb-2 cursor-pointer">
                    <div className="w-12 h-1.5 bg-white/20 rounded-full" />
                </div>

                {/* Header */}
                <div className="px-panel-gutter pb-4 border-b border-white/10">
                    <div className="flex items-center justify-between mt-2">
                        <h2 className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
                            Multiplayer Lobby
                        </h2>
                        <button
                            onClick={onClose}
                            className="w-8 h-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-all ring-1 ring-white/10 shadow-sm"
                        >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                        </button>
                    </div>
                </div>

                {/* Scrollable Content */}
                <div className="flex-1 overflow-y-auto px-panel-gutter py-4 space-y-5 custom-scrollbar">

                    {/* Tabs */}
                    <div className="flex bg-white/5 rounded-full p-1 mb-2">
                        <button
                            onClick={() => setActiveTab('host')}
                            className={`flex-1 py-2 text-sm font-bold uppercase tracking-widest rounded-full transition-all ${activeTab === 'host' ? 'bg-purple-600 text-white shadow-lg' : 'text-white/50 hover:text-white/80'}`}
                        >
                            Host Game
                        </button>
                        <button
                            onClick={() => setActiveTab('join')}
                            className={`flex-1 py-2 text-sm font-bold uppercase tracking-widest rounded-full transition-all ${activeTab === 'join' ? 'bg-purple-600 text-white shadow-lg' : 'text-white/50 hover:text-white/80'}`}
                        >
                            Join Game
                        </button>
                    </div>

                    <AnimatePresence mode="wait">
                        {activeTab === 'host' ? (
                            <motion.div
                                key="host"
                                initial={{ opacity: 0, x: -20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: 20 }}
                                className="space-y-5"
                            >
                                {/* Room Code */}
                                <div className="bg-white/5 border border-white/10 rounded-3xl p-5 text-center shadow-inner">
                                    <span className="block text-xs text-white/50 font-bold uppercase tracking-widest mb-2">Room Code</span>
                                    <div className="flex items-center justify-center gap-4">
                                        {currentRoomId ? (
                                            <span className="text-3xl font-mono text-cyan-400 font-black tracking-widest bg-cyan-900/10 px-4 py-2 rounded-xl border border-cyan-400/30 shadow-[0_0_15px_rgba(34,211,238,0.2)]">
                                                {currentRoomId}
                                            </span>
                                        ) : (
                                            <div className="flex items-center gap-2 px-6 py-3 bg-white/5 rounded-xl border border-white/10 animate-pulse">
                                                <div className="w-4 h-4 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
                                                <span className="text-sm font-bold text-white/40 uppercase tracking-widest">Generating...</span>
                                            </div>
                                        )}
                                        {currentRoomId && (
                                            <button
                                                onClick={() => navigator.clipboard.writeText(currentRoomId)}
                                                className="p-3 bg-white/10 hover:bg-white/20 rounded-xl transition-colors shrink-0 text-white shadow-sm"
                                                title="Copy Code"
                                            >
                                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                                            </button>
                                        )}
                                    </div>
                                </div>

                                {/* Slot Cards Grid */}
                                {lobbyState && (
                                    <div className="space-y-2">
                                        <span className="block text-[10px] text-white/40 font-black uppercase tracking-widest mb-2">
                                            Lobby Slots ({lobbyState.slots.filter(s => s.status === 'joined').length}/{lobbyState.slots.length})
                                        </span>
                                        <div className="grid grid-cols-2 gap-2">
                                            {lobbyState.slots.map((slot) => (
                                                <SlotCard
                                                    key={slot.slotIndex}
                                                    slot={slot}
                                                    isHost={isHost}
                                                    onKick={() => onKickPlayer(slot.slotIndex)}
                                                    onSwapWith={() => handleSwap(slot.slotIndex)}
                                                    dragMode={swapSource !== null}
                                                    onDragStart={() => setSwapSource(slot.slotIndex)}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Friends List (only show when room is created but not full) */}
                                {currentRoomId && lobbyState && !isReady && (
                                    <div className="flex flex-col">
                                        <div className="flex bg-white/5 rounded-2xl p-1 mb-3 shrink-0">
                                            <button
                                                onClick={() => setFriendTab('game')}
                                                className={`flex-1 py-1.5 text-[10px] font-bold uppercase tracking-widest rounded-xl transition-all ${friendTab === 'game' ? 'bg-purple-600 shadow-md text-white' : 'text-white/50 hover:text-white/80'}`}
                                            >
                                                Game Friends
                                            </button>
                                            <button
                                                onClick={() => setFriendTab('onchain')}
                                                className={`flex-1 py-1.5 text-[10px] font-bold uppercase tracking-widest rounded-xl transition-all ${friendTab === 'onchain' ? 'bg-purple-600 shadow-md text-white' : 'text-white/50 hover:text-white/80'}`}
                                            >
                                                Onchain Friends
                                            </button>
                                        </div>

                                        <div className="space-y-2 max-h-[200px] overflow-y-auto custom-scrollbar pr-1">
                                            {isLoadingFriends ? (
                                                <div className="flex justify-center py-6">
                                                    <div className="w-6 h-6 border-2 border-white/20 border-t-white/80 rounded-full animate-spin"></div>
                                                </div>
                                            ) : (
                                                <>
                                                    {(friendTab === 'game' ? friendsData.gameFriends : friendsData.onchainFriends).length === 0 ? (
                                                        <div className="text-center py-6 text-white/40 text-xs font-bold uppercase tracking-widest bg-white/5 rounded-2xl border border-white/5">
                                                            No friends found.
                                                        </div>
                                                    ) : (
                                                        (friendTab === 'game' ? friendsData.gameFriends : friendsData.onchainFriends).map((friend: any, i: number) => (
                                                            <div key={friend.wallet_address || i} className="flex items-center justify-between p-3 bg-white/5 rounded-2xl border border-white/10 shadow-sm transition-all hover:bg-white/10 shrink-0">
                                                                <div className="flex items-center gap-3 overflow-hidden">
                                                                    {friend.avatar_url ? (
                                                                        <img src={friend.avatar_url} alt="avatar" className="w-10 h-10 rounded-full border border-white/20 object-cover shrink-0" />
                                                                    ) : (
                                                                        <div className="w-10 h-10 bg-gradient-to-br from-purple-600 to-purple-500 rounded-full flex items-center justify-center font-bold text-white shadow-inner shrink-0">
                                                                            {(friend.username?.[0] || '?').toUpperCase()}
                                                                        </div>
                                                                    )}
                                                                    <div className="min-w-0">
                                                                        <span className="block text-sm font-bold text-white truncate">{friend.username || (friend.wallet_address ? `Guest ${friend.wallet_address.substring(0, 6)}` : 'Unknown')}</span>
                                                                        <span className="block text-[10px] uppercase font-bold tracking-widest text-white/50 truncate">
                                                                            Wins: {friend.total_wins || 0}
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                                <button
                                                                    onClick={() => onSendInvite(friend.wallet_address, friend.username)}
                                                                    className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 rounded-lg text-[10px] uppercase tracking-widest font-bold text-white shadow-[0_0_10px_rgba(176,38,255,0.4)] transition-colors shrink-0 ml-2"
                                                                >
                                                                    Invite
                                                                </button>
                                                            </div>
                                                        ))
                                                    )}
                                                </>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {/* No lobby yet — show waiting or connected status */}
                                {!lobbyState && !currentRoomId && (
                                    <div className="text-center py-6 text-white/40 text-xs font-bold uppercase tracking-widest">
                                        Generate a room code to start hosting.
                                    </div>
                                )}
                            </motion.div>
                        ) : (
                            /* JOIN TAB */
                            <motion.div
                                key="join"
                                initial={{ opacity: 0, x: 20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -20 }}
                                className="space-y-6 mt-4"
                            >
                                {isLobbyConnected ? (
                                    <div className="space-y-5">
                                        {/* Connected Status */}
                                        <div className="flex flex-col items-center justify-center space-y-4 pt-4">
                                            <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center relative shadow-[0_0_30px_rgba(34,197,94,0.3)] border border-green-500/30">
                                                <div className="absolute inset-0 bg-green-500 rounded-full animate-ping opacity-20"></div>
                                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="w-8 h-8 text-green-400">
                                                    <polyline points="20 6 9 17 4 12"></polyline>
                                                </svg>
                                            </div>
                                            <div className="text-center">
                                                <h3 className="text-xl font-black text-white drop-shadow-md italic">LOBBY JOINED</h3>
                                                <p className="text-white/60 text-sm font-bold mt-1">Waiting for Host to start...</p>
                                            </div>
                                        </div>

                                        {/* Show lobby slots as read-only for Guests */}
                                        {lobbyState && (
                                            <div className="space-y-2">
                                                <span className="block text-[10px] text-white/40 font-black uppercase tracking-widest mb-2">
                                                    Players ({lobbyState.slots.filter(s => s.status === 'joined').length}/{lobbyState.slots.length})
                                                </span>
                                                <div className="grid grid-cols-2 gap-2">
                                                    {lobbyState.slots.map((slot) => (
                                                        <SlotCard
                                                            key={slot.slotIndex}
                                                            slot={slot}
                                                            isHost={false}
                                                            onKick={() => {}}
                                                            onSwapWith={() => {}}
                                                            dragMode={false}
                                                            onDragStart={() => {}}
                                                        />
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <>
                                        <div className="text-center space-y-4">
                                            <span className="block text-sm text-white/70 font-bold uppercase tracking-widest">Have a room code?</span>
                                            <input
                                                type="text"
                                                placeholder="ENTER CODE"
                                                value={roomCode}
                                                onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                                                className="w-full bg-black/40 text-center text-3xl font-mono text-white placeholder-white/20 px-6 py-6 rounded-3xl border border-white/10 focus:border-purple-500/50 focus:outline-none focus:ring-2 focus:ring-purple-500/20 uppercase tracking-widest transition-all shadow-inner"
                                                maxLength={6}
                                            />
                                        </div>
                                        <button
                                            onClick={() => onJoin(roomCode)}
                                            disabled={roomCode.length < 3}
                                            className="w-full py-5 bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-500 hover:to-purple-600 text-white font-black italic tracking-tighter rounded-[24px] shadow-[0_0_30px_rgba(176,38,255,0.3)] transition-all disabled:opacity-50 disabled:cursor-not-allowed text-xl"
                                        >
                                            JOIN GAME
                                        </button>
                                    </>
                                )}
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                {/* Action Bar (Host only, when lobby exists) */}
                {isHost && lobbyState && activeTab === 'host' && (
                    <div className="p-panel-gutter pt-0 mt-auto space-y-2">
                        {canHybrid && !isReady && (
                            <button
                                onClick={onQuickMatch}
                                className="w-full py-4 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 hover:border-amber-500/50 text-amber-400 font-black tracking-widest uppercase rounded-2xl transition-all flex items-center justify-center gap-2 text-sm"
                            >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-5 h-5">
                                    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                                </svg>
                                Quick Match — Fill Remaining
                            </button>
                        )}
                        <motion.button
                            whileHover={isReady ? { scale: 1.02 } : {}}
                            whileTap={isReady ? { scale: 0.98 } : {}}
                            onClick={isReady ? onStartMatch : undefined}
                            disabled={!isReady}
                            className={`w-full py-5 font-black italic tracking-tighter rounded-[24px] transition-all text-xl border border-white/20 ${isReady
                                ? 'bg-gradient-to-r from-cyan-400 to-blue-500 text-white shadow-[0_0_30px_rgba(34,211,238,0.4)] cursor-pointer'
                                : 'bg-white/5 text-white/30 cursor-not-allowed'
                                }`}
                        >
                            {isReady ? '🚀 START MATCH' : 'WAITING FOR PLAYERS...'}
                        </motion.button>
                    </div>
                )}
            </motion.div>
        </>
    );
};
