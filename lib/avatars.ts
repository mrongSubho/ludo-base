'use client';

// ─── Avatar library ─────────────────────────────────────────────────────────
// FORMAT (stable contract — design ideas plug in here without touching UI):
//   { id, label, tagline?, featured?, kind, series, unlock, src?, bg? }
// - `id` is stored in players.avatar_url as `avatar:<id>`.
// - `kind: 'image'` renders `src` (/avatars/pilots/*.png|svg or legacy /avatars/*.png).
//   `kind: 'monogram'` renders the player's initial on the `bg` gradient.
// - `unlock` gates picking: default (everyone) | wins (total_wins >= count)
//   | level (progression level >= level). Locked tiles show the requirement.
// SERIES:
// - pilots   — Custom Ludo 3077 Pilot Portraits & Tactical Helmets (player default).
// - monogram — Initial badges in 6 cyber-tactical gradients (default).
// - trophy   — Win-gated prestige frames (gold ring in UI).
// - legion   — AI Bot brand marks (kept for legacy player resolution only; hidden from picker).

export type AvatarKind = 'image' | 'monogram';
export type AvatarSeries = 'pilots' | 'monogram' | 'trophy' | 'legion';
export type PlayerAvatarSeries = Exclude<AvatarSeries, 'legion'>;

export const PLAYER_AVATAR_SERIES: readonly PlayerAvatarSeries[] = [
    'pilots',
    'monogram',
    'trophy',
] as const;

export type AvatarUnlock =
    | { type: 'default' }
    | { type: 'wins'; count: number }
    | { type: 'level'; level: number };

export interface AvatarDef {
    id: string;
    label: string;
    /** Short pilot role / flavor subtitle shown in the Identity overlay. */
    tagline?: string;
    /** Highlighted hero portrait card in the Pilots picker. */
    featured?: boolean;
    kind: AvatarKind;
    series: AvatarSeries;
    unlock: AvatarUnlock;
    /** image path for kind === 'image' */
    src?: string;
    /** tailwind gradient classes for monogram tiles */
    bg?: string;
}

const PILOT_DEFS: readonly AvatarDef[] = [
    {
        id: 'pilot-cipher',
        label: 'Cipher',
        tagline: 'Recon Tactician',
        featured: true,
        kind: 'image',
        series: 'pilots',
        unlock: { type: 'default' },
        src: '/avatars/pilots/cipher.png',
    },
    {
        id: 'pilot-valkyrie',
        label: 'Valkyrie',
        tagline: 'Orbital Ace',
        featured: true,
        kind: 'image',
        series: 'pilots',
        unlock: { type: 'default' },
        src: '/avatars/pilots/valkyrie.png',
    },
    {
        id: 'pilot-ronin',
        label: 'Ronin',
        tagline: 'Crimson Blade',
        kind: 'image',
        series: 'pilots',
        unlock: { type: 'default' },
        src: '/avatars/pilots/ronin.svg',
    },
    {
        id: 'pilot-kitsune',
        label: 'Kitsune',
        tagline: 'Neon Fox',
        kind: 'image',
        series: 'pilots',
        unlock: { type: 'default' },
        src: '/avatars/pilots/kitsune.svg',
    },
    {
        id: 'pilot-vanguard',
        label: 'Vanguard',
        tagline: 'Orbital Breacher',
        kind: 'image',
        series: 'pilots',
        unlock: { type: 'default' },
        src: '/avatars/pilots/vanguard.svg',
    },
    {
        id: 'pilot-solaris',
        label: 'Solaris',
        tagline: 'Solar Striker',
        kind: 'image',
        series: 'pilots',
        unlock: { type: 'default' },
        src: '/avatars/pilots/solaris.svg',
    },
    {
        id: 'pilot-specter',
        label: 'Specter',
        tagline: 'Stealth Recon',
        kind: 'image',
        series: 'pilots',
        unlock: { type: 'default' },
        src: '/avatars/pilots/specter.svg',
    },
    {
        id: 'pilot-nova',
        label: 'Nova',
        tagline: 'Quantum Pilot',
        kind: 'image',
        series: 'pilots',
        unlock: { type: 'default' },
        src: '/avatars/pilots/nova.svg',
    },
    {
        id: 'pilot-warden',
        label: 'Warden',
        tagline: 'Aegis Sentinel',
        kind: 'image',
        series: 'pilots',
        unlock: { type: 'default' },
        src: '/avatars/pilots/warden.svg',
    },
    {
        id: 'pilot-apex',
        label: 'Apex',
        tagline: 'Grandmaster',
        kind: 'image',
        series: 'pilots',
        unlock: { type: 'default' },
        src: '/avatars/pilots/apex.svg',
    },
];

const LEGION_IDS = [
    'alibaba', 'claude', 'cohere', 'deepseek', 'elevenlabs', 'gemini', 'groq',
    'huggingface', 'meta', 'minimax', 'mistral', 'moonshot', 'nvidia', 'openai',
    'perplexity', 'qwen', 'xai', 'yi', 'zhipuai',
] as const;

const MONOGRAM_FLAVORS: readonly { label: string; tagline: string; bg: string }[] = [
    { label: 'Hyper Cyan', tagline: '3077 Signal', bg: 'from-cyan-600 to-teal-400' },
    { label: 'Solar Amber', tagline: 'Apex Gold', bg: 'from-amber-500 to-orange-400' },
    { label: 'Matrix Jade', tagline: 'Emerald Grid', bg: 'from-emerald-600 to-lime-400' },
    { label: 'Crimson Pulse', tagline: 'Laser Red', bg: 'from-rose-600 to-red-400' },
    { label: 'Cobalt Ice', tagline: 'Orbital Blue', bg: 'from-sky-600 to-blue-400' },
    { label: 'Titanium Onyx', tagline: 'Stealth Steel', bg: 'from-slate-600 to-zinc-400' },
];

export const AVATARS: AvatarDef[] = [
    ...PILOT_DEFS,
    ...MONOGRAM_FLAVORS.map((flavor, i) => ({
        id: `mono-${i + 1}`,
        label: flavor.label,
        tagline: flavor.tagline,
        kind: 'monogram' as const,
        series: 'monogram' as const,
        unlock: { type: 'default' } as AvatarUnlock,
        bg: flavor.bg,
    })),
    // Trophy frames: same monogram core, gold ring in UI, gated by wins.
    { id: 'trophy-10', label: 'Deca Victor', tagline: '10 Arena Wins', kind: 'monogram', series: 'trophy', unlock: { type: 'wins', count: 10 }, bg: 'from-yellow-500 to-amber-300' },
    { id: 'trophy-50', label: 'Arena Hero', tagline: '50 Arena Wins', kind: 'monogram', series: 'trophy', unlock: { type: 'wins', count: 50 }, bg: 'from-orange-500 to-yellow-300' },
    { id: 'trophy-100', label: 'Centurion', tagline: '100 Arena Wins', kind: 'monogram', series: 'trophy', unlock: { type: 'wins', count: 100 }, bg: 'from-amber-400 to-yellow-200' },
    // Legacy bot-legion marks preserved for existing profiles only (not shown in player picker).
    ...LEGION_IDS.map((id) => ({
        id: `bot-${id}`,
        label: id[0].toUpperCase() + id.slice(1),
        tagline: 'Bot Legion',
        kind: 'image' as const,
        series: 'legion' as const,
        unlock: { type: 'default' } as AvatarUnlock,
        src: `/avatars/${id}.png`,
    })),
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
