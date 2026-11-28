'use client';

import { useEffect, useMemo, useRef } from 'react';
import { getSoundEngine } from '@/lib/audio/SoundEngine';
import { computeMatchAudioMood, diffGameStateForAudio } from '@/lib/audio/boardAudioState';
import { resolveDiceThemeId } from '@/lib/diceVisuals';
import { prefersReducedMotion } from '@/lib/motion';
import { usePreferences } from '@/hooks/usePreferences';
import type { ColorCorner } from '@/lib/boardLayout';
import type { Player } from './useGameEngine';
import type { GameState, PlayerColor } from '@/lib/types';
import { isSeatInTier1Afk } from '@/lib/afkPolicy';

export interface UseBoardAudioProps {
    gameState: GameState;
    players: Player[];
    myColor?: PlayerColor;
    playerCount: '1v1' | '4P' | '2v2';
    colorCorner: ColorCorner;
    spectatorMode?: boolean;
}

/**
 * Reactive board audio coordinator.
 *
 * Watches GameState transitions (works equally for offline, P2P fallback,
 * MatchRoom DO `roomAuthority`, and Spectator mode), schedules impact/landing
 * SFX on physical touchdown rather than `t = 0`, drives adaptive match BGM +
 * final-moments Heartbeat tension, and warns when a held power drops below 30s.
 */
export function useBoardAudio({
    gameState,
    players,
    myColor,
    playerCount,
    colorCorner,
    spectatorMode = false,
}: UseBoardAudioProps): void {
    const { preferences } = usePreferences();
    const themeId = resolveDiceThemeId(preferences?.theme);
    const prevStateRef = useRef<GameState | null>(null);
    const warnedPowerKeysRef = useRef<Set<string>>(new Set());
    const warnedAfkMarkersRef = useRef<Set<string>>(new Set());
    const delayedPlayTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

    const botColors = useMemo(() => {
        const s = new Set<PlayerColor>();
        for (const p of players) {
            if (p.isAi) s.add(p.color);
        }
        return s;
    }, [players]);

    // 1. State-diff event emitter (immediate or delayed until physical landing)
    useEffect(() => {
        const prev = prevStateRef.current;
        prevStateRef.current = gameState;
        if (!prev) return;

        const reducedMotion = prefersReducedMotion();
        const events = diffGameStateForAudio(prev, gameState, {
            myColor,
            playerCount,
            colorCorner,
            spectatorMode,
            botColors,
            themeId,
            reducedMotion,
        });
        const engine = getSoundEngine();
        for (const ev of events) {
            const delayMs = !reducedMotion && ev.delayMs && ev.delayMs > 0 ? ev.delayMs : 0;
            if (delayMs === 0) {
                engine.play(ev.id, ev.opts);
            } else {
                const tid = setTimeout(() => {
                    delayedPlayTimersRef.current.delete(tid);
                    engine.play(ev.id, ev.opts);
                }, delayMs);
                delayedPlayTimersRef.current.add(tid);
            }
        }
    }, [gameState, myColor, playerCount, colorCorner, spectatorMode, botColors, themeId]);

    // 2. Adaptive BGM intensity + Final-moments Heartbeat mood
    useEffect(() => {
        const mood = computeMatchAudioMood(gameState, playerCount, colorCorner);
        getSoundEngine().setMatchMood(mood.scene, mood.urgency);
    }, [gameState.positions, gameState.winner, gameState.status, gameState.isRolling, gameState.matchStats, playerCount, colorCorner, gameState]);

    // Reset mood and cancel any queued impact sounds cleanly when leaving the board
    useEffect(() => {
        const warned = warnedPowerKeysRef.current;
        const timers = delayedPlayTimersRef.current;
        return () => {
            timers.forEach((tid) => clearTimeout(tid));
            timers.clear();
            getSoundEngine().setMatchMood('lobby', 0);
            warned.clear();
        };
    }, []);

    // 3. Held-power <30s expiry warning + Tier-1 AFK reclaim countdown warning alerts
    useEffect(() => {
        if (spectatorMode || !myColor || gameState.winner) return;
        const iv = setInterval(() => {
            const hand = gameState.playerPowers?.[myColor] ?? [];
            const now = Date.now();
            for (const item of hand) {
                const rem = item.expiresAt - now;
                const key = `${item.type}:${item.expiresAt}`;
                if (rem > 0 && rem <= 30_000 && !warnedPowerKeysRef.current.has(key)) {
                    warnedPowerKeysRef.current.add(key);
                    getSoundEngine().play('power_expiring');
                    break;
                }
            }

            const myAfk = gameState.afkStats?.[myColor];
            if (isSeatInTier1Afk(myAfk) && typeof myAfk?.afkDeadlineAt === 'number') {
                const remMs = myAfk.afkDeadlineAt - now;
                if (remMs > 0) {
                    const remSecs = Math.ceil(remMs / 1000);
                    if (remSecs <= 60 && !warnedAfkMarkersRef.current.has(`${myAfk.afkDeadlineAt}:60`)) {
                        warnedAfkMarkersRef.current.add(`${myAfk.afkDeadlineAt}:60`);
                        getSoundEngine().play('afk_ultimatum');
                    } else if (remSecs <= 30 && !warnedAfkMarkersRef.current.has(`${myAfk.afkDeadlineAt}:30`)) {
                        warnedAfkMarkersRef.current.add(`${myAfk.afkDeadlineAt}:30`);
                        getSoundEngine().play('afk_ultimatum');
                    } else if (remSecs <= 10) {
                        const secKey = `${myAfk.afkDeadlineAt}:s:${remSecs}`;
                        if (!warnedAfkMarkersRef.current.has(secKey)) {
                            warnedAfkMarkersRef.current.add(secKey);
                            getSoundEngine().play('timer_urgent', { urgentLevel: Math.min(5, Math.max(1, 11 - remSecs)) });
                        }
                    }
                }
            } else {
                warnedAfkMarkersRef.current.clear();
            }
        }, 1000);
        return () => clearInterval(iv);
    }, [gameState.playerPowers, gameState.afkStats, gameState.winner, myColor, spectatorMode]);
}
