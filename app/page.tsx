'use client';

import { useEffect, useState } from 'react';
import Board from './components/Board';
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

// ─── Main Page ────────────────────────────────────────────────────────────────

type AppState = 'dashboard' | 'game';
type Tab = 'profile' | 'friends' | 'leaderboard' | 'mission' | 'marketplace' | null;

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
              <div className="wallet-icon"><WalletIcon /></div>
              <span className="app-title">Ludo Base</span>
            </div>
            <div className="header-right">
              <div className="token-pill">
                <TokenIcon />
                <span>1,250</span>
              </div>
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
                <span className="game-mode-title">{selectedMode} Mode</span>
                <span className="game-status">{playerCount} Players</span>
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

    </div>
  );
}