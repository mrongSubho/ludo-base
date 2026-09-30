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

/** Custom winking-face mark (SVG — not emoji). Face is the button. */
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
            {/* full-bleed face — no tiny icon chip */}
            <circle cx="32" cy="32" r="30" fill="url(#ef-face)" stroke="#E8A82E" strokeWidth="1.8" />
            <ellipse cx="30" cy="27" rx="16" ry="12" fill="url(#ef-gloss)" />
            <ellipse cx="16.5" cy="36" rx="5.5" ry="3.4" fill="#F97A7A" opacity="0.5" />
            <ellipse cx="47.5" cy="36" rx="5.5" ry="3.4" fill="#F97A7A" opacity="0.5" />
            <ellipse cx="23" cy="30" rx="3.6" ry="4.8" fill="#2A1B0A" />
            <circle cx="21.6" cy="28.3" r="1.35" fill="#FFFFFF" />
            <circle cx="24.2" cy="31.6" r="0.65" fill="#FFFFFF" opacity="0.8" />
            <path
                d="M36.5 31 C38.5 33.2 42.5 33.5 44.8 31.2"
                stroke="#2A1B0A"
                strokeWidth="2.8"
                strokeLinecap="round"
                fill="none"
            />
            <path
                d="M43.8 29 L46.5 27.2 M45.5 32.8 L48.4 33"
                stroke="#2A1B0A"
                strokeWidth="1.8"
                strokeLinecap="round"
                opacity="0.9"
            />
            <path
                d="M17 23.2 C19.5 21.4 23 21.2 25.2 22.6"
                stroke="#C9891A"
                strokeWidth="2"
                strokeLinecap="round"
                fill="none"
            />
            <path
                d="M38 22.2 C40.5 20.6 44 20.8 46.2 22.6"
                stroke="#C9891A"
                strokeWidth="2"
                strokeLinecap="round"
                fill="none"
            />
            <path
                d="M20 39 C23.5 45 29 47.8 33.8 47.3 C38 46.8 41.4 44.2 43.4 40.5 C39.2 43.5 34.2 44.2 30.2 42.6 C27 41.3 24.2 39.4 20 39 Z"
                fill="#7A2E12"
            />
            <path
                d="M23.5 44.2 C26.2 46.8 30 47.5 32.8 46.3 C34.4 45.6 35.5 44.5 36.2 43.2 C32.6 44.5 28.2 44.1 23.5 44.2 Z"
                fill="#F06292"
            />
            <path
                d="M20 39 C23.5 45 29 47.8 33.8 47.3 C38 46.8 41.4 44.2 43.4 40.5"
                stroke="#2A1B0A"
                strokeWidth="2.2"
                strokeLinecap="round"
                fill="none"
            />
            <path d="M8 11 L9.3 13.8 L12.1 15.1 L9.3 16.4 L8 19.2 L6.7 16.4 L3.9 15.1 L6.7 13.8 Z" fill="#FFFFFF" />
            <path d="M55 47 L56 49.1 L58.1 50.1 L56 51.1 L55 53.2 L54 51.1 L51.9 50.1 L54 49.1 Z" fill="#7DD3FC" />
            <circle cx="55" cy="11" r="1.8" fill="#FFFFFF" opacity="0.95" />
            <circle cx="10" cy="52" r="1.3" fill="#FFFFFF" opacity="0.75" />
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
