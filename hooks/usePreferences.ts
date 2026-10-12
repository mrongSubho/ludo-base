'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { getPreferenceCookie, setPreferenceCookie, PreferenceKey } from '@/lib/preferencesUtils';
import { isGuestActive } from '@/lib/guest';

export interface Preferences {
    theme: string;
    sfx: boolean;
    music: boolean;
    haptics: boolean;
    tokenStyle: string;
    diceStyle: string;
}

const DEFAULTS: Preferences = {
    theme: 'retro',
    sfx: true,
    music: true,
    haptics: true,
    tokenStyle: 'pawn',
    diceStyle: 'classic',
};

/** Cookie/localStorage invalidation: one event name for every write. */
const PREF_CHANGE_EVENT = 'ludo-prefs-change';

const listeners = new Set<() => void>();

function emitChange(): void {
    listeners.forEach(fn => fn());
    try {
        window.dispatchEvent(new Event(PREF_CHANGE_EVENT));
    } catch {
        /* SSR / non-DOM */
    }
}

function subscribe(onStoreChange: () => void): () => void {
    listeners.add(onStoreChange);
    try {
        window.addEventListener(PREF_CHANGE_EVENT, onStoreChange);
    } catch {
        /* SSR */
    }
    return () => {
        listeners.delete(onStoreChange);
        try {
            window.removeEventListener(PREF_CHANGE_EVENT, onStoreChange);
        } catch {
            /* SSR */
        }
    };
}

/** Stable snapshot — same content must produce the same object identity, or
 *  `useSyncExternalStore` re-renders every consumer in an infinite loop. */
let cachedSnapshot: Preferences | null = null;
let cachedRaw: string | null = null;

function snapshot(): Preferences {
    const getVal = (key: PreferenceKey, fallback: string): string => {
        try {
            return getPreferenceCookie(key) || localStorage.getItem(key) || fallback;
        } catch {
            return fallback;
        }
    };

    const raw = [
        getVal('ludo-theme', 'retro'),
        getVal('ludo-sfx', 'on'),
        getVal('ludo-music', 'on'),
        getVal('ludo-haptic', 'on'),
        getVal('token-style', 'pawn'),
        getVal('dice-style', 'classic'),
    ].join('|');
    if (cachedSnapshot && cachedRaw === raw) return cachedSnapshot;

    // Legacy 'dark'/'ui' cookies migrate to Retro-Futurism (the default);
    // legacy 'porcelain' cookies migrate to Daybreak.
    // Valid themes: retro (dark) | light (daybreak).
    const themeRaw = raw.split('|')[0] ?? 'retro';
    const theme = themeRaw === 'light' || themeRaw === 'porcelain' ? 'light' : 'retro';
    const sfx = (raw.split('|')[1] ?? 'on') === 'on';
    const music = (raw.split('|')[2] ?? 'on') === 'on';
    const haptics = (raw.split('|')[3] ?? 'on') === 'on';
    // Guests default to orb tokens (their flagship trial look) unless they
    // already picked a style — wallet users keep the pawn default.
    const tokenFallback = (() => {
        try {
            return isGuestActive() ? 'orb' : 'pawn';
        } catch {
            return 'pawn';
        }
    })();
    const tokenStyle = (raw.split('|')[4] ?? tokenFallback) === 'orb' ? 'orb' : 'pawn';
    const diceRaw = raw.split('|')[5] ?? 'classic';
    const diceStyle = diceRaw === 'midnight' || diceRaw === 'gold' ? diceRaw : 'classic';

    cachedRaw = raw;
    cachedSnapshot = { theme, sfx, music, haptics, tokenStyle, diceStyle };
    return cachedSnapshot;
}

function applyBodyClasses(p: Preferences): void {
    if (typeof document === 'undefined') return;
    document.body.classList.remove('theme-retro-futurism', 'theme-daybreak');
    if (p.theme === 'light') document.body.classList.add('theme-daybreak');
    else document.body.classList.add('theme-retro-futurism');
    document.body.classList.toggle('token-style-orb', p.tokenStyle === 'orb');
}

/**
 * REA-07: one store over the cookie, read through useSyncExternalStore.
 *
 * Previously each consumer held its own useState seeded in a mount effect, so
 * a mid-match toggle reached only the component that changed it — the theme
 * switch re-rendered Settings while the board kept the old token style. The
 * store is the cookie; every consumer subscribes to the same invalidation.
 */
export function usePreferences() {
    const preferences = useSyncExternalStore(subscribe, snapshot, () => DEFAULTS);

    const updatePreference = useCallback((key: PreferenceKey, value: string) => {
        try {
            setPreferenceCookie(key, value);
        } catch {
            /* SSR / non-DOM — the store still updates below */
        }
        try {
            localStorage.setItem(key, value);
        } catch {
            /* private mode */
        }
        // Invalidate the shared snapshot BEFORE notifying, so a reader that
        // re-reads during the dispatch sees the new value.
        cachedRaw = null;
        cachedSnapshot = null;
        applyBodyClasses(snapshot());
        emitChange();
    }, []);

    return { preferences, updatePreference };
}
