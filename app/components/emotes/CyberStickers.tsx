"use client";

import React from 'react';
import { useReducedMotion } from '@/hooks/useReducedMotion';

export type CyberStickerId =
  | 'cyber-orb-glitch'
  | 'cyber-orb-overheat'
  | 'cyber-orb-laser-eyes'
  | 'cyber-orb-smug'
  | 'cyber-orb-bounce'
  | 'cyber-orb-blue-screen'
  | 'cyber-orb-diamond'
  | 'cyber-orb-wave';

interface CyberStickerProps {
  id: string;
  size?: number;
  className?: string;
  alt?: string;
}

const STICKER_ANIMATIONS: Record<string, string> = {
  'cyber-orb-glitch': 'animate-pulse hover:skew-x-2',
  'cyber-orb-overheat': 'animate-bounce',
  'cyber-orb-laser-eyes': 'hover:scale-110 transition-transform',
  'cyber-orb-smug': 'hover:rotate-6 transition-transform',
  'cyber-orb-bounce': 'animate-bounce',
  'cyber-orb-blue-screen': 'animate-pulse',
  'cyber-orb-diamond': 'hover:scale-105 transition-transform',
  'cyber-orb-wave': 'animate-pulse',
};

/**
 * Original Cyber-Orb Animated Sticker
 * 100% vector SVG with responsive sizing and terminal-glass aura.
 * Parity with Ludo World social reaction hooks without external character IP.
 */
function normalizeStickerId(id: string): string {
  if (!id.startsWith('/emotes/')) return id;
  const file = id.split('/').pop() ?? id;
  const stem = file.replace(/\.(svg|png|gif|webp)$/i, '');
  return stem.startsWith('orb-') ? `cyber-orb-${stem.slice(4)}` : stem;
}

export function CyberSticker({ id, size = 64, className = '', alt = 'Reaction' }: CyberStickerProps) {
  const reduced = useReducedMotion();
  const normalizedId = normalizeStickerId(id);
  const assetUrl = id.startsWith('/emotes/')
    ? id
    : `/emotes/cyber-orb/${normalizedId.replace('cyber-orb-', 'orb-')}.svg`;

  const anim = reduced ? '' : (STICKER_ANIMATIONS[normalizedId] || '');

  return (
    <div
      className={`relative inline-flex items-center justify-center select-none ${anim} ${className}`}
      style={{ width: size, height: size }}
    >
      <img
        src={assetUrl}
        alt={alt}
        width={size}
        height={size}
        className="w-full h-full object-contain filter drop-shadow-[0_0_8px_color-mix(in_srgb,var(--accent)_40%,transparent)]"
        loading="lazy"
      />
    </div>
  );
}
