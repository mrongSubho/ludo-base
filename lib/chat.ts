"use client";

import type { PlayerColor } from '@/lib/types';
import { chatVisibleLength } from './emotes';

export type ChatEvent = {
    text: string;
    color: PlayerColor;
    actor?: string;
    audience?: 'all' | 'team';
    t: number;
};

export const CHAT_MAX_LEN = 500;
export const CHAT_MIN_TTL_MS = 4000;
export const CHAT_MAX_TTL_MS = 5000;
/** Compatibility alias for callers that need the upper bound. */
export const CHAT_TTL_MS = CHAT_MAX_TTL_MS;

export function chatTtlMs(text: string): number {
    const visibleLength = chatVisibleLength(text);
    const lengthRatio = Math.min(1, Math.max(0, (visibleLength - 1) / 79));
    return Math.round(CHAT_MIN_TTL_MS + lengthRatio * (CHAT_MAX_TTL_MS - CHAT_MIN_TTL_MS));
}

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
        audience: p.audience === 'team' ? 'team' : 'all',
        t: typeof p.t === 'number' ? p.t : Date.now(),
    };
}
