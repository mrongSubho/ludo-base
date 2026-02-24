'use client';

import { useEffect, useState } from 'react';

// ─── Inline SVG Icon Components ──────────────────────────────────────────────

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

const DiceIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="2" width="20" height="20" rx="3" />
    <circle cx="8" cy="8" r="1.2" fill="currentColor" />
    <circle cx="16" cy="8" r="1.2" fill="currentColor" />
    <circle cx="12" cy="12" r="1.2" fill="currentColor" />
    <circle cx="8" cy="16" r="1.2" fill="currentColor" />
    <circle cx="16" cy="16" r="1.2" fill="currentColor" />
  </svg>
);

const BoltIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
);

const ChevronRight = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

// ─── Footer Nav Icons ────────────────────────────────────────────────────────

const HomeIcon = () => (
  <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <polyline points="9 22 9 12 15 12 15 22" />
  </svg>
);

const InviteIcon = () => (
  <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <line x1="19" y1="8" x2="19" y2="14" />
    <line x1="16" y1="11" x2="22" y2="11" />
  </svg>
);

const ProfileIcon = () => (
  <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

const BackpackIcon = () => (
  <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 10a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V10z" />
    <path d="M9 8V6a3 3 0 0 1 6 0v2" />
    <line x1="8" y1="14" x2="16" y2="14" />
  </svg>
);

const ShopIcon = () => (
  <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
    <line x1="3" y1="6" x2="21" y2="6" />
    <path d="M16 10a4 4 0 0 1-8 0" />
  </svg>
);

// ─── Main Page Component ─────────────────────────────────────────────────────

export default function Page() {
  const [isMounted, setIsMounted] = useState(false);
  const [selectedPlayers, setSelectedPlayers] = useState<string>('2');
  const [selectedBet, setSelectedBet] = useState<string>('50');

  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted) {
    return (
      <div className="loading-shell">
        <div className="loading-spinner" />
      </div>
    );
  }

  const playerOptions = ['2', '4', '2v2'];
  const betOptions = ['10', '25', '50', '100', '250'];

  return (
    <div className="app-shell">
      {/* ── Header ─────────────────────────────────────────── */}
      <header className="header">
        <div className="header-left">
          <div className="wallet-icon">
            <WalletIcon />
          </div>
          <span className="app-title">Ludo Base</span>
        </div>
        <div className="token-pill">
          <TokenIcon />
          <span>1,250</span>
        </div>
      </header>

      {/* ── Main Content ───────────────────────────────────── */}
      <main className="main-content">

        {/* Game Modes */}
        <section className="animate-in">
          <p className="section-label">Game Modes</p>
          <div className="game-modes">
            <div className="game-card classic">
              <div className="card-icon classic">
                <DiceIcon />
              </div>
              <div className="card-text">
                <h3>Classic</h3>
                <p>Traditional rules, pure strategy</p>
              </div>
              <span className="card-arrow">
                <ChevronRight />
              </span>
            </div>
            <div className="game-card power">
              <div className="card-icon power">
                <BoltIcon />
              </div>
              <div className="card-text">
                <h3>Power</h3>
                <p>Power-ups, shields &amp; wild cards</p>
              </div>
              <span className="card-arrow">
                <ChevronRight />
              </span>
            </div>
          </div>
        </section>

        {/* Betting / Selection */}
        <section className="betting-section animate-in">
          <span className="betting-title">Select Players</span>
          <div className="player-pills">
            {playerOptions.map((opt) => (
              <button
                key={opt}
                className={`player-pill${selectedPlayers === opt ? ' active' : ''}`}
                onClick={() => setSelectedPlayers(opt)}
              >
                {opt}
              </button>
            ))}
          </div>

          <div className="bet-amount-section">
            <span className="bet-label">Bet Amount</span>
            <div className="bet-chips">
              {betOptions.map((amt) => (
                <button
                  key={amt}
                  className={`bet-chip${selectedBet === amt ? ' active' : ''}`}
                  onClick={() => setSelectedBet(amt)}
                >
                  {amt}
                </button>
              ))}
            </div>
          </div>

          <button className="play-button">
            Play Now
          </button>
        </section>

        {/* Quick Stats */}
        <section className="animate-in">
          <p className="section-label">Your Stats</p>
          <div className="quick-stats">
            <div className="stat-card">
              <span className="stat-value">42</span>
              <span className="stat-label">Wins</span>
            </div>
            <div className="stat-card">
              <span className="stat-value">78%</span>
              <span className="stat-label">Win Rate</span>
            </div>
            <div className="stat-card">
              <span className="stat-value">3</span>
              <span className="stat-label">Streak</span>
            </div>
          </div>
        </section>

      </main>

      {/* ── Footer Navigation ──────────────────────────────── */}
      <nav className="footer-nav">
        <button className="nav-item active">
          <HomeIcon />
          <span className="nav-label">Home</span>
        </button>
        <button className="nav-item">
          <InviteIcon />
          <span className="nav-label">Invite</span>
        </button>
        <button className="nav-item">
          <ProfileIcon />
          <span className="nav-label">Profile</span>
        </button>
        <button className="nav-item">
          <BackpackIcon />
          <span className="nav-label">Backpack</span>
        </button>
        <button className="nav-item">
          <ShopIcon />
          <span className="nav-label">Shop</span>
        </button>
      </nav>
    </div>
  );
}