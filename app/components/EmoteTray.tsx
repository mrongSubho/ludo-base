"use client";

import React, { useEffect, useState } from 'react';
import type { PlayerColor } from '@/lib/types';
import {
    PRESET_EMOTES,
    createEmoteEvent,
    emoteById,
    isEmoteId,
    EMOTE_TTL_MS,
    type EmoteEvent,
    type EmoteId,
} from '@/lib/emotes';

interface EmoteTrayProps {
    myColor: PlayerColor;
    onEmote: (event: EmoteEvent) => void;
    /** Live floats keyed by color (local + remote). */
    floats: EmoteEvent[];
    disabled?: boolean;
}

/**
 * G5 — preset emote tray + floating phrases over seats.
 * No voice. No free-text (keeps moderation trivial).
 */
export function EmoteTray({ myColor, onEmote, floats, disabled }: EmoteTrayProps) {
    const [open, setOpen] = useState(false);

    return (
        <div className="relative">
            {floats.map((f) => (
                <EmoteFloat key={`${f.color}-${f.t}`} event={f} />
            ))}
            <button
                type="button"
                className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-white/75"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                aria-label="Emotes"
                disabled={disabled}
            >
                Emotes
            </button>
            {open && (
                <div className="absolute bottom-full right-0 mb-2 z-40 w-48 rounded-2xl border border-white/10 bg-black/85 p-2 backdrop-blur-md shadow-xl">
                    <div className="grid grid-cols-2 gap-1">
                        {PRESET_EMOTES.map((e) => (
                            <button
                                key={e.id}
                                type="button"
                                className="rounded-lg border border-white/10 bg-white/5 px-2 py-2 text-[10px] font-bold text-white/85 hover:bg-white/10 active:scale-95"
                                onClick={() => {
                                    onEmote(createEmoteEvent(e.id, myColor));
                                    setOpen(false);
                                }}
                            >
                                {e.text}
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

function EmoteFloat({ event }: { event: EmoteEvent }) {
    const def = emoteById(event.emoteId);
    const [alive, setAlive] = useState(true);
    useEffect(() => {
        const t = setTimeout(() => setAlive(false), EMOTE_TTL_MS);
        return () => clearTimeout(t);
    }, [event.t]);
    if (!alive || !def) return null;
    return (
        <div
            className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 whitespace-nowrap rounded-full border border-white/15 bg-black/80 px-3 py-1 text-[11px] font-bold text-white/90 shadow-lg"
            data-emote={event.emoteId}
            data-color={event.color}
            role="status"
        >
            {def.text}
        </div>
    );
}

/** Parse an inbound emote wire payload. */
export function parseEmotePayload(payload: unknown): EmoteEvent | null {
    if (!payload || typeof payload !== 'object') return null;
    const p = payload as Partial<EmoteEvent> & { emoteId?: unknown };
    if (!isEmoteId(p.emoteId)) return null;
    if (typeof p.color !== 'string') return null;
    return {
        emoteId: p.emoteId as EmoteId,
        color: p.color,
        actor: typeof p.actor === 'string' ? p.actor : undefined,
        t: typeof p.t === 'number' ? p.t : Date.now(),
    };
}

export default EmoteTray;
