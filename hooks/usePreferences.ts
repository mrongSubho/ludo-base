'use client';

import { useState, useEffect, useCallback } from 'react';
import { getPreferenceCookie, setPreferenceCookie, PreferenceKey } from '@/lib/preferencesUtils';

export interface Preferences {
    theme: string;
    sfx: boolean;
    music: boolean;
    haptics: boolean;
}

export function usePreferences() {
    const [preferences, setPreferences] = useState<Preferences>({
        theme: 'ui',
        sfx: true,
        music: true,
        haptics: true,
    });

    // Initialize from cookies or localStorage
    useEffect(() => {
        const getVal = (key: PreferenceKey, fallback: string): string => {
            return getPreferenceCookie(key) || localStorage.getItem(key) || fallback;
        };

        const theme = getVal('ludo-theme', 'ui');
        const sfx = getVal('ludo-sfx', 'on') === 'on';
        const music = getVal('ludo-music', 'on') === 'on';
        const haptics = getVal('ludo-haptic', 'on') === 'on';

        setPreferences({ theme, sfx, music, haptics });
    }, []);

    const updatePreference = useCallback((key: PreferenceKey, value: string) => {
        setPreferenceCookie(key, value);
        localStorage.setItem(key, value);
        
        setPreferences(prev => ({
            ...prev,
            theme: key === 'ludo-theme' ? value : prev.theme,
            sfx: key === 'ludo-sfx' ? value === 'on' : prev.sfx,
            music: key === 'ludo-music' ? value === 'on' : prev.music,
            haptics: key === 'ludo-haptic' ? value === 'on' : prev.haptics,
        }));

        // Trigger side effects immediately if needed (e.g. theme application)
        if (key === 'ludo-theme') {
            document.body.classList.remove('theme-cosmic-ui', 'theme-cosmic-dark', 'theme-retro-futurism');
            if (value === 'dark') document.body.classList.add('theme-cosmic-dark');
            else if (value === 'retro') document.body.classList.add('theme-retro-futurism');
            else document.body.classList.add('theme-cosmic-ui');
        }
    }, []);

    return { preferences, updatePreference };
}
