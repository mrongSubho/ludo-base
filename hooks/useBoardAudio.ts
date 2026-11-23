'use client';

import { useEffect, useMemo, useRef } from 'react';
import { getSoundEngine } from '@/lib/audio/SoundEngine';
import { computeMatchAudioMood, diffGameStateForAudio } from '@/lib/audio/boardAudioState';
import type { ColorCorner } from '@/lib/boardLayout';
import type { Player } from './useGameEngine';
import type { GameState, PlayerColor } from '@/lib/types';

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
 * Watches authoritative GameState transitions (works equally for offline,
 * P2P fallback, MatchRoom DO `roomAuthority`, and Spectator mode), fires
 * non-duplicated gameplay SFX, drives adaptive match BGM + final-moments
 * Heartbeat tension, and warns when a held power item drops below 30s.
 */
export function useBoardAudio({
    gameState,
    players,
    myColor,
    playerCount,
    colorCorner,
    spectatorMode = false,
}: UseBoardAudioProps): void {
    const prevStateRef = useRef<GameState | null>(null);
    const warnedPowerKeysRef = useRef<Set<string>>(new Set());

    const botColors = useMemo(() => {
        const s = new Set<PlayerColor>();
        for (const p of players) {
            if (p.isAi) s.add(p.color);
        }
        return s;
    }, [players]);

    // 1. State-diff event emitter
    useEffect(() => {
        const prev = prevStateRef.current;
        prevStateRef.current = gameState;
        if (!prev) return;

        const events = diffGameStateForAudio(prev, gameState, {
            myColor,
            playerCount,
            colorCorner,
            spectatorMode,
            botColors,
        });
        const engine = getSoundEngine();
        for (const ev of events) {
            engine.play(ev.id, ev.opts);
        }
    }, [gameState, myColor, playerCount, colorCorner, spectatorMode, botColors]);

    // 2. Adaptive BGM intensity + Final-moments Heartbeat mood
    useEffect(() => {
        const mood = computeMatchAudioMood(gameState, playerCount, colorCorner);
        getSoundEngine().setMatchMood(mood.scene, mood.urgency);
    }, [gameState.positions, gameState.winner, gameState.status, gameState.isRolling, gameState.matchStats, playerCount, colorCorner, gameState]);

    // Reset mood cleanly when leaving the board
    useEffect(() => {
        const warned = warnedPowerKeysRef.current;
        return () => {
            getSoundEngine().setMatchMood('lobby', 0);
            warned.clear();
        };
    }, []);

    // 3. Held-power <30s expiry warning
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
        }, 1000);
        return () => clearInterval(iv);
    }, [gameState.playerPowers, gameState.winner, myColor, spectatorMode]);
}
