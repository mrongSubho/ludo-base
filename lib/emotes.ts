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
    | 'brb';

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
    /** ms epoch */
    t: number;
}

export function createEmoteEvent(emoteId: EmoteId, color: string, actor?: string): EmoteEvent {
    return { emoteId, color, actor, t: Date.now() };
}

/** How long the float stays visible (ms). */
export const EMOTE_TTL_MS = 2200;
