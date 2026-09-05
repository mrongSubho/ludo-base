"use client";

import React from 'react';
import { useDisconnect } from 'wagmi';
import { motion } from 'framer-motion';
import { usePreferences } from '@/hooks/usePreferences';

// ─── Theme-agnostic contract (holds for current + future themes) ───────────
// 1. This panel always renders on the shared dark-glass sandwich shell, so it
//    only ever uses white-ink + white-opacity surfaces + cyan accents — never
//    theme-bound text/background colors.
// 2. No font-family is set here; headings inherit whatever display font the
//    active theme provides (Russo One today, anything tomorrow).
// 3. Spacing inside `.ludo-settings-scope` is re-asserted in globals.css
//    (the global unlayered reset zeroes Tailwind spacing utilities).

const SoundIcon = () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
        <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
);

const MusicIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
        <path d="M9 18V5l12-2v13"></path>
        <circle cx="6" cy="18" r="3"></circle>
        <circle cx="18" cy="16" r="3"></circle>
    </svg>
);

const HapticIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
        <path d="M5 9h4l2 5h4l2-5h4"></path>
        <path d="M2 12h20"></path>
    </svg>
);

const HelpIcon = () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
);

const MessageIcon = () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
);

const InfoIcon = () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="16" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
);

const FileTextIcon = () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <polyline points="10 9 9 9 8 9" />
    </svg>
);

const ShieldIcon = () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
);

const LogOutIcon = () => (
    <svg className="w-4 h-4 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <polyline points="16 17 21 12 16 7" />
        <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
);

const ChevronIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-white/25">
        <polyline points="9 18 15 12 9 6" />
    </svg>
);

const GearTile = () => (
    <div className="w-7 h-7 rounded-xl bg-cyan-500/15 border border-cyan-400/40 flex items-center justify-center shadow-[0_0_16px_rgba(34,211,238,0.25)]">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-cyan-300">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
    </div>
);

// Segmented control (marketplace STORE/LOADOUT vocabulary). Rebuilt natively so
// panel options always fit their card — the legacy switcher styles assumed a
// wider container and overflowed here. Their component files stay on disk,
// untouched, for any other consumer.
const Segmented = ({ options, value, onPick }: {
    options: { value: string; label: string; icon: React.ReactNode }[];
    value: string;
    onPick: (v: string) => void;
}) => (
    <div className="grid grid-cols-2 gap-1 p-1 rounded-2xl bg-black/50 border border-white/10">
        {options.map(o => {
            const active = o.value === value;
            return (
                <button
                    key={o.value}
                    onClick={() => onPick(o.value)}
                    className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 ${active ? 'bg-cyan-500/20 text-white shadow-[inset_0_0_0_1px_rgba(34,211,238,0.5)]' : 'text-white/35 hover:text-white/70'}`}
                >
                    <span className={active ? 'text-cyan-300' : ''}>{o.icon}</span>
                    <span className="truncate">{o.label}</span>
                </button>
            );
        })}
    </div>
);

const BoltIcon = (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
);

const PaletteIcon = (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
        <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
        <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
        <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
        <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
        <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
    </svg>
);

const PawnIcon = (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
        <circle cx="12" cy="7" r="3" />
        <path d="M12 10v7M8.5 21h7M9.5 17h5" />
    </svg>
);

const OrbIcon = (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
        <circle cx="12" cy="12" r="8" />
        <circle cx="12" cy="12" r="3" />
    </svg>
);
const SectionLabel = ({ children }: { children: React.ReactNode }) => (
    <div className="flex items-center gap-2.5 mb-2">
        <span className="px-2 py-0.5 rounded-md bg-white/[0.07] border border-white/10 text-[10px] font-black tracking-[0.18em] text-white/60 font-mono uppercase">
            {children}
        </span>
        <div className="flex-1 h-px bg-gradient-to-r from-white/15 to-transparent" />
    </div>
);

// iOS-style switch, single cyan accent (theme-agnostic on the dark shell)
const Switch = ({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) => (
    <button
        onClick={onToggle}
        role="switch"
        aria-checked={on}
        aria-label={label}
        className={`w-11 h-6 rounded-full p-0.5 transition-colors shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 ${on ? 'bg-cyan-500' : 'bg-white/10'}`}
    >
        <motion.div
            layout
            className="w-[18px] h-[18px] bg-white rounded-full shadow"
            animate={{ x: on ? 20 : 0 }}
            transition={{ type: 'spring', stiffness: 500, damping: 32 }}
        />
    </button>
);

const PrefRow = ({ icon, tint, label, hint, on, onToggle, last = false }: {
    icon: React.ReactNode; tint: string; label: string; hint: string;
    on: boolean; onToggle: () => void; last?: boolean;
}) => (
    <div className={`flex items-center justify-between p-3.5 ${last ? '' : 'border-b border-white/5'}`}>
        <div className="flex items-center gap-3 min-w-0">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${tint}`}>
                {icon}
            </div>
            <div className="flex flex-col min-w-0">
                <span className="text-[13px] font-bold text-white truncate">{label}</span>
                <span className="text-[10px] font-bold text-white/35 truncate">{hint}</span>
            </div>
        </div>
        <Switch on={on} onToggle={onToggle} label={label} />
    </div>
);

const NavRow = ({ icon, tint, label, hint, last = false }: {
    icon: React.ReactNode; tint: string; label: string; hint?: string; last?: boolean;
}) => (
    <button className={`w-full flex items-center gap-3 p-3.5 hover:bg-white/5 active:bg-white/10 transition-colors text-left ${last ? '' : 'border-b border-white/5'}`}>
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${tint}`}>
            {icon}
        </div>
        <div className="flex-1 flex flex-col min-w-0">
            <span className="text-[13px] font-bold text-white truncate">{label}</span>
            {hint && <span className="text-[10px] font-bold text-white/35 truncate">{hint}</span>}
        </div>
        <ChevronIcon />
    </button>
);

export function SettingsPanel({ onClose }: { onClose: () => void }) {
    const { preferences, updatePreference } = usePreferences();
    const { disconnect } = useDisconnect();

    return (
        <>
            <div className="fixed top-[64px] bottom-[80px] left-0 right-0 z-40 bg-transparent" />

            <div className="fixed inset-0 z-[110] flex justify-center pointer-events-none">
                <div className="w-full max-w-[500px] relative h-full">
                    <div
                        /* Unified global panel layout: top-64, bottom-80 sandwich */
                        className="ludo-settings-scope pointer-events-auto absolute top-[64px] bottom-[80px] left-[8px] right-[8px] border border-white/10 rounded-[32px] flex flex-col shadow-2xl overflow-hidden"
                        style={{ background: 'var(--ludo-bg-cosmic)', backgroundColor: 'rgba(13,13,13,0.92)', backdropFilter: 'blur(32px)' }}
                    >
                        {/* Authentic Subdued Cosmic Orbs */}
                        <div className="absolute top-[-20%] left-[-20%] w-full h-full cosmic-orb cosmic-orb-1 opacity-20 scale-150 pointer-events-none" />
                        <div className="absolute bottom-[-20%] right-[-20%] w-full h-full cosmic-orb cosmic-orb-2 opacity-15 scale-150 pointer-events-none" />

                        {/* Drag Handle */}
                        <div className="w-full flex justify-center pt-2 pb-1 relative z-10">
                            <div className="w-12 h-1.5 bg-white/20 rounded-full" />
                        </div>

                        {/* Header */}
                        <div className="px-5 pb-3 border-b border-white/10 relative z-10">
                            <div className="flex items-center justify-between mb-1 mt-1">
                                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                    <GearTile />
                                    Settings
                                </h2>
                                <button
                                    onClick={onClose}
                                    aria-label="Close settings"
                                    className="w-8 h-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-all ring-1 ring-white/10 shadow-sm"
                                >
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                </button>
                            </div>
                            <div className="flex items-center gap-2 px-0.5">
                                <span className="text-[11px] font-black text-cyan-300 tracking-wide uppercase">Tuned per wallet</span>
                                <span className="w-0.5 h-0.5 rounded-full bg-white/25" />
                                <span className="px-2 py-0.5 rounded-full bg-black/40 border border-white/10 text-[11px] font-black text-white/70 font-mono">
                                    v1.0.0
                                </span>
                            </div>
                        </div>

                        {/* Scrollable Content */}
                        <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar px-5 pt-3 pb-4 relative z-10 flex flex-col gap-4">

                            {/* Preferences */}
                            <section>
                                <SectionLabel>Preferences</SectionLabel>
                                <div className="rounded-2xl border border-white/10 bg-white/[0.04] overflow-hidden divide-y divide-white/5">
                                    <PrefRow
                                        icon={<SoundIcon />} tint="bg-cyan-500/15 text-cyan-300"
                                        label="Sound Effects" hint="Rolls, captures, UI taps"
                                        on={preferences.sfx} onToggle={() => updatePreference('ludo-sfx', preferences.sfx ? 'off' : 'on')}
                                    />
                                    <PrefRow
                                        icon={<MusicIcon />} tint="bg-fuchsia-500/15 text-fuchsia-300"
                                        label="Game Music" hint="Lobby and arena ambience"
                                        on={preferences.music} onToggle={() => updatePreference('ludo-music', preferences.music ? 'off' : 'on')}
                                    />
                                    <PrefRow
                                        icon={<HapticIcon />} tint="bg-amber-500/15 text-amber-300"
                                        label="Haptics" hint="Vibration on key moments"
                                        on={preferences.haptics} onToggle={() => updatePreference('ludo-haptic', preferences.haptics ? 'off' : 'on')}
                                    />
                                </div>
                            </section>

                            {/* Appearance */}
                            <section>
                                <SectionLabel>Appearance</SectionLabel>
                                <div className="rounded-2xl border border-white/10 bg-white/[0.04] overflow-hidden divide-y divide-white/5">
                                    <div className="p-3.5">
                                        <div className="text-[10px] font-black uppercase tracking-widest text-white/35 mb-2">Theme</div>
                                        <Segmented
                                            value={preferences.theme}
                                            onPick={(v) => updatePreference('ludo-theme', v)}
                                            options={[
                                                { value: 'retro', label: 'Retro', icon: BoltIcon },
                                                { value: 'ui', label: 'Cosmic', icon: PaletteIcon },
                                            ]}
                                        />
                                    </div>
                                    <div className="p-3.5">
                                        <div className="text-[10px] font-black uppercase tracking-widest text-white/35 mb-2">Token style</div>
                                        <Segmented
                                            value={preferences.tokenStyle}
                                            onPick={(v) => updatePreference('token-style', v)}
                                            options={[
                                                { value: 'pawn', label: 'Chess', icon: PawnIcon },
                                                { value: 'orb', label: 'Orbs', icon: OrbIcon },
                                            ]}
                                        />
                                    </div>
                                </div>
                                <p className="text-[10px] font-bold text-white/30 mt-2 px-1">
                                    Dice skins live in the Marketplace — anything you own can be equipped from your Loadout.
                                </p>
                            </section>

                            {/* Support */}
                            <section>
                                <SectionLabel>Support</SectionLabel>
                                <div className="rounded-2xl border border-white/10 bg-white/[0.04] overflow-hidden divide-y divide-white/5">
                                    <NavRow icon={<HelpIcon />} tint="bg-cyan-500/15 text-cyan-300" label="Help Center" hint="Rules, fairness, payouts" />
                                    <NavRow icon={<MessageIcon />} tint="bg-cyan-500/15 text-cyan-300" label="Feedback" hint="Tell us what to fix next" />
                                </div>
                            </section>

                            {/* About */}
                            <section>
                                <SectionLabel>About</SectionLabel>
                                <div className="rounded-2xl border border-white/10 bg-white/[0.04] overflow-hidden divide-y divide-white/5">
                                    <NavRow icon={<InfoIcon />} tint="bg-cyan-500/15 text-cyan-300" label="About Ludo Base" />
                                    <NavRow icon={<FileTextIcon />} tint="bg-cyan-500/15 text-cyan-300" label="Terms of Service" />
                                    <NavRow icon={<ShieldIcon />} tint="bg-cyan-500/15 text-cyan-300" label="Privacy Policy" />
                                </div>
                                <p className="text-center text-[10px] font-black uppercase tracking-[0.2em] text-white/30 mt-3">
                                    Ludo Base · Onchain Arena
                                </p>
                                <p className="text-center text-[10px] text-white/25 font-mono mt-0.5">
                                    build {process.env.NEXT_PUBLIC_GIT_HASH || 'dev'}
                                </p>
                            </section>

                            {/* Sign out */}
                            <button
                                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-red-500/10 border border-red-500/25 hover:bg-red-500/20 active:scale-[0.99] transition-all text-red-400 text-xs font-black uppercase tracking-[0.18em]"
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
        </>
    );
}
