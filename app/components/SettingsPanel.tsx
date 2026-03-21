"use client";

import React, { useState, useEffect } from 'react';
import { useDisconnect } from 'wagmi';
import { motion } from 'framer-motion';
import ThemeSwitcher from './ThemeSwitcher';

// ─── Settings Drawer Icons ───────────────────────────────────────────────────

const SoundIcon = () => (
    <svg className="w-5 h-5 text-cyan-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
        <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
);

const HelpIcon = () => (
    <svg className="w-5 h-5 text-cyan-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
);

const MessageIcon = () => (
    <svg className="w-5 h-5 text-cyan-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
);

const InfoIcon = () => (
    <svg className="w-5 h-5 text-cyan-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="16" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
);

const FileTextIcon = () => (
    <svg className="w-5 h-5 text-cyan-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <polyline points="10 9 9 9 8 9" />
    </svg>
);

const ShieldIcon = () => (
    <svg className="w-5 h-5 text-cyan-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
);

const LogOutIcon = () => (
    <svg className="w-5 h-5 text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
        <>
            <div
                className="fixed top-[64px] bottom-[80px] left-0 right-0 z-40 bg-transparent"
            />

            <div className="fixed inset-0 z-[110] flex justify-center pointer-events-none">
                <div className="w-full max-w-[500px] relative h-full">
                    <div
                        /* Unified global panel layout: top-64, bottom-80 sandwich */
                        className="pointer-events-auto absolute top-[64px] bottom-[80px] left-[8px] right-[8px] border border-white/10 rounded-[32px] flex flex-col shadow-2xl overflow-y-auto pb-[40px]"
                        style={{ background: 'var(--ludo-bg-cosmic)', backgroundColor: 'rgba(13,13,13,0.92)', backdropFilter: 'blur(32px)' }}
                    >
                {/* Authentic Subdued Cosmic Orbs */}
                <div className="absolute top-[-20%] left-[-20%] w-full h-full cosmic-orb cosmic-orb-1 opacity-20 scale-150 pointer-events-none" />
                <div className="absolute bottom-[-20%] right-[-20%] w-full h-full cosmic-orb cosmic-orb-2 opacity-15 scale-150 pointer-events-none" />

                {/* Handle Bar */}
                <div className="w-full flex justify-center pt-4 pb-2">
                    <div className="w-12 h-1.5 bg-white/20 rounded-full" />
                </div>

                {/* Header */}
                <div className="px-panel-gutter pb-4 border-b border-white/10">
                    <div className="flex items-center justify-between mt-2">
                        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6 text-cyan-400">
                                <circle cx="12" cy="12" r="3" />
                                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                            </svg>
                            Settings
                        </h2>
                        <button
                            onClick={onClose}
                            className="w-8 h-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-all ring-1 ring-white/10 shadow-sm"
                        >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                        </button>
                    </div>
                </div>

                {/* Scrollable Content Area */}
                <div className="flex-1 overflow-y-auto px-panel-gutter py-4 space-y-6 custom-scrollbar">



                    {/* Preferences Section */}
                    <div className="flex flex-col">
                        <h3 className="text-sm font-bold text-white/40 uppercase tracking-wider mb-3 px-2">Preferences</h3>
                        <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
                            {/* SFX */}
                            <div className="flex items-center justify-between p-4 border-b border-white/5">
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center">
                                        <SoundIcon />
                                    </div>
                                    <span className="text-sm font-medium text-white">Sound Effects</span>
                                </div>
                                <button
                                    className={`w-12 h-6 rounded-full p-1 transition-colors relative flex items-center ${soundEffectsOn ? 'bg-cyan-600' : 'bg-white/10'}`}
                                    onClick={toggleSfx}
                                >
                                    <motion.div
                                        layout
                                        className="w-4 h-4 bg-white rounded-full shadow-sm"
                                        animate={{ x: soundEffectsOn ? 24 : 0 }}
                                        transition={{ type: "spring", stiffness: 500, damping: 30 }}
                                    />
                                </button>
                            </div>

                            {/* Music */}
                            <div className="flex items-center justify-between p-4">
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-full bg-pink-500/20 text-pink-400 flex items-center justify-center">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                                            <path d="M9 18V5l12-2v13"></path>
                                            <circle cx="6" cy="18" r="3"></circle>
                                            <circle cx="18" cy="16" r="3"></circle>
                                        </svg>
                                    </div>
                                    <span className="text-sm font-medium text-white">Game Music</span>
                                </div>
                                <button
                                    className={`w-12 h-6 rounded-full p-1 transition-colors relative flex items-center ${musicOn ? 'bg-pink-500' : 'bg-white/10'}`}
                                    onClick={toggleMusic}
                                >
                                    <motion.div
                                        layout
                                        className="w-4 h-4 bg-white rounded-full shadow-sm"
                                        animate={{ x: musicOn ? 24 : 0 }}
                                        transition={{ type: "spring", stiffness: 500, damping: 30 }}
                                    />
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Theme Section */}
                    <div className="flex flex-col">
                        <h3 className="text-sm font-bold text-white/40 uppercase tracking-wider mb-3 px-2">Theme</h3>
                        <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden p-4 flex justify-center items-center">
                            <ThemeSwitcher />
                        </div>
                    </div>

                    {/* Support Section */}
                    <div className="flex flex-col">
                        <h3 className="text-sm font-bold text-white/40 uppercase tracking-wider mb-3 px-2">Support</h3>
                        <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden flex flex-col">
                            <button className="flex items-center gap-3 p-4 border-b border-white/5 hover:bg-white/5 transition-colors">
                                <div className="w-8 h-8 rounded-full bg-cyan-600/20 flex items-center justify-center">
                                    <HelpIcon />
                                </div>
                                <span className="text-sm font-medium text-white">Help Center</span>
                            </button>
                            <button className="flex items-center gap-3 p-4 hover:bg-white/5 transition-colors">
                                <div className="w-8 h-8 rounded-full bg-cyan-600/20 flex items-center justify-center">
                                    <MessageIcon />
                                </div>
                                <span className="text-sm font-medium text-white">Feedback Form</span>
                            </button>
                        </div>
                    </div>

                    {/* About Section */}
                    <div className="flex flex-col">
                        <h3 className="text-sm font-bold text-white/40 uppercase tracking-wider mb-3 px-2">About</h3>
                        <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden flex flex-col">
                            <button className="flex items-center gap-3 p-4 border-b border-white/5 hover:bg-white/5 transition-colors">
                                <div className="w-8 h-8 rounded-full bg-cyan-600/20 flex items-center justify-center">
                                    <InfoIcon />
                                </div>
                                <span className="text-sm font-medium text-white">About Us</span>
                            </button>
                            <button className="flex items-center gap-3 p-4 border-b border-white/5 hover:bg-white/5 transition-colors">
                                <div className="w-8 h-8 rounded-full bg-cyan-600/20 flex items-center justify-center">
                                    <FileTextIcon />
                                </div>
                                <span className="text-sm font-medium text-white">Terms of Services</span>
                            </button>
                            <button className="flex items-center gap-3 p-4 hover:bg-white/5 transition-colors">
                                <div className="w-8 h-8 rounded-full bg-cyan-600/20 flex items-center justify-center">
                                    <ShieldIcon />
                                </div>
                                <span className="text-sm font-medium text-white">Privacy Policy</span>
                            </button>
                        </div>
                        <div className="mt-4 flex flex-col items-center justify-center text-center">
                            <p className="text-white/60 font-bold tracking-widest uppercase text-xs">Ludo Base : The Onchain Arena</p>
                            <p className="text-white/30 text-xs">Version 1.0.0</p>
                        </div>
                    </div>

                    {/* Sign Out */}
                    <div className="pt-4 pb-8">
                        <button
                            className="w-full flex items-center justify-center gap-2 p-4 rounded-2xl bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 transition-colors text-red-500 font-bold"
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
        </div>
    </>
    );
};
