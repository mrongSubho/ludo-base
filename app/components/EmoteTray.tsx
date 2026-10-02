"use client";

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { PlayerColor } from '@/lib/types';
import {
    PRESET_EMOTES,
    EMOJI_EMOTES,
    createEmoteEvent,
    isEmoteId,
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
    const [tab, setTab] = useState<'text' | 'emoji'>('text');
    const [custom, setCustom] = useState(['', '']);

    return (
        <div className="emote-tray">
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
            <AnimatePresence>
                {open && (
                    <motion.div
                        className="emote-sheet board-sheet"
                        initial={{ opacity: 0, y: 14, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 8, scale: 0.98 }}
                        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                    >
                        <div className="emote-sheet-head">
                            <span className="chat-sheet-dot" />
                            <span className="chat-sheet-title">Quick reactions</span>
                            <button
                                type="button"
                                className="chat-sheet-x"
                                aria-label="Close emotes"
                                onClick={() => setOpen(false)}
                            >
                                ×
                            </button>
                        </div>
                        <div className="emote-tabs" role="tablist">
                            <button className={tab === 'text' ? 'active' : ''} onClick={() => setTab('text')} role="tab">Text</button>
                            <button className={tab === 'emoji' ? 'active' : ''} onClick={() => setTab('emoji')} role="tab">Emoji</button>
                        </div>
                        {tab === 'text' ? <div className="emote-sheet-grid">
                        {PRESET_EMOTES.map((e) => (
                            <button
                                key={e.id}
                                type="button"
                                className="emote-sheet-option"
                                onClick={() => {
                                    onEmote(createEmoteEvent(e.id, myColor));
                                    setOpen(false);
                                }}
                            >
                                <span className={`emote-option-glyph emote-option-${e.id}`} aria-hidden="true">{getEmoteGlyph(e.id)}</span>
                                {e.text}
                            </button>
                        ))}
                        </div> : <div className="emote-sheet-grid">
                            {EMOJI_EMOTES.map((e) => (
                                <button key={e.id} type="button" className="emote-sheet-option emoji-emote-option" onClick={() => {
                                    onEmote({ emoteId: 'custom', customText: e.glyph, color: myColor, t: Date.now() });
                                    setOpen(false);
                                }}>
                                    <span className="emoji-emote-glyph" aria-hidden="true">{e.glyph}</span>{e.label}
                                </button>
                            ))}
                        </div>}
                        {tab === 'text' && (
                            <div className="custom-emote-editor">
                                {custom.map((value, index) => (
                                    <div className="custom-emote-row" key={index}>
                                        <input
                                            value={value}
                                            maxLength={32}
                                            placeholder={`Custom ${index + 1}`}
                                            onChange={(event) => setCustom((items) => items.map((item, i) => i === index ? event.target.value : item))}
                                        />
                                        <button
                                            type="button"
                                            disabled={!value.trim()}
                                            onClick={() => {
                                                onEmote({ emoteId: 'custom', customText: value.trim().slice(0, 32), color: myColor, t: Date.now() });
                                                setOpen(false);
                                            }}
                                        >
                                            Send
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

export function getEmoteGlyph(id: EmoteId): string {
    switch (id) {
        case 'gl': return '✦';
        case 'nice': return '★';
        case 'oops': return '!';
        case 'think': return '…';
        case 'wow': return '⚡';
        case 'phew': return '♡';
        case 'thanks': return '✓';
        case 'brb': return '◌';
        case 'custom': return '＋';
    }
}

/** Parse an inbound emote wire payload. */
export function parseEmotePayload(payload: unknown): EmoteEvent | null {
    if (!payload || typeof payload !== 'object') return null;
    const p = payload as Record<string, unknown>;
    if (!isEmoteId(p.emoteId) && p.emoteId !== 'custom') return null;
    if (typeof p.color !== 'string') return null;
    if (typeof p.t !== 'number') return null;
    return {
        emoteId: p.emoteId as EmoteId,
        color: p.color as PlayerColor,
        actor: typeof p.actor === 'string' ? p.actor : undefined,
        customText: typeof p.customText === 'string' ? p.customText.slice(0, 32) : undefined,
        t: p.t,
    };
}
