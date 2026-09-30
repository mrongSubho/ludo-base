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
                className="emote-fab"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                aria-label="Emotes"
                disabled={disabled}
            >
                {/* Sticker face + spark orbit — one mark, no label */}
                <svg viewBox="0 0 32 32" className="emote-fab-icon" aria-hidden>
                    <circle cx="16" cy="16" r="11" fill="rgba(255,255,255,0.16)" stroke="#fff" strokeWidth="1.6" />
                    <circle cx="12.2" cy="14" r="1.35" fill="#fff" />
                    <path d="M18.2 12.6c1.2 0 2.1 1 2.1 2.1" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" fill="none" />
                    <path d="M11.5 18.2c1.3 1.7 3 2.5 4.5 2.5s3.2-.8 4.5-2.5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" fill="none" />
                    <path d="M7.2 9.2l.7 1.5 1.5.7-1.5.7-.7 1.5-.7-1.5-1.5-.7 1.5-.7z" fill="#fbbf24" />
                    <path d="M24.5 20.8l.55 1.15 1.15.55-1.15.55-.55 1.15-.55-1.15-1.15-.55 1.15-.55z" fill="#7dd3fc" />
                    <circle cx="24.2" cy="9.4" r="1.1" fill="#fff" opacity=".9" />
                    <circle cx="8.2" cy="22.2" r="0.9" fill="#fff" opacity=".75" />
                </svg>
            </button>
            {open && (
                <div className="absolute bottom-full left-0 mb-2 z-40 w-48 rounded-2xl border border-white/10 bg-black/85 p-2 backdrop-blur-md shadow-xl">
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
