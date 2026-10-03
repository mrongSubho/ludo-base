/**
 * G5 — themed preset emotes / quick chat (no voice, no emoji font dependency).
 * Broadcast as a lightweight GAME action; DMs stay ECDH-sealed and unused here.
 */

export type EmoteId =
    | 'gl'
    | 'nice'
    | 'oops'
    | 'think'
    | 'wow'
    | 'phew'
    | 'thanks'
    | 'brb'
    | 'custom';

export interface EmoteDef {
    id: EmoteId;
    label: string;
    /** Short phrase shown over the board. */
    text: string;
}

export const PRESET_EMOTES: EmoteDef[] = [
    { id: 'gl', label: 'GL', text: 'Good luck!' },
    { id: 'nice', label: 'Nice', text: 'Nice move' },
    { id: 'oops', label: 'Oops', text: 'Oops…' },
    { id: 'think', label: 'Hmm', text: 'Thinking…' },
    { id: 'wow', label: 'Wow', text: 'What a roll' },
    { id: 'phew', label: 'Phew', text: 'That was close' },
    { id: 'thanks', label: 'TY', text: 'Thanks!' },
    { id: 'brb', label: 'BRB', text: 'One sec' },
];

export function isEmoteId(value: unknown): value is EmoteId {
    return typeof value === 'string' && PRESET_EMOTES.some((e) => e.id === value);
}

export function emoteById(id: EmoteId): EmoteDef | undefined {
    return PRESET_EMOTES.find((e) => e.id === id);
}

export interface EmoteEvent {
    emoteId: EmoteId;
    color: string;
    actor?: string;
    customText?: string;
    assetUrl?: string;
    /** ms epoch */
    t: number;
}

export function createEmoteEvent(emoteId: EmoteId, color: string, actor?: string): EmoteEvent {
    return { emoteId, color, actor, t: Date.now() };
}

export interface EmojiEmote {
    id: string;
    label: string;
    glyph: string;
    assetUrl?: string;
}

export interface EmojiPack {
    id: string;
    name: string;
    /** The tab label is intentionally a glyph to keep the sheet compact. */
    tabGlyph: string;
    items: readonly EmojiEmote[];
}

export const EMOJI_PACKS: readonly EmojiPack[] = [];

/** Backwards-compatible alias for callers that use the original list. */
export const EMOJI_EMOTES: readonly EmojiEmote[] = [];

const CHAT_EMOTE_TOKEN = /\[\[ludo-emote:([^|\]]+)\|([^|\]]*)\]\]/g;

export function encodeChatEmote(emote: EmojiEmote): string {
    const asset = emote.assetUrl?.startsWith('/emotes/') ? emote.assetUrl : '';
    return asset ? `[[ludo-emote:${asset}|${emote.glyph}]]` : emote.glyph;
}

export type ChatDraftEmote = { glyph: string; encoded: string };

export function encodeChatDraft(value: string, emotes: readonly ChatDraftEmote[]): string {
    let encoded = '';
    let cursor = 0;
    let emoteIndex = 0;
    while (cursor < value.length) {
        const emote = emotes[emoteIndex];
        if (emote && value.startsWith(emote.glyph, cursor)) {
            encoded += emote.encoded;
            cursor += emote.glyph.length;
            emoteIndex += 1;
        } else {
            encoded += value[cursor];
            cursor += 1;
        }
    }
    return encoded;
}

export function retainChatDraftEmotes(value: string, emotes: readonly ChatDraftEmote[]): ChatDraftEmote[] {
    let cursor = 0;
    return emotes.filter((emote) => {
        const index = value.indexOf(emote.glyph, cursor);
        if (index < 0) return false;
        cursor = index + emote.glyph.length;
        return true;
    });
}

export interface ChatContentPart {
    text?: string;
    assetUrl?: string;
    glyph?: string;
}

export function parseChatContent(value: string): ChatContentPart[] {
    const parts: ChatContentPart[] = [];
    let cursor = 0;
    CHAT_EMOTE_TOKEN.lastIndex = 0;
    for (const match of value.matchAll(CHAT_EMOTE_TOKEN)) {
        const index = match.index ?? 0;
        if (index > cursor) parts.push({ text: value.slice(cursor, index) });
        const assetUrl = match[1].startsWith('/emotes/') ? match[1] : undefined;
        if (assetUrl) parts.push({ assetUrl, glyph: match[2] });
        else parts.push({ text: match[2] });
        cursor = index + match[0].length;
    }
    if (cursor < value.length) parts.push({ text: value.slice(cursor) });
    return parts.length > 0 ? parts : [{ text: value }];
}

export function chatVisibleLength(value: string): number {
    return parseChatContent(value).reduce((length, part) => length + (part.assetUrl ? 1 : (part.text?.length ?? 0)), 0);
}

/** How long the float stays visible (ms). */
export const EMOTE_TTL_MS = 2200;
