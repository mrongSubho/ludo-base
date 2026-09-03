'use client';

import React, { useId } from 'react';

export const RANGES = [
    { id: '1D', days: 1 },
    { id: '1W', days: 7 },
    { id: '1M', days: 30 },
    { id: '3M', days: 90 },
    { id: '1Y', days: 365 },
    { id: 'All', days: Infinity },
];

/** Start timestamp (ms) for a range id; 0 = all time. */
export const rangeCutoff = (rangeId: string): number => {
    const def = RANGES.find(r => r.id === rangeId) || RANGES[RANGES.length - 1];
    return def.days === Infinity ? 0 : Date.now() - def.days * 86400000;
};

/* Price-chart style sparkline: gradient area fill, min/max markers + labels */
export function FormChart({ points, positive }: { points: number[]; positive: boolean }) {
    const W = 300, H = 96, PAD = 8;
    const gid = useId().replace(/:/g, '');
    if (points.length === 0) return null;
    const min = Math.min(...points);
    const max = Math.max(...points);
    const span = max - min || 1;
    const n = points.length;
    const x = (i: number) => (n === 1 ? W / 2 : PAD + (i * (W - PAD * 2)) / (n - 1));
    const y = (v: number) => H - PAD - ((v - min) / span) * (H - PAD * 2);
    const line = points.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const area = `${line} L${x(n - 1).toFixed(1)},${H} L${x(0).toFixed(1)},${H} Z`;
    const stroke = positive ? '#22d3ee' : '#f87171';
    const minIdx = points.indexOf(min);
    const maxIdx = points.indexOf(max);
    return (
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-[96px]">
            <defs>
                <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={stroke} stopOpacity="0.35" />
                    <stop offset="100%" stopColor={stroke} stopOpacity="0" />
                </linearGradient>
            </defs>
            <path d={area} fill={`url(#${gid})`} />
            <path d={line} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            <circle cx={x(maxIdx)} cy={y(max)} r="3" fill={stroke} />
            <circle cx={x(minIdx)} cy={y(min)} r="3" fill={stroke} />
            <text x={x(maxIdx)} y={Math.max(10, y(max) - 8)} textAnchor="middle" fontSize="10" fill="rgba(255,255,255,0.45)">{max > 0 ? `+${max}` : `${max}`}</text>
            <text x={x(minIdx)} y={Math.min(H - 4, y(min) + 14)} textAnchor="middle" fontSize="10" fill="rgba(255,255,255,0.45)">{min > 0 ? `+${min}` : `${min}`}</text>
        </svg>
    );
}
