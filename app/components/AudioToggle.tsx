"use client";

import { useEffect } from 'react';
import { useAudio } from '../hooks/useAudio';
import { usePreferences } from '@/hooks/usePreferences';

/**
 * REA-13: this component existed but was never rendered anywhere — dead code
 * that happened to hold the only ambient-audio driver, so the "Game Music"
 * preference in Settings did nothing. It is now a headless driver mounted once
 * by `app/page.tsx` (see AudioDriver below), so the preference and the audio
 * it controls finally move together.
 */
export default function AudioToggle() {
    const { playAmbient, stopAmbient } = useAudio();
    const { preferences } = usePreferences();
    const isMuted = !preferences.music;

    useEffect(() => {
        const theme = preferences.theme || 'retro';
        if (!isMuted) {
            playAmbient(theme);
        } else {
            stopAmbient();
        }
    }, [isMuted, preferences.theme, playAmbient, stopAmbient]);

    // No DOM of its own: the preference row in SettingsPanel is the control.
    return null;
}
