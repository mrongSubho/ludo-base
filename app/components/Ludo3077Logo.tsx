'use client';

import React, { useId } from 'react';

export type EmblemSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const SIZE_CLASS: Record<EmblemSize, string> = {
    xs: 'w-8 h-8',
    sm: 'w-14 h-14',
    md: 'w-20 h-20',
    lg: 'w-28 h-28',
    xl: 'w-56 h-56',
};

const DIAL_RIVETS = Array.from({ length: 8 }, (_, idx) => {
    const a = (idx / 8) * Math.PI * 2;
    return { cx: 110 + Math.cos(a) * 65, cy: 110 + Math.sin(a) * 65 };
});

/**
 * Official Ludo 3077 Mechanical Hatch-Dial Emblem.
 * Extracted from the Phase 1 BootSequence lockup so Boot, Sign-In, Splash,
 * Navbar, and Wallet Modals share one recognizable brand mark.
 */
export function Ludo3077Emblem({
    size = 'lg',
    showReticle = true,
    className = '',
}: {
    size?: EmblemSize;
    showReticle?: boolean;
    className?: string;
}) {
    const rawId = useId().replace(/:/g, '');
    const dialGradId = `ludo3077-dial-${rawId}`;
    const glowFilterId = `ludo3077-glow-${rawId}`;

    return (
        <div className={`relative flex items-center justify-center shrink-0 ${SIZE_CLASS[size]} ${className}`}>
            {showReticle && (
                <>
                    <svg
                        viewBox="0 0 220 220"
                        className="absolute inset-0 w-full h-full animate-hud-reticle-spin"
                        style={{ color: 'var(--accent, #00E5FF)' }}
                        fill="none"
                        aria-hidden="true"
                    >
                        <circle
                            cx="110"
                            cy="110"
                            r="102"
                            stroke="currentColor"
                            strokeWidth="1.2"
                            strokeOpacity="0.6"
                            strokeDasharray="180 44 120 40"
                        />
                        <circle cx="152" cy="17" r="3.6" fill="currentColor" />
                        <circle cx="52" cy="193" r="3.2" fill="currentColor" />
                    </svg>

                    <svg
                        viewBox="0 0 220 220"
                        className="absolute inset-0 w-full h-full animate-hud-reticle-spin-rev"
                        style={{ color: 'var(--accent, #00E5FF)' }}
                        fill="none"
                        aria-hidden="true"
                    >
                        <circle
                            cx="110"
                            cy="110"
                            r="86"
                            stroke="currentColor"
                            strokeWidth="1"
                            strokeOpacity="0.4"
                            strokeDasharray="34 14 8 14"
                        />
                    </svg>
                </>
            )}

            <svg
                viewBox={showReticle ? '0 0 220 220' : '28 28 164 164'}
                className="relative w-full h-full"
                fill="none"
                aria-label="Ludo 3077 Official Emblem"
            >
                <defs>
                    <radialGradient id={dialGradId} cx="42%" cy="34%" r="68%">
                        <stop offset="0%" stopColor="#1E2530" />
                        <stop offset="65%" stopColor="#0E131B" />
                        <stop offset="100%" stopColor="#06080D" />
                    </radialGradient>
                    <filter id={glowFilterId} x="-30%" y="-30%" width="160%" height="160%">
                        <feGaussianBlur stdDeviation="2.4" result="blur" />
                        <feMerge>
                            <feMergeNode in="blur" />
                            <feMergeNode in="SourceGraphic" />
                        </feMerge>
                    </filter>
                </defs>

                <circle cx="110" cy="110" r="71" fill="#171C24" stroke="#334155" strokeWidth="2.2" />
                <rect x="35" y="101" width="7" height="18" rx="2" fill="#273140" stroke="#475569" strokeWidth="1" />
                <circle
                    cx="110"
                    cy="110"
                    r="58"
                    fill={`url(#${dialGradId})`}
                    stroke="#00E5FF"
                    strokeOpacity="0.38"
                    strokeWidth="1.2"
                />

                {DIAL_RIVETS.map((rivet, idx) => (
                    <circle
                        key={idx}
                        cx={rivet.cx}
                        cy={rivet.cy}
                        r="2"
                        fill="#090D12"
                        stroke="#475569"
                        strokeWidth="0.7"
                    />
                ))}

                <g stroke="#00E5FF" strokeOpacity="0.06" strokeWidth="1">
                    <line x1="72" y1="74" x2="148" y2="146" />
                    <line x1="88" y1="62" x2="156" y2="130" />
                    <line x1="64" y1="90" x2="132" y2="158" />
                </g>

                <polygon
                    points="110,68 121,79 110,90 99,79"
                    fill="#00E5FF"
                    filter={`url(#${glowFilterId})`}
                />

                {[
                    { cx: 88, cy: 108 },
                    { cx: 132, cy: 108 },
                    { cx: 110, cy: 132 },
                ].map((tile, idx) => (
                    <g
                        key={idx}
                        transform={`rotate(45 ${tile.cx} ${tile.cy})`}
                        filter={`url(#${glowFilterId})`}
                    >
                        <rect
                            x={tile.cx - 12}
                            y={tile.cy - 12}
                            width="24"
                            height="24"
                            rx="4"
                            fill="rgba(0, 229, 255, 0.14)"
                            stroke="#00E5FF"
                            strokeWidth="1.5"
                        />
                        <circle cx={tile.cx - 5.5} cy={tile.cy - 5.5} r="1.8" fill="#00E5FF" />
                        <circle cx={tile.cx + 5.5} cy={tile.cy - 5.5} r="1.8" fill="#00E5FF" />
                        <circle cx={tile.cx} cy={tile.cy} r="2.1" fill="#00E5FF" />
                        <circle cx={tile.cx - 5.5} cy={tile.cy + 5.5} r="1.8" fill="#00E5FF" />
                        <circle cx={tile.cx + 5.5} cy={tile.cy + 5.5} r="1.8" fill="#00E5FF" />
                    </g>
                ))}
            </svg>
        </div>
    );
}

export default Ludo3077Emblem;
