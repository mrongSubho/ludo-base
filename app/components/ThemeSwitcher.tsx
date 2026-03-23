'use client';

import { useState, useEffect } from 'react';

type Theme = 'default' | 'midnight' | 'cyberpunk' | 'classic';

export default function ThemeSwitcher() {
    const [activeTheme, setActiveTheme] = useState<'ui' | 'dark'>('ui');

    useEffect(() => {
        const saved = localStorage.getItem('ludo-theme');
        if (saved === 'dark') {
            setActiveTheme('dark');
            document.body.classList.add('theme-cosmic-dark');
            document.body.classList.remove('theme-cosmic-ui');
        } else {
            document.body.classList.add('theme-cosmic-ui');
            document.body.classList.remove('theme-cosmic-dark');
        }
    }, []);

    const toggleTheme = (theme: 'ui' | 'dark') => {
        if (theme === activeTheme) return;
        setActiveTheme(theme);
        localStorage.setItem('ludo-theme', theme);
        if (theme === 'dark') {
            document.body.classList.add('theme-cosmic-dark');
            document.body.classList.remove('theme-cosmic-ui');
        } else {
            document.body.classList.add('theme-cosmic-ui');
            document.body.classList.remove('theme-cosmic-dark');
        }
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
        </div>
    );
}
