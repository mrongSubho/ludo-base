'use client';

import React, { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Board from './components/Board';
import SnakesBoard from './components/SnakesBoard';
// Unused slide-up panels were extracted to their own components or removed natively
import WalletConnectCard from './components/WalletConnectCard';
import GameLobby from './components/GameLobby';
import { SettingsPanel } from './components/SettingsPanel';
import { HeaderNavPanel, TokenIcon } from './components/HeaderNavPanel';
import { FooterNavPanel } from './components/FooterNavPanel';
import PublicProfileModal from './components/PublicProfileModal';
import { useAccount, useDisconnect } from 'wagmi';
import { useName, useAvatar } from '@coinbase/onchainkit/identity';
import { useMultiplayer } from '@/hooks/useMultiplayer';

// ─── User Profile Dashboard (slides in from right) ───────────────────────────

type AppState = 'dashboard' | 'game';
type Tab = 'profile' | 'friends' | 'leaderboard' | 'mission' | 'marketplace' | 'settings' | 'messages' | null;

// Mock user data has been removed

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
          className="absolute inset-0 rounded-3xl bg-gradient-to-tr from-purple-600 to-teal-400 opacity-20 blur-xl"
        />
        <div className="absolute inset-0 bg-gradient-to-tr from-purple-600 to-teal-400 rounded-3xl shadow-[0_0_40px_rgba(99,102,241,0.4)] flex items-center justify-center border border-white/20">
          <span className="text-5xl drop-shadow-lg">🎲</span>
        </div>
      </div>

      <h1 className="text-4xl md:text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-white via-purple-200 to-teal-200 tracking-tight mb-2 drop-shadow-sm text-center">
        LUDO BASE
      </h1>
      <p className="text-purple-300 font-medium tracking-[0.3em] uppercase text-sm mb-12 text-center">
        Superstar Edition
      </p>

      {/* Loading Bar Illusion */}
      <div className="w-64 h-1.5 bg-black/40 rounded-full overflow-hidden border border-white/10 shadow-inner">
        <motion.div
          initial={{ width: "0%" }}
          animate={{ width: "100%" }}
          transition={{ duration: 1.5, ease: "easeInOut" }}
          className="h-full bg-gradient-to-r from-purple-600 via-teal-400 to-emerald-400 rounded-full shadow-[0_0_10px_rgba(45,212,191,0.6)]"
        />
      </div>
    </motion.div>
  </motion.div>
);

import { useCurrentUser } from '@/hooks/useCurrentUser';

export default function Page() {
  const [appState, setAppState] = useState<AppState>('dashboard');
  const [activeTab, setActiveTab] = useState<Tab>(null);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [showQuitWarning, setShowQuitWarning] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const [hasUnreadMessages, setHasUnreadMessages] = useState(true);
  const [selectedProfileAddress, setSelectedProfileAddress] = useState<string | null>(null);
  const { profile, address, isConnected, displayName: finalName } = useCurrentUser();
  const { gameState, broadcastAction, isHost, isLobbyConnected } = useMultiplayer();

  const finalAvatar = profile?.avatar_url || null;

  // Match Configuration State (Synced with GameLobby)
  const [selectedMode, setSelectedMode] = useState<'classic' | 'power' | 'snakes'>('classic');
  const [playerCount, setPlayerCount] = useState<'1v1' | '2v2' | '4P'>('1v1');
  const [betAmount, setBetAmount] = useState<number>(0);
  const [isBotMatch, setIsBotMatch] = useState(false);

  useEffect(() => {
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

  // --- Multiplayer Game Start Sync ---
  useEffect(() => {
    if (gameState?.isStarted && appState !== 'game') {
      setAppState('game');
    }
  }, [gameState?.isStarted, appState]);

  const closeTab = () => setActiveTab(null);
  const toggle = (tab: Tab) => setActiveTab(prev => prev === tab ? null : tab);

  const handlePlayNow = () => {
    if (isHost) {
      broadcastAction('START_GAME', {});
    }
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

      {!isConnected ? (
        <div className="fixed inset-0 z-40 bg-black/80 flex items-center justify-center">
          <WalletConnectCard />
        </div>
      ) : (
        <div className={`app-shell ${appState === 'dashboard' ? 'dashboard-shell cosmic-core-bg' : ''}`}>
          {/* ── Dashboard State ── */}
          {appState === 'dashboard' && (
            <div className="dashboard-container relative">
              {/* Cosmic Orbs (Rendered behind content) */}
              <div className="cosmic-orb cosmic-orb-1" />
              <div className="cosmic-orb cosmic-orb-2" />
              <div className="cosmic-orb cosmic-orb-3" />

              {/* Header */}
              <HeaderNavPanel
                finalAvatar={finalAvatar}
                finalName={finalName || 'Player'}
                hasUnreadMessages={hasUnreadMessages}
                onMessagesClick={() => {
                  toggle('messages');
                  setHasUnreadMessages(false);
                }}
                onSettingsClick={() => toggle('settings')}
              />

              <main className="dash-main pb-safe-footer px-safe">

                <GameLobby
                  gameMode={selectedMode as any}
                  setGameMode={setSelectedMode as any}
                  matchType={playerCount as any}
                  setMatchType={setPlayerCount as any}
                  wager={betAmount}
                  setWager={setBetAmount}
                  onStartGame={(isBot?: boolean) => {
                    if (isBot) setIsBotMatch(true);
                    else setIsBotMatch(false);
                    setAppState('game');
                  }}
                />
              </main>

              {/* Footer Nav & Modals */}
              <FooterNavPanel
                activeTab={activeTab}
                onToggleTab={toggle}
                onCloseTab={closeTab}
                selectedChatId={selectedChatId}
                onSelectChat={setSelectedChatId}
                onOpenProfile={(uid) => setSelectedProfileAddress(uid)}
              />

              {/* Settings Drawer */}
              <AnimatePresence mode="wait">
                {activeTab === 'settings' && (
                  <SettingsPanel key="settings" onClose={closeTab} />
                )}
              </AnimatePresence>

              {/* Global Public Profile Popup */}
              <PublicProfileModal
                isOpen={!!selectedProfileAddress}
                userAddress={selectedProfileAddress}
                onClose={() => setSelectedProfileAddress(null)}
                onDM={(userId) => {
                  setSelectedProfileAddress(null);
                  setSelectedChatId(userId);
                  setActiveTab('messages');
                }}
              />
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
                  <SnakesBoard playerCount={playerCount as any} onOpenProfile={(addr) => setSelectedProfileAddress(addr)} />
                ) : (
                  <Board playerCount={playerCount} gameMode={selectedMode as any} isBotMatch={isBotMatch} onOpenProfile={(addr) => setSelectedProfileAddress(addr)} />
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

        </div>
      )}
    </>
  );
}
