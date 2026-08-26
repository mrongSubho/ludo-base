'use client';

import { useState, useEffect, useCallback } from 'react';
import { getPreferenceCookie, setPreferenceCookie, PreferenceKey } from '@/lib/preferencesUtils';

export interface Preferences {
    theme: string;
    sfx: boolean;
    music: boolean;
    haptics: boolean;
    tokenStyle: string;
}

export function usePreferences() {
    const [preferences, setPreferences] = useState<Preferences>({
        theme: 'retro',
        sfx: true,
        music: true,
        haptics: true,
        tokenStyle: 'pawn',
    });

    // Initialize from cookies or localStorage
    useEffect(() => {
        const getVal = (key: PreferenceKey, fallback: string): string => {
            return getPreferenceCookie(key) || localStorage.getItem(key) || fallback;
        };

        // Legacy 'dark' cookies migrate to Retro-Futurism (the default)
        const raw = getVal('ludo-theme', 'retro');
        const theme = raw === 'ui' ? 'ui' : 'retro';
        const sfx = getVal('ludo-sfx', 'on') === 'on';
        const music = getVal('ludo-music', 'on') === 'on';
        const haptics = getVal('ludo-haptic', 'on') === 'on';
        const tokenStyle = getVal('token-style', 'pawn') === 'orb' ? 'orb' : 'pawn';

        setPreferences({ theme, sfx, music, haptics, tokenStyle });

        // Apply token style class immediately on load
        if (tokenStyle === 'orb') document.body.classList.add('token-style-orb');
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
            tokenStyle: key === 'token-style' ? value : prev.tokenStyle,
        }));

        // Trigger side effects immediately if needed (e.g. theme application)
        if (key === 'ludo-theme') {
            document.body.classList.remove('theme-cosmic-ui', 'theme-cosmic-dark', 'theme-retro-futurism');
            if (value === 'ui') document.body.classList.add('theme-cosmic-ui');
            else document.body.classList.add('theme-retro-futurism');
        }

        if (key === 'token-style') {
            document.body.classList.toggle('token-style-orb', value === 'orb');
        }
    }, []);

    return { preferences, updatePreference };
}
