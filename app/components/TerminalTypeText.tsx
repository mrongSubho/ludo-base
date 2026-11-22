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
}

/**
 * Smooth terminal telemetry typewriter readout with a slim compositor-animated
 * cursor. Renders immediately when `prefers-reduced-motion: reduce` is active.
 */
export function TerminalTypeText({
    text,
    charMs = 20,
    className = '',
    style,
    showCursor = true,
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

    const typed = reducedMotion ? text : text.slice(0, visibleCount);
    const isTyping = !reducedMotion && visibleCount < text.length;

    return (
        <span
            className={`inline-flex items-center max-w-full ${className}`}
            style={style}
            aria-label={text}
        >
            <span className="truncate">{typed}</span>
            {showCursor && !reducedMotion && (
                <motion.span
                    aria-hidden="true"
                    className="inline-block w-[0.5ch] h-[0.95em] ml-0.5 shrink-0 rounded-[1px]"
                    style={{ backgroundColor: 'currentColor' }}
                    animate={
                        isTyping
                            ? { opacity: [1, 0.25, 1] }
                            : { opacity: [0.85, 0.15, 0.85] }
                    }
                    transition={{
                        duration: isTyping ? 0.42 : 1.05,
                        repeat: Infinity,
                        ease: 'easeInOut',
                    }}
                />
            )}
        </span>
    );
}

export default TerminalTypeText;
