'use client';

import { useEffect, useRef, useState } from 'react';

// ─── useElementSize ──────────────────────────────────────────────────────────
// Measures an element's real rendered box via ResizeObserver. Layout that
// sizes itself from measured containers works on every viewport without
// device-specific viewport arithmetic (no dvh reserves, no width caps).
export function useElementSize<T extends HTMLElement>() {
    const ref = useRef<T | null>(null);
    const [size, setSize] = useState({ w: 0, h: 0 });

    useEffect(() => {
        const el = ref.current;
        if (!el || typeof ResizeObserver === 'undefined') return;
        const update = () => {
            const r = el.getBoundingClientRect();
            setSize(prev =>
                Math.abs(prev.w - r.width) < 0.5 && Math.abs(prev.h - r.height) < 0.5
                    ? prev
                    : { w: r.width, h: r.height }
            );
        };
        update();
        const ro = new ResizeObserver(update);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    return [ref, size] as const;
}
