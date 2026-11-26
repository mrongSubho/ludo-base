'use client';

import { useSyncExternalStore } from 'react';
import { onReducedMotionChange, prefersReducedMotion } from '@/lib/motion';

function subscribe(callback: () => void): () => void {
    return onReducedMotionChange(() => callback());
}

function getSnapshot(): boolean {
    return prefersReducedMotion();
}

function getServerSnapshot(): boolean {
    return false;
}

/**
 * Reactive reduced-motion hook honoring both OS `prefers-reduced-motion: reduce`
 * and Ludo's in-app motion mode toggle (`full` / `reduced` / `system`).
 */
export function useReducedMotion(): boolean {
    return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
