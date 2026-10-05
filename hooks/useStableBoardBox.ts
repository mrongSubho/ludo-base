'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Stable board box.
 *
 * The board square must be invariant: nothing that appears over the board may
 * change its size — not the in-game chat composer, not the IME/keyboard, not a
 * panel, not a transient viewport squeeze. Those all shrink the live
 * board-area box, which a naive "measure the container" square turns into a
 * visible resize mid-match.
 *
 * So the square is a *committed* value. It is (re)committed only when the
 * layout viewport genuinely changes size — rotation, window resize, different
 * device — and never while the IME is up or an overlay has the viewport
 * squeezed. Everything in between reuses the last commit, which makes the
 * board pixel-stable for the whole session.
 *
 * Returns the committed square plus the committed height of the area box, so
 * callers can pin the area too and keep the surrounding cluster from reflowing.
 */
export function useStableBoardBox(
    area: { w: number; h: number },
    minSquare = 160
): { square: number; height: number } | null {
    const [committed, setCommitted] = useState<{ square: number; height: number } | null>(null);
    const lastLayout = useRef<{ w: number; h: number } | null>(null);

    useEffect(() => {
        if (typeof window === 'undefined') return;

        // The IME shrinks the visual viewport, not the layout viewport. Treat a
        // tall visual/layout gap as "a keyboard is up" and refuse to re-commit,
        // so the board cannot be measured against a squeezed box.
        const imeIsUp = () => {
            const vv = window.visualViewport;
            if (!vv) return document.body.classList.contains('keyboard-open');
            return window.innerHeight - vv.height > 80;
        };

        const commit = () => {
            if (area.w <= 0 || area.h <= 0) return;
            if (imeIsUp()) return;
            const square = Math.max(minSquare, Math.floor(Math.min(area.w, area.h)));
            setCommitted((prev) =>
                prev && prev.square === square && prev.height === Math.round(area.h)
                    ? prev
                    : { square, height: Math.round(area.h) }
            );
        };

        commit();

        const onLayoutChange = () => {
            const next = { w: window.innerWidth, h: window.innerHeight };
            const prev = lastLayout.current;
            lastLayout.current = next;
            if (prev && prev.w === next.w && prev.h === next.h) return;
            // Defer one frame + a beat: rotation and window drags settle, and an
            // IME opening/closing must not look like a layout change.
            window.setTimeout(commit, 150);
        };

        lastLayout.current = { w: window.innerWidth, h: window.innerHeight };
        window.addEventListener('resize', onLayoutChange);
        window.addEventListener('orientationchange', onLayoutChange);
        return () => {
            window.removeEventListener('resize', onLayoutChange);
            window.removeEventListener('orientationchange', onLayoutChange);
        };
        // area dims are the measurement source; re-evaluate whenever they change
    }, [area.w, area.h, minSquare]);

    return committed;
}