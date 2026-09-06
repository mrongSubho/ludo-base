'use client';

// ─── Avatar library ─────────────────────────────────────────────────────────
// FORMAT (stable contract — design ideas plug in here without touching UI):
//   { id, label, kind, series, unlock, src?, bg? }
// - `id` is stored in players.avatar_url as `avatar:<id>`.
// - `kind: 'image'` renders `src` (/avatars/*.png). `kind: 'monogram'`
//   renders the player's initial on the `bg` gradient (no asset needed).
// - `unlock` gates picking: default (everyone) | wins (total_wins >= count)
//   | level (progression level >= level). Locked tiles show the requirement.
// SERIES v1:
// - legion   — Bot Legion: the 19 brand marks already in /avatars (default).
// - monogram — initial tiles in 6 gradient flavors (default).
// - trophy   — locked frames earned by wins (structure ready; art = monogram
//              + gold ring for now, custom frames can replace `frame` later).

export type AvatarKind = 'image' | 'monogram';
export type AvatarSeries = 'legion' | 'monogram' | 'trophy';
export type AvatarUnlock =
    | { type: 'default' }
    | { type: 'wins'; count: number }
    | { type: 'level'; level: number };

export interface AvatarDef {
    id: string;
    label: string;
    kind: AvatarKind;
    series: AvatarSeries;
    unlock: AvatarUnlock;
    /** image path for kind === 'image' */
    src?: string;
    /** tailwind gradient classes for monogram tiles */
    bg?: string;
}

const LEGION_IDS = [
    'alibaba', 'claude', 'cohere', 'deepseek', 'elevenlabs', 'gemini', 'groq',
    'huggingface', 'meta', 'minimax', 'mistral', 'moonshot', 'nvidia', 'openai',
    'perplexity', 'qwen', 'xai', 'yi', 'zhipuai',
] as const;

const MONOGRAM_BGS = [
    'from-cyan-600 to-teal-400',
    'from-fuchsia-600 to-purple-400',
    'from-amber-500 to-orange-400',
    'from-emerald-600 to-lime-400',
    'from-rose-600 to-pink-400',
    'from-blue-600 to-indigo-400',
];

export const AVATARS: AvatarDef[] = [
    ...LEGION_IDS.map((id) => ({
        id: `bot-${id}`,
        label: id[0].toUpperCase() + id.slice(1),
        kind: 'image' as const,
        series: 'legion' as const,
        unlock: { type: 'default' } as AvatarUnlock,
        src: `/avatars/${id}.png`,
    })),
    ...MONOGRAM_BGS.map((bg, i) => ({
        id: `mono-${i + 1}`,
        label: `Monogram ${i + 1}`,
        kind: 'monogram' as const,
        series: 'monogram' as const,
        unlock: { type: 'default' } as AvatarUnlock,
        bg,
    })),
    // Trophy frames: same monogram core, gold ring in UI, gated by wins.
    { id: 'trophy-10', label: 'Deca Victor', kind: 'monogram', series: 'trophy', unlock: { type: 'wins', count: 10 }, bg: 'from-yellow-500 to-amber-300' },
    { id: 'trophy-50', label: 'Arena Hero', kind: 'monogram', series: 'trophy', unlock: { type: 'wins', count: 50 }, bg: 'from-orange-500 to-yellow-300' },
    { id: 'trophy-100', label: 'Centurion', kind: 'monogram', series: 'trophy', unlock: { type: 'wins', count: 100 }, bg: 'from-amber-400 to-yellow-200' },
];

export function isUnlocked(
    def: AvatarDef,
    stats: { wins: number; level: number }
): { ok: boolean; hint: string } {
    if (def.unlock.type === 'default') return { ok: true, hint: '' };
    if (def.unlock.type === 'wins') {
        return stats.wins >= def.unlock.count
            ? { ok: true, hint: '' }
            : { ok: false, hint: `${def.unlock.count} wins` };
    }
    return stats.level >= def.unlock.level
        ? { ok: true, hint: '' }
        : { ok: false, hint: `Lv. ${def.unlock.level}` };
}

/** Encode a library pick for storage. */
export function encodeAvatar(id: string): string {
    return `avatar:${id}`;
}

/**
 * Resolve any stored avatar reference to a library def (or null when it's a
 * legacy URL / bare key / empty). Legacy http(s) URLs keep rendering as
 * plain images at the call site.
 */
export function resolveAvatarDef(ref: string | null | undefined): AvatarDef | null {
    if (!ref || !ref.startsWith('avatar:')) return null;
    return AVATARS.find((a) => a.id === ref.slice('avatar:'.length)) || null;
}

/** Legacy avatar values (full URLs) still render directly. */
export function isDirectImage(ref: string | null | undefined): boolean {
    return !!ref && !ref.startsWith('avatar:') && (/^https?:\/\//.test(ref) || ref.startsWith('/'));
}

// ─── Profile name rules (single source of truth) ────────────────────────────
export const NAME_RULES = {
    min: 3,
    max: 16,
    pattern: /^[A-Za-z0-9_]+$/,
    help: '3–16 chars · letters, numbers, underscore',
} as const;

export function validateName(name: string): string | null {
    const v = name.trim();
    if (v.length < NAME_RULES.min || v.length > NAME_RULES.max) {
        return `Name must be ${NAME_RULES.min}–${NAME_RULES.max} characters`;
    }
    if (!NAME_RULES.pattern.test(v)) return 'Letters, numbers and _ only';
    if (v.startsWith('0x') || v.startsWith('0X')) return 'Name can\'t look like a wallet';
    if (/^(guest|user)(_|$)/i.test(v)) return 'That prefix is reserved';
    return null;
}
