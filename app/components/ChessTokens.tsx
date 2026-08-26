import React, { useId } from 'react';

export type ChessRank = 'Pawn' | 'Knight' | 'Bishop' | 'Rook' | 'Queen' | 'King';

export const RANK_ORDER: Record<ChessRank, number> = {
    Pawn: 0,
    Knight: 1,
    Bishop: 2,
    Rook: 3,
    Queen: 4,
    King: 5,
};

export function getTokenRank(position: number): ChessRank {
    if (position === -1) return 'Pawn';
    if (position >= 0 && position <= 17) return 'Knight';
    if (position >= 18 && position <= 34) return 'Bishop';
    if (position >= 35 && position <= 51) return 'Rook';
    if (position >= 52 && position <= 56) return 'Queen';
    if (position === 57) return 'King';
    return 'Pawn'; // Fallback
}

export function shade(hex: string, pct: number): string {
    const n = parseInt(hex.replace('#', ''), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const t = pct < 0 ? 0 : 255;
    const p = Math.abs(pct) / 100;
    r = Math.round((t - r) * p + r);
    g = Math.round((t - g) * p + g);
    b = Math.round((t - b) * p + b);
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

interface ChessPieceProps {
    color: string;
    rank: ChessRank;
    className?: string;
}

const colorMap: Record<string, string> = {
    green: '#2ecc40',
    red: '#f44336',
    yellow: '#ffc107',
    blue: '#3b82f6',
};

type Palette = {
    base: string; hi: string; light: string; mid: string; dark: string; deep: string; blackest: string;
};

function palette(color: string): Palette {
    const base = colorMap[color] || (color.startsWith('#') ? color : '#2ecc40');
    return {
        base,
        hi: shade(base, 62),
        light: shade(base, 34),
        mid: shade(base, -10),
        dark: shade(base, -30),
        deep: shade(base, -52),
        blackest: shade(base, -70),
    };
}

/* Candy-plastic material: bright center-left key light, gentle edge falloff */
const GlossDefs = ({ id, p }: { id: string; p: Palette }) => (
    <defs>
        <linearGradient id={`cyl-${id}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor={p.dark} />
            <stop offset="0.09" stopColor={p.base} />
            <stop offset="0.26" stopColor={p.hi} />
            <stop offset="0.46" stopColor={p.base} />
            <stop offset="0.72" stopColor={p.mid} />
            <stop offset="0.90" stopColor={p.dark} />
            <stop offset="1" stopColor={p.deep} />
        </linearGradient>
        <radialGradient id={`sphhi-${id}`} cx="0.32" cy="0.24" r="0.78">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0.95" />
            <stop offset="0.28" stopColor="#ffffff" stopOpacity="0.30" />
            <stop offset="0.60" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`sphlo-${id}`} cx="0.44" cy="0.36" r="0.78">
            <stop offset="0" stopColor="#000000" stopOpacity="0" />
            <stop offset="0.68" stopColor="#000000" stopOpacity="0" />
            <stop offset="0.90" stopColor={p.blackest} stopOpacity="0.30" />
            <stop offset="1" stopColor={p.blackest} stopOpacity="0.48" />
        </radialGradient>
        <linearGradient id={`ao-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#000000" stopOpacity="0" />
            <stop offset="1" stopColor="#000000" stopOpacity="0.35" />
        </linearGradient>
        <radialGradient id={`gshadow-${id}`} cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#000000" stopOpacity="0.40" />
            <stop offset="0.7" stopColor="#000000" stopOpacity="0.14" />
            <stop offset="1" stopColor="#000000" stopOpacity="0" />
        </radialGradient>
    </defs>
);

const Spec = ({ cx, cy, rx, ry, rot = 0, o = 0.9 }: { cx: number; cy: number; rx: number; ry: number; rot?: number; o?: number }) => (
    <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="#ffffff" opacity={o} transform={`rotate(${rot} ${cx} ${cy})`} />
);

const ShineStrip = ({ x, y, w, h, o = 0.5 }: { x: number; y: number; w: number; h: number; o?: number }) => (
    <rect x={x} y={y} width={w} height={h} rx={h / 2} fill="#ffffff" opacity={o} />
);

/* Classic chunky ludo pawn: wide flared skirt, waist ring, big dome head */
const PawnBody = ({ id, p }: { id: string; p: Palette }) => {
    const cyl = `url(#cyl-${id})`;
    return (
        <g>
            {/* contact shadow */}
            <ellipse cx="100" cy="194" rx="66" ry="8" fill={`url(#gshadow-${id})`} />
            {/* flared skirt */}
            <path d="M 84 128 C 81 150, 63 167, 45 177 C 38 181, 35 184, 35 189 Q 35 193, 41 193 L 159 193 Q 165 193, 165 189 C 165 184, 162 181, 155 177 C 137 167, 119 150, 116 128 Z" fill={cyl} stroke={p.deep} strokeOpacity="0.35" strokeWidth="2.5" />
            {/* left rim light carving the silhouette */}
            <path d="M 84 128 C 81 150, 63 167, 45 177" stroke={p.hi} strokeWidth="3" opacity="0.55" fill="none" strokeLinecap="round" />
            {/* bottom rim thickness + front reflected light */}
            <ellipse cx="100" cy="190" rx="64" ry="7.5" fill={`url(#ao-${id})`} opacity="0.7" />
            <path d="M 48 189 C 68 193.5, 132 193.5, 152 189" stroke={p.light} strokeWidth="2.4" opacity="0.7" fill="none" strokeLinecap="round" />
            {/* skirt sheen / core shadow */}
            <path d="M 80 140 C 75 158, 62 171, 50 179 C 64 173, 78 158, 83 138 Z" fill="#ffffff" opacity="0.30" />
            <path d="M 120 138 C 125 156, 138 171, 150 179 C 136 173, 122 158, 117 136 Z" fill={p.blackest} opacity="0.26" />
            {/* waist ring */}
            <ellipse cx="100" cy="127" rx="21" ry="6.5" fill={cyl} />
            <ShineStrip x={87} y={124.5} w={17} h={2.6} o={0.6} />
            {/* neck + collar */}
            <rect x="86" y="100" width="28" height="30" fill={cyl} />
            <ellipse cx="100" cy="109" rx="24" ry="7" fill={cyl} />
            <ShineStrip x={86} y={106} w={18} h={2.8} o={0.55} />
            {/* dome head */}
            <circle cx="100" cy="72" r="44" fill={cyl} stroke={p.deep} strokeOpacity="0.3" strokeWidth="2.5" />
            <circle cx="100" cy="72" r="44" fill={`url(#sphhi-${id})`} />
            <circle cx="100" cy="72" r="44" fill={`url(#sphlo-${id})`} />
            {/* left rim light on the dome */}
            <path d="M 62 42 C 54 52, 52 66, 56 80" stroke={p.hi} strokeWidth="3.5" opacity="0.6" fill="none" strokeLinecap="round" />
            <Spec cx={82} cy={49} rx={15} ry={9} rot={-30} o={0.97} />
            <Spec cx={94} cy={40} rx={4.5} ry={3} rot={-20} o={0.85} />
            <Spec cx={123} cy={94} rx={5} ry={3} rot={-15} o={0.35} />
        </g>
    );
};

export const ChessPiece = ({ color, rank, className = '' }: ChessPieceProps) => {
    const p = palette(color);
    const rawId = useId();
    const id = rawId.replace(/[^a-zA-Z0-9]/g, '');
    const cyl = `url(#cyl-${id})`;

    const svgProps = {
        viewBox: "0 0 200 200",
        className: `w-full h-full transform scale-[1.22] origin-bottom drop-shadow-[3px_8px_6px_rgba(0,0,0,0.5)] ${className}`,
    };

    switch (rank) {
        case 'Pawn':
            return (
                <svg {...svgProps}>
                    <GlossDefs id={id} p={p} />
                    <PawnBody id={id} p={p} />
                </svg>
            );

        case 'Knight':
            return (
                <svg {...svgProps}>
                    <GlossDefs id={id} p={p} />
                    <PawnBody id={id} p={p} />
                    {/* helmet visor */}
                    <rect x="62" y="46" width="76" height="17" rx="8.5" fill={cyl} />
                    <rect x="62" y="46" width="76" height="17" rx="8.5" fill={p.blackest} opacity="0.20" />
                    <rect x="70" y="52" width="38" height="5.5" rx="2.75" fill="#000000" opacity="0.6" />
                    <ShineStrip x={67} y={48.5} w={26} h={3} o={0.65} />
                    <Spec cx={131} cy={53} rx={4} ry={2} rot={-10} o={0.85} />
                </svg>
            );

        case 'Bishop':
            return (
                <svg {...svgProps}>
                    <GlossDefs id={id} p={p} />
                    {/* mitre tip (behind dome) */}
                    <path d="M 100 4 C 116 17, 122 34, 113 47 C 108 55, 92 55, 87 47 C 78 34, 84 17, 100 4 Z" fill={cyl} />
                    <line x1="107" y1="16" x2="95" y2="42" stroke={p.blackest} strokeWidth="6" strokeLinecap="round" opacity="0.65" />
                    <line x1="106" y1="15.5" x2="94.5" y2="41" stroke="#000000" strokeWidth="1.8" strokeLinecap="round" opacity="0.5" />
                    <Spec cx={89} cy={18} rx={4} ry={7} rot={18} o={0.65} />
                    <circle cx="100" cy="6" r="5.5" fill={cyl} />
                    <circle cx="98.6" cy="4.8" r="1.7" fill="#ffffff" opacity="0.9" />
                    <PawnBody id={id} p={p} />
                </svg>
            );

        case 'Rook':
            return (
                <svg {...svgProps}>
                    <GlossDefs id={id} p={p} />
                    <PawnBody id={id} p={p} />
                    {/* battlement crown */}
                    <rect x="58" y="8" width="17" height="22" rx="4" fill={cyl} />
                    <rect x="91.5" y="6" width="17" height="24" rx="4" fill={cyl} />
                    <rect x="125" y="8" width="17" height="22" rx="4" fill={cyl} />
                    <rect x="58" y="8" width="17" height="22" rx="4" fill={p.blackest} opacity="0.14" />
                    <rect x="125" y="8" width="17" height="22" rx="4" fill={p.blackest} opacity="0.24" />
                    <rect x="56" y="24" width="88" height="11" rx="5.5" fill={cyl} />
                    <ShineStrip x={61} y={11} w={9} h={2.8} o={0.6} />
                    <ShineStrip x={94.5} y={9} w={9} h={2.8} o={0.6} />
                    <ShineStrip x={128} y={11} w={9} h={2.8} o={0.5} />
                    <ShineStrip x={62} y={26.5} w={26} h={2.8} o={0.55} />
                </svg>
            );

        case 'Queen':
            return (
                <svg {...svgProps}>
                    <GlossDefs id={id} p={p} />
                    <PawnBody id={id} p={p} />
                    {/* five-point crown */}
                    <path d="M 78 48 L 69 14 L 88 27 L 100 3 L 112 27 L 131 14 L 122 48 Z" fill={cyl} />
                    <path d="M 78 48 L 69 14 L 88 27 L 97 42 Z" fill="#ffffff" opacity="0.25" />
                    <path d="M 122 48 L 131 14 L 112 27 L 103 42 Z" fill={p.blackest} opacity="0.24" />
                    <rect x="74" y="46" width="52" height="11" rx="5.5" fill={cyl} />
                    <ShineStrip x={79} y={48.5} w={20} h={2.8} o={0.6} />
                    <circle cx="69" cy="11" r="5" fill={cyl} />
                    <circle cx="100" cy="5" r="5.5" fill={cyl} />
                    <circle cx="131" cy="11" r="5" fill={cyl} />
                    <circle cx="67.6" cy="9.6" r="1.6" fill="#ffffff" opacity="0.9" />
                    <circle cx="98.4" cy="3.6" r="1.7" fill="#ffffff" opacity="0.9" />
                    <circle cx="129.6" cy="9.6" r="1.6" fill="#ffffff" opacity="0.9" />
                </svg>
            );

        case 'King':
            return (
                <svg {...svgProps}>
                    <GlossDefs id={id} p={p} />
                    <PawnBody id={id} p={p} />
                    {/* crown band + cross */}
                    <rect x="76" y="34" width="48" height="12" rx="6" fill={cyl} />
                    <ShineStrip x={81} y={37} w={18} h={2.8} o={0.6} />
                    <rect x="95.5" y="2" width="9" height="34" rx="4.5" fill={cyl} />
                    <rect x="84" y="10" width="32" height="9" rx="4.5" fill={cyl} />
                    <ShineStrip x={97.5} y={4.5} w={3} h={28} o={0.5} />
                    <ShineStrip x={86.5} y={12.5} w={27} h={2.6} o={0.5} />
                    <Spec cx={118} cy={39} rx={4} ry={2} rot={-10} o={0.8} />
                </svg>
            );

        default:
            return null;
    }
};
