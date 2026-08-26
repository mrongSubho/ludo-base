import React, { useId } from 'react';

export type PreviewRank = 'Pawn' | 'Knight' | 'Bishop' | 'Rook' | 'Queen' | 'King';

function shadeHex(hex: string, pct: number): string {
    const n = parseInt(hex.replace('#', ''), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const t = pct < 0 ? 0 : 255;
    const p = Math.abs(pct) / 100;
    r = Math.round((t - r) * p + r);
    g = Math.round((t - g) * p + g);
    b = Math.round((t - b) * p + b);
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

const COLORS: Record<string, string> = {
    green: '#22c55e', red: '#ef4444', yellow: '#eab308', blue: '#3b82f6',
};

/* ── SLIM CLASSIC: the pre-chunky generation (slim ludo pawn + rank toppers) ── */
export const ClassicSlimPiece = ({ color, rank }: { color: string; rank: PreviewRank }) => {
    const rawId = useId();
    const id = rawId.replace(/[^a-zA-Z0-9]/g, '');
    const base = COLORS[color] || '#22c55e';
    const hi = shadeHex(base, 58), mid = shadeHex(base, -14), dark = shadeHex(base, -40), deep = shadeHex(base, -66), blackest = shadeHex(base, -82);
    const cyl = `url(#sc-cyl-${id})`;
    const p = { hi, mid, dark, deep, blackest };

    return (
        <svg viewBox="0 0 200 200" className="w-full h-full">
            <defs>
                <linearGradient id={`sc-cyl-${id}`} x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0" stopColor={deep} /><stop offset="0.1" stopColor={dark} />
                    <stop offset="0.28" stopColor={hi} /><stop offset="0.42" stopColor={base} />
                    <stop offset="0.64" stopColor={mid} /><stop offset="0.86" stopColor={dark} />
                    <stop offset="1" stopColor={blackest} />
                </linearGradient>
                <radialGradient id={`sc-hi-${id}`} cx="0.33" cy="0.26" r="0.75">
                    <stop offset="0" stopColor="#fff" stopOpacity="0.95" /><stop offset="0.25" stopColor="#fff" stopOpacity="0.35" /><stop offset="0.58" stopColor="#fff" stopOpacity="0" />
                </radialGradient>
                <radialGradient id={`sc-lo-${id}`} cx="0.42" cy="0.38" r="0.75">
                    <stop offset="0.6" stopColor="#000" stopOpacity="0" /><stop offset="0.88" stopColor={blackest} stopOpacity="0.45" /><stop offset="1" stopColor={blackest} stopOpacity="0.7" />
                </radialGradient>
            </defs>
            <ellipse cx="100" cy="187" rx="46" ry="7" fill="#000" opacity="0.25" />
            {/* skirt */}
            <path d="M 88 108 C 88 126, 81 140, 67 150 C 56 158, 51 168, 51 179 L 51 181 C 51 184.5, 53.5 186, 57 186 L 143 186 C 146.5 186, 149 184.5, 149 181 L 149 179 C 149 168, 144 158, 133 150 C 119 140, 112 126, 112 108 Z" fill={cyl} />
            <ellipse cx="100" cy="182" rx="46" ry="5.5" fill="#000" opacity="0.3" />
            <ellipse cx="100" cy="109" rx="15.5" ry="5.5" fill={cyl} />
            <rect x="90" y="94" width="20" height="18" fill={cyl} />
            <ellipse cx="100" cy="96" rx="17.5" ry="6" fill={cyl} />
            <circle cx="100" cy="66" r="34" fill={cyl} />
            <circle cx="100" cy="66" r="34" fill={`url(#sc-hi-${id})`} />
            <circle cx="100" cy="66" r="34" fill={`url(#sc-lo-${id})`} />
            <ellipse cx="87" cy="48" rx="11" ry="6.5" fill="#fff" opacity="0.95" transform="rotate(-32 87 48)" />
            {rank === 'Knight' && (<g>
                <rect x="72" y="42" width="56" height="15" rx="7.5" fill={cyl} />
                <rect x="79" y="47.5" width="28" height="4.5" rx="2.25" fill="#000" opacity="0.6" />
            </g>)}
            {rank === 'Bishop' && (<g>
                <path d="M 100 4 C 113 15, 118 30, 111 41 C 107 47, 93 47, 89 41 C 82 30, 87 15, 100 4 Z" fill={cyl} />
                <line x1="105" y1="14" x2="95" y2="36" stroke={blackest} strokeWidth="5" strokeLinecap="round" opacity="0.7" />
                <circle cx="100" cy="6.5" r="4.5" fill={cyl} />
            </g>)}
            {rank === 'Rook' && (<g>
                <rect x="70" y="24" width="14" height="16" rx="3.5" fill={cyl} />
                <rect x="93" y="21" width="14" height="19" rx="3.5" fill={cyl} />
                <rect x="116" y="24" width="14" height="16" rx="3.5" fill={cyl} />
                <rect x="68" y="34" width="64" height="9" rx="4.5" fill={cyl} />
            </g>)}
            {rank === 'Queen' && (<g>
                <path d="M 74 42 L 68 22 L 84 32 L 100 12 L 116 32 L 132 22 L 126 42 Z" fill={cyl} />
                <rect x="72" y="40" width="56" height="9" rx="4.5" fill={cyl} />
                <circle cx="68" cy="19" r="4.5" fill={cyl} /><circle cx="100" cy="9" r="5" fill={cyl} /><circle cx="132" cy="19" r="4.5" fill={cyl} />
            </g>)}
            {rank === 'King' && (<g>
                <rect x="76" y="34" width="48" height="12" rx="6" fill={cyl} />
                <rect x="95.5" y="2" width="9" height="34" rx="4.5" fill={cyl} />
                <rect x="84" y="10" width="32" height="9" rx="4.5" fill={cyl} />
            </g>)}
        </svg>
    );
};

/* ── ORIGINAL v1: the committed "candy apple gloss" chess set ── */
export const OriginalPiece = ({ color, rank }: { color: string; rank: PreviewRank }) => {
    const rawId = useId();
    const id = rawId.replace(/[^a-zA-Z0-9]/g, '');
    const base = COLORS[color] || '#22c55e';
    const vol = `url(#ov-${id})`;

    const Gradients = () => (
        <defs>
            <radialGradient id={`ov-${id}`} cx="30%" cy="25%" r="75%">
                <stop offset="0%" stopColor="#ffffff" stopOpacity="0.85" />
                <stop offset="15%" stopColor={base} stopOpacity="1" />
                <stop offset="45%" stopColor={base} stopOpacity="1" />
                <stop offset="95%" stopColor="#000000" stopOpacity="0.75" />
                <stop offset="100%" stopColor="#000000" stopOpacity="0.85" />
            </radialGradient>
        </defs>
    );

    const TactileBase = () => (
        <g>
            <rect x="40" y="165" width="120" height="25" rx="12" fill={vol} />
            <ellipse cx="60" cy="170" rx="15" ry="5" fill="#ffffff" opacity="0.6" transform="rotate(-10 60 170)" />
            <rect x="55" y="145" width="90" height="25" rx="12" fill={vol} />
            <ellipse cx="72" cy="150" rx="10" ry="3" fill="#ffffff" opacity="0.5" transform="rotate(-10 72 150)" />
        </g>
    );

    return (
        <svg viewBox="0 0 200 200" className="w-full h-full">
            <Gradients />
            <TactileBase />
            {rank === 'Pawn' && (<g>
                <path d="M75 155 L125 155 L115 85 L85 85 Z" fill={vol} />
                <circle cx="100" cy="65" r="35" fill={vol} />
                <ellipse cx="82" cy="45" rx="12" ry="6" fill="#ffffff" opacity="0.9" transform="rotate(-35 82 45)" />
                <rect x="75" y="90" width="50" height="15" rx="7.5" fill={vol} />
            </g>)}
            {rank === 'Rook' && (<g>
                <path d="M70 155 L130 155 L125 65 L75 65 Z" fill={vol} />
                <rect x="65" y="45" width="70" height="20" rx="10" fill={vol} />
                <rect x="68" y="25" width="16" height="25" rx="8" fill={vol} />
                <rect x="92" y="25" width="16" height="25" rx="8" fill={vol} />
                <rect x="116" y="25" width="16" height="25" rx="8" fill={vol} />
            </g>)}
            {rank === 'Knight' && (<g>
                <path d="M70 155 L130 155 L120 100 L80 100 Z" fill={vol} />
                <rect x="70" y="95" width="60" height="15" rx="7.5" fill={vol} />
                <path d="M 125 100 C 145 60, 110 20, 95 35 C 70 60, 45 40, 45 60 C 45 80, 65 95, 80 105 Z" fill={vol} />
            </g>)}
            {rank === 'Bishop' && (<g>
                <path d="M70 155 L130 155 L115 90 L85 90 Z" fill={vol} />
                <path d="M 85 85 C 55 50, 65 15, 100 15 C 135 15, 145 50, 115 85 Z" fill={vol} />
                <path d="M 95 30 L 75 55" stroke="rgba(0,0,0,0.5)" strokeWidth="6" strokeLinecap="round" />
                <circle cx="100" cy="10" r="10" fill={vol} />
            </g>)}
            {rank === 'Queen' && (<g>
                <path d="M65 155 L135 155 L120 70 L80 70 Z" fill={vol} />
                <rect x="70" y="65" width="60" height="15" rx="7.5" fill={vol} />
                <path d="M 80 70 L 60 30 L 75 55 L 90 20 L 100 50 L 110 20 L 125 55 L 140 30 L 120 70 Z" fill={vol} stroke={base} strokeWidth="8" strokeLinejoin="round" />
                <circle cx="60" cy="30" r="10" fill={vol} /><circle cx="90" cy="20" r="10" fill={vol} />
                <circle cx="110" cy="20" r="10" fill={vol} /><circle cx="140" cy="30" r="10" fill={vol} />
            </g>)}
            {rank === 'King' && (<g>
                <path d="M65 155 L135 155 L120 100 L80 100 Z" fill={vol} />
                <rect x="70" y="95" width="60" height="15" rx="7.5" fill={vol} />
                <path d="M 75 100 L 55 50 C 80 30, 120 30, 145 50 L 125 100 Z" fill={vol} />
                <rect x="92" y="10" width="16" height="40" rx="8" fill={vol} />
                <rect x="80" y="20" width="40" height="16" rx="8" fill={vol} />
                <ellipse cx="80" cy="65" rx="14" ry="7" fill="#ffffff" opacity="0.8" transform="rotate(-25 80 65)" />
            </g>)}
        </svg>
    );
};

/* ── SOFT RENDER v5: painted-3D technique ──────────────────────────────
   Blurred light/shadow layers + saturated color shadows + studio key
   light. Mimics how rendered game tokens actually shade.            */
const SOFT_COLORS: Record<string, string> = {
    green: '#31d158', red: '#ff4d4d', yellow: '#ffc82e', blue: '#3f8dff',
};

export const SoftRenderPiece = ({ color, rank }: { color: string; rank: PreviewRank }) => {
    const rawId = useId();
    const id = rawId.replace(/[^a-zA-Z0-9]/g, '');
    const base = SOFT_COLORS[color] || '#31d158';
    const lit = shadeHex(base, 55);
    const lite = shadeHex(base, 30);
    const shd = shadeHex(base, -22);
    const shd2 = shadeHex(base, -34);
    const edge = shadeHex(base, -44);
    const body = `url(#sr-body-${id})`;
    const blur = (n: number) => `url(#sr-blur${n}-${id})`;

    const SKIRT = "M 82 126 C 79 148, 62 165, 45 175 C 37 179, 33 183, 33 188 Q 33 192.5, 40 192.5 L 160 192.5 Q 167 192.5, 167 188 C 167 183, 163 179, 155 175 C 138 165, 121 148, 118 126 Z";

    return (
        <svg viewBox="0 0 200 200" className="w-full h-full">
            <defs>
                <linearGradient id={`sr-body-${id}`} x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0" stopColor={shd2} />
                    <stop offset="0.10" stopColor={base} />
                    <stop offset="0.26" stopColor={lit} />
                    <stop offset="0.46" stopColor={base} />
                    <stop offset="0.72" stopColor={shd} />
                    <stop offset="0.92" stopColor={shd2} />
                    <stop offset="1" stopColor={edge} />
                </linearGradient>
                <filter id={`sr-blur2-${id}`} x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="2.2" /></filter>
                <filter id={`sr-blur4-${id}`} x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="4.5" /></filter>
                <filter id={`sr-blur7-${id}`} x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="7" /></filter>
                <clipPath id={`sr-sk-${id}`}><path d={SKIRT} /></clipPath>
                <radialGradient id={`sr-key-${id}`} cx="0.5" cy="0.5" r="0.5">
                    <stop offset="0" stopColor="#ffffff" stopOpacity="0.95" />
                    <stop offset="0.45" stopColor="#ffffff" stopOpacity="0.55" />
                    <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
                </radialGradient>
                <radialGradient id={`sr-gsh-${id}`} cx="0.5" cy="0.5" r="0.5">
                    <stop offset="0" stopColor="#000000" stopOpacity="0.38" />
                    <stop offset="0.6" stopColor="#000000" stopOpacity="0.18" />
                    <stop offset="1" stopColor="#000000" stopOpacity="0" />
                </radialGradient>
            </defs>

            {/* grounded soft shadow */}
            <ellipse cx="100" cy="193" rx="64" ry="9" fill={`url(#sr-gsh-${id})`} filter={blur(4)} />

            {/* toppers BEHIND head for bishop only */}
            {rank === 'Bishop' && (
                <g>
                    <path d="M 100 -2 C 117 12, 124 32, 114 46 C 108 55, 92 55, 86 46 C 76 32, 83 12, 100 -2 Z" fill={body} stroke={edge} strokeOpacity="0.4" strokeWidth="2.5" />
                    <line x1="108" y1="14" x2="95" y2="40" stroke={edge} strokeWidth="6.5" strokeLinecap="round" opacity="0.7" filter={blur(2)} />
                    <ellipse cx="90" cy="18" rx="5" ry="9" fill="#ffffff" opacity="0.55" transform="rotate(18 90 18)" filter={blur(2)} />
                    <circle cx="100" cy="1" r="6" fill={body} />
                    <circle cx="98" cy="-0.5" r="2" fill="#fff" opacity="0.9" />
                </g>
            )}

            {/* SKIRT */}
            <path d={SKIRT} fill={body} stroke={edge} strokeOpacity="0.42" strokeWidth="2.6" strokeLinejoin="round" />
            <g clipPath={`url(#sr-sk-${id})`}>
                <ellipse cx="132" cy="160" rx="34" ry="48" fill={shd} opacity="0.55" filter={blur(7)} />
                <rect x="20" y="168" width="160" height="26" fill={edge} opacity="0.4" filter={blur(4)} />
                <ellipse cx="100" cy="186" rx="56" ry="10" fill="#ffffff" opacity="0.30" filter={blur(4)} />
                <path d="M 82 132 C 78 152, 62 168, 46 178" stroke="#ffffff" strokeWidth="7" opacity="0.4" fill="none" strokeLinecap="round" filter={blur(4)} />
            </g>

            {/* waist + collar */}
            <ellipse cx="100" cy="126" rx="21" ry="7" fill={body} />
            <ellipse cx="100" cy="124.6" rx="15" ry="3" fill="#ffffff" opacity="0.5" filter={blur(2)} />
            <ellipse cx="100" cy="130" rx="19" ry="4.5" fill={edge} opacity="0.35" filter={blur(2)} />
            <rect x="84" y="98" width="32" height="32" fill={body} />
            <ellipse cx="100" cy="107" rx="24" ry="7.5" fill={body} />
            <ellipse cx="100" cy="105.4" rx="17" ry="3.2" fill="#ffffff" opacity="0.5" filter={blur(2)} />
            <ellipse cx="100" cy="112.5" rx="22" ry="4.5" fill={edge} opacity="0.32" filter={blur(2)} />

            {/* DOME HEAD */}
            <circle cx="100" cy="64" r="46" fill={body} stroke={edge} strokeOpacity="0.4" strokeWidth="2.6" />
            {/* key light: big soft wash upper-left */}
            <circle cx="86" cy="50" r="34" fill={`url(#sr-key-${id})`} filter={blur(4)} />
            {/* hot core of the highlight */}
            <ellipse cx="80" cy="43" rx="10" ry="6.5" fill="#ffffff" opacity="0.95" transform="rotate(-32 80 43)" filter={blur(2)} />
            {/* bounce light lower-right */}
            <ellipse cx="114" cy="98" rx="24" ry="11" fill={lit} opacity="0.5" filter={blur(4)} />
            {/* right ambient occlusion where head meets collar */}
            <ellipse cx="100" cy="104" rx="30" ry="8" fill={edge} opacity="0.35" filter={blur(4)} />

            {/* toppers IN FRONT for the rest */}
            {rank === 'Knight' && (
                <g>
                    <rect x="60" y="40" width="80" height="18" rx="9" fill={body} stroke={edge} strokeOpacity="0.4" strokeWidth="2.5" />
                    <rect x="69" y="46.5" width="40" height="6" rx="3" fill={edge} opacity="0.75" filter={blur(2)} />
                    <ellipse cx="76" cy="43.5" rx="12" ry="2.6" fill="#fff" opacity="0.6" filter={blur(2)} />
                </g>
            )}
            {rank === 'Rook' && (
                <g>
                    <rect x="54" y="4" width="19" height="26" rx="5" fill={body} stroke={edge} strokeOpacity="0.4" strokeWidth="2.4" />
                    <rect x="90.5" y="2" width="19" height="28" rx="5" fill={body} stroke={edge} strokeOpacity="0.4" strokeWidth="2.4" />
                    <rect x="127" y="4" width="19" height="26" rx="5" fill={body} stroke={edge} strokeOpacity="0.4" strokeWidth="2.4" />
                    <rect x="52" y="22" width="96" height="13" rx="6.5" fill={body} stroke={edge} strokeOpacity="0.4" strokeWidth="2.4" />
                    <ellipse cx="62" cy="9" rx="5" ry="2.4" fill="#fff" opacity="0.55" filter={blur(2)} />
                    <ellipse cx="98" cy="7" rx="5" ry="2.4" fill="#fff" opacity="0.55" filter={blur(2)} />
                    <ellipse cx="135" cy="9" rx="5" ry="2.4" fill="#fff" opacity="0.45" filter={blur(2)} />
                    <ellipse cx="70" cy="26.5" rx="14" ry="2.6" fill="#fff" opacity="0.5" filter={blur(2)} />
                </g>
            )}
            {rank === 'Queen' && (
                <g>
                    <path d="M 76 48 L 66 10 L 87 25 L 100 -1 L 113 25 L 134 10 L 124 48 Z" fill={body} stroke={edge} strokeOpacity="0.4" strokeWidth="2.5" strokeLinejoin="round" />
                    <path d="M 76 48 L 66 10 L 87 25 L 96 42 Z" fill="#ffffff" opacity="0.28" filter={blur(2)} />
                    <rect x="73" y="46" width="54" height="12" rx="6" fill={body} stroke={edge} strokeOpacity="0.4" strokeWidth="2.5" />
                    <ellipse cx="84" cy="50" rx="10" ry="2.6" fill="#fff" opacity="0.55" filter={blur(2)} />
                    <circle cx="66" cy="7" r="5.5" fill={body} /><circle cx="100" cy="-2" r="6" fill={body} /><circle cx="134" cy="7" r="5.5" fill={body} />
                    <circle cx="64.5" cy="5.5" r="1.8" fill="#fff" opacity="0.9" /><circle cx="98.2" cy="-3.5" r="2" fill="#fff" opacity="0.9" /><circle cx="132.5" cy="5.5" r="1.8" fill="#fff" opacity="0.9" />
                </g>
            )}
            {rank === 'King' && (
                <g>
                    <rect x="74" y="32" width="52" height="13" rx="6.5" fill={body} stroke={edge} strokeOpacity="0.4" strokeWidth="2.5" />
                    <ellipse cx="88" cy="36" rx="10" ry="2.6" fill="#fff" opacity="0.55" filter={blur(2)} />
                    <rect x="95.5" y="-2" width="9" height="36" rx="4.5" fill={body} stroke={edge} strokeOpacity="0.4" strokeWidth="2.4" />
                    <rect x="83" y="6" width="34" height="9" rx="4.5" fill={body} stroke={edge} strokeOpacity="0.4" strokeWidth="2.4" />
                    <rect x="97.5" y="0.5" width="3" height="30" rx="1.5" fill="#fff" opacity="0.5" filter={blur(2)} />
                </g>
            )}
        </svg>
    );
};

/* ── STANDING v6: elevated-camera perspective ──────────────────────────
   Camera ~25° above → foot disc reads as an ellipse, rings are
   foreshortened, piece visually stands upright on the board.        */
export const StandingPiece = ({ color, rank }: { color: string; rank: PreviewRank }) => {
    const rawId = useId();
    const id = rawId.replace(/[^a-zA-Z0-9]/g, '');
    const base = SOFT_COLORS[color] || '#31d158';
    const lit = shadeHex(base, 55);
    const shd = shadeHex(base, -20);
    const shd2 = shadeHex(base, -32);
    const edge = shadeHex(base, -42);
    const body = `url(#st-body-${id})`;
    const blur = (n: number) => `url(#sr-blur${n}-${id})`;

    return (
        <svg viewBox="0 0 200 200" className="w-full h-full">
            <defs>
                <linearGradient id={`st-body-${id}`} x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0" stopColor={shd2} /><stop offset="0.10" stopColor={base} />
                    <stop offset="0.26" stopColor={lit} /><stop offset="0.46" stopColor={base} />
                    <stop offset="0.72" stopColor={shd} /><stop offset="0.92" stopColor={shd2} />
                    <stop offset="1" stopColor={edge} />
                </linearGradient>
                <linearGradient id={`st-foot-${id}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor={shd} /><stop offset="0.55" stopColor={shd2} /><stop offset="1" stopColor={edge} />
                </linearGradient>
                <clipPath id={`st-sk-${id}`}>
                    <path d="M 82 106 C 78 128, 62 150, 47 163 C 42 168, 40 171.5, 41 175 L 159 175 C 160 171.5, 158 168, 153 163 C 138 150, 122 128, 118 106 Z" />
                </clipPath>
            </defs>

            {/* grounded shadow */}
            <ellipse cx="100" cy="189" rx="66" ry="10" fill={`url(#sr-gsh-${id})`} filter={blur(4)} />

            {/* visible foot disc — the "standing" cue */}
            <ellipse cx="100" cy="175" rx="56" ry="14" fill={`url(#st-foot-${id})`} stroke={edge} strokeOpacity="0.45" strokeWidth="2" />
            <path d="M 52 180 C 70 186.5, 130 186.5, 148 180" stroke={lit} strokeWidth="2.6" opacity="0.6" fill="none" strokeLinecap="round" filter={blur(2)} />

            {/* bishop mitre behind head */}
            {rank === 'Bishop' && (
                <g>
                    <path d="M 100 13 C 116 26, 122 43, 113 55 C 107 63, 93 63, 87 55 C 78 43, 84 26, 100 13 Z" fill={body} stroke={edge} strokeOpacity="0.4" strokeWidth="2.4" />
                    <line x1="108" y1="29" x2="96" y2="51" stroke={edge} strokeWidth="6" strokeLinecap="round" opacity="0.65" filter={blur(2)} />
                    <circle cx="100" cy="16" r="5.5" fill={body} stroke={edge} strokeOpacity="0.4" strokeWidth="2" />
                    <ellipse cx="90" cy="33" rx="4.5" ry="8" fill="#fff" opacity="0.5" transform="rotate(18 90 33)" filter={blur(2)} />
                </g>
            )}

            {/* skirt cone */}
            <path d="M 82 106 C 78 128, 62 150, 47 163 C 42 168, 40 171.5, 41 175 L 159 175 C 160 171.5, 158 168, 153 163 C 138 150, 122 128, 118 106 Z" fill={body} stroke={edge} strokeOpacity="0.35" strokeWidth="2.4" strokeLinejoin="round" />
            <g clipPath={`url(#st-sk-${id})`}>
                <ellipse cx="130" cy="152" rx="32" ry="42" fill={shd} opacity="0.5" filter={blur(7)} />
                <rect x="20" y="161" width="160" height="17" fill={edge} opacity="0.38" filter={blur(4)} />
                <path d="M 82 110 C 77 130, 62 149, 48 160" stroke="#ffffff" strokeWidth="7" opacity="0.38" fill="none" strokeLinecap="round" filter={blur(4)} />
                <ellipse cx="100" cy="172" rx="52" ry="7" fill="#ffffff" opacity="0.25" filter={blur(4)} />
            </g>

            {/* waist ring + neck + collar (foreshortened ellipses) */}
            <ellipse cx="100" cy="107" rx="20" ry="7" fill={body} stroke={edge} strokeOpacity="0.3" strokeWidth="1.8" />
            <ellipse cx="100" cy="105.6" rx="13" ry="3" fill="#ffffff" opacity="0.45" filter={blur(2)} />
            <rect x="85" y="84" width="30" height="26" fill={body} />
            <ellipse cx="100" cy="90" rx="23" ry="8" fill={body} stroke={edge} strokeOpacity="0.3" strokeWidth="1.8" />
            <ellipse cx="100" cy="88.4" rx="16" ry="3.4" fill="#ffffff" opacity="0.5" filter={blur(2)} />

            {/* dome head */}
            <circle cx="100" cy="59" r="43" fill={body} stroke={edge} strokeOpacity="0.38" strokeWidth="2.4" />
            <circle cx="87" cy="46" r="33" fill={`url(#sr-key-${id})`} filter={blur(4)} />
            <ellipse cx="81" cy="40" rx="10" ry="6.5" fill="#ffffff" opacity="0.95" transform="rotate(-32 81 40)" filter={blur(2)} />
            <ellipse cx="113" cy="93" rx="23" ry="10" fill={lit} opacity="0.45" filter={blur(4)} />
            <ellipse cx="100" cy="97" rx="29" ry="7.5" fill={edge} opacity="0.35" filter={blur(4)} />

            {/* toppers in front */}
            {rank === 'Knight' && (
                <g>
                    <rect x="61" y="35" width="78" height="17" rx="8.5" fill={body} stroke={edge} strokeOpacity="0.4" strokeWidth="2.4" />
                    <rect x="70" y="41" width="38" height="5.5" rx="2.75" fill={edge} opacity="0.75" filter={blur(2)} />
                    <ellipse cx="77" cy="38.5" rx="12" ry="2.5" fill="#fff" opacity="0.55" filter={blur(2)} />
                </g>
            )}
            {rank === 'Rook' && (
                <g>
                    <rect x="56" y="1" width="18" height="22" rx="4.5" fill={body} stroke={edge} strokeOpacity="0.4" strokeWidth="2.3" />
                    <rect x="91" y="0" width="18" height="23" rx="4.5" fill={body} stroke={edge} strokeOpacity="0.4" strokeWidth="2.3" />
                    <rect x="126" y="1" width="18" height="22" rx="4.5" fill={body} stroke={edge} strokeOpacity="0.4" strokeWidth="2.3" />
                    <rect x="54" y="19" width="92" height="12" rx="6" fill={body} stroke={edge} strokeOpacity="0.4" strokeWidth="2.3" />
                    <ellipse cx="64" cy="5" rx="5" ry="2.3" fill="#fff" opacity="0.5" filter={blur(2)} />
                    <ellipse cx="99" cy="4" rx="5" ry="2.3" fill="#fff" opacity="0.5" filter={blur(2)} />
                    <ellipse cx="134" cy="5" rx="5" ry="2.3" fill="#fff" opacity="0.45" filter={blur(2)} />
                </g>
            )}
            {rank === 'Queen' && (
                <g>
                    <path d="M 77 53 L 68 17 L 88 31 L 100 4 L 112 31 L 132 17 L 123 53 Z" fill={body} stroke={edge} strokeOpacity="0.4" strokeWidth="2.4" strokeLinejoin="round" />
                    <rect x="74" y="51" width="52" height="11" rx="5.5" fill={body} stroke={edge} strokeOpacity="0.4" strokeWidth="2.4" />
                    <ellipse cx="85" cy="55" rx="9" ry="2.4" fill="#fff" opacity="0.5" filter={blur(2)} />
                    <circle cx="68" cy="14" r="5" fill={body} stroke={edge} strokeOpacity="0.4" strokeWidth="2" />
                    <circle cx="100" cy="3" r="5.5" fill={body} stroke={edge} strokeOpacity="0.4" strokeWidth="2" />
                    <circle cx="132" cy="14" r="5" fill={body} stroke={edge} strokeOpacity="0.4" strokeWidth="2" />
                </g>
            )}
            {rank === 'King' && (
                <g>
                    <rect x="75" y="35" width="50" height="12" rx="6" fill={body} stroke={edge} strokeOpacity="0.4" strokeWidth="2.4" />
                    <ellipse cx="89" cy="39" rx="9" ry="2.4" fill="#fff" opacity="0.5" filter={blur(2)} />
                    <rect x="95.5" y="1" width="9" height="36" rx="4.5" fill={body} stroke={edge} strokeOpacity="0.4" strokeWidth="2.3" />
                    <rect x="84" y="9" width="32" height="9" rx="4.5" fill={body} stroke={edge} strokeOpacity="0.4" strokeWidth="2.3" />
                    <rect x="97.5" y="3.5" width="3" height="30" rx="1.5" fill="#fff" opacity="0.5" filter={blur(2)} />
                </g>
            )}
        </svg>
    );
};
