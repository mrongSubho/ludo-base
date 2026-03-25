"use client";

import React, { useState, useCallback, useEffect } from 'react';
import { useTeamUpContext } from '@/hooks/TeamUpContext';
import { ActionDice } from './ActionDice';
import { TeamUpMatchPanel } from './TeamUpMatchPanel';
import { OfflineMatchPanel } from './OfflineMatchPanel';
import { QuickMatchPanel } from './QuickMatchPanel';
import { useSoundEffects } from '../hooks/useSoundEffects';
import { LiveArenaDirectory } from './LiveArenaDirectory';
import { ActivityFeed } from './ActivityFeed';
import { LuMinus, LuPlus, LuTrophy, LuTimer, LuUsers } from 'react-icons/lu';
import { supabase } from '@/lib/supabase';
import { useAccount } from 'wagmi';

interface GameLobbyProps {
    gameMode: 'classic' | 'power';
    setGameMode: (mode: 'classic' | 'power') => void;
    matchType: '1v1' | '2v2' | '4P';
    setMatchType: (type: '1v1' | '2v2' | '4P') => void;
    wager: number;
    setWager: (wager: number) => void;
    onStartGame: (isBotMatch?: boolean) => void;
    onWatchMatch?: (roomCode: string) => void;
}

export default function GameLobby({
    gameMode,
    setGameMode,
    matchType,
    setMatchType,
    wager,
    setWager,
    onStartGame,
    onWatchMatch,
}: GameLobbyProps) {
    const {
        roomId,
        isLobbyConnected,
        isHost,
        hostGame,
        joinGame,
        lobbyState,
        sendInvite,
        swapPlayers,
        kickPlayer,
        onQuickMatch: startQuickMatch,
        leaveGame
    } = useTeamUpContext();
    const { address } = useAccount();

    // Configuration State
    const { playSelect, playCoin } = useSoundEffects();
    const [showTeamUpOptions, setShowTeamUpOptions] = useState(false);
    const [showOfflineOptions, setShowOfflineOptions] = useState(false);
    const [isQuickMatchActive, setIsQuickMatchActive] = useState(false);
    const [searchId, setSearchId] = useState(0);
    const [tournaments, setTournaments] = useState<any[]>([]);

    // Fetch Upcoming Tournaments
    useEffect(() => {
        const fetchTournaments = async () => {
            const { data } = await (supabase.from('tournaments') as any)
                .select('*')
                .eq('status', 'upcoming')
                .order('start_at', { ascending: true })
                .limit(3);
            if (data) setTournaments(data);
        };
        fetchTournaments();

        const channel = (supabase.channel('tournaments_sync') as any)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'tournaments' }, () => fetchTournaments())
            .subscribe();
        
        return () => { supabase.removeChannel(channel); };
    }, []);

    const handleJoinTournament = useCallback(async (tournamentId: string, entryFee: number) => {
        if (!address) return;
        
        const { data, error } = await (supabase.rpc as any)('join_tournament', {
            p_tournament_id: tournamentId,
            p_player_id: address
        });

        if (error) {
            console.error('Failed to join tournament:', error);
            alert('Failed to join: ' + error.message);
            return;
        }

        const res = data as any;
        if (res.success) {
            alert('Enrolled Successfully!');
            // Log activity
            (supabase.from('activities') as any).insert({
                actor_id: address,
                type: 'join_tournament',
                metadata: { tournament_id: tournamentId }
            }).then();
        } else {
            alert(res.error || 'Failed to join tournament');
        }
    }, [address]);

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
        setSearchId(prev => prev + 1);
        setIsQuickMatchActive(true);
    };

    const handleCancelQuickMatch = useCallback(() => setIsQuickMatchActive(false), []);

    return (
        <div className="relative w-full max-w-4xl mx-auto px-4 py-8 min-h-[600px] flex flex-col items-center justify-center">
            {/* 1. INITIAL SETUP PANEL */}
            {(!isQuickMatchActive && lobbyState?.status !== 'quickmatch') && (
                <div
                    key="setup"
                    className="w-full max-w-[420px] mx-auto flex flex-col gap-6" 
                >
                    {/* 1. SELECTION GROUP */}
                    <div className="w-full space-y-6 flex flex-col">
                        {/* Mode Section */}
                        <div className="flex flex-col items-center w-full">
                            <div className="flex justify-center w-full mb-4 mt-2">
                                <div className="inline-block px-6 py-2 bg-[rgba(0,0,0,0.35)] border border-white/10 rounded-full backdrop-blur-md">
                                    <h3 className="text-white/90 text-[11px] font-black uppercase tracking-[0.2em] text-center drop-shadow-md">Select Game Mode</h3>
                                </div>
                            </div>
                            <div className="flex justify-center gap-4">
                                {(['classic', 'power'] as const).map(mode => (
                                    <button
                                        key={mode}
                                        onClick={() => {
                                            playSelect();
                                            setGameMode(mode);
                                        }}
                                        className={`relative px-8 py-4 rounded-full border transition-all duration-200 ease-out glass-panel flex flex-col items-center justify-center min-w-[150px] hover:scale-[1.02] active:scale-95 ${gameMode === mode
                                            ? 'border-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.2)] bg-[rgba(0,0,0,0.5)]'
                                            : 'border-white/20 hover:border-white/40 bg-[rgba(0,0,0,0.5)]'
                                            }`}
                                    >
                                        <div className="relative z-10 text-center">
                                            <span className={`block text-xl font-black italic tracking-tighter capitalize drop-shadow-md ${gameMode === mode ? 'text-cyan-400' : 'text-white/90'}`}>{mode}</span>
                                            <div className={`mt-1 inline-block px-3 py-1 rounded-full border backdrop-blur-md ${gameMode === mode ? 'bg-[rgba(0,0,0,0.35)] border-cyan-500/30' : 'bg-[rgba(0,0,0,0.35)] border-white/10'}`}>
                                                <span className={`text-[10px] font-black uppercase tracking-[0.2em] ${gameMode === mode ? 'text-cyan-400' : 'text-white/50'}`}>{mode === 'classic' ? 'Original Rules' : 'Special Power-ups'}</span>
                                            </div>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Match Type Section */}
                        <div className="flex flex-col items-center w-full">
                            <div className="flex justify-center w-full mt-2 mb-4">
                                <div className="inline-block px-6 py-2 bg-[rgba(0,0,0,0.35)] border border-white/10 rounded-full backdrop-blur-md">
                                    <h3 className="text-white/90 text-[11px] font-black uppercase tracking-[0.2em] text-center drop-shadow-md">Match Type</h3>
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
                                        className={`w-14 h-14 rounded-full border transition-all duration-200 ease-out glass-panel flex items-center justify-center hover:scale-110 active:scale-90 ${matchType === type
                                            ? 'border-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.3)] bg-[rgba(0,0,0,0.5)]'
                                            : 'border-white/10 hover:border-white/30 bg-[rgba(0,0,0,0.5)]'
                                            }`}
                                    >
                                        <span className={`block text-xl font-black italic tracking-tighter drop-shadow-md ${matchType === type ? 'text-cyan-400' : 'text-white/60'}`}>{type}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* 2. ENTRY FEE PANEL */}
                    <div className="p-6 pb-8 rounded-[20px] glass-panel flex flex-col items-center shadow-2xl border-t border-white/20 border-x border-white/5 border-b border-black/20 shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)]">
                        <div className="inline-block px-8 py-2 bg-[rgba(0,0,0,0.35)] border border-white/10 rounded-full backdrop-blur-md mb-4">
                            <span className="text-white/90 text-[11px] font-black uppercase tracking-[0.2em] drop-shadow-md">Entry Fee</span>
                        </div>
                        <div className="flex items-center justify-between w-full px-2 mb-4">
                            <button onClick={() => { playCoin(); setWager(Math.max(0, wager - (wager >= 1000 ? 1000 : 100))); }} className="w-12 h-12 rounded-[16px] bg-[rgba(0,0,0,0.35)] border border-white/10 flex items-center justify-center text-white/80 hover:bg-white/10 hover:scale-105 active:scale-95 shadow-lg backdrop-blur-md transition-all duration-200">
                                <LuMinus className="w-6 h-6 stroke-[3px]" />
                            </button>
                            <div className="flex-1 flex flex-col items-center justify-center relative">
                                <input type="number" value={wager} onChange={(e) => setWager(Math.max(0, parseInt(e.target.value) || 0))} className="w-full bg-transparent text-center text-6xl font-black text-white drop-shadow-[0_0_15px_rgba(255,255,255,0.3)] focus:outline-none focus:ring-2 focus:ring-cyan-400/50 rounded-xl [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                            </div>
                            <button onClick={() => { playCoin(); setWager(wager + (wager >= 1000 ? 1000 : 100)); }} className="w-12 h-12 rounded-[16px] bg-[rgba(0,0,0,0.35)] border border-white/10 flex items-center justify-center text-white/80 hover:bg-white/10 hover:scale-105 active:scale-95 shadow-lg backdrop-blur-md transition-all duration-200">
                                <LuPlus className="w-6 h-6 stroke-[3px]" />
                            </button>
                        </div>
                        <div className="flex gap-2 justify-center flex-wrap">
                            {[0, 1000, 10000, 100000, 1000000].map(val => (
                                <button key={val} onClick={() => { playCoin(); setWager(val); }} className={`px-4 py-2 rounded-full border transition-all duration-200 hover:scale-105 active:scale-95 backdrop-blur-md shadow-sm text-[11px] font-black ${wager === val ? 'border-cyan-400 bg-[rgba(0,0,0,0.35)] text-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.3)]' : 'bg-[rgba(0,0,0,0.35)] hover:bg-white/15 border-white/10 text-white/90'}`}>
                                    {val === 0 ? 'Free' : val >= 1000000 ? `${val / 1000000} M` : val >= 1000 ? `${val / 1000} k` : val}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* 3. ACTION DICE - Now perfectly spaced below the entry fee */}
                    <div className="w-full flex justify-center pt-8 relative z-30">
                        <ActionDice 
                            onSelectQuickMatch={handleStartQuickMatch}
                            onSelectTeamUp={() => setShowTeamUpOptions(true)}
                            onSelectOfflineMatch={() => setShowOfflineOptions(true)}
                        />
                    </div>

                </div>
            )}

            {/* --- LIVE ARENA DIRECTORY (GambleFi) --- */}
            {(!isQuickMatchActive && lobbyState?.status !== 'quickmatch') && (
                <div className="w-full flex flex-col gap-12 mt-12 pb-24">
                    
                    {/* Upcoming Tournaments Section */}
                    {tournaments.length > 0 && (
                        <div className="w-full space-y-6">
                            <div className="flex items-center justify-between px-2">
                                <h3 className="text-white/90 text-[11px] font-black uppercase tracking-[0.2em] flex items-center gap-2">
                                    <LuTrophy className="text-yellow-500 w-4 h-4" />
                                    Tournament Arena
                                </h3>
                                <button className="text-[10px] font-bold text-cyan-400 uppercase tracking-widest hover:text-cyan-300 transition-colors">
                                    View All
                                </button>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                {tournaments.map((t) => (
                                    <div key={t.id} className="glass-panel p-5 rounded-[24px] border border-white/10 hover:border-cyan-500/30 transition-all group relative overflow-hidden">
                                        <div className="absolute top-0 right-0 p-3">
                                            <div className="bg-yellow-500/20 text-yellow-400 text-[9px] font-black px-2 py-1 rounded-full border border-yellow-500/30 flex items-center gap-1 shadow-sm">
                                                <LuTrophy className="w-2.5 h-2.5" />
                                                ${t.prize_pool}
                                            </div>
                                        </div>
                                        <div className="space-y-3 relative z-10">
                                            <h4 className="text-white font-bold text-lg leading-tight group-hover:text-cyan-400 transition-colors">{t.title}</h4>
                                            <div className="flex items-center gap-4 text-white/40 text-[10px] font-bold uppercase tracking-widest">
                                                <div className="flex items-center gap-1.5">
                                                    <LuTimer className="w-3.5 h-3.5 text-cyan-400" />
                                                    {new Date(t.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                </div>
                                                <div className="flex items-center gap-1.5">
                                                    <LuUsers className="w-3.5 h-3.5 text-cyan-400" />
                                                    {t.min_players}+ Players
                                                </div>
                                            </div>
                                            <button 
                                                onClick={() => handleJoinTournament(t.id, t.entry_fee)}
                                                className="w-full py-3 bg-[rgba(255,255,255,0.05)] hover:bg-cyan-500 text-white rounded-xl text-xs font-black uppercase tracking-[0.1em] transition-all border border-white/10 hover:border-cyan-400 shadow-sm mt-2"
                                            >
                                                Register Entry: ${t.entry_fee}
                                            </button>
                                        </div>
                                        {/* Subtle background glow */}
                                        <div className="absolute -bottom-10 -right-10 w-32 h-32 bg-cyan-500/10 rounded-full blur-3xl group-hover:bg-cyan-500/20 transition-all" />
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <ActivityFeed />
                    <LiveArenaDirectory onWatchMatch={onWatchMatch} />
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
                    onHost={() => hostGame()}
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
                    onQuickMatch={startQuickMatch}
                />
            )}

            {showOfflineOptions && (
                <OfflineMatchPanel
                    key="offline"
                    gameMode={gameMode}
                    matchType={matchType}
                    onClose={() => setShowOfflineOptions(false)}
                    onStartOfflineGame={() => {
                        setShowOfflineOptions(false);
                        onStartGame(true);
                    }}
                />
            )}

            {(isQuickMatchActive || lobbyState?.status === 'quickmatch') && (
                <QuickMatchPanel
                    key={`quickmatch-${searchId}`}
                    gameMode={gameMode}
                    matchType={matchType}
                    wager={wager}
                    onStartGame={onStartGame}
                    onCancel={handleCancelQuickMatch}
                    isHybrid={lobbyState?.status === 'quickmatch'}
                    roomCode={roomId}
                    slotsNeeded={lobbyState?.slots.filter(s => s.status === 'empty').length}
                />
            )}
        </div>
    );
}
