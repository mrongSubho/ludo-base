"use client";

import React, { useState, useEffect } from 'react';
import { useDisconnect } from 'wagmi';
import ThemeSwitcher from './ThemeSwitcher';

// ─── Settings Drawer Icons ───────────────────────────────────────────────────

const SoundIcon = () => (
    <svg className="settings-row-icon svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
        <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
);

const HelpIcon = () => (
    <svg className="settings-row-icon svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
);

const MessageIcon = () => (
    <svg className="settings-row-icon svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
);

const InfoIcon = () => (
    <svg className="settings-row-icon svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="16" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
);

const FileTextIcon = () => (
    <svg className="settings-row-icon svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <polyline points="10 9 9 9 8 9" />
    </svg>
);

const ShieldIcon = () => (
    <svg className="settings-row-icon svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
);

const LogOutIcon = () => (
    <svg className="settings-row-icon svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <polyline points="16 17 21 12 16 7" />
        <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
);

export function SettingsPanel({ onClose }: { onClose: () => void }) {
    const [soundEffectsOn, setSoundEffectsOn] = useState(true);
    const [musicOn, setMusicOn] = useState(true);
    const { disconnect } = useDisconnect();

    useEffect(() => {
        // Read initial preferences from localStorage
        const savedSfx = localStorage.getItem('ludo-sfx');
        const savedMusic = localStorage.getItem('ludo-music');
        if (savedSfx !== null) setSoundEffectsOn(savedSfx === 'on');
        if (savedMusic !== null) setMusicOn(savedMusic === 'on');
    }, []);

    const toggleSfx = () => {
        const newState = !soundEffectsOn;
        setSoundEffectsOn(newState);
        localStorage.setItem('ludo-sfx', newState ? 'on' : 'off');
    };

    const toggleMusic = () => {
        const newState = !musicOn;
        setMusicOn(newState);
        localStorage.setItem('ludo-music', newState ? 'on' : 'off');
    };

    return (
        <div className="settings-drawer-overlay" onClick={onClose}>
            <div className="settings-drawer" onClick={e => e.stopPropagation()}>
                <div className="settings-drawer-header">
                    <h2 className="settings-drawer-title">Settings</h2>
                    <button className="settings-drawer-close" onClick={onClose}>✕</button>
                </div>
                <div className="settings-drawer-body">
                    <div className="settings-section">
                        <h3 className="settings-section-title">Theme</h3>
                        <div className="settings-theme-row">
                            <ThemeSwitcher />
                        </div>
                    </div>
                    <div className="settings-divider" />
                    <div className="settings-section">
                        <h3 className="settings-section-title">Preferences</h3>
                        <div className="settings-row">
                            <div className="settings-row-left">
                                <SoundIcon />
                                <span>Sound Effects</span>
                            </div>
                            <button className={`settings-toggle ${soundEffectsOn ? 'toggle-on' : ''}`} onClick={toggleSfx}>
                                <span className="toggle-knob" />
                            </button>
                        </div>
                        <div className="settings-row">
                            <div className="settings-row-left">
                                <svg className="settings-row-icon svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
                                    <path d="M9 18V5l12-2v13"></path>
                                    <circle cx="6" cy="18" r="3"></circle>
                                    <circle cx="18" cy="16" r="3"></circle>
                                </svg>
                                <span>Game Music</span>
                            </div>
                            <button className={`settings-toggle ${musicOn ? 'toggle-on' : ''}`} onClick={toggleMusic}>
                                <span className="toggle-knob" />
                            </button>
                        </div>
                    </div>
                    <div className="settings-divider" />
                    <div className="settings-section">
                        <h3 className="settings-section-title">Support</h3>
                        <button className="settings-action-btn">
                            <HelpIcon />
                            <span>Help Center</span>
                        </button>
                        <button className="settings-action-btn">
                            <MessageIcon />
                            <span>Feedback Form</span>
                        </button>
                    </div>

                    <div className="settings-divider" />
                    <div className="settings-section">
                        <h3 className="settings-section-title">About</h3>
                        <button className="settings-action-btn">
                            <InfoIcon />
                            <span>About Us</span>
                        </button>
                        <button className="settings-action-btn">
                            <FileTextIcon />
                            <span>Terms of Services</span>
                        </button>
                        <button className="settings-action-btn">
                            <ShieldIcon />
                            <span>Privacy Policy</span>
                        </button>

                        <div className="settings-about">
                            <p>Ludo Base Superstar</p>
                            <p className="settings-version">Version 1.0.0</p>
                        </div>
                    </div>

                    <div className="settings-divider" />
                    <div className="settings-section">
                        <button
                            className="settings-action-btn text-danger"
                            onClick={() => {
                                disconnect();
                                onClose();
                            }}
                        >
                            <LogOutIcon />
                            <span>Sign Out</span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
