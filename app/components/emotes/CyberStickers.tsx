"use client";

import React from 'react';

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
export function CyberSticker({ id, size = 64, className = '', alt = 'Reaction' }: CyberStickerProps) {
  const assetUrl = id.startsWith('/emotes/')
    ? id
    : `/emotes/cyber-orb/${id.replace('cyber-orb-', 'orb-')}.svg`;

  const anim = STICKER_ANIMATIONS[id] || '';

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
        className="w-full h-full object-contain filter drop-shadow-[0_0_8px_rgba(0,229,255,0.4)]"
        loading="lazy"
      />
    </div>
  );
}
