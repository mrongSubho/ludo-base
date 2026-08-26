'use client';

import { usePreferences } from '@/hooks/usePreferences';

type Theme = 'ui' | 'retro';

export default function ThemeSwitcher() {
    const { preferences, updatePreference } = usePreferences();
    const activeTheme = preferences.theme as Theme;

    const toggleTheme = (theme: Theme) => {
        if (theme === activeTheme) return;
        updatePreference('ludo-theme', theme);
    };

    const PaletteIcon = (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
            <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
            <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
            <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
            <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
            <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
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
                onClick={() => toggleTheme('ui')}
                className={`theme-inline-btn ${activeTheme === 'ui' ? 'active' : 'cursor-pointer'}`}
            >
                <span className="theme-icon">{PaletteIcon}</span>
                <span className="theme-label">Cosmic UI</span>
            </div>
        </div>
    );
}
