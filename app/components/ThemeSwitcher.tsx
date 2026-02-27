'use client';

import { useState, useEffect } from 'react';

type Theme = 'default' | 'midnight' | 'cyberpunk' | 'classic';

export default function ThemeSwitcher() {
    const [theme, setTheme] = useState<Theme>('default');

    useEffect(() => {
        const savedTheme = localStorage.getItem('ludo-theme') as Theme;
        if (savedTheme) {
            setTheme(savedTheme);
        }
    }, []);

    const toggleTheme = (newTheme: Theme) => {
        setTheme(newTheme);
        localStorage.setItem('ludo-theme', newTheme);
    };

    const themes: { id: Theme; label: string; icon: string }[] = [
        { id: 'default', label: 'Pastel', icon: '🎨' },
        { id: 'midnight', label: 'Midnight', icon: '🌙' },
        { id: 'cyberpunk', label: 'Cyberpunk', icon: '⚡' },
        { id: 'classic', label: 'Classic', icon: '🎲' },
    ];

    return (
        <div className="theme-switcher-inline">
            {themes.map((t) => (
                <button
                    key={t.id}
                    className={`theme-inline-btn ${theme === t.id ? 'active' : ''}`}
                    onClick={() => toggleTheme(t.id)}
                    title={t.label}
                >
                    <span className="theme-icon">{t.icon}</span>
                    <span className="theme-label">{t.label}</span>
                </button>
            ))}
        </div>
    );
}
