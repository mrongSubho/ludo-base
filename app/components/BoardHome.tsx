import React from 'react';
import { motion } from 'framer-motion';
import { Token } from './BoardTokens';
import { Corner } from '@/lib/boardLayout';

export const StarMarker = ({ color }: { color?: string }) => (
    <svg className="star-svg" viewBox="0 0 24 24" fill="currentColor" style={{ color }}>
        <path d="M12 2l2.9 6.26L22 9.27l-5 4.87L18.18 22 12 18.27 5.82 22 7 14.14 2 9.27l7.1-1.01L12 2z" />
    </svg>
);

export const ArrowMarker = ({ dir }: { dir: 'up' | 'down' | 'left' | 'right' }) => {
    const rotation = { right: 0, down: 90, left: 180, up: 270 }[dir];
    return (
        <svg
            className="home-arrow-svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            style={{ transform: `rotate(${rotation}deg)` }}
        >
            <path d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z" />
        </svg>
    );
};

interface HomeBlockProps {
    color: 'green' | 'red' | 'yellow' | 'blue';
    corner: Corner;
    gridRow: string;
    gridCol: string;
    tokensInHome: number[];
    onTokenClick: (tokenIndex: number) => void;
    isDraggable?: boolean;
    counterRotationDeg?: number;
}

export function HomeBlock({
    color,
    corner,
    gridRow,
    gridCol,
    tokensInHome,
    onTokenClick,
    isDraggable,
    counterRotationDeg = 0
}: HomeBlockProps) {
    return (
        <div
            className={`board-home ${color}`}
            data-corner={corner}
            style={{ gridRow, gridColumn: gridCol }}
        >
            <div className="home-pad">
                {[0, 1, 2, 3].map((idx) => (
                    <div key={idx} className="token-dot-wrapper">
                        {tokensInHome.includes(idx) && (
                            <Token
                                color={color}
                                onClick={() => onTokenClick(idx)}
                                isDraggable={isDraggable}
                                counterRotationDeg={counterRotationDeg}
                            />
                        )}
                        {!tokensInHome.includes(idx) && <span className="token-dot-placeholder" />}
                    </div>
                ))}
            </div>
        </div>
    );
}
