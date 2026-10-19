"use client";

/**
 * useConversationLive — the ephemeral half of a DM thread.
 *
 * Today the DM thread has no live transport at all: `useDataBoot` pulls
 * `/api/messages` once at boot and the thread only changes when the user acts
 * on it. (`useMessages` looks like the poller but nothing imports it — it is
 * dead code.) So this hook adds the first live DM signal in the app, and it is
 * deliberately split into two kinds of traffic:
 *
 * 1. PRESENCE — "this person is composing". Ephemeral, no DB write, and it
 *    clears itself when the socket drops. Same `channel.track()` mechanism as
 *    `useSpectatorPresence`, which is already proven in this codebase.
 * 2. BROADCAST — a content-free `message` nudge telling the other side to
 *    refetch. Without it, a "composing" orb would sit up to a boot-cycle ahead
 *    of the text it is announcing, which reads as broken rather than live.
 *
 * Channel topic is the sorted wallet pair, so both sides derive the same name
 * without knowing a conversation id. These channels are public (the app's
 * existing `game-room-*` and `spectators-*` channels are too — Supabase
 * private channels need RLS on `realtime.messages`, which the hosted project
 * cannot currently create). The payload is therefore content-free by design:
 * a boolean and a timestamp, never a message body.
 *
 * Reduced motion: this hook is transport only. The orb that renders it goes
 * through `ThinkingOrb`, which handles `prefers-reduced-motion` itself.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

/** How long a single "typing" assertion stays believable without renewal. */
const TYPING_TTL_MS = 4000;
/** Minimum gap between re-assertions while the user keeps typing. */
const TYPING_REFRESH_MS = 2000;

export interface ConversationLive {
    /** True while the peer is composing (expires on its own). */
    peerTyping: boolean;
    /** Call on every input change; throttled internally. */
    setTyping: (typing: boolean) => void;
    /** Tell the peer a message just landed, so they refetch immediately. */
    notifyMessage: () => void;
    /** Increments on every peer nudge — use as a refetch trigger. */
    nudge: number;
}

/**
 * Deterministic channel topic for a wallet pair.
 *
 * Sorted so both sides derive the same name without knowing a conversation
 * id, lowercased so checksum casing cannot split a pair, and `null` for a
 * self-pair (there is no self-DM to signal).
 */
export function dmTopic(selfWallet: string | null | undefined, peerWallet: string | null | undefined): string | null {
    if (!selfWallet || !peerWallet) return null;
    const a = selfWallet.toLowerCase();
    const b = peerWallet.toLowerCase();
    if (a === b) return null;
    const [lo, hi] = a < b ? [a, b] : [b, a];
    return `dm-${lo}_${hi}`;
}

export function useConversationLive(
    peerWallet: string | null | undefined,
    selfWallet: string | null | undefined,
): ConversationLive {
    const [peerTyping, setPeerTyping] = useState(false);
    const [nudge, setNudge] = useState(0);
    const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
    const lastTrackRef = useRef(0);

    const topic = useMemo(() => dmTopic(selfWallet, peerWallet), [peerWallet, selfWallet]);

    useEffect(() => {
        if (!topic || !selfWallet) return;
        const self = selfWallet.toLowerCase();

        const channel = supabase.channel(topic, {
            config: { presence: { key: self } },
        });
        channelRef.current = channel;

        const readPresence = () => {
            const state = channel.presenceState<{ typing?: boolean; until?: number }>();
            const now = Date.now();
            let typing = false;
            for (const [key, entries] of Object.entries(state)) {
                if (key === self) continue;
                for (const entry of entries as { typing?: boolean; until?: number }[]) {
                    if (entry?.typing && Number(entry.until) > now) {
                        typing = true;
                        break;
                    }
                }
                if (typing) break;
            }
            setPeerTyping(typing);
        };

        channel
            .on('presence', { event: 'sync' }, readPresence)
            .on('presence', { event: 'leave' }, readPresence)
            .on('broadcast', { event: 'message' }, () => setNudge((n) => n + 1))
            .subscribe(async (status) => {
                if (status !== 'SUBSCRIBED') return;
                // Announce a non-typing presence so the peer can distinguish
                // "left" from "never arrived".
                await channel.track({ typing: false, until: 0 });
                readPresence();
            });

        // Presence sync only fires on change; the TTL needs its own clock.
        const tick = window.setInterval(readPresence, 1000);

        return () => {
            window.clearInterval(tick);
            void channel.untrack().then(() => supabase.removeChannel(channel));
            if (channelRef.current === channel) channelRef.current = null;
            setPeerTyping(false);
        };
    }, [topic, selfWallet]);

    const setTyping = useCallback((typing: boolean) => {
        const channel = channelRef.current;
        if (!channel) return;
        const now = Date.now();
        if (typing && now - lastTrackRef.current < TYPING_REFRESH_MS) return;
        lastTrackRef.current = typing ? now : 0;
        void channel.track({ typing, until: typing ? now + TYPING_TTL_MS : 0 });
    }, []);

    const notifyMessage = useCallback(() => {
        void channelRef.current?.send({
            type: 'broadcast',
            event: 'message',
            payload: { at: Date.now() },
        });
    }, []);

    return { peerTyping, setTyping, notifyMessage, nudge };
}
