'use client';

import { useEffect, useState } from 'react';
import Board from './components/Board';
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

const FriendsIcon = () => (
  <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

const LeaderboardIcon = () => (
  <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
    <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
    <path d="M4 22h16" />
    <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
    <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
    <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
  </svg>
);

const MissionIcon = () => (
  <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <circle cx="12" cy="12" r="6" />
    <circle cx="12" cy="12" r="2" />
  </svg>
);

const MarketplaceIcon = () => (
  <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
    <line x1="3" y1="6" x2="21" y2="6" />
    <path d="M16 10a4 4 0 0 1-8 0" />
  </svg>
);

// ─── Generic Slide-up Panel ───────────────────────────────────────────────────

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

type Tab = 'game' | 'profile' | 'friends' | 'mission' | 'leaderboard' | 'marketplace';

export default function Page() {
  const [isMounted, setIsMounted] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('game');

  useEffect(() => { setIsMounted(true); }, []);

  if (!isMounted) {
    return (
      <div className="loading-shell">
        <div className="loading-spinner" />
      </div>
    );
  }

  const closeTab = () => setActiveTab('game');
  const toggle = (tab: Tab) => setActiveTab(prev => prev === tab ? 'game' : tab);

  return (
    <div className="app-shell">
      {/* Header */}
      <header className="header">
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

      {/* Board */}
      <main className="board-main">
        <Board />
      </main>

      {/* ── Panels ── */}
      {activeTab === 'leaderboard' && (
        <Leaderboard isOpen onClose={closeTab} />
      )}
      {activeTab === 'profile' && (
        <TabPanel title="Profile" emoji="👤"
          description="Your stats, match history, and achievements will live here."
          onClose={closeTab} />
      )}
      {activeTab === 'friends' && (
        <TabPanel title="Friends" emoji="👥"
          description="Invite friends, view online players, and challenge them to a game."
          onClose={closeTab} />
      )}
      {activeTab === 'mission' && (
        <TabPanel title="Missions" emoji="🎯"
          description="Daily and weekly missions to earn bonus tokens and rewards."
          onClose={closeTab} />
      )}
      {activeTab === 'marketplace' && (
        <TabPanel title="Marketplace" emoji="🛍️"
          description="Buy board skins, token designs, and exclusive avatar frames."
          onClose={closeTab} />
      )}

      {/* Footer Nav */}
      <nav className="footer-nav">
        <button id="nav-profile" className={`nav-item ${activeTab === 'profile' ? 'active' : ''}`} onClick={() => toggle('profile')}>
          <ProfileIcon />
          <span className="nav-label">Profile</span>
        </button>
        <button id="nav-friends" className={`nav-item ${activeTab === 'friends' ? 'active' : ''}`} onClick={() => toggle('friends')}>
          <FriendsIcon />
          <span className="nav-label">Friends</span>
        </button>
        <button id="nav-mission" className={`nav-item ${activeTab === 'mission' ? 'active' : ''}`} onClick={() => toggle('mission')}>
          <MissionIcon />
          <span className="nav-label">Mission</span>
        </button>
        <button id="nav-leaderboard" className={`nav-item ${activeTab === 'leaderboard' ? 'active' : ''}`} onClick={() => toggle('leaderboard')}>
          <LeaderboardIcon />
          <span className="nav-label">Leaderboard</span>
        </button>
        <button id="nav-marketplace" className={`nav-item ${activeTab === 'marketplace' ? 'active' : ''}`} onClick={() => toggle('marketplace')}>
          <MarketplaceIcon />
          <span className="nav-label">Market</span>
        </button>
      </nav>
    </div>
  );
}