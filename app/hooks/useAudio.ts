'use client';

import { useCallback, useRef, useEffect } from 'react';
import { usePreferences } from '@/hooks/usePreferences';

export const useAudio = () => {
    const { preferences } = usePreferences();
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
                if (audioCtx.current.state !== 'closed') {
                    try {
                        audioCtx.current.close();
                    } catch (e) {
                        console.error('Failed to close AudioContext:', e);
                    }
                }
                audioCtx.current = null;
            }
        };
    }, []);

    const initAudio = () => {
        if (!audioCtx.current) {
            audioCtx.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        if (audioCtx.current.state === 'suspended') {
            audioCtx.current.resume().catch(e => console.error('Failed to resume AudioContext:', e));
        }
        return audioCtx.current;
    };

    const triggerHaptic = useCallback((pattern: number | number[] = 10) => {
        if (typeof window !== 'undefined' && preferences.haptics && navigator.vibrate) {
            navigator.vibrate(pattern);
        }
    }, [preferences.haptics]);

    const playMove = useCallback(() => {
        if (!preferences.sfx) return;
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
        
        triggerHaptic(5); // Ultra-short subtle click
    }, [preferences.sfx, triggerHaptic]);

    const playCapture = useCallback(() => {
        if (!preferences.sfx) return;
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
        
        triggerHaptic([30, 50, 30]); // Shaky capture feel
    }, [preferences.sfx, triggerHaptic]);

    const playWin = useCallback(() => {
        if (!preferences.sfx) return;
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
        
        triggerHaptic([100, 50, 100, 50, 200]); // Victory fanfare vibration
    }, [preferences.sfx, triggerHaptic]);

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
        if (!preferences.music) return;

        const ctx = initAudio();
        if (volume <= 0) return;

        const gain = ctx.createGain();
        const filter = ctx.createBiquadFilter();
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();

        gain.gain.setValueAtTime(0, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + 4); // Smoother fade in

        let lfo: OscillatorNode | undefined;

        // Theme mapping Fix: match real theme classes
        const isRetro = theme.includes('retro');
        const isDark = theme.includes('dark');

        if (isRetro) {
            // Retro-Futurism: Neon Pulse
            osc1.type = 'sawtooth';
            osc1.frequency.setValueAtTime(73.42, ctx.currentTime); // D2
            osc2.type = 'sine';
            osc2.frequency.setValueAtTime(146.83, ctx.currentTime); // D3
            
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(600, ctx.currentTime);
            filter.Q.setValueAtTime(5, ctx.currentTime);

            lfo = ctx.createOscillator();
            const lfoGain = ctx.createGain();
            lfo.frequency.setValueAtTime(0.5, ctx.currentTime);
            lfoGain.gain.setValueAtTime(400, ctx.currentTime);
            lfo.connect(lfoGain);
            lfoGain.connect(filter.frequency);
            lfo.start();
        } else if (isDark) {
            // Cosmic Dark: Space Drone
            osc1.type = 'sine';
            osc1.frequency.setValueAtTime(40, ctx.currentTime);
            osc2.type = 'sine';
            osc2.frequency.setValueAtTime(61.74, ctx.currentTime); // B1
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(120, ctx.currentTime);
        } else {
            // Cosmic UI / Classic: Soft Ethereal
            osc1.type = 'triangle';
            osc1.frequency.setValueAtTime(261.63, ctx.currentTime); // C4
            osc2.type = 'sine';
            osc2.frequency.setValueAtTime(329.63, ctx.currentTime); // E4
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(1000, ctx.currentTime);
        }

        osc1.connect(filter);
        osc2.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);

        osc1.start();
        osc2.start();

        ambientNodes.current = { osc1, osc2, gain, filter, lfo };
    }, [stopAmbient, preferences.music]);

    const playTurn = useCallback(() => {
        if (!preferences.sfx) return;
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
        
        triggerHaptic(10); // Subtle notification
    }, [preferences.sfx, triggerHaptic]);

    const playStrike = useCallback(() => {
        if (!preferences.sfx) return;
        const ctx = initAudio();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(150, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(50, ctx.currentTime + 0.3);

        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.3);
        
        triggerHaptic(50); // Warning strike
    }, [preferences.sfx, triggerHaptic]);

    return { playMove, playCapture, playWin, playAmbient, stopAmbient, playTurn, playStrike, triggerHaptic };
};
