'use client';

import React, { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Board from './components/Board';
import SnakesBoard from './components/SnakesBoard';
import ThemeSwitcher from './components/ThemeSwitcher';
import FriendsPanel from './components/FriendsPanel';
import UserProfilePanel from './components/UserProfilePanel';
// Slide-up panels and logic might be moved or handled differently later, omitting Leaderboard for now if not needed,
// but let's keep it imported and conditionally rendered.
import Leaderboard from './components/Leaderboard';
import MissionPanel from './components/MissionPanel';
import MarketplacePanel from './components/MarketplacePanel';

// ─── Inline SVG Icons ────────────────────────────────────────────────────────

const WalletIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
    <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
    <path d="M18 12a1 1 0 1 0 2 0 1 1 0 0 0-2 0" />
  </svg>
);

const TokenIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <path d="M12 6v12M8 10h8M8 14h8" />
  </svg>
);

const ProfileIcon = () => (
  <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

const UsersIcon = () => (
  <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

const TrophyIcon = () => (
  <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 21h8M12 17v4M7 4h10M5 4h14v5a7 7 0 0 1-14 0V4z" />
  </svg>
);

const TargetIcon = () => (
  <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <circle cx="12" cy="12" r="6" />
    <circle cx="12" cy="12" r="2" />
  </svg>
);

const ShopIcon = () => (
  <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
    <line x1="3" y1="6" x2="21" y2="6" />
    <path d="M16 10a4 4 0 0 1-8 0" />
  </svg>
);

const DiceIcon = () => (
  <svg className="mode-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <circle cx="15.5" cy="15.5" r="1.5" />
    <circle cx="15.5" cy="8.5" r="1.5" />
    <circle cx="8.5" cy="15.5" r="1.5" />
    <circle cx="12" cy="12" r="1.5" />
  </svg>
);

const LightningIcon = () => (
  <svg className="mode-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
);

const ChevronRight = () => (
  <svg className="chevron-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

// ─── Settings Drawer Icons ───────────────────────────────────────────────────

const SoundIcon = () => (
  <svg className="settings-row-icon svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
  </svg>
);

const BellIcon = () => (
  <svg className="settings-row-icon svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
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

const SnakeIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
    <path d="M16 2.016c-3.3 0-6 2.7-6 6v3.968c0 1.1-.9 2.016-2 2.016s-2-.916-2-2.016V9.984c0-1.1-.9-2.016-2-2.016S2 8.884 2 9.984v4.064c0 3.3 2.7 6 6 6s6-2.7 6-6V9.984c0-1.1.9-2.016 2-2.016H18c1.1 0 2 .916 2 2.016v4.064c0 1.1.9 2.016 2 2.016s2-.916 2-2.016V8.016c0-3.3-2.7-6-6-6h-2z" />
    <circle cx="15.5" cy="5.5" r="1.5" fill="#fff" />
  </svg>
);

const HeaderMessageIcon = () => (
  <svg className="dm-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
  </svg>
);

const LogOutIcon = () => (
  <svg className="settings-row-icon svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);

// ─── Generic Slide-up Panel (for footer tabs) ─────────────────────────────────

function TabPanel({ title, emoji, icon, description, onClose }: {
  title: string;
  emoji?: string;
  icon?: React.ReactNode;
  description: string;
  onClose: () => void
}) {
  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', damping: 25, stiffness: 200 }} className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[500px] h-[85vh] bg-[#1a1c29]/20 backdrop-blur-xl border-t border-white/10 rounded-t-[32px] z-50 flex flex-col shadow-2xl">
        <div className="w-full flex justify-center pt-4 pb-2" onClick={onClose}><div className="w-12 h-1.5 bg-white/20 rounded-full" /></div>
        <div className="px-6 pb-4 border-b border-white/10 flex flex-col gap-4">
          <div className="flex items-center justify-between mt-2">
            <h2 className="text-2xl font-bold text-white flex items-center gap-3">
              {icon ? icon : <span className="text-2xl">{emoji}</span>}
              {title}
            </h2>
            <button onClick={onClose} className="p-2 rounded-full bg-white/5 hover:bg-white/10 text-white/70 transition-colors">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-8 flex flex-col items-center justify-center text-center opacity-60 pb-safe-footer">
          <div className="mb-4">
            {icon ? (
              <div className="w-16 h-16 text-white/40 mx-auto">
                {icon}
              </div>
            ) : <span className="text-6xl">{emoji}</span>}
          </div>
          <h3 className="text-xl font-bold text-white mb-2">{title}</h3>
          <p className="text-sm text-white/60">{description}</p>
        </div>
      </motion.div>
    </>
  );
}

// ─── Settings Drawer (slides in from right) ──────────────────────────────────

function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [soundEffectsOn, setSoundEffectsOn] = useState(true);
  const [musicOn, setMusicOn] = useState(true);

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
            <button className="settings-action-btn text-danger">
              <LogOutIcon />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Messages Drawer (slides in from right) ──────────────────────────────────

function MessagesPanel({ onClose }: { onClose: () => void }) {
  return (
    <div className="settings-drawer-overlay" onClick={onClose}>
      <div className="settings-drawer" onClick={e => e.stopPropagation()}>
        <div className="settings-drawer-header">
          <h2 className="settings-drawer-title">Messages</h2>
          <button className="settings-drawer-close" onClick={onClose}>✕</button>
        </div>
        <div className="settings-drawer-body" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', opacity: 0.6, paddingTop: '100px' }}>
          <HeaderMessageIcon />
          <p style={{ marginTop: '16px', fontWeight: 500 }}>No new messages yet.</p>
        </div>
      </div>
    </div>
  );
}

// ─── Settings Drawer (slides in from right) ──────────────────────────────────
// (This is located higher up in the file)

// ─── User Profile Dashboard (slides in from right) ───────────────────────────

// ─── Settings Drawer (Side Panel - High Priority) ────────────────────────────────────────────────────────────────

type AppState = 'dashboard' | 'game';
type Tab = 'profile' | 'friends' | 'leaderboard' | 'mission' | 'marketplace' | 'settings' | 'messages' | null;

// Mock user data
const USER = { avatar: '🎮', name: 'Player', level: 8 };

const SplashScreen = () => (
  <motion.div
    initial={{ opacity: 1 }}
    exit={{ opacity: 0 }}
    transition={{ duration: 0.8, ease: "easeInOut" }}
    className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-black/60 backdrop-blur-md"
  >
    <motion.div
      initial={{ scale: 0.8, opacity: 0, y: 20 }}
      animate={{ scale: 1, opacity: 1, y: 0 }}
      transition={{ duration: 0.7, ease: "easeOut" }}
      className="flex flex-col items-center"
    >
      <div className="w-24 h-24 mb-6 relative">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
          className="absolute inset-0 rounded-3xl bg-gradient-to-tr from-indigo-500 to-teal-400 opacity-20 blur-xl"
        />
        <div className="absolute inset-0 bg-gradient-to-tr from-indigo-500 to-teal-400 rounded-3xl shadow-[0_0_40px_rgba(99,102,241,0.4)] flex items-center justify-center border border-white/20">
          <span className="text-5xl drop-shadow-lg">🎲</span>
        </div>
      </div>

      <h1 className="text-4xl md:text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-white via-indigo-200 to-teal-200 tracking-tight mb-2 drop-shadow-sm text-center">
        LUDO BASE
      </h1>
      <p className="text-indigo-300 font-medium tracking-[0.3em] uppercase text-sm mb-12 text-center">
        Superstar Edition
      </p>

      {/* Loading Bar Illusion */}
      <div className="w-64 h-1.5 bg-black/40 rounded-full overflow-hidden border border-white/10 shadow-inner">
        <motion.div
          initial={{ width: "0%" }}
          animate={{ width: "100%" }}
          transition={{ duration: 1.5, ease: "easeInOut" }}
          className="h-full bg-gradient-to-r from-indigo-500 via-teal-400 to-emerald-400 rounded-full shadow-[0_0_10px_rgba(45,212,191,0.6)]"
        />
      </div>
    </motion.div>
  </motion.div>
);

export default function Page() {
  const [isMounted, setIsMounted] = useState(false);
  const [appState, setAppState] = useState<AppState>('dashboard');
  const [activeTab, setActiveTab] = useState<Tab>(null);
  const [showQuitWarning, setShowQuitWarning] = useState(false);
  const [showSplash, setShowSplash] = useState(true);

  // Match Configuration State
  const [selectedMode, setSelectedMode] = useState<'classic' | 'power' | 'snakes'>('classic');
  const [playerCount, setPlayerCount] = useState<'2' | '4' | '2v2'>('4');
  const [betAmount, setBetAmount] = useState<number>(50);

  useEffect(() => {
    setIsMounted(true);
    const t = setTimeout(() => setShowSplash(false), 1500);
    return () => clearTimeout(t);
  }, []);

  // Sync state to ref for back-button hardware popstate interceptor
  const stateRef = useRef({ activeTab, appState, showQuitWarning });
  useEffect(() => {
    stateRef.current = { activeTab, appState, showQuitWarning };
  }, [activeTab, appState, showQuitWarning]);

  useEffect(() => {
    // Push an initial history state so the hardware back button has something to pop instead of leaving the PWA
    window.history.pushState({ ludoState: 'active' }, '', window.location.href);

    const handlePopState = (e: PopStateEvent) => {
      // Re-push state so the next back press is also intercepted
      window.history.pushState({ ludoState: 'active' }, '', window.location.href);

      const current = stateRef.current;

      if (current.activeTab !== null) {
        // Drawer is open -> natively close it
        setActiveTab(null);
      } else if (current.appState === 'game') {
        // In a game -> Prompt exit confirmation instead of leaving instantly
        if (!current.showQuitWarning) {
          setShowQuitWarning(true);
        } else {
          setShowQuitWarning(false);
        }
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  if (!isMounted) {
    return (
      <div className="loading-shell">
        <div className="loading-spinner" />
      </div>
    );
  }

  const closeTab = () => setActiveTab(null);
  const toggle = (tab: Tab) => setActiveTab(prev => prev === tab ? null : tab);

  const handlePlayNow = () => {
    setAppState('game');
  };

  const handleBackToSubMenu = () => {
    setAppState('dashboard');
  };

  return (
    <>
      <AnimatePresence>
        {showSplash && <SplashScreen />}
      </AnimatePresence>
      <div className={`app-shell ${appState === 'dashboard' ? 'dashboard-shell' : ''}`}>
        {/* ── Dashboard State ── */}
        {appState === 'dashboard' && (
          <div className="dashboard-container">
            {/* Header */}
            <header className="header dash-header">
              <div className="header-left">
                <div className="token-pill">
                  <TokenIcon />
                  <span>1,250</span>
                </div>
              </div>
              <div className="header-center">
                <div className="user-avatar-mini">{USER.avatar}</div>
                <div className="user-info-mini">
                  <span className="user-name-mini">{USER.name}</span>
                  <span className="user-level-mini">Lv.{USER.level}</span>
                </div>
              </div>
              <div className="header-right">
                <button className="dm-btn" onClick={() => toggle('messages')} title="Messages">
                  <HeaderMessageIcon />
                  {/* Glowing Notification Pulse */}
                  <span className="unread-badge"></span>
                </button>
                <button className="settings-dots-btn" onClick={() => toggle('settings')} title="Settings">
                  <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
                    <circle cx="12" cy="5" r="2" />
                    <circle cx="12" cy="12" r="2" />
                    <circle cx="12" cy="19" r="2" />
                  </svg>
                </button>
              </div>
            </header>

            <main className="dash-main pb-safe-footer">
              {/* Game Modes Section */}
              <section className="dash-section">
                <h3 className="section-title">GAME MODES</h3>
                <div className="modes-list">
                  <div
                    className={`mode-card ${selectedMode === 'classic' ? 'active selection-glow-green' : ''}`}
                    onClick={() => setSelectedMode('classic')}
                  >
                    <div className="mode-icon-wrapper classic">
                      <DiceIcon />
                    </div>
                    <div className="mode-details">
                      <h4>Classic</h4>
                      <p>Traditional rules, pure strategy</p>
                    </div>
                    <ChevronRight />
                  </div>

                  <div
                    className={`mode-card ${selectedMode === 'power' ? 'active selection-glow-orange' : ''}`}
                    onClick={() => setSelectedMode('power')}
                  >
                    <div className="mode-icon-wrapper power">
                      <LightningIcon />
                    </div>
                    <div className="mode-details">
                      <h4>Power</h4>
                      <p>Power-ups, shields & wild cards</p>
                    </div>
                    <ChevronRight />
                  </div>

                  <div
                    className={`mode-card ${selectedMode === 'snakes' ? 'active selection-glow-purple' : ''}`}
                    onClick={() => setSelectedMode('snakes')}
                  >
                    <div className="mode-icon-wrapper snakes" style={{ background: 'linear-gradient(135deg, var(--ludo-accent), var(--color-ludo-alert))' }}>
                      <SnakeIcon />
                    </div>
                    <div className="mode-details">
                      <h4>Snakes</h4>
                      <p>Classic board with unpredictable twists</p>
                    </div>
                    <ChevronRight />
                  </div>
                </div>
              </section>

              {/* Match Config Section */}
              <section className="dash-section config-section">
                <div className="config-card">
                  <h4 className="config-title text-center">Select Players</h4>
                  <div className="segmented-control">
                    {(['2', '4', '2v2'] as const).map(num => (
                      <button
                        key={num}
                        className={`seg-btn ${playerCount === num ? 'active' : ''}`}
                        onClick={() => setPlayerCount(num)}
                      >
                        {num}
                      </button>
                    ))}
                  </div>

                  <h4 className="config-title text-center mt-6">BET AMOUNT</h4>
                  <div className="bet-pills">
                    {[10, 25, 50, 100, 250].map(amt => (
                      <button
                        key={amt}
                        className={`bet-pill ${betAmount === amt ? 'active' : ''}`}
                        onClick={() => setBetAmount(amt)}
                      >
                        {amt}
                      </button>
                    ))}
                  </div>

                  <button className="play-now-btn" onClick={handlePlayNow}>
                    Play Now
                  </button>
                </div>
              </section>
            </main>

            {/* Footer Nav */}
            <nav className="footer-nav">
              <button className={`nav-item ${activeTab === 'profile' ? 'active' : ''}`} onClick={() => toggle('profile')}>
                <ProfileIcon />
                <span className="nav-label">Profile</span>
              </button>
              <button className={`nav-item ${activeTab === 'friends' ? 'active' : ''}`} onClick={() => toggle('friends')}>
                <UsersIcon />
                <span className="nav-label">Friends</span>
              </button>
              <button className={`nav-item ${activeTab === 'leaderboard' ? 'active' : ''}`} onClick={() => toggle('leaderboard')}>
                <TrophyIcon />
                <span className="nav-label">Leaderboard</span>
              </button>
              <button className={`nav-item ${activeTab === 'mission' ? 'active' : ''}`} onClick={() => toggle('mission')}>
                <TargetIcon />
                <span className="nav-label">Mission</span>
              </button>
              <button className={`nav-item ${activeTab === 'marketplace' ? 'active' : ''}`} onClick={() => toggle('marketplace')}>
                <ShopIcon />
                <span className="nav-label">MarketP.</span>
              </button>
            </nav>

            {/* Slide-up Panels for footer tabs */}
            {activeTab === 'profile' && (
              <UserProfilePanel onClose={closeTab} />
            )}
            {activeTab === 'friends' && (
              <FriendsPanel onClose={closeTab} />
            )}
            {activeTab === 'leaderboard' && (
              <Leaderboard isOpen={true} onClose={closeTab} />
            )}
            {activeTab === 'mission' && (
              <MissionPanel isOpen={true} onClose={closeTab} />
            )}
            {activeTab === 'marketplace' && (
              <MarketplacePanel isOpen={true} onClose={closeTab} />
            )}

            {activeTab === 'settings' && <SettingsPanel onClose={closeTab} />}
            {activeTab === 'messages' && <MessagesPanel onClose={closeTab} />}
          </div>
        )}


        {/* ── Game State ── */}
        {appState === 'game' && (
          <>
            <div className="game-top-bar">
              <div className="game-header-left">
                <button className="back-btn" onClick={() => setShowQuitWarning(true)}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '20px', height: '20px' }}>
                    <line x1="19" y1="12" x2="5" y2="12"></line>
                    <polyline points="12 19 5 12 12 5"></polyline>
                  </svg>
                </button>
                <div className="game-status-info">
                  <span className="game-mode-title">{playerCount === '2v2' ? 'Team Mode' : `${selectedMode} Mode`}</span>
                  <span className="game-status">{playerCount === '2v2' ? '2v2' : `${playerCount} Players`}</span>
                </div>
              </div>

              <div className="game-header-right">
                <div className="game-bet-pill">
                  <TokenIcon />
                  <span>{betAmount}</span>
                </div>
              </div>
            </div>
            <main className={`board-main has-top-back ${selectedMode === 'snakes' ? 'snakes-board-bg' : ''}`}>
              {selectedMode === 'snakes' ? (
                <SnakesBoard playerCount={playerCount} />
              ) : (
                <Board playerCount={playerCount} gameMode={selectedMode} />
              )}
            </main>

            {/* ── Quit Match Warning Overlay ── */}
            {showQuitWarning && (
              <div className="absolute inset-0 z-[999] bg-black/80 backdrop-blur-md flex items-center justify-center">
                <div className="bg-[#1a1c29] border border-white/10 p-8 rounded-2xl shadow-2xl max-w-sm w-[90%] text-center">
                  <h2 className="text-2xl font-bold text-white mb-3">Leave Match?</h2>
                  <p className="text-white/70 mb-8 font-medium">All progress will be lost. Are you sure you want to quit?</p>
                  <div className="flex gap-4 justify-center">
                    <button
                      onClick={() => setShowQuitWarning(false)}
                      className="flex-1 py-3 px-4 rounded-xl font-bold text-white bg-white/10 hover:bg-white/20 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => {
                        setShowQuitWarning(false);
                        handleBackToSubMenu();
                      }}
                      className="flex-1 py-3 px-4 rounded-xl font-bold text-white bg-red-600 hover:bg-red-500 transition-colors"
                    >
                      Quit Game
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* Settings Drawer — at top level for correct fixed positioning */}
        {activeTab === 'settings' && (
          <SettingsPanel onClose={closeTab} />
        )}

      </div>
    </>
  );
}