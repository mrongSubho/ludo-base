"use client";

import type { PlayerColor } from '@/lib/types';

export type ChatEvent = {
    text: string;
    color: PlayerColor;
    actor?: string;
    t: number;
};

export const CHAT_MAX_LEN = 80;
export const CHAT_TTL_MS = 8000;

/** Quick phrases for the in-match chat sheet (ref-style pills). */
export const CHAT_PRESETS = [
    'Hello!',
    'Play fast!',
    'Oh Teri!',
    'Well Play',
    'why!why!',
    'Sorry mate!',
] as const;

export function clampChatText(raw: string): string {
    return raw.replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX_LEN);
}

export function parseChatPayload(payload: unknown): ChatEvent | null {
    if (!payload || typeof payload !== 'object') return null;
    const p = payload as Record<string, unknown>;
    if (typeof p.text !== 'string') return null;
    const text = clampChatText(p.text);
    if (!text) return null;
    if (typeof p.color !== 'string') return null;
    return {
        text,
        color: p.color as PlayerColor,
        actor: typeof p.actor === 'string' ? p.actor : undefined,
        t: typeof p.t === 'number' ? p.t : Date.now(),
    };
}
