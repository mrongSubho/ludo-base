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
    disabled?: boolean;
}

/**
 * G5 — preset emote tray + floating phrases over seats.
 * No voice. No free-text (keeps moderation trivial).
 */
export function EmoteTray({ myColor, onEmote, disabled }: EmoteTrayProps) {
    const [open, setOpen] = useState(false);

    return (
        <div className="relative">
            <button
                type="button"
                className={`match-foot-pill ${open ? 'on' : ''}`}
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                aria-label="Emotes"
                disabled={disabled}
            >
                Emotes
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

export function EmoteFloat({ event }: { event: EmoteEvent }) {
    const def = emoteById(event.emoteId);
    const [alive, setAlive] = useState(true);
    useEffect(() => {
        const t = setTimeout(() => setAlive(false), EMOTE_TTL_MS);
        return () => clearTimeout(t);
    }, [event.t]);
    if (!alive || !def) return null;
    return (
        <div
            className={`emote-float emote-float-${event.emoteId}`}
            data-emote={event.emoteId}
            data-color={event.color}
            aria-label={def.text}
            role="status"
        >
            <span className="emote-float-glyph" aria-hidden="true">{getEmoteGlyph(event.emoteId)}</span>
            <span className="emote-float-label">{def.text}</span>
        </div>
    );
}

function getEmoteGlyph(id: EmoteId): string {
    switch (id) {
        case 'gl': return '✦';
        case 'nice': return '★';
        case 'oops': return '!';
        case 'think': return '…';
        case 'wow': return '⚡';
        case 'phew': return '♡';
        case 'thanks': return '✓';
        case 'brb': return '◌';
    }
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
