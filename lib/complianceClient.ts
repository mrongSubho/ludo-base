'use client';

export const ANALYTICS_CONSENT_KEY = 'ludo-analytics-consent-v1';

const listeners = new Set<(enabled: boolean) => void>();

export function hasAnalyticsConsent(): boolean {
    if (typeof window === 'undefined') return false;
    try {
        return window.localStorage.getItem(ANALYTICS_CONSENT_KEY) === 'true';
    } catch {
        return false;
    }
}

export function setAnalyticsConsent(enabled: boolean): void {
    const val = Boolean(enabled);
    if (typeof window !== 'undefined') {
        try {
            window.localStorage.setItem(ANALYTICS_CONSENT_KEY, val ? 'true' : 'false');
        } catch {
            /* storage unavailable */
        }
    }
    for (const cb of listeners) {
        try {
            cb(val);
        } catch {
            /* ignore listener error */
        }
    }
}

export function onAnalyticsConsentChange(cb: (enabled: boolean) => void): () => void {
    listeners.add(cb);
    if (typeof window === 'undefined') {
        return () => {
            listeners.delete(cb);
        };
    }
    const onStorage = (e: StorageEvent) => {
        if (e.key === ANALYTICS_CONSENT_KEY) {
            cb(e.newValue === 'true');
        }
    };
    window.addEventListener('storage', onStorage);
    return () => {
        listeners.delete(cb);
        window.removeEventListener('storage', onStorage);
    };
}
