'use client';

import { useState, useEffect } from 'react';
import { useAudio } from '../hooks/useAudio';

export default function AudioToggle() {
    const { playAmbient, stopAmbient } = useAudio();
    const [isMuted, setIsMuted] = useState(true); // Default to muted for auto-play policies

    useEffect(() => {
        // Read persistence
        const savedMute = localStorage.getItem('ludo-audio-muted');
        if (savedMute !== null) {
            setIsMuted(savedMute === 'true');
        }
    }, []);

    useEffect(() => {
        const handleThemeChange = () => {
            const theme = document.documentElement.getAttribute('data-theme') || 'default';
            if (!isMuted) {
                playAmbient(theme);
            } else {
                stopAmbient();
            }
        };

        // MutationObserver to watch data-theme on html
        const observer = new MutationObserver(handleThemeChange);
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

        // Initial play if not muted
        if (!isMuted) {
            handleThemeChange();
        }

        return () => observer.disconnect();
    }, [isMuted, playAmbient, stopAmbient]);

    const toggleMute = () => {
        const nextMute = !isMuted;
        setIsMuted(nextMute);
        localStorage.setItem('ludo-audio-muted', String(nextMute));
        if (nextMute) {
            stopAmbient();
        } else {
            const theme = document.documentElement.getAttribute('data-theme') || 'default';
            playAmbient(theme);
        }
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
