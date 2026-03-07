'use client';

import { useState, useEffect } from 'react';

type Theme = 'default' | 'midnight' | 'cyberpunk' | 'classic';

export default function ThemeSwitcher() {
    return (
        <div className="theme-switcher-inline">
            <div className="theme-inline-btn active cursor-default opacity-80" title="Cosmic Theme (Standard)">
                <span className="theme-icon">🎨</span>
                <span className="theme-label">Cosmic UI</span>
            </div>
        </div>
    );
}
