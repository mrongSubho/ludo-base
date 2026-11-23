'use client';

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { onReducedMotionChange, prefersReducedMotion } from '@/lib/motion';

export interface ArcSpringState {
    hx: number;
    hv: number;
    bx: number;
    bv: number;
    tx: number;
    trip: number;
}

export interface ArcSpringStepResult {
    hx: number;
    hv: number;
    bx: number;
    bv: number;
    settled: boolean;
}

interface InternalArcState extends ArcSpringState {
    initialized: boolean;
    visible: boolean;
    w: number;
    h: number;
    centers: number[];
    reduced: boolean;
    activeIdx: number;
    dragX: number | null;
}

interface RetroArcLightProps {
    navRef: React.RefObject<HTMLElement | null>;
    activeIdx: number;
    dragX: number | null;
}

/** Builds a horizontal stadium capsule path connecting head X and tail X. */
export function buildArcStadiumPath(
    hx: number,
    bx: number,
    cy: number,
    r: number,
    padX = 2.5,
): string {
    const lx = Math.min(hx, bx) - padX;
    const rx = Math.max(hx, bx) + padX;
    return (
        `M ${lx.toFixed(2)} ${(cy - r).toFixed(2)} ` +
        `L ${rx.toFixed(2)} ${(cy - r).toFixed(2)} ` +
        `A ${r.toFixed(2)} ${r.toFixed(2)} 0 0 1 ${rx.toFixed(2)} ${(cy + r).toFixed(2)} ` +
        `L ${lx.toFixed(2)} ${(cy + r).toFixed(2)} ` +
        `A ${r.toFixed(2)} ${r.toFixed(2)} 0 0 1 ${lx.toFixed(2)} ${(cy - r).toFixed(2)} Z`
    );
}

/** Boosts optical stroke weight while stretched into a rod in flight. */
export function computeArcStrokeWidth(
    hx: number,
    bx: number,
): { strokeWidth: number; open: number } {
    const open = Math.min(1, Math.abs(hx - bx) / 96);
    const strokeWidth = 1.9 + open * 0.75;
    return { strokeWidth, open };
}

/** Advances the asymmetric dual-spring physics (head leads; distance-gated tail snaps home). */
export function stepArcSprings(
    state: ArcSpringState,
    dtRaw: number,
): ArcSpringStepResult {
    const dt = Math.min(0.032, Math.max(0, dtRaw));

    let hv = state.hv + (-280 * (state.hx - state.tx) - 24 * state.hv) * dt;
    let hx = state.hx + hv * dt;

    const home = 1 - Math.min(1, Math.abs(hx - state.tx) / Math.max(1, state.trip));
    const bk = 42 + 260 * home * home;
    const cb = 2 * Math.sqrt(bk) * 0.88;
    let bv = state.bv + (-bk * (state.bx - state.tx) - cb * state.bv) * dt;
    let bx = state.bx + bv * dt;

    const settled =
        Math.abs(hx - state.tx) < 0.35 &&
        Math.abs(bx - state.tx) < 0.35 &&
        Math.abs(hv) < 4 &&
        Math.abs(bv) < 4;

    if (settled) {
        hx = state.tx;
        bx = state.tx;
        hv = 0;
        bv = 0;
    }

    return { hx, hv, bx, bv, settled };
}

function resolveTargetX(centers: number[], activeIdx: number, dragX: number | null): number | null {
    if (centers.length === 0) return null;
    if (dragX !== null) {
        const minC = centers[0];
        const maxC = centers[centers.length - 1];
        const clamped = Math.max(minC, Math.min(maxC, dragX));
        let nearest = minC;
        let bestDist = Infinity;
        for (const c of centers) {
            const d = Math.abs(c - clamped);
            if (d < bestDist) {
                bestDist = d;
                nearest = c;
            }
        }
        return clamped + (nearest - clamped) * 0.28;
    }
    if (activeIdx >= 0 && activeIdx < centers.length) {
        return centers[activeIdx];
    }
    return null;
}

export function RetroArcLight({ navRef, activeIdx, dragX }: RetroArcLightProps) {
    const rawId = useId();
    const uid = rawId.replace(/:/g, '');
    const lipGradId = `arc-lip-${uid}`;
    const ambientGradId = `arc-ambient-${uid}`;
    const topLipClipId = `arc-clip-${uid}`;
    const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion);

    const arcGlowRef = useRef<SVGPathElement | null>(null);
    const arcCoreRef = useRef<SVGPathElement | null>(null);
    const lipRectRef = useRef<SVGRectElement | null>(null);
    const lipGradRef = useRef<SVGLinearGradientElement | null>(null);
    const ambientGradRef = useRef<SVGRadialGradientElement | null>(null);
    const rafRef = useRef<number | null>(null);
    const lastTsRef = useRef<number>(0);

    const stateRef = useRef<InternalArcState>({
        hx: 0,
        hv: 0,
        bx: 0,
        bv: 0,
        tx: 0,
        trip: 16,
        initialized: false,
        visible: false,
        w: 0,
        h: 0,
        centers: [],
        reduced: prefersReducedMotion(),
        activeIdx,
        dragX,
    });

    const paint = useCallback((hx: number, bx: number) => {
        const st = stateRef.current;
        if (st.w <= 0 || st.h <= 0 || !Number.isFinite(hx) || !Number.isFinite(bx)) return;

        const cy = st.h / 2;
        const r = Math.max(19, Math.min(24.5, st.h / 2 - 4.5));
        const padX = st.w < 340 ? 1.5 : 2.5;
        const d = buildArcStadiumPath(hx, bx, cy, r, padX);
        const { strokeWidth, open } = computeArcStrokeWidth(hx, bx);
        const midX = (hx + bx) / 2;
        const span = Math.abs(hx - bx);

        if (arcCoreRef.current) {
            arcCoreRef.current.setAttribute('d', d);
            arcCoreRef.current.setAttribute('stroke-width', strokeWidth.toFixed(2));
        }
        if (arcGlowRef.current) {
            arcGlowRef.current.setAttribute('d', d);
            arcGlowRef.current.setAttribute('stroke-width', (strokeWidth + 4.5).toFixed(2));
            arcGlowRef.current.setAttribute('stroke-opacity', (0.28 + open * 0.14).toFixed(3));
        }
        if (lipRectRef.current) {
            const lw = Math.max(0, st.w - 2);
            const lh = Math.max(0, st.h - 2);
            lipRectRef.current.setAttribute('width', lw.toFixed(1));
            lipRectRef.current.setAttribute('height', lh.toFixed(1));
            lipRectRef.current.setAttribute('rx', (lh / 2).toFixed(1));
        }
        if (lipGradRef.current) {
            lipGradRef.current.setAttribute('x1', (midX - 92).toFixed(1));
            lipGradRef.current.setAttribute('y1', '0');
            lipGradRef.current.setAttribute('x2', (midX + 92).toFixed(1));
            lipGradRef.current.setAttribute('y2', '0');
        }
        if (ambientGradRef.current) {
            ambientGradRef.current.setAttribute('cx', midX.toFixed(1));
            ambientGradRef.current.setAttribute('cy', cy.toFixed(1));
            ambientGradRef.current.setAttribute('r', (72 + span * 0.45).toFixed(1));
        }
    }, []);

    const stopLoop = useCallback(() => {
        if (rafRef.current !== null) {
            window.cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
        }
        lastTsRef.current = 0;
    }, []);

    const startLoop = useCallback(() => {
        if (rafRef.current !== null) return;
        const tick = (ts: number) => {
            const st = stateRef.current;
            if (!st.visible) {
                stopLoop();
                return;
            }
            const dt = lastTsRef.current > 0 ? (ts - lastTsRef.current) / 1000 : 1 / 60;
            lastTsRef.current = ts;
            const next = stepArcSprings(st, dt);
            st.hx = next.hx;
            st.hv = next.hv;
            st.bx = next.bx;
            st.bv = next.bv;
            paint(st.hx, st.bx);
            if (next.settled) {
                stopLoop();
                return;
            }
            rafRef.current = window.requestAnimationFrame(tick);
        };
        rafRef.current = window.requestAnimationFrame(tick);
    }, [paint, stopLoop]);

    const syncTarget = useCallback(
        (snapIfResize = false) => {
            const st = stateRef.current;
            const tx = resolveTargetX(st.centers, st.activeIdx, st.dragX);
            if (tx === null) {
                st.visible = false;
                stopLoop();
                return;
            }

            const wasVisible = st.visible;
            st.visible = true;

            if (!st.initialized || !wasVisible || st.reduced || (snapIfResize && rafRef.current === null)) {
                stopLoop();
                st.hx = tx;
                st.bx = tx;
                st.hv = 0;
                st.bv = 0;
                st.tx = tx;
                st.trip = 16;
                st.initialized = true;
                paint(st.hx, st.bx);
                return;
            }

            if (Math.abs(tx - st.tx) > 0.25) {
                st.trip = st.dragX !== null ? 48 : Math.max(16, Math.abs(tx - st.hx));
                st.tx = tx;
            }

            if (
                Math.abs(st.tx - st.hx) > 0.35 ||
                Math.abs(st.tx - st.bx) > 0.35 ||
                Math.abs(st.hv) >= 4 ||
                Math.abs(st.bv) >= 4
            ) {
                startLoop();
            } else {
                paint(st.hx, st.bx);
            }
        },
        [paint, startLoop, stopLoop],
    );

    const measure = useCallback(() => {
        const navEl = navRef.current;
        if (!navEl) return;
        const rect = navEl.getBoundingClientRect();
        const btns = Array.from(navEl.querySelectorAll<HTMLElement>('.nav-item'));
        const centers = btns.map((btn) => {
            const br = btn.getBoundingClientRect();
            return br.left - rect.left + br.width / 2;
        });
        const st = stateRef.current;
        st.w = rect.width;
        st.h = rect.height;
        st.centers = centers;
        syncTarget(true);
    }, [navRef, syncTarget]);

    useEffect(() => {
        stateRef.current.reduced = reducedMotion;
        const unsub = onReducedMotionChange((reduced) => {
            stateRef.current.reduced = reduced;
            setReducedMotion(reduced);
            syncTarget(true);
        });
        return unsub;
    }, [reducedMotion, syncTarget]);

    useEffect(() => {
        measure();
        const navEl = navRef.current;
        if (!navEl) return;
        const ro = new ResizeObserver(measure);
        ro.observe(navEl);
        window.addEventListener('resize', measure);
        return () => {
            ro.disconnect();
            window.removeEventListener('resize', measure);
            stopLoop();
        };
    }, [measure, navRef, stopLoop]);

    useEffect(() => {
        const st = stateRef.current;
        st.activeIdx = activeIdx;
        st.dragX = dragX;
        if (st.centers.length === 0) {
            measure();
        } else {
            syncTarget(false);
        }
    }, [activeIdx, dragX, measure, syncTarget]);

    const isVisible = dragX !== null || activeIdx >= 0;

    return (
        <svg
            className="retro-arc-svg pointer-events-none absolute inset-0 w-full h-full z-0"
            aria-hidden="true"
            style={{
                opacity: isVisible ? 1 : 0,
                transition: reducedMotion ? 'none' : 'opacity 160ms ease-out',
            }}
        >
            <defs>
                <linearGradient ref={lipGradRef} id={lipGradId} gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="var(--accent-bright)" stopOpacity="0" />
                    <stop offset="50%" stopColor="var(--accent-bright)" stopOpacity="0.82" />
                    <stop offset="100%" stopColor="var(--accent-bright)" stopOpacity="0" />
                </linearGradient>
                <radialGradient ref={ambientGradRef} id={ambientGradId} gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.18" />
                    <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
                </radialGradient>
                <clipPath id={topLipClipId}>
                    <rect x="0" y="0" width="100%" height="55%" />
                </clipPath>
            </defs>
            <rect x="0" y="0" width="100%" height="100%" fill={`url(#${ambientGradId})`} />
            <rect
                ref={lipRectRef}
                x="1"
                y="1"
                fill="none"
                stroke={`url(#${lipGradId})`}
                strokeWidth="1.25"
                clipPath={`url(#${topLipClipId})`}
            />
            <path
                ref={arcGlowRef}
                fill="none"
                stroke="var(--accent)"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ filter: 'blur(4.5px)' }}
            />
            <path
                ref={arcCoreRef}
                fill="rgba(var(--accent-rgb), 0.07)"
                stroke="var(--accent-bright)"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}
