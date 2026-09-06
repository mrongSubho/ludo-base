'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useCurrentUser } from '@/hooks/useCurrentUser';

// ─── Shared notifications inbox (single source of truth) ────────────────────
// Actionable social items: incoming friend requests + incoming pokes.
// Badge = UNSEEN only. Clicking/acting marks seen (persisted per wallet);
// accept/decline/poke-back remove the row. DM unread lives in GameData;
// celebrations are read-only (never badged).

export interface InboxRequest {
    id: string;
    wallet_address: string;
    name: string;
    avatar: string | null;
    time: string;
}

export interface InboxPoke {
    id: string;
    sender_id: string;
    name: string;
    avatar: string | null;
    time: string;
}

interface SeenState {
    r: string[];
    p: string[];
}

const timeAgo = (iso: string | null) => {
    if (!iso) return 'Just now';
    const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
};

const displayNameOf = (username: string | null | undefined, wallet: string) =>
    (username && !username.startsWith('0x')) ? username : `User ${wallet.slice(-4).toUpperCase()}`;

const seenKey = (me: string) => `notif_seen_${me}`;

function readSeen(me: string): SeenState {
    try {
        const raw = localStorage.getItem(seenKey(me));
        if (!raw) return { r: [], p: [] };
        const parsed = JSON.parse(raw);
        return {
            r: Array.isArray(parsed.r) ? parsed.r.slice(-100) : [],
            p: Array.isArray(parsed.p) ? parsed.p.slice(-100) : [],
        };
    } catch {
        return { r: [], p: [] };
    }
}

export function useNotifications() {
    const { address } = useCurrentUser();
    const me = (address || '').toLowerCase();

    const [requests, setRequests] = useState<InboxRequest[]>([]);
    const [pokes, setPokes] = useState<InboxPoke[]>([]);
    const [seen, setSeen] = useState<SeenState>({ r: [], p: [] });

    useEffect(() => {
        if (me) setSeen(readSeen(me));
        else setSeen({ r: [], p: [] });
    }, [me]);

    const persistSeen = useCallback((next: SeenState) => {
        if (!me) return;
        setSeen(next);
        try {
            localStorage.setItem(seenKey(me), JSON.stringify(next));
        } catch {
            /* workers/private mode */
        }
    }, [me]);

    const fetchAll = useCallback(async () => {
        if (!me) {
            setRequests([]);
            setPokes([]);
            return;
        }
        try {
            const { data: reqData } = await supabase
                .from('friendships')
                .select('id,friend_address,created_at,requester:players!friendships_user_address_fkey(wallet_address,username,avatar_url)')
                .eq('status', 'pending')
                .eq('friend_address', me)
                .order('created_at', { ascending: false })
                .limit(20);
            setRequests(((reqData || []) as any[]).flatMap((r: any) => {
                const p = r.requester;
                if (!p?.wallet_address) return [];
                return [{
                    id: r.id,
                    wallet_address: p.wallet_address,
                    name: displayNameOf(p.username, p.wallet_address),
                    avatar: p.avatar_url || null,
                    time: timeAgo(r.created_at),
                }];
            }));
        } catch (err) {
            console.error('Notifications requests error:', err);
        }
        try {
            const res = await fetch(`/api/social/poke?wallet=${me}`);
            if (res.ok) {
                const data = await res.json();
                setPokes((Array.isArray(data) ? data : []).slice(0, 20).map((p: any) => ({
                    id: p.id,
                    sender_id: p.sender_id,
                    name: displayNameOf(p.players?.username, p.sender_id),
                    avatar: p.players?.avatar_url || null,
                    time: timeAgo(p.created_at),
                })));
            }
        } catch (err) {
            console.error('Notifications pokes error:', err);
        }
    }, [me]);

    useEffect(() => {
        fetchAll();
        if (!me) return;
        const channel = supabase
            .channel('notif-inbox-sync')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships' }, (payload: any) => {
                const row = payload.new || payload.old;
                if (!row) return;
                const involved = [row.user_address, row.friend_address]
                    .filter(Boolean)
                    .some((a: string) => a.toLowerCase() === me);
                if (involved) fetchAll();
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'pokes', filter: `receiver_id=eq.${me}` }, () => {
                fetchAll();
            })
            .subscribe();
        const timer = setInterval(fetchAll, 20000);
        return () => {
            supabase.removeChannel(channel);
            clearInterval(timer);
        };
    }, [me, fetchAll]);

    const markSeenRequest = useCallback((id: string) => {
        persistSeen({ ...readSeen(me), r: [...readSeen(me).r, id] });
    }, [me, persistSeen]);

    const markSeenPoke = useCallback((senderId: string) => {
        const cur = readSeen(me);
        if (cur.p.includes(senderId.toLowerCase())) return;
        persistSeen({ ...cur, p: [...cur.p, senderId.toLowerCase()] });
    }, [me, persistSeen]);

    const acceptRequest = useCallback(async (id: string) => {
        const { error } = await supabase.from('friendships').update({ status: 'accepted' }).eq('id', id);
        if (!error) {
            setRequests(prev => prev.filter(r => r.id !== id));
            markSeenRequest(id);
        }
        return !error;
    }, [markSeenRequest]);

    const declineRequest = useCallback(async (id: string) => {
        const { error } = await supabase.from('friendships').delete().eq('id', id);
        if (!error) {
            setRequests(prev => prev.filter(r => r.id !== id));
            markSeenRequest(id);
        }
        return !error;
    }, [markSeenRequest]);

    const pokeBack = useCallback(async (friendId: string) => {
        if (!me) return false;
        try {
            const res = await fetch('/api/social/poke', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sender: me, receiver: friendId.toLowerCase() })
            });
            if (res.ok) {
                setPokes(prev => prev.filter(p => p.sender_id.toLowerCase() !== friendId.toLowerCase()));
                markSeenPoke(friendId);
                window.dispatchEvent(new CustomEvent('mission-update'));
                return true;
            }
            return false;
        } catch (err) {
            console.error('Poke back error:', err);
            return false;
        }
    }, [me, markSeenPoke]);

    const notifCount =
        requests.filter(r => !seen.r.includes(r.id)).length +
        pokes.filter(p => !seen.p.includes(p.sender_id.toLowerCase())).length;

    return {
        requests,
        pokes,
        notifCount,
        markSeenRequest,
        markSeenPoke,
        acceptRequest,
        declineRequest,
        pokeBack,
        refresh: fetchAll,
    };
}
