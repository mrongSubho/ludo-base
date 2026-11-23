'use client';

import { useEffect, useRef } from 'react';
import { usePreferences } from '@/hooks/usePreferences';
import { getSoundEngine } from '@/lib/audio/SoundEngine';
import type { MatchConnectionStatus } from '@/lib/matchProtocol';

export interface AudioToggleProps {
    appState?: 'dashboard' | 'game' | 'spectating';
    matchConnectionStatus?: MatchConnectionStatus;
}

/**
 * Headless root audio driver mounted once by `app/page.tsx`.
 *
 * Keeps the singleton procedural `SoundEngine` synchronized with user
 * preferences (theme, SFX/Music mute + volume sliders, haptics), installs
 * autoplay gesture unlock + tab visibility auto-pause, updates active app
 * scene (`dashboard` vs `game`/`spectating`), and reports network link cues.
 */
export default function AudioToggle({
    appState = 'dashboard',
    matchConnectionStatus,
}: AudioToggleProps) {
    const { preferences } = usePreferences();
    const prevConnRef = useRef<MatchConnectionStatus | undefined>(undefined);

    useEffect(() => {
        const engine = getSoundEngine();
        return engine.installLifecycleListeners();
    }, []);

    useEffect(() => {
        getSoundEngine().updatePrefs({
            theme: preferences.theme,
            sfx: preferences.sfx,
            music: preferences.music,
            sfxVolume: preferences.sfxVolume,
            musicVolume: preferences.musicVolume,
            haptics: preferences.haptics,
        });
    }, [
        preferences.theme,
        preferences.sfx,
        preferences.music,
        preferences.sfxVolume,
        preferences.musicVolume,
        preferences.haptics,
    ]);

    useEffect(() => {
        getSoundEngine().setAppScene(appState);
    }, [appState]);

    useEffect(() => {
        const prev = prevConnRef.current;
        prevConnRef.current = matchConnectionStatus;
        if (!prev || prev === matchConnectionStatus) return;
        if (matchConnectionStatus === 'reconnecting') {
            getSoundEngine().play('net_lost');
        } else if (prev === 'reconnecting' && matchConnectionStatus === 'connected') {
            getSoundEngine().play('net_restored');
        }
    }, [matchConnectionStatus]);

    return null;
}
