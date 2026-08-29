import React from 'react';

export type ChessRank = 'Pawn' | 'Knight' | 'Bishop' | 'Rook' | 'Queen' | 'King';

export const COLOR_PIECE: Record<string, ChessRank> = {
    green: 'King',
    red: 'Queen',
    yellow: 'Rook',
    blue: 'Bishop',
};

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
    return 'Pawn';
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

/* ─────────── Sprite mapping ─────────── */

const SPRITE_MAP: Record<string, string> = {
    King: '/tokens/king.png',
    Queen: '/tokens/queen.png',
    Rook: '/tokens/rook.png',
    Bishop: '/tokens/bishop.png',
};

/* Per-piece scale overrides — queen is thinner, needs extra width */
const PIECE_SCALE: Record<string, string> = {
    King: 'scale(1.8)',
    Queen: 'scale(2.0) scaleX(1.35)',
    Rook: 'scale(1.8)',
    Bishop: 'scale(1.8)',
};

/* Team ring color map */
const RING_COLOR: Record<string, string> = {
    green: '#00ff88',
    red: '#ff3344',
    yellow: '#ffcc00',
    blue: '#00ccff',
};

interface ChessPieceProps {
    color: string;
    rank?: ChessRank;
    className?: string;
    /** 'home' = default larger ring; 'board' = brighter ring for small board cells */
    size?: 'home' | 'board';
}

export const ChessPiece = ({ color, rank: _rank, className = '', size = 'home' }: ChessPieceProps) => {
    const pieceType = COLOR_PIECE[color] || 'Pawn';
    const src = SPRITE_MAP[pieceType];
    const transform = PIECE_SCALE[pieceType] || 'scale(1.8)';
    const ringColor = RING_COLOR[color] || '#ffffff';
    const isBoard = size === 'board';

    if (!src) {
        return null;
    }

    return (
        <div
            className={`relative w-full h-full ${className}`}
            style={{ filter: 'drop-shadow(2px 6px 5px rgba(0,0,0,0.55))' }}
        >
            {/* Crisp team ring — no bleed */}
            <div
                style={{
                    position: 'absolute',
                    inset: isBoard ? '6%' : '12%',
                    borderRadius: '50%',
                    border: `1.5px solid ${ringColor}`,
                    boxShadow: `0 0 4px ${ringColor}`,
                    opacity: 0.9,
                    pointerEvents: 'none',
                    zIndex: 1,
                }}
            />
            {/* Piece sprite */}
            <img
                src={src}
                alt={`${color} ${pieceType}`}
                draggable={false}
                className="w-full h-full object-contain"
                style={{
                    transform,
                    transformOrigin: 'center bottom',
                    position: 'relative',
                    zIndex: 2,
                }}
            />

        </div>
    );
};
