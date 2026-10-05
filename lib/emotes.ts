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

/**
 * A draft emote the composer is tracking.
 *
 * `token` is the literal text inserted into the field (a unique shortcode such
 * as `:baddie:`), `encoded` is what goes on the wire. A shared per-pack glyph
 * was unusable as a field token: every item in a pack used the same glyph, so
 * the field could not show which emote was picked and encoding could not tell
 * two picks apart.
 */
export type ChatDraftEmote = { token: string; encoded: string; glyph: string; assetUrl?: string };

/** Unique, typeable shortcode for an emote: `:label:`. */
export function emoteShortcode(emote: EmojiEmote): string {
    const slug = (emote.label || emote.id || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 24);
    return `:${slug || 'emote'}:`;
}

/** A shortcode that is not already present in the field. */
export function uniqueShortcode(emote: EmojiEmote, value: string): string {
    const base = emoteShortcode(emote);
    if (!value.includes(base)) return base;
    let n = 2;
    while (value.includes(`:${base.slice(1, -1)}-${n}:`)) n += 1;
    return `:${base.slice(1, -1)}-${n}:`;
}

export function draftEmoteFrom(emote: EmojiEmote, token: string): ChatDraftEmote {
    return { token, encoded: encodeChatEmote(emote), glyph: emote.glyph, assetUrl: emote.assetUrl };
}

/** Append an emote to a draft: unique shortcode + its tracking entry. */
export function insertDraftEmote(
    emote: EmojiEmote,
    value: string,
    emotes: readonly ChatDraftEmote[],
    maxLength: number
): { value: string; emotes: ChatDraftEmote[] } {
    const token = uniqueShortcode(emote, value);
    const next = `${value}${token}`.slice(0, maxLength);
    if (next.length <= value.length) return { value, emotes: [...emotes] };
    return { value: next, emotes: [...emotes, draftEmoteFrom(emote, token)] };
}

export function encodeChatDraft(value: string, emotes: readonly ChatDraftEmote[]): string {
    let encoded = '';
    let cursor = 0;
    let emoteIndex = 0;
    while (cursor < value.length) {
        const emote = emotes[emoteIndex];
        if (emote && value.startsWith(emote.token, cursor)) {
            encoded += emote.encoded;
            cursor += emote.token.length;
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
        const index = value.indexOf(emote.token, cursor);
        if (index < 0) return false;
        cursor = index + emote.token.length;
        return true;
    });
}

/**
 * Draft text split for rendering: plain text plus the emotes still present, in
 * field order. Used by the rich composer layer to draw emote art inline.
 */
export function parseChatDraft(
    value: string,
    emotes: readonly ChatDraftEmote[]
): { text: string; emote?: ChatDraftEmote }[] {
    const parts: { text: string; emote?: ChatDraftEmote }[] = [];
    let cursor = 0;
    let index = 0;
    while (cursor < value.length) {
        const emote = emotes[index];
        if (emote && value.startsWith(emote.token, cursor)) {
            if (cursor > 0) parts.push({ text: value.slice(0, cursor) });
            parts.push({ text: emote.token, emote });
            value = value.slice(cursor + emote.token.length);
            cursor = 0;
            index += 1;
            continue;
        }
        cursor += 1;
    }
    if (value) parts.push({ text: value });
    return parts.length > 0 ? parts : [{ text: '' }];
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
