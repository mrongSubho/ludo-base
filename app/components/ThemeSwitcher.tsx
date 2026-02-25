'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

type Theme = 'default' | 'midnight' | 'cyberpunk' | 'classic';

export default function ThemeSwitcher() {
    const [theme, setTheme] = useState<Theme>('default');
    const [isOpen, setIsOpen] = useState(false);

    useEffect(() => {
        const savedTheme = localStorage.getItem('ludo-theme') as Theme;
        if (savedTheme) {
            setTheme(savedTheme);
            document.documentElement.setAttribute('data-theme', savedTheme);
        }
    }, []);

    const toggleTheme = (newTheme: Theme) => {
        setTheme(newTheme);
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('ludo-theme', newTheme);
        setIsOpen(false);
    };

    const themes: { id: Theme; label: string; icon: string }[] = [
        { id: 'default', label: 'Pastel', icon: '🎨' },
        { id: 'midnight', label: 'Midnight', icon: '🌙' },
        { id: 'cyberpunk', label: 'Cyberpunk', icon: '⚡' },
        { id: 'classic', label: 'Classic', icon: '🎲' },
    ];

    return (
        <div className="theme-switcher-wrapper">
            <button
                className="theme-toggle-btn"
                onClick={() => setIsOpen(!isOpen)}
                title="Change Theme"
            >
                {themes.find(t => t.id === theme)?.icon || '🎨'}
            </button>

            <AnimatePresence>
                {isOpen && (
                    <>
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="theme-menu-overlay"
                            onClick={() => setIsOpen(false)}
                        />
                        <motion.div
                            initial={{ opacity: 0, scale: 0.9, y: 10 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.9, y: 10 }}
                            className="theme-menu"
                        >
                            {themes.map((t) => (
                                <button
                                    key={t.id}
                                    className={`theme-option ${theme === t.id ? 'active' : ''}`}
                                    onClick={() => toggleTheme(t.id)}
                                >
                                    <span className="theme-icon">{t.icon}</span>
                                    <span className="theme-label">{t.label}</span>
                                </button>
                            ))}
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </div>
    );
}
