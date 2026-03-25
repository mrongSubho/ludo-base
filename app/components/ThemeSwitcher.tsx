'use client';

import { usePreferences } from '@/hooks/usePreferences';

type Theme = 'ui' | 'dark' | 'retro';

export default function ThemeSwitcher() {
    const { preferences, updatePreference } = usePreferences();
    const activeTheme = preferences.theme as Theme;

    const toggleTheme = (theme: Theme) => {
        if (theme === activeTheme) return;
        updatePreference('ludo-theme', theme);
    };

    return (
        <div className="theme-switcher-inline">
            <div 
                onClick={() => toggleTheme('ui')}
                className={`theme-inline-btn ${activeTheme === 'ui' ? 'active' : 'cursor-pointer'}`}
            >
                <span className="theme-icon">🎨</span>
                <span className="theme-label">Cosmic UI</span>
            </div>
            <div 
                onClick={() => toggleTheme('dark')}
                className={`theme-inline-btn ${activeTheme === 'dark' ? 'active' : 'cursor-pointer'}`}
            >
                <span className="theme-icon">🌑</span>
                <span className="theme-label">Cosmic Dark</span>
            </div>
            <div 
                onClick={() => toggleTheme('retro')}
                className={`theme-inline-btn ${activeTheme === 'retro' ? 'active' : 'cursor-pointer'}`}
            >
                <span className="theme-icon">⚡</span>
                <span className="theme-label">Retro-Futurism</span>
            </div>
        </div>
    );
}
