"use client";

import React, { useState, useCallback, useEffect } from 'react';
import { useTeamUpContext } from '@/hooks/TeamUpContext';
import { ActionDice } from './ActionDice';
import { LiveBroadcastCard } from './ActivityFeed';
import dynamic from 'next/dynamic';
const TeamUpMatchPanel = dynamic(() => import('./TeamUpMatchPanel').then(m => m.TeamUpMatchPanel));
const OfflineMatchPanel = dynamic(() => import('./OfflineMatchPanel').then(m => m.OfflineMatchPanel));
const QuickMatchPanel = dynamic(() => import('./QuickMatchPanel').then(m => m.QuickMatchPanel));
import { useSoundEffects } from '../hooks/useSoundEffects';
import { LuMinus, LuPlus } from 'react-icons/lu';
import { supabase } from '@/lib/supabase';
import { useAccount } from 'wagmi';
import { useGuestWall } from '@/hooks/GuestWallContext';

interface GameLobbyProps {
    gameMode: 'classic' | 'power';
    setGameMode: (mode: 'classic' | 'power') => void;
    matchType: '1v1' | '2v2' | '4P';
    setMatchType: (type: '1v1' | '2v2' | '4P') => void;
    wager: number;
    setWager: (wager: number) => void;
    onStartGame: (isBotMatch?: boolean, difficulty?: import('@/lib/types').BotDifficulty) => void;
    onOpenProfile?: (address: string) => void;
}

export default function GameLobby({
    gameMode,
    setGameMode,
    matchType,
    setMatchType,
    wager,
    setWager,
    onStartGame,
    onOpenProfile,
}: GameLobbyProps) {
    const {
        roomId,
        isLobbyConnected,
        isHost,
        hostGame,
        joinGame,
        hostQuickLobby,
        lobbyState,
        sendInvite,
        swapPlayers,
        kickPlayer,
        leaveGame
    } = useTeamUpContext();
    const { address } = useAccount();
    // Guests can only enter offline/bot matches — online entry shows the wall.
    const { guard } = useGuestWall();

    // Configuration State
    const { playSelect, playCoin } = useSoundEffects();
    const [showTeamUpOptions, setShowTeamUpOptions] = useState(false);
    const [showOfflineOptions, setShowOfflineOptions] = useState(false);
    const [isQuickMatchActive, setIsQuickMatchActive] = useState(false);
    const [hybridParams, setHybridParams] = useState<{ roomCode: string; slotsNeeded: number; matchType: '1v1' | '2v2' | '4P' } | null>(null);
    const [searchId, setSearchId] = useState(0);

    // Handle Joining from Live Feed
    useEffect(() => {
        const handleJoinPool = (e: any) => {
            const pool = e.detail;
            if (pool) {
                console.log('📡 [Lobby] Joining pool from feed:', pool);
                setWager(pool.entryFee);
                setGameMode(pool.mode);
                setMatchType(pool.matchType);
                // Trigger search on next tick to ensure state sync
                setTimeout(() => {
                    handleStartQuickMatch();
                }, 100);
            }
        };
        window.addEventListener('join_pool', handleJoinPool);
        return () => window.removeEventListener('join_pool', handleJoinPool);
    }, [setWager, setGameMode, setMatchType]);

    const handleStartQuickMatch = () => {
        guard('online-play', () => {
            setSearchId(prev => prev + 1);
            setIsQuickMatchActive(true);
        });
    };

    const handleCancelQuickMatch = useCallback(() => {
        setIsQuickMatchActive(false);
        setHybridParams(null);
    }, []);

    // Fill Remaining with Quick Match: host advertises the room, the hybrid
    // search pairs public-pool guests straight into it (they joinGame the
    // room code and get seated). Closes TeamUp; seats fill live behind this.
    const handleFillWithQuickMatch = () => {
        if (!lobbyState || !isHost) return;
        const empty = lobbyState.slots.filter(s => s.status === 'empty').length;
        if (empty === 0) return;
        playSelect();
        setHybridParams({ roomCode: lobbyState.roomCode, slotsNeeded: empty, matchType: lobbyState.matchType });
        setShowTeamUpOptions(false);
        setSearchId(prev => prev + 1);
        setIsQuickMatchActive(true);
    };

    return (
        <div className="ludo-lobby-scope relative isolate w-full max-w-4xl mx-auto px-3 sm:px-4 py-3 sm:py-8 min-h-[600px] h-full flex flex-col items-center justify-start">
            {/* Theme photo backdrop (fixed layer, behind everything, taps pass through) */}
            <div className="lobby-backdrop" aria-hidden />
            {/* 1. INITIAL SETUP PANEL */}
            {(!isQuickMatchActive && lobbyState?.status !== 'quickmatch') && (
                <div
                    key="setup"
                    className="w-full max-w-[420px] mx-auto flex flex-col gap-2 sm:gap-3 h-full setup-tier"
                >
                    {/* 1. SELECTION GROUP */}
                    <div className="w-full space-y-3 flex flex-col">
                        {/* Mode Section */}
                        <div className="flex flex-col items-center w-full">
                            <div className="flex justify-center w-full mb-3 mt-1">
                                <div className="inline-block px-5 py-1.5 bg-[rgba(0,0,0,0.35)] border border-white/10 rounded-full backdrop-blur-md">
                                    <h3 className="text-white/90 text-[10px] font-black uppercase tracking-[0.2em] text-center drop-shadow-md">Select Game Mode</h3>
                                </div>
                            </div>
                            <div className="flex justify-center gap-3">
                                {(['classic', 'power'] as const).map(mode => (
                                    <button
                                        key={mode}
                                        onClick={() => {
                                            playSelect();
                                            setGameMode(mode);
                                        }}
                                        className={`relative w-40 py-1 rounded-full border transition-all duration-200 ease-out glass-panel flex flex-col items-center justify-center hover:scale-[1.02] active:scale-95 ${gameMode === mode
                                            ? 'border-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.2)] bg-[rgba(0,0,0,0.5)]'
                                            : 'border-white/20 hover:border-white/40 bg-[rgba(0,0,0,0.5)]'
                                            }`}
                                    >
                                        {gameMode === mode && (
                                            <span className="porcelain-holo-tick absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-cyan-500 flex items-center justify-center shadow-lg z-10">
                                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" className="w-2.5 h-2.5 text-white"><polyline points="20 6 9 17 4 12" /></svg>
                                            </span>
                                        )}
                                        <div className="relative z-10 text-center">
                                            <span className={`block text-lg font-black italic tracking-tighter capitalize drop-shadow-md leading-none ${gameMode === mode ? 'text-cyan-400' : 'text-white/90'}`}>{mode}</span>
                                            <div className={`mt-0.5 inline-block px-1.5 py-px rounded-full border backdrop-blur-md ${gameMode === mode ? 'bg-[rgba(0,0,0,0.35)] border-cyan-500/30' : 'bg-[rgba(0,0,0,0.35)] border-white/10'}`}>
                                                <span className={`text-[8px] font-black uppercase tracking-[0.16em] whitespace-nowrap ${gameMode === mode ? 'text-cyan-400' : 'text-white/50'}`}>{mode === 'classic' ? 'Original Rules' : 'Special Power-ups'}</span>
                                            </div>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Match Type Section */}
                        <div className="flex flex-col items-center w-full">
                            <div className="flex justify-center w-full mt-1 mb-3">
                                <div className="inline-block px-5 py-1.5 bg-[rgba(0,0,0,0.35)] border border-white/10 rounded-full backdrop-blur-md">
                                    <h3 className="text-white/90 text-[10px] font-black uppercase tracking-[0.2em] text-center drop-shadow-md">Match Type</h3>
                                </div>
                            </div>
                            <div className="flex justify-center gap-3">
                                {(['1v1', '2v2', '4P'] as const).map(type => (
                                    <button
                                        key={type}
                                        onClick={() => {
                                            playSelect();
                                            setMatchType(type);
                                        }}
                                        className={`w-12 h-12 rounded-full border transition-all duration-200 ease-out glass-panel flex items-center justify-center hover:scale-110 active:scale-90 relative ${matchType === type
                                            ? 'border-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.3)] bg-[rgba(0,0,0,0.5)]'
                                            : 'border-white/10 hover:border-white/30 bg-[rgba(0,0,0,0.5)]'
                                            }`}
                                    >
                                        {matchType === type && (
                                            <span className="porcelain-holo-tick absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-cyan-500 flex items-center justify-center shadow-lg z-10">
                                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" className="w-2.5 h-2.5 text-white"><polyline points="20 6 9 17 4 12" /></svg>
                                            </span>
                                        )}
                                        <span className={`block text-lg font-black italic tracking-tighter drop-shadow-md ${matchType === type ? 'text-cyan-400' : 'text-white/60'}`}>{type}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* 2. ENTRY FEE PANEL */}
                    <div className="fee-tier p-1.5 pb-2 rounded-[20px] glass-panel flex flex-col items-center shadow-2xl border-t border-white/20 border-x border-white/5 border-b border-black/20 shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)]">
                        <div className="inline-block px-5 py-0.5 bg-[rgba(0,0,0,0.35)] border border-white/10 rounded-full backdrop-blur-md mb-1">
                            <span className="text-white/90 text-[10px] font-black uppercase tracking-[0.2em] drop-shadow-md">Entry Fee</span>
                        </div>
                        <div className="flex items-center justify-between w-full px-2 mb-1">
                            <button onClick={() => { playCoin(); setWager(Math.max(0, wager - (wager >= 1000 ? 1000 : 100))); }} className="w-11 h-11 rounded-[14px] bg-[rgba(0,0,0,0.35)] border border-white/10 flex items-center justify-center text-white/80 hover:bg-white/10 hover:scale-105 active:scale-95 shadow-lg backdrop-blur-md transition-all duration-200">
                                <LuMinus className="w-5 h-5 stroke-[3px]" />
                            </button>
                            <div className="flex-1 flex flex-col items-center justify-center relative">
                                <input type="number" value={wager} onChange={(e) => setWager(Math.max(0, parseInt(e.target.value) || 0))} className="w-full bg-transparent text-center text-xl font-black text-white drop-shadow-[0_0_15px_rgba(255,255,255,0.3)] focus:outline-none focus:ring-2 focus:ring-cyan-400/50 rounded-xl [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                            </div>
                            <button onClick={() => { playCoin(); setWager(wager + (wager >= 1000 ? 1000 : 100)); }} className="w-11 h-11 rounded-[14px] bg-[rgba(0,0,0,0.35)] border border-white/10 flex items-center justify-center text-white/80 hover:bg-white/10 hover:scale-105 active:scale-95 shadow-lg backdrop-blur-md transition-all duration-200">
                                <LuPlus className="w-5 h-5 stroke-[3px]" />
                            </button>
                        </div>
                        <div className="flex gap-1.5 justify-center flex-wrap">
                            {[0, 1000, 10000, 100000, 1000000].map(val => (
                                <button key={val} onClick={() => { playCoin(); setWager(val); }} className={`px-3 min-h-[44px] inline-flex items-center justify-center rounded-full border transition-all duration-200 hover:scale-105 active:scale-95 backdrop-blur-md shadow-sm text-[10px] font-black ${wager === val ? 'border-cyan-400 bg-[rgba(0,0,0,0.35)] text-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.3)]' : 'bg-[rgba(0,0,0,0.35)] hover:bg-white/15 border-white/10 text-white/90'}`}>
                                    {val === 0 ? 'Free' : val >= 1000000 ? `${val / 1000000} M` : val >= 1000 ? `${val / 1000} k` : val}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* 3. ACTION DICE - flex-1 so it rides lower, centered in
                        the free space between entry fee and the card */}
                    <div className="w-full flex-1 flex items-center justify-center relative z-30 min-h-0">
                        <ActionDice 
                            onSelectQuickMatch={handleStartQuickMatch}
                            onSelectTeamUp={() => guard('teamup', () => setShowTeamUpOptions(true))}
                            onSelectOfflineMatch={() => setShowOfflineOptions(true)}
                        />
                    </div>

                    {/* 4. LIVE BROADCAST card (MCP stream design). Chat + matches
                        open in its panel; arena streams live in the Arena tab. */}
                    <div className="w-full mt-auto pt-3">
                        <LiveBroadcastCard onOpenProfile={onOpenProfile} />
                    </div>

                </div>
            )}

            {/* --- OVERLAY PANELS --- */}
            {showTeamUpOptions && (
                <TeamUpMatchPanel
                    key="teamup"
                    onClose={() => {
                        leaveGame();
                        setShowTeamUpOptions(false);
                    }}
                    onJoin={(code: string) => joinGame(code)}
                    onHost={() => hostQuickLobby(matchType, gameMode, wager)}
                    currentRoomId={roomId}
                    isHost={isHost}
                    isLobbyConnected={isLobbyConnected}
                    lobbyState={lobbyState}
                    onStartMatch={() => {
                        setShowTeamUpOptions(false);
                        onStartGame();
                    }}
                    onSwapPlayers={swapPlayers}
                    onKickPlayer={kickPlayer}
                    onSendInvite={sendInvite}
                    onQuickMatch={handleFillWithQuickMatch}
                    matchType={matchType}
                    gameMode={gameMode}
                    entryFee={wager}
                />
            )}

            {showOfflineOptions && (
                <OfflineMatchPanel
                    key="offline"
                    gameMode={gameMode}
                    matchType={matchType}
                    onClose={() => setShowOfflineOptions(false)}
                    onStartOfflineGame={(difficulty) => {
                        setShowOfflineOptions(false);
                        onStartGame(true, difficulty);
                    }}
                />
            )}

            {(isQuickMatchActive || lobbyState?.status === 'quickmatch' || hybridParams) && (
                <QuickMatchPanel
                    key={`quickmatch-${searchId}`}
                    gameMode={gameMode}
                    matchType={hybridParams?.matchType ?? matchType}
                    wager={wager}
                    onStartGame={onStartGame}
                    onCancel={handleCancelQuickMatch}
                    isHybrid={!!hybridParams || lobbyState?.status === 'quickmatch'}
                    roomCode={hybridParams?.roomCode ?? roomId}
                    slotsNeeded={hybridParams?.slotsNeeded ?? lobbyState?.slots.filter(s => s.status === 'empty').length}
                />
            )}
        </div>
    );
}
