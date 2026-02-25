'use client';

import { useCallback, useRef, useEffect } from 'react';

export const useAudio = () => {
    const audioCtx = useRef<AudioContext | null>(null);

    useEffect(() => {
        return () => {
            if (audioCtx.current) {
                audioCtx.current.close();
            }
        };
    }, []);

    const initAudio = () => {
        if (!audioCtx.current) {
            audioCtx.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        if (audioCtx.current.state === 'suspended') {
            audioCtx.current.resume();
        }
        return audioCtx.current;
    };

    const playMove = useCallback(() => {
        const ctx = initAudio();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(600, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.05);

        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.05);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start();
        osc.stop(ctx.currentTime + 0.05);
    }, []);

    const playCapture = useCallback(() => {
        const ctx = initAudio();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'square';
        osc.frequency.setValueAtTime(400, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + 0.1);

        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start();
        osc.stop(ctx.currentTime + 0.1);
    }, []);

    const playWin = useCallback(() => {
        const ctx = initAudio();
        const playChime = (freq: number, startTime: number) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, startTime);
            gain.gain.setValueAtTime(0.1, startTime);
            gain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.4);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(startTime);
            osc.stop(startTime + 0.4);
        };

        const now = ctx.currentTime;
        playChime(523.25, now); // C5
        playChime(659.25, now + 0.1); // E5
        playChime(783.99, now + 0.2); // G5
        playChime(1046.50, now + 0.3); // C6
    }, []);

    return { playMove, playCapture, playWin };
};
