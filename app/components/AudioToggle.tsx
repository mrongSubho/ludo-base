'use client';

import { useEffect } from 'react';
import { useAudio } from '../hooks/useAudio';
import { usePreferences } from '@/hooks/usePreferences';

export default function AudioToggle() {
    const { playAmbient, stopAmbient } = useAudio();
    const { preferences, updatePreference } = usePreferences();
    const isMuted = !preferences.music;

    useEffect(() => {
        const theme = preferences.theme || 'ui';
        if (!isMuted) {
            playAmbient(theme);
        } else {
            stopAmbient();
        }
    }, [isMuted, preferences.theme, playAmbient, stopAmbient]);

    const toggleMute = () => {
        updatePreference('ludo-music', isMuted ? 'on' : 'off');
    };

    return (
        <button
            className="audio-toggle-btn"
            onClick={toggleMute}
            title={isMuted ? "Unmute Ambient" : "Mute Ambient"}
        >
            {isMuted ? '🔇' : '🔊'}
        </button>
    );
}
