'use client';

import { useEffect, useRef, useState } from 'react';
import type { ColorCorner, GameState } from '@/lib/types';
import type { DiceThemeId } from '@/lib/diceVisuals';
import { onReducedMotionChange, prefersReducedMotion } from '@/lib/motion';
import {
    AnimationBarrier,
    estimateTransitionDurationMs,
} from '@/lib/animationBarrier';

export interface UsePresentedGameStateProps {
    authoritativeState: GameState;
    colorCorner: ColorCorner;
    themeId?: DiceThemeId;
    resyncVersion?: number;
}

export interface UsePresentedGameStateResult {
    presentedState: GameState;
    barrier: AnimationBarrier;
    isLocked: boolean;
}

/**
 * Separates immediate `authoritativeState` (used by useGameTimer, roomSeq, and
 * intent validation) from paced `presentedState` driven by a deadlock-proof
 * FIFO `AnimationBarrier`.
 */
export function usePresentedGameState({
    authoritativeState,
    colorCorner,
    themeId = '3077',
    resyncVersion = 0,
}: UsePresentedGameStateProps): UsePresentedGameStateResult {
    const [presentedState, setPresentedState] = useState<GameState>(authoritativeState);
    const [isLocked, setIsLocked] = useState(false);

    const lastResyncVersionRef = useRef(resyncVersion);
    const barrierRef = useRef<AnimationBarrier | null>(null);

    if (!barrierRef.current) {
        barrierRef.current = new AnimationBarrier({
            initialState: authoritativeState,
            getReducedMotion: () => prefersReducedMotion(),
            isHidden: () =>
                typeof document !== 'undefined' && document.visibilityState === 'hidden',
            onPresent: (nextPresented) => {
                setPresentedState(nextPresented);
                setIsLocked(barrierRef.current?.isLocked() ?? false);
            },
        });
    }

    const barrier = barrierRef.current;

    useEffect(() => {
        const resynced = resyncVersion !== lastResyncVersionRef.current;
        lastResyncVersionRef.current = resyncVersion;

        const prevAuthoritative = barrier.getAuthoritative();
        if (authoritativeState === prevAuthoritative && !resynced) {
            return;
        }

        const estimatedMs = resynced
            ? 0
            : estimateTransitionDurationMs(prevAuthoritative, authoritativeState, colorCorner, themeId);

        barrier.enqueue(authoritativeState, {
            resync: resynced,
            estimatedMs,
        });
        setIsLocked(barrier.isLocked());
    }, [authoritativeState, colorCorner, themeId, resyncVersion, barrier]);

    useEffect(() => {
        const unsubMotion = onReducedMotionChange((reduced) => {
            if (reduced) {
                barrier.flush('reduced-motion');
                setIsLocked(false);
            }
        });

        const onVisibilityChange = () => {
            if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
                barrier.flush('visibility-hidden');
                setIsLocked(false);
            }
        };

        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', onVisibilityChange);
        }

        return () => {
            unsubMotion();
            if (typeof document !== 'undefined') {
                document.removeEventListener('visibilitychange', onVisibilityChange);
            }
            barrier.dispose();
        };
    }, [barrier]);

    return {
        presentedState,
        barrier,
        isLocked,
    };
}
