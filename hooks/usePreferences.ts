'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { getPreferenceCookie, setPreferenceCookie, PreferenceKey } from '@/lib/preferencesUtils';

export interface Preferences {
    theme: string;
    sfx: boolean;
    music: boolean;
    sfxVolume: number;
    musicVolume: number;
    haptics: boolean;
    tokenStyle: string;
    diceStyle: string;
}

const DEFAULTS: Preferences = {
    theme: '3077',
    sfx: true,
    music: true,
    sfxVolume: 80,
    musicVolume: 70,
    haptics: true,
    tokenStyle: 'orb',
    diceStyle: 'classic',
};

function parseVolume(raw: string | undefined, fallback: number): number {
    if (raw === undefined || raw === '') return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.min(100, Math.round(n)));
}

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
        getVal('ludo-theme', '3077'),
        getVal('ludo-sfx', 'on'),
        getVal('ludo-music', 'on'),
        getVal('ludo-haptic', 'on'),
        getVal('token-style', 'orb'),
        getVal('dice-style', 'classic'),
        getVal('ludo-sfx-vol', '80'),
        getVal('ludo-music-vol', '70'),
    ].join('|');
    if (cachedSnapshot && cachedRaw === raw) return cachedSnapshot;

    // Legacy 'dark'/'ui' cookies migrate to Retro-Futurism;
    // legacy 'porcelain' cookies migrate to Daybreak.
    // Valid themes: 3077 (flagship cyber-tactical, default) | retro (cosmic dark) | light (daybreak).
    const parts = raw.split('|');
    const themeRaw = parts[0] ?? '3077';
    let theme = '3077';
    if (themeRaw === 'retro' || themeRaw === 'dark' || themeRaw === 'ui') theme = 'retro';
    else if (themeRaw === 'light' || themeRaw === 'porcelain') theme = 'light';
    const sfx = (parts[1] ?? 'on') === 'on';
    const music = (parts[2] ?? 'on') === 'on';
    const haptics = (parts[3] ?? 'on') === 'on';
    // Orb is the default token style for everyone. `raw` is always joined
    // values, so `parts[4]` is never undefined — the previous `??
    // tokenFallback` was dead code and the guest/wallet branch above it never
    // ran, which is why "selected the default as orb" still rendered pawns.
    // An explicit 'pawn' cookie still wins; only the default moved.
    const tokenStyle = (parts[4] ?? 'orb') === 'pawn' ? 'pawn' : 'orb';
    const diceRaw = parts[5] ?? 'classic';
    const diceStyle = diceRaw === 'midnight' || diceRaw === 'gold' ? diceRaw : 'classic';
    const sfxVolume = parseVolume(parts[6], DEFAULTS.sfxVolume);
    const musicVolume = parseVolume(parts[7], DEFAULTS.musicVolume);

    cachedRaw = raw;
    cachedSnapshot = { theme, sfx, music, sfxVolume, musicVolume, haptics, tokenStyle, diceStyle };
    return cachedSnapshot;
}

function applyBodyClasses(p: Preferences): void {
    if (typeof document === 'undefined') return;
    document.body.classList.remove('theme-retro-futurism', 'theme-daybreak', 'theme-3077');
    if (p.theme === 'retro') document.body.classList.add('theme-retro-futurism');
    else if (p.theme === 'light') document.body.classList.add('theme-daybreak');
    else document.body.classList.add('theme-3077');
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

    // The body classes must exist on FIRST PAINT, not only after the user
    // toggles a preference: `applyBodyClasses` used to run solely inside
    // `updatePreference`, so a fresh visitor (or one whose cookie was written
    // before hydration) never got `token-style-orb` on <body> and board.css
    // kept rendering the chess pawns despite orb being the default. SSR sets
    // the class from the cookie (app/layout.tsx); this effect re-asserts it
    // after hydration and on every change. Idempotent classList writes.
    useEffect(() => {
        applyBodyClasses(preferences);
    }, [preferences]);

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
