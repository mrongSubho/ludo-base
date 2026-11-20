'use client';

import React, { useEffect, useId, useState } from 'react';
import { onReducedMotionChange, prefersReducedMotion } from '@/lib/motion';

export type EmblemSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
export type DieFace = 1 | 2 | 3 | 4 | 5 | 6;
type DiceTriplet = readonly [DieFace, DieFace, DieFace];

const SIZE_CLASS: Record<EmblemSize, string> = {
    xs: 'w-8 h-8',
    sm: 'w-14 h-14',
    md: 'w-20 h-20',
    lg: 'w-28 h-28',
    xl: 'w-56 h-56',
};

/**
 * Seven slotted machine screws positioned on the 45-degree clock marks
 * around the vault flange. The 9 o'clock position (180 deg) is omitted
 * because the articulated mechanical vault hinge occupies that sector.
 */
const BEZEL_SCREWS = [
    { angle: -90, slot: -34 },
    { angle: -45, slot: 24 },
    { angle: 0, slot: -48 },
    { angle: 45, slot: 18 },
    { angle: 90, slot: -26 },
    { angle: 135, slot: 38 },
    { angle: -135, slot: -18 },
].map(({ angle, slot }) => {
    const rad = (angle * Math.PI) / 180;
    return {
        cx: Number((110 + Math.cos(rad) * 65.2).toFixed(2)),
        cy: Number((110 + Math.sin(rad) * 65.2).toFixed(2)),
        slot,
    };
});

/** Coordinates for the 3 interlocking 45-degree rotated dice beneath the crown diamond. */
const EMBLEM_DICE_POS = [
    { cx: 85.2, cy: 108 },
    { cx: 134.8, cy: 108 },
    { cx: 110, cy: 132.8 },
] as const;

/** Canonical pip coordinates inside each 29x29 local die box (rotated 45 deg around center). */
const PIP_LAYOUTS: Record<DieFace, ReadonlyArray<readonly [number, number, number]>> = {
    1: [[0, 0, 3.6]],
    2: [
        [-7.0, -7.0, 3.05],
        [7.0, 7.0, 3.05],
    ],
    3: [
        [-7.0, -7.0, 2.95],
        [0, 0, 2.95],
        [7.0, 7.0, 2.95],
    ],
    4: [
        [-6.9, -6.9, 2.95],
        [6.9, -6.9, 2.95],
        [-6.9, 6.9, 2.95],
        [6.9, 6.9, 2.95],
    ],
    5: [
        [-6.9, -6.9, 2.9],
        [6.9, -6.9, 2.9],
        [0, 0, 3.1],
        [-6.9, 6.9, 2.9],
        [6.9, 6.9, 2.9],
    ],
    6: [
        [-6.6, -7.0, 2.55],
        [6.6, -7.0, 2.55],
        [-6.6, 0, 2.55],
        [6.6, 0, 2.55],
        [-6.6, 7.0, 2.55],
        [6.6, 7.0, 2.55],
    ],
};

const DEFAULT_DICE: DiceTriplet = [5, 5, 5];

function randomOtherDie(prev: DieFace): DieFace {
    const candidates: DieFace[] = ([1, 2, 3, 4, 5, 6] as const).filter((n) => n !== prev);
    return candidates[Math.floor(Math.random() * candidates.length)];
}

function nextRandomTriplet(prev: DiceTriplet): DiceTriplet {
    const a = randomOtherDie(prev[0]);
    const b = randomOtherDie(prev[1]);
    let c = randomOtherDie(prev[2]);
    // Keep the 3 dice visually varied (avoid all three showing the exact same face)
    if (a === b && b === c) {
        c = randomOtherDie(c);
    }
    return [a, b, c];
}

/**
 * Official Ludo 3077 Mechanical Hatch-Dial Emblem.
 * Forged-titanium porthole bezel with 7 slotted machine screws, articulated
 * 9 o'clock hinge, recessed 3K diagonal carbon-fiber dish, neon cyan crown
 * diamond + 3 rotated dice with live animated random pips, and counter-rotating
 * HUD orbital reticles.
 */
export function Ludo3077Emblem({
    size = 'lg',
    showReticle = true,
    animatePips = showReticle,
    className = '',
}: {
    size?: EmblemSize;
    showReticle?: boolean;
    animatePips?: boolean;
    className?: string;
}) {
    const uid = useId().replace(/:/g, '');
    const [reducedMotion, setReducedMotion] = useState(false);
    const [dice, setDice] = useState<DiceTriplet>(DEFAULT_DICE);
    const [tumbleMask, setTumbleMask] = useState<readonly [boolean, boolean, boolean]>([
        false,
        false,
        false,
    ]);

    useEffect(() => {
        setReducedMotion(prefersReducedMotion());
        return onReducedMotionChange(setReducedMotion);
    }, []);

    useEffect(() => {
        if (!animatePips || reducedMotion) {
            setDice(DEFAULT_DICE);
            setTumbleMask([false, false, false]);
            return;
        }

        const timeouts: number[] = [];
        let current: DiceTriplet = DEFAULT_DICE;

        const scheduleRoll = () => {
            const target = nextRandomTriplet(current);
            current = target;

            EMBLEM_DICE_POS.forEach((_, dieIndex) => {
                const startDelay = dieIndex * 95;
                const tStart = window.setTimeout(() => {
                    // Brief mid-roll scramble + subtle scale dip
                    setTumbleMask((prev) => {
                        const next: [boolean, boolean, boolean] = [...prev];
                        next[dieIndex] = true;
                        return next;
                    });
                    setDice((prev) => {
                        const next: [DieFace, DieFace, DieFace] = [...prev];
                        next[dieIndex] = randomOtherDie(prev[dieIndex]);
                        return next;
                    });

                    const tSettle = window.setTimeout(() => {
                        setDice((prev) => {
                            const next: [DieFace, DieFace, DieFace] = [...prev];
                            next[dieIndex] = target[dieIndex];
                            return next;
                        });
                        setTumbleMask((prev) => {
                            const next: [boolean, boolean, boolean] = [...prev];
                            next[dieIndex] = false;
                            return next;
                        });
                    }, 85);
                    timeouts.push(tSettle);
                }, startDelay);
                timeouts.push(tStart);
            });
        };

        // Kick off an immediate roll shortly after mount so Boot & Sign-In feel alive right away
        const initialTimer = window.setTimeout(scheduleRoll, 520);
        const interval = window.setInterval(scheduleRoll, 1850);

        return () => {
            window.clearTimeout(initialTimer);
            window.clearInterval(interval);
            timeouts.forEach((id) => window.clearTimeout(id));
        };
    }, [animatePips, reducedMotion]);

    const ids = {
        ringGlow: `l3077-rg-${uid}`,
        shadow: `l3077-sh-${uid}`,
        chamfer: `l3077-ch-${uid}`,
        bezel: `l3077-bz-${uid}`,
        sheen: `l3077-sn-${uid}`,
        innerBevel: `l3077-ib-${uid}`,
        outerEdge: `l3077-oe-${uid}`,
        screw: `l3077-sc-${uid}`,
        hingePin: `l3077-hp-${uid}`,
        hingeLug: `l3077-hl-${uid}`,
        metalNoise: `l3077-mn-${uid}`,
        carbon: `l3077-cb-${uid}`,
        vignette: `l3077-vg-${uid}`,
        cyanWash: `l3077-cw-${uid}`,
        diamond: `l3077-dm-${uid}`,
        neon: `l3077-nn-${uid}`,
        bezelMask: `l3077-bm-${uid}`,
        dishClip: `l3077-dc-${uid}`,
    };
    const showMicroTexture = size !== 'xs';

    return (
        <div className={`relative flex items-center justify-center shrink-0 ${SIZE_CLASS[size]} ${className}`}>
            {showReticle && (
                <>
                    {/* Outer continuous orbital ring + tactical capsule & thruster pods */}
                    <svg
                        viewBox="0 0 220 220"
                        className="absolute inset-0 w-full h-full animate-hud-reticle-spin"
                        style={{ color: 'var(--accent, #00E5FF)' }}
                        fill="none"
                        aria-hidden="true"
                    >
                        <defs>
                            <filter id={ids.ringGlow} x="-20%" y="-20%" width="140%" height="140%">
                                <feGaussianBlur in="SourceGraphic" stdDeviation="1.25" result="blur" />
                                <feMerge>
                                    <feMergeNode in="blur" />
                                    <feMergeNode in="SourceGraphic" />
                                </feMerge>
                            </filter>
                        </defs>
                        <g filter={`url(#${ids.ringGlow})`}>
                            <circle
                                cx="110"
                                cy="110"
                                r="99.5"
                                stroke="currentColor"
                                strokeWidth="1.5"
                                strokeOpacity="0.88"
                            />
                            {/* Top-right elongated orbital capsule pod (~ -32 deg) */}
                            <g transform="translate(194.4, 57.3) rotate(58)">
                                <rect x="-6.2" y="-2.5" width="12.4" height="5" rx="2.5" fill="currentColor" />
                            </g>
                            {/* Bottom-left tapered orbital thruster node (~ 162 deg) */}
                            <g transform="translate(15.4, 140.7) rotate(-108)">
                                <path d="M-6.6 -2.1 L4.2 -3 L7 0 L4.2 3 L-6.6 2.1 Z" fill="currentColor" />
                            </g>
                        </g>
                    </svg>

                    {/* Inner uniform fine dotted telemetry orbit (counter-rotating) */}
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
                            r="85.5"
                            stroke="currentColor"
                            strokeWidth="1.3"
                            strokeOpacity="0.72"
                            strokeDasharray="2.1 5.2"
                            strokeLinecap="round"
                        />
                    </svg>
                </>
            )}

            {/* Main static mechanical vault hatch + carbon dish + glowing cyan emblem */}
            <svg
                viewBox={showReticle ? '0 0 220 220' : '26 26 168 168'}
                className="relative w-full h-full"
                fill="none"
                aria-label="Ludo 3077 Official Emblem"
            >
                <defs>
                    <radialGradient id={ids.shadow} cx="50%" cy="52%" r="50%">
                        <stop offset="68%" stopColor="#000000" stopOpacity="0.78" />
                        <stop offset="86%" stopColor="#000000" stopOpacity="0.38" />
                        <stop offset="100%" stopColor="#000000" stopOpacity="0" />
                    </radialGradient>

                    <linearGradient id={ids.chamfer} x1="18%" y1="14%" x2="84%" y2="86%">
                        <stop offset="0%" stopColor="#7B8796" />
                        <stop offset="22%" stopColor="#4A5360" />
                        <stop offset="54%" stopColor="#1E232A" />
                        <stop offset="84%" stopColor="#0E1217" />
                        <stop offset="100%" stopColor="#313944" />
                    </linearGradient>

                    <linearGradient id={ids.bezel} x1="18%" y1="14%" x2="84%" y2="86%">
                        <stop offset="0%" stopColor="#434C58" />
                        <stop offset="26%" stopColor="#2D343D" />
                        <stop offset="56%" stopColor="#1F242B" />
                        <stop offset="82%" stopColor="#14181E" />
                        <stop offset="100%" stopColor="#282F38" />
                    </linearGradient>

                    <radialGradient id={ids.sheen} cx="30%" cy="22%" r="65%">
                        <stop offset="0%" stopColor="#C2D0DE" stopOpacity="0.22" />
                        <stop offset="45%" stopColor="#768494" stopOpacity="0.06" />
                        <stop offset="100%" stopColor="#000000" stopOpacity="0.24" />
                    </radialGradient>

                    {/* Inverted 3D inner chamfer bevel (dark top-left, lit bottom-right) */}
                    <linearGradient id={ids.innerBevel} x1="18%" y1="16%" x2="82%" y2="84%">
                        <stop offset="0%" stopColor="#07090C" />
                        <stop offset="36%" stopColor="#181D24" />
                        <stop offset="72%" stopColor="#485360" />
                        <stop offset="100%" stopColor="#6F7B8A" />
                    </linearGradient>

                    <linearGradient id={ids.outerEdge} x1="15%" y1="15%" x2="85%" y2="85%">
                        <stop offset="0%" stopColor="#7A8797" stopOpacity="0.65" />
                        <stop offset="42%" stopColor="#222830" stopOpacity="0.5" />
                        <stop offset="100%" stopColor="#06080B" stopOpacity="0.92" />
                    </linearGradient>

                    <radialGradient id={ids.screw} cx="34%" cy="30%" r="72%">
                        <stop offset="0%" stopColor="#7B8897" />
                        <stop offset="42%" stopColor="#37404B" />
                        <stop offset="82%" stopColor="#1B2027" />
                        <stop offset="100%" stopColor="#0D1116" />
                    </radialGradient>

                    <linearGradient id={ids.hingePin} x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="#12161C" />
                        <stop offset="28%" stopColor="#5B6775" />
                        <stop offset="52%" stopColor="#7B8897" />
                        <stop offset="74%" stopColor="#2B323C" />
                        <stop offset="100%" stopColor="#0C0F14" />
                    </linearGradient>

                    <linearGradient id={ids.hingeLug} x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stopColor="#697685" />
                        <stop offset="26%" stopColor="#38414C" />
                        <stop offset="74%" stopColor="#1B2028" />
                        <stop offset="100%" stopColor="#0A0D11" />
                    </linearGradient>

                    {showMicroTexture && (
                        <filter id={ids.metalNoise} x="0%" y="0%" width="100%" height="100%">
                            <feTurbulence
                                type="fractalNoise"
                                baseFrequency="0.065 0.08"
                                numOctaves="3"
                                seed="11"
                                result="noise"
                            />
                            <feColorMatrix
                                in="noise"
                                type="matrix"
                                values="0.35 0 0 0 0.25   0.35 0 0 0 0.28   0.35 0 0 0 0.32   0 0 0 0.16 0"
                            />
                        </filter>
                    )}

                    {/* Diagonal -45 deg 3K carbon-fiber twill weave */}
                    <pattern
                        id={ids.carbon}
                        width="6.5"
                        height="6.5"
                        patternUnits="userSpaceOnUse"
                        patternTransform="rotate(-45)"
                    >
                        <rect width="6.5" height="6.5" fill="#0B0E13" />
                        <rect x="0" y="0" width="3.4" height="2.2" fill="#252D38" />
                        <rect x="3.4" y="0" width="3.1" height="2.2" fill="#10141B" />
                        <rect x="1.6" y="2.2" width="3.4" height="2.1" fill="#2A3340" />
                        <rect x="0" y="2.2" width="1.6" height="2.1" fill="#0E1218" />
                        <rect x="5.0" y="2.2" width="1.5" height="2.1" fill="#0E1218" />
                        <rect x="3.1" y="4.3" width="3.4" height="2.2" fill="#232B36" />
                        <rect x="0" y="4.3" width="3.1" height="2.2" fill="#0F131A" />
                    </pattern>

                    <radialGradient id={ids.vignette} cx="50%" cy="50%" r="50%">
                        <stop offset="0%" stopColor="#000000" stopOpacity="0.04" />
                        <stop offset="56%" stopColor="#000000" stopOpacity="0.22" />
                        <stop offset="84%" stopColor="#030508" stopOpacity="0.72" />
                        <stop offset="100%" stopColor="#010204" stopOpacity="0.96" />
                    </radialGradient>

                    <radialGradient id={ids.cyanWash} cx="50%" cy="52%" r="44%">
                        <stop offset="0%" stopColor="#00E5FF" stopOpacity="0.22" />
                        <stop offset="55%" stopColor="#00E5FF" stopOpacity="0.06" />
                        <stop offset="100%" stopColor="#00E5FF" stopOpacity="0" />
                    </radialGradient>

                    <linearGradient id={ids.diamond} x1="30%" y1="0%" x2="70%" y2="100%">
                        <stop offset="0%" stopColor="#AAFFFF" />
                        <stop offset="50%" stopColor="#70F5FF" />
                        <stop offset="100%" stopColor="#48E6FF" />
                    </linearGradient>

                    <filter id={ids.neon} x="-45%" y="-45%" width="190%" height="190%">
                        <feGaussianBlur in="SourceGraphic" stdDeviation="3.6" result="wide" />
                        <feColorMatrix
                            in="wide"
                            type="matrix"
                            values="0 0 0 0 0   0 0 0 0 0.9   0 0 0 0 1   0 0 0 0.62 0"
                            result="wideCyan"
                        />
                        <feGaussianBlur in="SourceGraphic" stdDeviation="1.15" result="tight" />
                        <feMerge>
                            <feMergeNode in="wideCyan" />
                            <feMergeNode in="tight" />
                            <feMergeNode in="SourceGraphic" />
                        </feMerge>
                    </filter>

                    <mask id={ids.bezelMask}>
                        <circle cx="110" cy="110" r="72.4" fill="white" />
                        <circle cx="110" cy="110" r="57.4" fill="black" />
                    </mask>

                    <clipPath id={ids.dishClip}>
                        <circle cx="110" cy="110" r="52.4" />
                    </clipPath>
                </defs>

                {/* Cast drop shadow */}
                <circle cx="110" cy="113" r="79" fill={`url(#${ids.shadow})`} />

                {/* Heavy forged-titanium bezel */}
                <circle cx="110" cy="110" r="74.6" fill={`url(#${ids.chamfer})`} />
                <circle cx="110" cy="110" r="72.5" fill={`url(#${ids.bezel})`} />
                <circle cx="110" cy="110" r="72.5" fill={`url(#${ids.sheen})`} />

                {/* Organic weathered forged-metal surface + micro-lathe rings */}
                <g mask={`url(#${ids.bezelMask})`}>
                    {showMicroTexture && (
                        <rect x="35" y="35" width="150" height="150" filter={`url(#${ids.metalNoise})`} />
                    )}
                    <circle cx="110" cy="110" r="70.8" stroke="#FFFFFF" strokeOpacity="0.06" strokeWidth="0.6" />
                    <circle cx="110" cy="110" r="67.5" stroke="#000000" strokeOpacity="0.16" strokeWidth="0.7" />
                    <circle cx="110" cy="110" r="61.0" stroke="#000000" strokeOpacity="0.20" strokeWidth="0.7" />
                </g>

                <circle cx="110" cy="110" r="74.0" stroke={`url(#${ids.outerEdge})`} strokeWidth="0.9" />

                {/* Inner 3D stepped bevel rim */}
                <circle cx="110" cy="110" r="58.0" stroke="#080B0F" strokeWidth="1.8" />
                <circle cx="110" cy="110" r="55.2" stroke={`url(#${ids.innerBevel})`} strokeWidth="4.4" />
                <circle cx="110" cy="110" r="52.7" stroke="#040608" strokeWidth="1.6" />

                {/* Seven 3D slotted machine screws */}
                <g>
                    {BEZEL_SCREWS.map((screw, idx) => (
                        <g key={idx} transform={`translate(${screw.cx}, ${screw.cy})`}>
                            <circle r="4.5" fill="#07090C" />
                            <circle r="4.5" stroke="#64707E" strokeOpacity="0.34" strokeWidth="0.6" />
                            <circle r="3.55" fill={`url(#${ids.screw})`} />
                            <g transform={`rotate(${screw.slot})`}>
                                <line
                                    x1="-2.8"
                                    y1="0"
                                    x2="2.8"
                                    y2="0"
                                    stroke="#05070A"
                                    strokeWidth="1.25"
                                    strokeLinecap="round"
                                />
                                <line
                                    x1="-2.5"
                                    y1="0.85"
                                    x2="2.5"
                                    y2="0.85"
                                    stroke="#8C9AAA"
                                    strokeOpacity="0.58"
                                    strokeWidth="0.55"
                                    strokeLinecap="round"
                                />
                            </g>
                        </g>
                    ))}
                </g>

                {/* Heavy articulated vault hinge at 9 o'clock */}
                <g>
                    <rect x="34.5" y="94.5" width="16" height="33.5" rx="2.2" fill="#040609" fillOpacity="0.65" />
                    <rect
                        x="39.5"
                        y="97"
                        width="8.5"
                        height="26"
                        rx="1.2"
                        fill="#161B22"
                        stroke="#090C10"
                        strokeWidth="0.9"
                    />
                    <rect
                        x="31.5"
                        y="96.5"
                        width="8"
                        height="27"
                        rx="1.2"
                        fill={`url(#${ids.hingePin})`}
                        stroke="#080B0F"
                        strokeWidth="0.9"
                    />
                    <line x1="32.2" y1="99.2" x2="38.8" y2="99.2" stroke="#080B0F" strokeWidth="0.9" />
                    <line x1="32.2" y1="120.8" x2="38.8" y2="120.8" stroke="#080B0F" strokeWidth="0.9" />
                    <rect
                        x="29.8"
                        y="92.2"
                        width="18.8"
                        height="5.6"
                        rx="1.3"
                        fill={`url(#${ids.hingeLug})`}
                        stroke="#080B0F"
                        strokeWidth="0.9"
                    />
                    <line
                        x1="31"
                        y1="93.3"
                        x2="47.2"
                        y2="93.3"
                        stroke="#8C9AAA"
                        strokeOpacity="0.45"
                        strokeWidth="0.65"
                    />
                    <rect
                        x="29.8"
                        y="122.2"
                        width="18.8"
                        height="5.6"
                        rx="1.3"
                        fill={`url(#${ids.hingeLug})`}
                        stroke="#080B0F"
                        strokeWidth="0.9"
                    />
                    <line
                        x1="31"
                        y1="123.3"
                        x2="47.2"
                        y2="123.3"
                        stroke="#8C9AAA"
                        strokeOpacity="0.45"
                        strokeWidth="0.65"
                    />
                </g>

                {/* Deep recessed 3K carbon-fiber faceplate */}
                <g clipPath={`url(#${ids.dishClip})`}>
                    <circle cx="110" cy="110" r="52.4" fill={`url(#${ids.carbon})`} />
                    <circle cx="110" cy="110" r="52.4" fill={`url(#${ids.vignette})`} />
                    <circle
                        cx="110"
                        cy="110"
                        r="52.4"
                        fill={`url(#${ids.cyanWash})`}
                        className={showReticle ? 'animate-emblem-core-pulse' : undefined}
                    />
                    <path
                        d="M67 88 A48 48 0 0 1 133 64 A54 54 0 0 0 67 88 Z"
                        fill="#FFFFFF"
                        fillOpacity="0.045"
                    />
                </g>

                {/* Glowing cyan core emblem: solid crown diamond + 3 rotated animated dice */}
                <g filter={`url(#${ids.neon})`} className={showReticle ? 'animate-emblem-core-pulse' : undefined}>
                    <polygon
                        points="110,61.5 124.2,78 110,94.5 95.8,78"
                        fill={`url(#${ids.diamond})`}
                    />

                    {EMBLEM_DICE_POS.map((tile, idx) => {
                        const isTumbling = tumbleMask[idx];
                        const pips = PIP_LAYOUTS[dice[idx]];

                        return (
                            <g key={idx} transform={`translate(${tile.cx}, ${tile.cy}) rotate(45)`}>
                                <g
                                    style={{
                                        transformOrigin: '0px 0px',
                                        transform: isTumbling ? 'scale(0.86)' : 'scale(1)',
                                        opacity: isTumbling ? 0.55 : 1,
                                        transition: 'transform 160ms cubic-bezier(0.22, 1, 0.36, 1), opacity 110ms ease',
                                    }}
                                >
                                    <rect
                                        x="-14.5"
                                        y="-14.5"
                                        width="29"
                                        height="29"
                                        rx="6.6"
                                        fill="rgba(0, 229, 255, 0.08)"
                                        stroke="#6DF5FF"
                                        strokeWidth="2.5"
                                    />
                                    {pips.map(([dx, dy, r], pipIdx) => (
                                        <circle
                                            key={pipIdx}
                                            cx={dx}
                                            cy={dy}
                                            r={r}
                                            fill="#82F8FF"
                                        />
                                    ))}
                                </g>
                            </g>
                        );
                    })}
                </g>
            </svg>
        </div>
    );
}

export default Ludo3077Emblem;
