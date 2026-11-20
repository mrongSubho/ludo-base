"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { FiSearch, FiCheck } from 'react-icons/fi';
import { supabase } from '@/lib/supabase';
import { GamePanelShell } from './GamePanelShell';
import { Button } from './Button';

interface PooledSearch {
    player_id: string;
    game_mode: string;
    wager: number;
    status: string;
    created_at: string;
}

export const LiveMatchmakingFeed = () => {
    const [isExpanded, setIsExpanded] = useState(false);
    const [pooledSearches, setPooledSearches] = useState<PooledSearch[]>([]);

    useEffect(() => {
        const fetchRecentSearches = async () => {
            const { data } = await supabase
                .from('matchmaking_queue')
                .select('player_id, game_mode, wager, status, created_at')
                .eq('status', 'searching')
                .order('created_at', { ascending: false })
                .limit(10);

            if (data) setPooledSearches(data as PooledSearch[]);
        };

        void fetchRecentSearches();

        const channel = supabase
            .channel('public:matchmaking_queue')
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'matchmaking_queue',
            }, (payload) => {
                if (payload.eventType === 'INSERT') {
                    setPooledSearches(prev => [payload.new as PooledSearch, ...prev].slice(0, 10));
                } else if (payload.eventType === 'UPDATE') {
                    setPooledSearches(prev => prev.map(s =>
                        s.player_id === (payload.new as PooledSearch).player_id ? (payload.new as PooledSearch) : s,
                    ));
                }
            })
            .subscribe();

        return () => {
            void supabase.removeChannel(channel);
        };
    }, []);

    const handleJoinMatch = useCallback((search: PooledSearch) => {
        console.log("Initiating join for:", search);
        setIsExpanded(false);
    }, []);

    const formatTime = (dateStr: string) => {
        const date = new Date(dateStr);
        const now = new Date();
        const diff = Math.floor((now.getTime() - date.getTime()) / 1000);

        if (diff < 60) return `${diff}s ago`;
        if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
        return `${Math.floor(diff / 3600)}h ago`;
    };

    return (
        <>
            <div className="fixed bottom-[110px] left-0 right-0 flex justify-center pointer-events-none z-50 px-4">
                <div
                    className="pointer-events-auto h-[72px] w-full max-w-[480px] rounded-full flex items-center justify-between px-6 relative overflow-hidden transition-all group glass-panel bg-surface-panel border border-line-soft cursor-pointer hover:border-accent/50 hover:scale-[1.02] active:scale-[0.98]"
                    onClick={() => setIsExpanded(true)}
                >
                    <div className="flex items-center gap-6 relative z-10">
                        <div className="w-11 h-11 rounded-full border border-line-soft bg-surface-recessed flex items-center justify-center overflow-hidden shadow-lg">
                            <FiSearch className="w-5 h-5 text-accent" />
                        </div>
                        <div className="flex flex-col">
                            <span className="text-ludo-xs font-extrabold text-ink-faint uppercase tracking-[0.2em] italic">Network Grid</span>
                            <div className="flex items-center gap-3">
                                <div className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_8px_rgba(0,229,255,0.8)] animate-pulse" />
                                <span className="text-xs font-extrabold text-accent italic uppercase tracking-wider">Establishing Active Links...</span>
                            </div>
                        </div>
                    </div>

                    <div className="flex-1 max-w-[280px] overflow-hidden ml-8 relative">
                        <div className="animate-marquee whitespace-nowrap flex gap-12">
                            {pooledSearches.length > 0 ? (
                                pooledSearches.map((s, i) => (
                                    <span key={i} className="text-ludo-sm font-extrabold text-ink-strong uppercase tracking-tighter italic flex items-center gap-2">
                                        <span className="text-accent opacity-70">LINK:</span>
                                        {s.game_mode.toUpperCase()} x {s.wager.toLocaleString()}
                                        <span className="text-ink-faint font-medium ml-2">{formatTime(s.created_at)}</span>
                                    </span>
                                ))
                            ) : (
                                <span className="text-ludo-sm font-extrabold text-ink-faint uppercase tracking-[0.4em] italic">Scanning Grid Signals...</span>
                            )}
                        </div>
                    </div>

                    <div className="flex items-center gap-4 relative z-10">
                        <div className="h-8 w-px bg-line-soft" />
                        <div className="flex flex-col items-end">
                            <span className="text-ludo-xs font-extrabold text-ink-faint uppercase">Node</span>
                            <span className="text-ludo-xs font-extrabold text-accent italic uppercase">Broadcast</span>
                        </div>
                    </div>
                </div>
            </div>

            {isExpanded && (
                <GamePanelShell
                    scopeClass="ludo-arena-scope"
                    kicker="// NETWORK GRID"
                    title="Match Browser"
                    subtitle={(
                        <span className="inline-flex items-center gap-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-positive animate-pulse" />
                            <span className="text-ludo-xs font-extrabold text-positive tracking-[0.2em] uppercase">Live_Node: Active</span>
                        </span>
                    )}
                    onClose={() => setIsExpanded(false)}
                    hideOrbs
                >
                    <div className="flex-1 min-h-0 overflow-y-auto px-5 pt-3 pb-4 no-scrollbar relative z-10">
                        {pooledSearches.length > 0 ? pooledSearches.map((s, i) => (
                            <div key={i} className="group relative mb-3 transition-all duration-200">
                                <div className="relative p-4 rounded-2xl border border-line-soft bg-surface-panel hover:border-accent/45 flex items-center justify-between gap-3">
                                    <div className="flex items-center gap-3.5 min-w-0">
                                        <div className="w-11 h-11 rounded-xl border border-line-soft bg-surface-recessed flex items-center justify-center text-accent shrink-0">
                                            {s.status === 'matched' ? <FiCheck className="w-5 h-5 text-positive" /> : <FiSearch className="w-5 h-5" />}
                                        </div>
                                        <div className="min-w-0">
                                            <span className="block text-sm font-extrabold italic text-ink-strong uppercase tracking-tight truncate">
                                                {s.game_mode} {s.game_mode.includes('v') ? '' : 'Power'}
                                            </span>
                                            <div className="flex items-center gap-3 mt-0.5">
                                                <span className="text-ludo-xs font-extrabold text-accent uppercase">
                                                    Wager: <span className="text-ink-strong">{s.wager.toLocaleString()}</span>
                                                </span>
                                                <span className="text-ludo-xs font-medium text-ink-faint uppercase">{formatTime(s.created_at)}</span>
                                            </div>
                                        </div>
                                    </div>

                                    {s.status !== 'matched' && (
                                        <Button
                                            variant="primary"
                                            size="sm"
                                            onClick={(e) => { e.stopPropagation(); handleJoinMatch(s); }}
                                            className="uppercase tracking-tight shrink-0"
                                        >
                                            Join Match
                                        </Button>
                                    )}
                                </div>
                            </div>
                        )) : (
                            <div className="h-full flex flex-col items-center justify-center text-ink-faint py-20">
                                <p className="text-ludo-xs font-extrabold uppercase tracking-[0.4em]">Establishing Link...</p>
                            </div>
                        )}
                    </div>

                    <div className="w-full px-5 py-3 border-t border-line-soft text-center relative z-10 shrink-0">
                        <span className="text-ludo-xs font-medium text-ink-faint uppercase tracking-[0.3em]">
                            Encrypted Real-time Feed | v1.0.4
                        </span>
                    </div>
                </GamePanelShell>
            )}
        </>
    );
};
