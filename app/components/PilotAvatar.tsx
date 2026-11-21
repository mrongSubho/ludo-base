'use client';

import React from 'react';
import { isDirectImage, resolveAvatarDef } from '@/lib/avatars';

export type PilotAvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const SIZE_CLASSES: Record<PilotAvatarSize, string> = {
    xs: 'w-8 h-8 text-ludo-sm',
    sm: 'w-10 h-10 text-ludo-md',
    md: 'w-12 h-12 text-ludo-lg',
    lg: 'w-14 h-14 text-ludo-xl',
    xl: 'w-20 h-20 text-ludo-3xl',
};

const TIER_RING: Record<string, string> = {
    'Arena Master': 'ring-2 ring-warn/80 border-warn/60',
    Diamond: 'ring-2 ring-accent/70 border-accent/60',
    Platinum: 'ring-1 ring-accent/50 border-line-strong',
    Gold: 'ring-2 ring-warn/60 border-warn/50',
    Silver: 'ring-1 ring-line-strong border-line-strong',
    Bronze: 'ring-1 ring-line-soft border-line-soft',
};

/**
 * Unified 3077 Pilot Emblem renderer across Profile, Public Dossier, and
 * Editor Previews. Resolves Legion images (`avatar:bot-*`), Monograms
 * (`avatar:mono-*`), Trophy rings (`avatar:trophy-*`), direct HTTP/local
 * images, and initial fallbacks identically everywhere.
 */
export function PilotAvatar({
    avatarUrl,
    name,
    size = 'lg',
    tier,
    className = '',
}: {
    avatarUrl?: string | null;
    name?: string | null;
    size?: PilotAvatarSize;
    tier?: string | null;
    className?: string;
}) {
    const def = resolveAvatarDef(avatarUrl);
    const letter = ((name || 'U').trim()[0] || 'U').toUpperCase();
    const box = SIZE_CLASSES[size];
    const trophyRing = def?.series === 'trophy' ? 'ring-2 ring-warn/80 border-warn/60' : '';
    const tierRing = tier ? TIER_RING[tier] || '' : '';
    const frameRing = trophyRing || tierRing || 'border-line-strong';

    if (def?.kind === 'image' && def.src) {
        const isCutout = def.series === 'pilots';
        return (
            <div
                className={`${box} rounded-full overflow-hidden shrink-0 bg-surface-recessed border ${frameRing} relative ${className}`}
                title={def.label}
            >
                <img
                    src={def.src}
                    alt={def.label}
                    className={
                        isCutout
                            ? 'w-full h-full object-contain object-bottom'
                            : 'w-full h-full object-cover'
                    }
                    width={96}
                    height={96}
                />
            </div>
        );
    }

    if (def?.kind === 'monogram') {
        return (
            <div
                className={`${box} rounded-full overflow-hidden shrink-0 bg-gradient-to-tr ${def.bg || 'from-cyan-600 to-teal-400'} border ${frameRing} flex items-center justify-center relative ${className}`}
                title={def.label}
            >
                <span
                    className="font-extrabold leading-none select-none"
                    style={{ color: '#ffffff', textShadow: '0 1px 2px rgba(0, 0, 0, 0.45)' }}
                >
                    {letter}
                </span>
            </div>
        );
    }

    if (avatarUrl && isDirectImage(avatarUrl)) {
        return (
            <div
                className={`${box} rounded-full overflow-hidden shrink-0 bg-surface-recessed border ${frameRing} relative ${className}`}
            >
                <img
                    src={avatarUrl}
                    alt={name || 'Pilot avatar'}
                    className="w-full h-full object-cover"
                    width={96}
                    height={96}
                />
            </div>
        );
    }

    return (
        <div
            className={`${box} rounded-full overflow-hidden shrink-0 bg-accent-soft border border-accent/40 flex items-center justify-center relative ${className}`}
        >
            <span className="font-extrabold text-accent leading-none select-none">{letter}</span>
        </div>
    );
}

export default PilotAvatar;
