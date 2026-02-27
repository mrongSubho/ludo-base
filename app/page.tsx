'use client';

import { useEffect, useState } from 'react';
import Board from './components/Board';
import ThemeSwitcher from './components/ThemeSwitcher';
// Slide-up panels and logic might be moved or handled differently later, omitting Leaderboard for now if not needed,
// but let's keep it imported and conditionally rendered.
import Leaderboard from './components/Leaderboard';

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

const LogOutIcon = () => (
  <svg className="settings-row-icon svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);

// ─── Generic Slide-up Panel (for footer tabs) ─────────────────────────────────

function TabPanel({ title, emoji, description, onClose }: {
  title: string;
  emoji: string;
  description: string;
  onClose: () => void;
}) {
  return (
    <div className="tab-panel-overlay" onClick={onClose}>
      <div className="tab-panel" onClick={e => e.stopPropagation()}>
        <div className="tab-panel-handle" />
        <div className="tab-panel-header">
          <span className="tab-panel-emoji">{emoji}</span>
          <h2 className="tab-panel-title">{title}</h2>
          <button className="tab-panel-close" onClick={onClose}>✕</button>
        </div>
        <div className="tab-panel-body">
          <div className="tab-coming-soon-card">
            <span className="coming-soon-icon">🚀</span>
            <p className="coming-soon-title">{description}</p>
            <p className="coming-soon-sub">Coming soon in the next update!</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Settings Drawer (slides in from right) ──────────────────────────────────

function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [soundOn, setSoundOn] = useState(true);
  const [notificationsOn, setNotificationsOn] = useState(true);

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
              <button className={`settings-toggle ${soundOn ? 'toggle-on' : ''}`} onClick={() => setSoundOn(!soundOn)}>
                <span className="toggle-knob" />
              </button>
            </div>
            <div className="settings-row">
              <div className="settings-row-left">
                <BellIcon />
                <span>Notifications</span>
              </div>
              <button className={`settings-toggle ${notificationsOn ? 'toggle-on' : ''}`} onClick={() => setNotificationsOn(!notificationsOn)}>
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

// ─── Main Page ────────────────────────────────────────────────────────────────

type AppState = 'dashboard' | 'game';
type Tab = 'profile' | 'friends' | 'leaderboard' | 'mission' | 'marketplace' | 'settings' | null;

// Mock user data
const USER = { avatar: '🎮', name: 'Player', level: 8 };

export default function Page() {
  const [isMounted, setIsMounted] = useState(false);
  const [appState, setAppState] = useState<AppState>('dashboard');
  const [activeTab, setActiveTab] = useState<Tab>(null);

  // Match Configuration State
  const [selectedMode, setSelectedMode] = useState<'classic' | 'power'>('classic');
  const [playerCount, setPlayerCount] = useState<'2' | '4' | '2v2'>('4');
  const [betAmount, setBetAmount] = useState<number>(50);

  useEffect(() => { setIsMounted(true); }, []);

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
              <button className="settings-dots-btn" onClick={() => toggle('settings')} title="Settings">
                <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
                  <circle cx="12" cy="5" r="2" />
                  <circle cx="12" cy="12" r="2" />
                  <circle cx="12" cy="19" r="2" />
                </svg>
              </button>
            </div>
          </header>

          <main className="dash-main">
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

            {/* Stats Section */}
            <section className="dash-section stats-section">
              <h3 className="section-title">YOUR STATS</h3>
              <div className="stats-grid">
                <div className="stat-card">
                  <h4>42</h4>
                  <span>WINS</span>
                </div>
                <div className="stat-card">
                  <h4>78%</h4>
                  <span>WIN RATE</span>
                </div>
                <div className="stat-card">
                  <h4>3</h4>
                  <span>STREAK</span>
                </div>
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
            <TabPanel title="Profile" emoji="👤" description="Your detailed game history & stats." onClose={closeTab} />
          )}
          {activeTab === 'friends' && (
            <TabPanel title="Friends" emoji="👥" description="See who is online and invite them to play." onClose={closeTab} />
          )}
          {activeTab === 'leaderboard' && (
            <Leaderboard isOpen={true} onClose={closeTab} />
          )}
          {activeTab === 'mission' && (
            <TabPanel title="Missions" emoji="🎯" description="Complete daily challenges for rewards." onClose={closeTab} />
          )}
          {activeTab === 'marketplace' && (
            <TabPanel title="Marketplace" emoji="🛍️" description="Buy themes, skins, and new dice." onClose={closeTab} />
          )}

        </div>
      )}


      {/* ── Game State ── */}
      {appState === 'game' && (
        <>
          <div className="game-top-bar">
            <div className="game-header-left">
              <button className="back-btn" onClick={handleBackToSubMenu}>
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
          <main className="board-main has-top-back">
            <Board playerCount={playerCount} gameMode={selectedMode} />
          </main>
        </>
      )}

      {/* Settings Drawer — at top level for correct fixed positioning */}
      {activeTab === 'settings' && (
        <SettingsPanel onClose={closeTab} />
      )}

    </div>
  );
}