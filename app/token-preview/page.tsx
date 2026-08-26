"use client";

import React from 'react';
import { ChessPiece } from '@/app/components/ChessTokens';
import { ClassicSlimPiece, OriginalPiece, SoftRenderPiece, StandingPiece } from '@/app/components/chessTokenVariants';

const RANKS = ['Pawn', 'Knight', 'Bishop', 'Rook', 'Queen', 'King'] as const;
const COLORS = ['green', 'red', 'yellow', 'blue'] as const;

type Variant = {
    name: string;
    desc: string;
    Component: React.ComponentType<{ color: string; rank: (typeof RANKS)[number] }>;
};

const VARIANTS: Variant[] = [
    { name: '★ STANDING 3D (new)', desc: 'Elevated camera — visible foot disc, foreshortened rings, towers over cell', Component: StandingPiece },
    { name: 'SOFT RENDER (flat view)', desc: 'Blurred studio lighting, colorful shadows', Component: SoftRenderPiece },
    { name: 'CURRENT', desc: 'Chunky pawn — live in game', Component: ChessPiece },
    { name: 'SLIM CLASSIC', desc: 'Previous slim generation', Component: ClassicSlimPiece },
    { name: 'ORIGINAL v1', desc: 'First committed candy-gloss set', Component: OriginalPiece },
];

export default function TokenPreviewPage() {
    const [size, setSize] = React.useState(84);

    return (
        <div className="min-h-screen bg-[#161626] text-white p-8">
            <header className="mb-8 flex flex-wrap items-center gap-4">
                <div>
                    <h1 className="text-2xl font-black tracking-wide">TOKEN LAB</h1>
                    <p className="text-sm text-white/50">Pick the winner per rank. Reference: Ludo King glossy pawns.</p>
                </div>
                <div className="ml-auto flex items-center gap-2 text-sm">
                    <span className="text-white/50">Size</span>
                    <input
                        type="range" min={48} max={140} value={size}
                        onChange={(e) => setSize(Number(e.target.value))}
                        className="accent-cyan-400"
                    />
                    <span className="w-10 tabular-nums">{size}px</span>
                </div>
            </header>

            <div className="space-y-10">
                {VARIANTS.map(({ name, desc, Component }) => (
                    <section key={name}>
                        <div className="mb-3 flex items-baseline gap-3">
                            <h2 className="text-lg font-bold text-cyan-300">{name}</h2>
                            <span className="text-xs text-white/40">{desc}</span>
                        </div>
                        <div className="inline-block rounded-2xl border border-white/10 bg-black/20 p-4">
                            {/* column headers */}
                            <div className="grid" style={{ gridTemplateColumns: `70px repeat(${COLORS.length}, ${size}px)` }}>
                                <span />
                                {COLORS.map(c => (
                                    <span key={c} className="pb-2 text-center text-[11px] uppercase tracking-widest text-white/40">{c}</span>
                                ))}
                            </div>
                            {RANKS.map(rank => (
                                <div key={rank} className="grid items-center" style={{ gridTemplateColumns: `70px repeat(${COLORS.length}, ${size}px)` }}>
                                    <span className="text-xs font-semibold uppercase tracking-wider text-white/60">{rank}</span>
                                    {COLORS.map(color => (
                                        <div
                                            key={color}
                                            className="aspect-square rounded-xl bg-white/[0.06] p-1 ring-1 ring-inset ring-white/10"
                                            style={{ width: size, height: size }}
                                        >
                                            <Component color={color} rank={rank} />
                                        </div>
                                    ))}
                                </div>
                            ))}
                        </div>
                    </section>
                ))}
            </div>
        </div>
    );
}
