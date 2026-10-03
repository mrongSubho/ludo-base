"use client";

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { PlayerColor } from '@/lib/types';
import {
    PRESET_EMOTES,
    EMOJI_PACKS,
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
    const [tab, setTab] = useState<'text' | string>('text');
    const [packs, setPacks] = useState<readonly typeof EMOJI_PACKS[number][]>(EMOJI_PACKS);
    const [custom, setCustom] = useState(['', '']);
    const [editingSlot, setEditingSlot] = useState<number | null>(null);
    const [draft, setDraft] = useState('');

    useEffect(() => {
        let active = true;
        fetch('/emotes/packs.json')
            .then((response) => response.ok ? response.json() : null)
            .then((remotePacks: unknown) => {
                if (!active || !Array.isArray(remotePacks)) return;
                const validPacks = remotePacks.filter((pack): pack is typeof EMOJI_PACKS[number] => {
                    if (!pack || typeof pack !== 'object') return false;
                    const candidate = pack as Record<string, unknown>;
                    return typeof candidate.id === 'string' &&
                        typeof candidate.name === 'string' &&
                        typeof candidate.tabGlyph === 'string' &&
                        Array.isArray(candidate.items);
                });
                if (validPacks.length > 0) setPacks([...EMOJI_PACKS, ...validPacks]);
            })
            .catch(() => {
                // Keep the bundled starter pack available when optional assets fail to load.
            });
        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        try {
            const saved = window.localStorage.getItem('ludo-custom-emotes');
            if (saved) {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed)) setCustom([String(parsed[0] ?? '').slice(0, 32), String(parsed[1] ?? '').slice(0, 32)]);
            }
        } catch {
            // Ignore malformed local preferences and use empty slots.
        }
    }, []);

    const saveCustom = (slot: number) => {
        const value = draft.trim().slice(0, 32);
        if (!value) return;
        const next = custom.map((item, index) => index === slot ? value : item);
        setCustom(next);
        window.localStorage.setItem('ludo-custom-emotes', JSON.stringify(next));
        setEditingSlot(null);
        setDraft('');
    };

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
                            {packs.map((pack) => (
                                <button key={pack.id} className={tab === pack.id ? 'active' : ''} onClick={() => setTab(pack.id)} role="tab" aria-label={pack.name}>{pack.tabGlyph}</button>
                            ))}
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
                        {custom.map((value, index) => (
                            editingSlot === index ? (
                                <div className="custom-emote-edit" key={`custom-edit-${index}`}>
                                    <input
                                        autoFocus
                                        value={draft}
                                        maxLength={32}
                                        placeholder="Write a reaction"
                                        onChange={(event) => setDraft(event.target.value)}
                                        onKeyDown={(event) => {
                                            if (event.key === 'Enter') saveCustom(index);
                                            if (event.key === 'Escape') setEditingSlot(null);
                                        }}
                                    />
                                    <button type="button" onClick={() => saveCustom(index)} disabled={!draft.trim()}>Save</button>
                                </div>
                            ) : (
                                <button
                                    key={`custom-${index}`}
                                    type="button"
                                    className={`emote-sheet-option ${value ? '' : 'custom-emote-empty'}`}
                                    onClick={() => {
                                        if (!value) {
                                            setEditingSlot(index);
                                            setDraft('');
                                            return;
                                        }
                                        onEmote({ emoteId: 'custom', customText: value, color: myColor, t: Date.now() });
                                        setOpen(false);
                                    }}
                                >
                                    <span className="emote-option-glyph" aria-hidden="true">{value ? '✦' : '+'}</span>
                                    {value || `Custom ${index + 1}`}
                                </button>
                            )
                        ))}
                        </div> : <div className="emote-sheet-grid">
                            {(packs.find((pack) => pack.id === tab)?.items ?? []).map((e) => (
                                <button key={e.id} type="button" className="emote-sheet-option emoji-emote-option" onClick={() => {
                                    onEmote({ emoteId: 'custom', customText: e.glyph, assetUrl: e.assetUrl, color: myColor, t: Date.now() });
                                    setOpen(false);
                                }}>
                                    <span className="emoji-emote-glyph" aria-hidden="true">
                                        {e.assetUrl ? <img src={e.assetUrl} alt="" loading="lazy" /> : e.glyph}
                                    </span>{e.label}
                                </button>
                            ))}
                        </div>}
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
        assetUrl: typeof p.assetUrl === 'string' && p.assetUrl.startsWith('/emotes/') ? p.assetUrl : undefined,
        t: p.t,
    };
}
