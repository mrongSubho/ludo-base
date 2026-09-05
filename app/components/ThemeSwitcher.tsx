// NOTE: currently unused — SettingsPanel hosts its own segmented theme
// control. Kept in sync (Retro-Futurism + Daybreak) for any future consumer.
'use client';

import { usePreferences } from '@/hooks/usePreferences';

type Theme = 'light' | 'retro';

export default function ThemeSwitcher() {
    const { preferences, updatePreference } = usePreferences();
    const activeTheme = preferences.theme as Theme;

    const toggleTheme = (theme: Theme) => {
        if (theme === activeTheme) return;
        updatePreference('ludo-theme', theme);
    };

    const SunIcon = (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-4 h-4">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
    );

    const BoltIcon = (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
    );

    return (
        <div className="theme-switcher-inline">
            <div
                onClick={() => toggleTheme('retro')}
                className={`theme-inline-btn ${activeTheme === 'retro' ? 'active' : 'cursor-pointer'}`}
            >
                <span className="theme-icon">{BoltIcon}</span>
                <span className="theme-label">Retro-Futurism</span>
            </div>
            <div
                onClick={() => toggleTheme('light')}
                className={`theme-inline-btn ${activeTheme === 'light' ? 'active' : 'cursor-pointer'}`}
            >
                <span className="theme-icon">{SunIcon}</span>
                <span className="theme-label">Daybreak</span>
            </div>
        </div>
    );
}
