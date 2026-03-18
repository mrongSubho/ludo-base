"use client";

import { useCallback, useEffect } from 'react';

export const useSoundEffects = () => {
    // 1. Preload sounds into the browser cache instantly in the background
    useEffect(() => {
        if (typeof window !== 'undefined') {
            const sounds = [
                '/sounds/ui-hover.mp3',
                '/sounds/ui-click.mp3',
                '/sounds/ui-select.mp3',
                '/sounds/coin-chink.mp3',
                '/sounds/dice-roll.mp3',
                '/sounds/dice-land.mp3'
            ];
            sounds.forEach(src => {
                const audio = new Audio();
                audio.src = src;
                audio.preload = 'auto'; // Forces the browser to download it silently
            });
        }
    }, []);

    const playSound = useCallback((path: string, volume: number = 0.5) => {
        if (typeof window !== 'undefined') {
            const audio = new Audio(path);
            audio.volume = volume;
            
            // cloneNode allows the same sound to play overlapping itself (good for spamming clicks)
            const playPromise = (audio.cloneNode(true) as HTMLAudioElement).play();
            
            // Catch browser autoplay restrictions safely
            if (playPromise !== undefined) {
                playPromise.catch(error => {
                    // console.warn("Audio autoplay prevented by browser or missing file:", error);
                });
            }
        }
    }, []);

    return {
        playHover: () => playSound('/sounds/ui-hover.mp3', 0.2),
        playClick: () => playSound('/sounds/ui-click.mp3', 0.5),
        playSelect: () => playSound('/sounds/ui-select.mp3', 0.6),
        playCoin: () => playSound('/sounds/coin-chink.mp3', 0.5),
        playDiceRoll: () => playSound('/sounds/dice-roll.mp3', 0.8),
        playDiceLand: () => playSound('/sounds/dice-land.mp3', 1.0),
    };
};
