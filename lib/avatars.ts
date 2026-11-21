'use client';

// ─── Avatar library ─────────────────────────────────────────────────────────
// FORMAT (stable contract — design ideas plug in here without touching UI):
//   { id, label, tagline?, kind, series, unlock, src?, bg? }
// - `id` is stored in players.avatar_url as `avatar:<id>`.
// - `kind: 'image'` renders `src` (/avatars/pilots/*.png transparent busts or legacy /avatars/*.png).
//   `kind: 'monogram'` renders the player's initial on the `bg` gradient.
// - `unlock` gates picking: default (everyone) | wins (total_wins >= count)
//   | level (progression level >= level). Locked tiles show the requirement.
// SERIES:
// - pilots   — 18 custom background-less transparent character portraits (humans,
//              superhumans, superheroes, androids across kids/teens/20s/30s/40s).
// - monogram — Initial badges in 6 cyber-tactical gradients.
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
    /** Short character archetype / role subtitle shown in the Identity overlay. */
    tagline?: string;
    kind: AvatarKind;
    series: AvatarSeries;
    unlock: AvatarUnlock;
    /** image path for kind === 'image' */
    src?: string;
    /** tailwind gradient classes for monogram tiles */
    bg?: string;
}

const PILOT_DEFS: readonly AvatarDef[] = [
    { id: 'pilot-kairo', label: 'Kairo', tagline: 'Street Runner', kind: 'image', series: 'pilots', unlock: { type: 'default' }, src: '/avatars/pilots/kairo.png' },
    { id: 'pilot-valkyrie', label: 'Valkyrie', tagline: 'Orbital Ace', kind: 'image', series: 'pilots', unlock: { type: 'default' }, src: '/avatars/pilots/valkyrie.png' },
    { id: 'pilot-aria', label: 'Aria-7', tagline: 'Synth Tactician', kind: 'image', series: 'pilots', unlock: { type: 'default' }, src: '/avatars/pilots/aria.png' },
    { id: 'pilot-blaze', label: 'Blaze', tagline: 'Solar Striker', kind: 'image', series: 'pilots', unlock: { type: 'default' }, src: '/avatars/pilots/blaze.png' },
    { id: 'pilot-spark', label: 'Spark', tagline: 'Tech Prodigy', kind: 'image', series: 'pilots', unlock: { type: 'default' }, src: '/avatars/pilots/spark.png' },
    { id: 'pilot-mika', label: 'Mika', tagline: 'Arcade Ace', kind: 'image', series: 'pilots', unlock: { type: 'default' }, src: '/avatars/pilots/mika.png' },
    { id: 'pilot-lyra', label: 'Lyra', tagline: 'Flare Hero', kind: 'image', series: 'pilots', unlock: { type: 'default' }, src: '/avatars/pilots/lyra.png' },
    { id: 'pilot-nova', label: 'Nova', tagline: 'Star Guardian', kind: 'image', series: 'pilots', unlock: { type: 'default' }, src: '/avatars/pilots/nova.png' },
    { id: 'pilot-jett', label: 'Jett', tagline: 'Shadow Blade', kind: 'image', series: 'pilots', unlock: { type: 'default' }, src: '/avatars/pilots/jett.png' },
    { id: 'pilot-bolt', label: 'Bolt-9', tagline: 'Pulse Android', kind: 'image', series: 'pilots', unlock: { type: 'default' }, src: '/avatars/pilots/bolt.png' },
    { id: 'pilot-titan', label: 'Titan', tagline: 'Vanguard Hero', kind: 'image', series: 'pilots', unlock: { type: 'default' }, src: '/avatars/pilots/titan.png' },
    { id: 'pilot-sora', label: 'Sora', tagline: 'Jade Mystic', kind: 'image', series: 'pilots', unlock: { type: 'default' }, src: '/avatars/pilots/sora.png' },
    { id: 'pilot-vex', label: 'Vex', tagline: 'Cyber Merc', kind: 'image', series: 'pilots', unlock: { type: 'default' }, src: '/avatars/pilots/vex.png' },
    { id: 'pilot-elena', label: 'Elena', tagline: 'Tactical Vet', kind: 'image', series: 'pilots', unlock: { type: 'default' }, src: '/avatars/pilots/elena.png' },
    { id: 'pilot-vance', label: 'Vance', tagline: 'Commander', kind: 'image', series: 'pilots', unlock: { type: 'default' }, src: '/avatars/pilots/vance.png' },
    { id: 'pilot-stark', label: 'Stark', tagline: 'Nano Architect', kind: 'image', series: 'pilots', unlock: { type: 'default' }, src: '/avatars/pilots/stark.png' },
    { id: 'pilot-aegis', label: 'Aegis', tagline: 'Titan Android', kind: 'image', series: 'pilots', unlock: { type: 'default' }, src: '/avatars/pilots/aegis.png' },
    { id: 'pilot-kestrel', label: 'Kestrel', tagline: 'Bounty Legend', kind: 'image', series: 'pilots', unlock: { type: 'default' }, src: '/avatars/pilots/kestrel.png' },
];

/** Back-compat aliases for retired v1 helmet IDs so saved profiles never break. */
const LEGACY_PILOT_ALIASES: Record<string, string> = {
    'pilot-cipher': 'pilot-kairo',
    'pilot-ronin': 'pilot-jett',
    'pilot-kitsune': 'pilot-mika',
    'pilot-vanguard': 'pilot-vance',
    'pilot-solaris': 'pilot-blaze',
    'pilot-specter': 'pilot-vex',
    'pilot-warden': 'pilot-aegis',
    'pilot-apex': 'pilot-kestrel',
};

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
    const rawId = ref.slice('avatar:'.length);
    const id = LEGACY_PILOT_ALIASES[rawId] ?? rawId;
    return AVATARS.find((a) => a.id === id) || null;
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
