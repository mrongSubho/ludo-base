'use client';

import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { onReducedMotionChange, prefersReducedMotion } from '@/lib/motion';

interface TerminalTypeTextProps {
    text: string;
    charMs?: number;
    className?: string;
    style?: React.CSSProperties;
    showCursor?: boolean;
    /** Append `...` once full text finishes typing so lines end cleanly as `...|`. */
    trailingEllipsis?: boolean;
}

/**
 * Smooth terminal telemetry typewriter readout with a slim compositor-animated
 * cursor. Reserves full natural text + cursor width so words are never clipped
 * when container space allows, and honors `prefers-reduced-motion: reduce`.
 */
export function TerminalTypeText({
    text,
    charMs = 20,
    className = '',
    style,
    showCursor = true,
    trailingEllipsis = false,
}: TerminalTypeTextProps) {
    const [reducedMotion, setReducedMotion] = useState(false);
    const [visibleCount, setVisibleCount] = useState(() => text.length);

    useEffect(() => {
        const rm = prefersReducedMotion();
        setReducedMotion(rm);
        return onReducedMotionChange(setReducedMotion);
    }, []);

    useEffect(() => {
        if (reducedMotion || !text) {
            setVisibleCount(text.length);
            return;
        }
        setVisibleCount(0);
        let count = 0;
        const id = window.setInterval(() => {
            count += 1;
            setVisibleCount(count);
            if (count >= text.length) {
                window.clearInterval(id);
            }
        }, Math.max(10, charMs));
        return () => window.clearInterval(id);
    }, [text, charMs, reducedMotion]);

    const fullText = trailingEllipsis && text ? `${text}...` : text;
    const isComplete = reducedMotion || visibleCount >= text.length;
    const visibleText = isComplete ? fullText : text.slice(0, visibleCount);
    const isTyping = !reducedMotion && visibleCount < text.length;

    return (
        <span
            className={`relative inline-flex items-center max-w-full align-baseline overflow-hidden ${className}`}
            style={style}
            aria-label={fullText}
        >
            {/* Full-string invisible footprint locks the start edge and reserves space for suffix + cursor */}
            <span aria-hidden="true" className="invisible select-none whitespace-pre pr-[1.15ch]">
                {fullText}
            </span>
            {/* Visible left-anchored typing track prints strictly left-to-right */}
            <span className="absolute inset-y-0 left-0 right-0 flex items-center justify-start text-left whitespace-pre overflow-hidden">
                <span>{visibleText}</span>
                {showCursor && !reducedMotion && (
                    <motion.span
                        aria-hidden="true"
                        className="inline-block w-[2px] h-[0.95em] ml-[2px] shrink-0 rounded-sm"
                        style={{ backgroundColor: 'currentColor' }}
                        animate={
                            isTyping
                                ? { opacity: [1, 0.25, 1] }
                                : { opacity: [0.9, 0.12, 0.9] }
                        }
                        transition={{
                            duration: isTyping ? 0.42 : 1.0,
                            repeat: Infinity,
                            ease: 'easeInOut',
                        }}
                    />
                )}
            </span>
        </span>
    );
}

export default TerminalTypeText;
