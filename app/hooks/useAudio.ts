'use client';

import { useCallback, useRef, useEffect } from 'react';

export const useAudio = () => {
    const audioCtx = useRef<AudioContext | null>(null);
    const ambientNodes = useRef<{
        osc1: OscillatorNode;
        osc2: OscillatorNode;
        gain: GainNode;
        filter: BiquadFilterNode;
        lfo?: OscillatorNode;
    } | null>(null);

    useEffect(() => {
        return () => {
            if (ambientNodes.current) {
                stopAmbient();
            }
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
        if (typeof window !== 'undefined' && localStorage.getItem('ludo-sfx') === 'off') return;
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
        if (typeof window !== 'undefined' && localStorage.getItem('ludo-sfx') === 'off') return;
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
        if (typeof window !== 'undefined' && localStorage.getItem('ludo-sfx') === 'off') return;
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

    const stopAmbient = useCallback(() => {
        if (ambientNodes.current) {
            try {
                ambientNodes.current.osc1.stop();
                ambientNodes.current.osc2.stop();
                ambientNodes.current.lfo?.stop();
            } catch (e) { }
            ambientNodes.current.gain.disconnect();
            ambientNodes.current = null;
        }
    }, []);

    const playAmbient = useCallback((theme: string, volume: number = 0.05) => {
        stopAmbient();
        if (typeof window !== 'undefined' && localStorage.getItem('ludo-music') === 'off') return;

        const ctx = initAudio();

        if (volume <= 0) return;

        const gain = ctx.createGain();
        const filter = ctx.createBiquadFilter();
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();

        gain.gain.setValueAtTime(0, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + 2); // Fade in

        let lfo: OscillatorNode | undefined;

        if (theme === 'cyberpunk') {
            // Synthwave: Filtered Saws + Arp-like vibe
            osc1.type = 'sawtooth';
            osc2.type = 'sawtooth';
            osc1.frequency.setValueAtTime(55, ctx.currentTime); // A1
            osc2.frequency.setValueAtTime(110, ctx.currentTime); // A2
            osc2.detune.setValueAtTime(12, ctx.currentTime);

            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(400, ctx.currentTime);
            filter.Q.setValueAtTime(10, ctx.currentTime);

            // LFO for filter sweep
            lfo = ctx.createOscillator();
            const lfoGain = ctx.createGain();
            lfo.frequency.setValueAtTime(0.2, ctx.currentTime);
            lfoGain.gain.setValueAtTime(300, ctx.currentTime);
            lfo.connect(lfoGain);
            lfoGain.connect(filter.frequency);
            lfo.start();
        } else if (theme === 'midnight') {
            // Deep Ambient: Sines + Low Filter
            osc1.type = 'sine';
            osc2.type = 'sine';
            osc1.frequency.setValueAtTime(40, ctx.currentTime);
            osc2.frequency.setValueAtTime(60, ctx.currentTime);
            osc2.detune.setValueAtTime(-5, ctx.currentTime);

            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(150, ctx.currentTime);
        } else if (theme === 'classic') {
            // Minimal: Soft Triangle
            osc1.type = 'triangle';
            osc2.type = 'triangle';
            osc1.frequency.setValueAtTime(220, ctx.currentTime);
            osc2.frequency.setValueAtTime(221, ctx.currentTime);
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(1000, ctx.currentTime);
        } else {
            // Pastel: Lo-fi Chill
            osc1.type = 'triangle';
            osc2.type = 'sine';
            osc1.frequency.setValueAtTime(196, ctx.currentTime); // G3
            osc2.frequency.setValueAtTime(246.94, ctx.currentTime); // B3

            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(800, ctx.currentTime);

            lfo = ctx.createOscillator();
            const lfoGain = ctx.createGain();
            lfo.frequency.setValueAtTime(0.1, ctx.currentTime);
            lfoGain.gain.setValueAtTime(0.02, ctx.currentTime);
            lfo.connect(lfoGain);
            lfoGain.connect(gain.gain);
            lfo.start();
        }

        osc1.connect(filter);
        osc2.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);

        osc1.start();
        osc2.start();

        ambientNodes.current = { osc1, osc2, gain, filter, lfo };
    }, [stopAmbient]);

    const playTurn = useCallback(() => {
        if (typeof window !== 'undefined' && localStorage.getItem('ludo-sfx') === 'off') return;
        const ctx = initAudio();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(800, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.1);

        gain.gain.setValueAtTime(0.05, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.2);
    }, []);

    const playStrike = useCallback(() => {
        if (typeof window !== 'undefined' && localStorage.getItem('ludo-sfx') === 'off') return;
        const ctx = initAudio();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        // Harsh buzz for a strike
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(150, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(50, ctx.currentTime + 0.3);

        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.3);
    }, []);

    return { playMove, playCapture, playWin, playAmbient, stopAmbient, playTurn, playStrike };
};
