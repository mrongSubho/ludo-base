"use client";

import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { motion, AnimatePresence } from 'framer-motion';

interface Activity {
    id: string;
    actor_id: string;
    type: 'win' | 'join_tournament' | 'level_up' | 'big_bet' | 'trophy';
    metadata: any;
    created_at: string;
    actor?: {
        username: string;
        avatar_url: string;
    };
}

export const ActivityFeed = () => {
    const [activities, setActivities] = useState<Activity[]>([]);

    useEffect(() => {
        const fetchInitial = async () => {
            const { data } = await (supabase.from('activities') as any)
                .select('*, actor:players(username, avatar_url)')
                .order('created_at', { ascending: false })
                .limit(20);
            if (data) setActivities(data as any);
        };

        fetchInitial();

        const channel = supabase
            .channel('public_activities')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'activities' }, async (payload) => {
                const { data } = await supabase
                    .from('players')
                    .select('username, avatar_url')
                    .eq('wallet_address', payload.new.actor_id)
                    .single();
                
                const newActivity = { ...payload.new, actor: data } as Activity;
                setActivities(prev => [newActivity, ...prev].slice(0, 20));
            })
            .subscribe();

        return () => { supabase.removeChannel(channel); };
    }, []);

    const getActivityText = (activity: Activity) => {
        switch (activity.type) {
            case 'join_tournament': return `joined the ${activity.metadata.tournament_title || 'Arena'} tournament`;
            case 'win': return `won ${activity.metadata.amount} coins in #${activity.metadata.room_code}`;
            case 'level_up': return `reached Level ${activity.metadata.level}!`;
            case 'big_bet': return `placed a ${activity.metadata.amount} bet on #${activity.metadata.room_code}`;
            case 'trophy': return `earned the "${activity.metadata.trophy_name}" trophy!`;
            default: return 'is active in the Arena';
        }
    };

    return (
        <div className="w-full flex flex-col gap-3">
            <div className="flex items-center gap-2 mb-2">
                <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-white/40">Broadcasting Now</h3>
            </div>
            
            <div className="space-y-2 overflow-hidden">
                <AnimatePresence mode="popLayout">
                    {activities.map((activity) => (
                        <motion.div
                            key={activity.id}
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className="flex items-center gap-3 p-3 bg-white/5 border border-white/10 rounded-2xl backdrop-blur-md"
                        >
                            <div className="w-8 h-8 rounded-full border border-white/20 overflow-hidden bg-white/10 shrink-0">
                                <img 
                                    src={activity.actor?.avatar_url || `https://avatar.vercel.sh/${activity.actor_id}`} 
                                    alt="avatar" 
                                    className="w-full h-full object-cover"
                                />
                            </div>
                            <div className="flex flex-col min-w-0">
                                <span className="text-[13px] text-white/90 truncate font-semibold">
                                    <span className="text-cyan-400 font-black">
                                        {activity.actor?.username || activity.actor_id.slice(0, 6)}
                                    </span>
                                    {' '}{getActivityText(activity)}
                                </span>
                                <span className="text-[9px] text-white/30 font-bold uppercase tracking-widest mt-0.5">
                                    {new Date(activity.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                            </div>
                        </motion.div>
                    ))}
                </AnimatePresence>
                
                {activities.length === 0 && (
                    <div className="py-8 text-center border-2 border-dashed border-white/5 rounded-3xl">
                        <span className="text-[10px] font-black text-white/20 uppercase tracking-[0.3em]">No Broadcasts Detected</span>
                    </div>
                )}
            </div>
        </div>
    );
};
