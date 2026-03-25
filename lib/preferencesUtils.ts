'use client';

/**
 * Client-side helper to manage user preferences via cookies
 * Survives page refreshes and is accessible by the server layout
 */

export type PreferenceKey = 'ludo-theme' | 'ludo-sfx' | 'ludo-music' | 'ludo-haptic';

export function setPreferenceCookie(key: PreferenceKey, value: string) {
    // Set cookie for 1 year
    const maxAge = 60 * 60 * 24 * 365;
    document.cookie = `${key}=${value}; path=/; max-age=${maxAge}; SameSite=Lax`;
}

export function getPreferenceCookie(key: PreferenceKey): string | null {
    if (typeof document === 'undefined') return null;
    const name = `${key}=`;
    const decodedCookie = decodeURIComponent(document.cookie);
    const ca = decodedCookie.split(';');
    for (let i = 0; i < ca.length; i++) {
        let c = ca[i];
        while (c.charAt(0) === ' ') {
            c = c.substring(1);
        }
        if (c.indexOf(name) === 0) {
            return c.substring(name.length, c.length);
        }
    }
    return null;
}

// Legacy support for theme specifically
export function setThemeCookie(theme: string) {
    setPreferenceCookie('ludo-theme', theme);
}

export function getThemeCookie(): string | null {
    return getPreferenceCookie('ludo-theme');
}
