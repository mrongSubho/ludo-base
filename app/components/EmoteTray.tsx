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

/** Custom winking-face mark (SVG — not emoji). */
function WinkFaceIcon() {
    return (
        <svg viewBox="0 0 64 64" className="emote-fab-icon" aria-hidden="true">
            <defs>
                <radialGradient id="ef-face" cx="38%" cy="32%" r="72%">
                    <stop offset="0%" stopColor="#FFF7D6" />
                    <stop offset="55%" stopColor="#FFD98A" />
                    <stop offset="100%" stopColor="#F5B94A" />
                </radialGradient>
                <radialGradient id="ef-gloss" cx="32%" cy="28%" r="55%">
                    <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.55" />
                    <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
                </radialGradient>
            </defs>
            <circle cx="32" cy="32" r="29" fill="#FFFFFF" opacity="0.12" />
            <circle cx="32" cy="33" r="24" fill="url(#ef-face)" stroke="#E8A82E" strokeWidth="1.6" />
            <ellipse cx="30" cy="28" rx="14" ry="11" fill="url(#ef-gloss)" />
            <ellipse cx="18.5" cy="36.5" rx="5" ry="3.2" fill="#F97A7A" opacity="0.45" />
            <ellipse cx="45.5" cy="36.5" rx="5" ry="3.2" fill="#F97A7A" opacity="0.45" />
            <ellipse cx="23.5" cy="30.5" rx="3.2" ry="4.2" fill="#2A1B0A" />
            <circle cx="22.3" cy="29.1" r="1.15" fill="#FFFFFF" />
            <circle cx="24.6" cy="31.8" r="0.55" fill="#FFFFFF" opacity="0.75" />
            <path
                d="M37 31.2 C38.8 33.1 42.4 33.4 44.4 31.4"
                stroke="#2A1B0A"
                strokeWidth="2.4"
                strokeLinecap="round"
                fill="none"
            />
            <path
                d="M44.2 29.6 L46.4 28 M45.8 32.4 L48.2 32.6"
                stroke="#2A1B0A"
                strokeWidth="1.5"
                strokeLinecap="round"
                opacity="0.85"
            />
            <path
                d="M18.2 24.2 C20.4 22.6 23.4 22.4 25.4 23.6"
                stroke="#C9891A"
                strokeWidth="1.7"
                strokeLinecap="round"
                fill="none"
            />
            <path
                d="M38.2 23.2 C40.4 21.8 43.6 22 45.6 23.6"
                stroke="#C9891A"
                strokeWidth="1.7"
                strokeLinecap="round"
                fill="none"
            />
            <path
                d="M22 39.2 C25.2 44.4 30.2 46.8 34.4 46.4 C38 46 41 43.8 42.8 40.6 C39 43.2 34.6 43.8 31 42.4 C28.2 41.3 25.8 39.6 22 39.2 Z"
                fill="#7A2E12"
            />
            <path
                d="M25.2 43.8 C27.6 46 31 46.6 33.4 45.6 C34.8 45 35.8 44 36.4 42.8 C33.2 44 29.4 43.6 25.2 43.8 Z"
                fill="#F06292"
            />
            <path
                d="M22 39.2 C25.2 44.4 30.2 46.8 34.4 46.4 C38 46 41 43.8 42.8 40.6"
                stroke="#2A1B0A"
                strokeWidth="2"
                strokeLinecap="round"
                fill="none"
            />
            <path d="M10 14 L11.1 16.4 L13.5 17.5 L11.1 18.6 L10 21 L8.9 18.6 L6.5 17.5 L8.9 16.4 Z" fill="#FFFFFF" />
            <path d="M52 48 L52.9 49.9 L54.8 50.8 L52.9 51.7 L52 53.6 L51.1 51.7 L49.2 50.8 L51.1 49.9 Z" fill="#7DD3FC" />
            <circle cx="53.5" cy="14.5" r="1.6" fill="#FFFFFF" opacity="0.9" />
            <circle cx="11.5" cy="50.5" r="1.1" fill="#FFFFFF" opacity="0.7" />
        </svg>
    );
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
                <WinkFaceIcon />
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
    const p = payload as Record<string, unknown>;
    if (!isEmoteId(p.emoteId)) return null;
    if (typeof p.color !== 'string') return null;
    if (typeof p.t !== 'number') return null;
    return {
        emoteId: p.emoteId as EmoteId,
        color: p.color as PlayerColor,
        actor: typeof p.actor === 'string' ? p.actor : undefined,
        t: p.t,
    };
}
