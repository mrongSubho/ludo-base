'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';
import Board from './components/Board';
import SnakesBoard from './components/SnakesBoard';
import WalletConnectCard from './components/WalletConnectCard';
import GameLobby from './components/GameLobby';
import { SettingsPanel } from './components/SettingsPanel';
import { InviteNotification } from './components/InviteNotification';
import { HeaderNavPanel, TokenIcon } from './components/HeaderNavPanel';
import { FooterNavPanel } from './components/FooterNavPanel';
import UserProfilePanel from './components/UserProfilePanel';
import FriendsPanel from './components/FriendsPanel';
import Leaderboard from './components/Leaderboard';
import RankingsPanel from './components/RankingsPanel';
import TournamentPanel from './components/TournamentPanel';
import MissionPanel from './components/MissionPanel';
import MarketplacePanel from './components/MarketplacePanel';
import MessagesPanel from './components/MessagesPanel';
import PublicProfileModal from './components/PublicProfileModal';
import { LiveArenaDirectory } from './components/LiveArenaDirectory';
import { SpectatorHUD } from './components/SpectatorHUD';
import { useAccount, useDisconnect } from 'wagmi';
import { useName, useAvatar } from '@coinbase/onchainkit/identity';
import { useTeamUp } from '@/hooks/useTeamUp';
import PresenceManager from './components/PresenceManager';
import { HostMigrationPanel } from './components/HostMigrationPanel';
import { assignCornersFFA, assignCorners2v2, shufflePlayers, CORNER_TO_POSITION } from '@/lib/boardLayout';
import { Player } from '@/hooks/useGameEngine';
import { calculateLevel, getProgression } from '@/lib/progression';
import { useSpectatorSync } from '@/hooks/useSpectatorSync';
import { useSpectatorPresence } from '@/hooks/useSpectatorPresence';

// ─── User Profile Dashboard (slides in from right) ───────────────────────────

type AppState = 'dashboard' | 'game' | 'spectating';
type Tab = 'profile' | 'friends' | 'leaderboard' | 'tournaments' | 'mission' | 'marketplace' | 'settings' | 'messages' | null;

// Mock user data has been removed

const SplashScreen = () => (
  <div
    className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-black/60 backdrop-blur-md"
  >
    <div
      className="flex flex-col items-center"
    >
      <div className="w-24 h-24 mb-6 relative">
        <div
          className="absolute inset-0 rounded-3xl bg-gradient-to-tr from-cyan-600 to-teal-400 opacity-20 blur-xl animate-slow-rotate"
        />
        <div className="absolute inset-0 bg-gradient-to-tr from-cyan-600 to-teal-400 rounded-3xl shadow-[0_0_40px_rgba(34,211,238,0.4)] flex items-center justify-center border border-white/20">
          <span className="text-5xl drop-shadow-lg">🎲</span>
        </div>
      </div>

      <h1 className="text-4xl md:text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-white via-cyan-200 to-teal-200 tracking-tight mb-2 drop-shadow-sm text-center">
        LUDO BASE
      </h1>
      <p className="text-cyan-400 font-black tracking-[0.4em] uppercase text-[10px] mb-12 text-center drop-shadow-[0_0_10px_rgba(34,211,238,0.5)]">
        The Onchain Arena
      </p>

      {/* Loading Bar Illusion */}
      <div className="w-64 h-1.5 bg-black/40 rounded-full overflow-hidden border border-white/10 shadow-inner">
        <div
          className="h-full bg-gradient-to-r from-cyan-600 via-teal-400 to-emerald-400 rounded-full shadow-[0_0_10px_rgba(34,211,238,0.6)] animate-loading-bar"
        />
      </div>
    </div>
  </div>
);

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useMessages } from '@/hooks/useMessages';

const StreamToggle = ({ matchId, isHost }: { matchId?: string, isHost: boolean }) => {
   const [isStreaming, setIsStreaming] = useState(false);
   const [isPending, setIsPending] = useState(false);

   if (!isHost || !matchId) return null;

   const toggleStream = async () => {
     setIsPending(true);
     try {
       const res = await fetch('/api/match/stream', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ matchId, enabled: !isStreaming })
       });
       if(res.ok) setIsStreaming(!isStreaming);
     } finally {
       setIsPending(false);
     }
   };

   return (
      <button 
         onClick={toggleStream} 
         disabled={isPending}
         className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-black tracking-widest transition-all ${isStreaming ? 'bg-pink-500/20 text-pink-400 border border-pink-500/30 shadow-[0_0_15px_rgba(236,72,153,0.3)]' : 'bg-white/5 text-white/50 border border-white/10 hover:text-white/80'} ${isPending ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <div className={`w-1.5 h-1.5 rounded-full ${isStreaming ? 'bg-pink-400 animate-pulse' : 'bg-white/30'}`} />
        {isStreaming ? 'LIVE GAMBLEFI' : 'STREAM MATCH'}
      </button>
   );
}


export default function Page() {
  const [appState, setAppState] = useState<AppState>('dashboard');
  const [activeTab, setActiveTab] = useState<Tab>(null);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [showQuitWarning, setShowQuitWarning] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const [selectedProfileAddress, setSelectedProfileAddress] = useState<string | null>(null);
  const [spectatingRoomCode, setSpectatingRoomCode] = useState<string | null>(null);
  const { profile, address, isConnected, displayName: finalName } = useCurrentUser();
  const { totalUnreadCount } = useMessages(address);
  const { gameState, broadcastAction, isHost, isLobbyConnected, participants, lobbyState, leaveGame } = useTeamUp();

  const finalAvatar = profile?.avatar_url || null;

  // Match Configuration State (Synced with GameLobby)
  const [selectedMode, setSelectedMode] = useState<'classic' | 'power' | 'snakes'>('classic');
  const [playerCount, setPlayerCount] = useState<'1v1' | '2v2' | '4P'>('1v1');
  const [betAmount, setBetAmount] = useState<number>(0);
  const [isBotMatch, setIsBotMatch] = useState(false);

  const progression = getProgression(profile?.xp || 0, profile?.rating || 0);
  const { level, tier } = progression;

  // ─── Spectator mode hooks (only active when spectatingRoomCode is set) ───────
  const {
    gameState: spectatorGameState,
    activeBetWindow,
  } = useSpectatorSync(spectatingRoomCode);
  const { spectatorCount } = useSpectatorPresence(spectatingRoomCode, address?.toLowerCase());

  const handleWatchMatch = useCallback((roomCode: string) => {
    setSpectatingRoomCode(roomCode);
    setAppState('spectating');
  }, []);

  const handleLeaveSpectating = useCallback(() => {
    setSpectatingRoomCode(null);
    setAppState('dashboard');
  }, []);

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

  // --- TeamUp Game Start Sync ---
  useEffect(() => {
    // A match is started if either the game engine says so OR the lobby status is 'playing'
    // This provides a robust recovery path if the primary START_GAME action is missed.
    const isActuallyStarted = gameState?.isStarted || lobbyState?.status === 'playing';

    if (isActuallyStarted && appState !== 'game') {
      console.log('🏁 TRANSITIONING TO GAME! (isStarted:', gameState?.isStarted, 'lobbyStatus:', lobbyState?.status, ')');
      setAppState('game');
    }
  }, [gameState?.isStarted, lobbyState?.status, appState]);

  const closeTab = () => setActiveTab(null);
  const toggle = (tab: Tab) => setActiveTab(prev => prev === tab ? null : tab);

  const handlePlayNow = async () => {
    console.log('🎲 [Page] handlePlayNow called. isHost:', isHost, 'playerCount:', playerCount, 'lobbyStatus:', lobbyState?.status);
    if (isHost) {
      const cc = playerCount === '2v2' ? assignCorners2v2() : assignCornersFFA(playerCount as '1v1' | '4P');
      let players: Player[] = [];

      const isInLobby = isLobbyConnected || (isHost && !!lobbyState);
      if (isInLobby && lobbyState && !isBotMatch) {
        // --- MULTIPLAYER LOBBY START ---
        // Map Lobby Slots directly to Player objects
        players = lobbyState.slots
          .filter(slot => slot.status === 'joined')
          .map(slot => {
            const addr = slot.playerId || '';
            const profileData = participants[addr.toLowerCase()];
            const corner = cc[slot.color];

            return {
              name: slot.playerName || profileData?.username || (addr === address?.toLowerCase() ? (finalName || 'Host') : 'Guest'),
              avatar: slot.playerAvatar || profileData?.avatar_url || '🎮',
              level: 1, // Default level
              isAi: false,
              color: slot.color,
              position: corner ? CORNER_TO_POSITION[corner] : 'bottom-left',
              walletAddress: addr
            } as Player;
          });

        if (players.length === 0) {
          console.warn('⚠️ No players found in joined slots, falling back to local host.');
          players = shufflePlayers(playerCount, false, cc) as Player[];
        }
      } else {
        // --- OFFLINE / BOT MATCH START ---
        players = shufflePlayers(playerCount, isBotMatch, cc) as Player[];

        // Legacy mapping for simple teamup without lobby (if still reachable)
        if (isLobbyConnected && !isBotMatch && !lobbyState) {
          const attendeeAddresses = Object.keys(participants);
          if (address && !attendeeAddresses.map(a => a.toLowerCase()).includes(address.toLowerCase())) {
            attendeeAddresses.unshift(address.toLowerCase());
          }

          let attendeeIndex = 0;
          players = players.map(p => {
            if (p && !p.isAi && attendeeIndex < attendeeAddresses.length) {
              const addr = attendeeAddresses[attendeeIndex++];
              const profileData = participants[addr];
              return {
                ...p,
                walletAddress: addr,
                name: profileData?.username || (addr === address?.toLowerCase() ? (finalName || 'Host') : 'Guest'),
                avatar: profileData?.avatar_url || p.avatar
              } as Player;
            }
            return p;
          });
        }
      }

      let newMatchId: string | undefined;

      try {
        const res = await fetch('/api/match/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
             roomCode: lobbyState?.roomCode || `local-${Date.now()}`,
             gameMode: lobbyState?.gameMode || selectedMode,
             participants: players.filter(p => !p.isAi).map(p => p.walletAddress || 'anonymous')
          })
        });
        if (res.ok) {
           const data = await res.json();
           newMatchId = data.matchId;
        } else {
           console.warn('⚠️ /api/match/start failed:', await res.text());
        }
      } catch (err) {
        console.error('❌ Error calling /api/match/start:', err);
      }

      broadcastAction('START_GAME', {
        initialBoardConfig: { players, colorCorner: cc },
        playerCount,
        isBotMatch,
        matchId: newMatchId
      });
    }
    setAppState('game');
  };

  const handleBackToSubMenu = () => {
    leaveGame();
    setAppState('dashboard');
  };

  const onStartGame = useCallback((isBot?: boolean) => {
    setIsBotMatch(!!isBot);
    handlePlayNow();
  }, [handlePlayNow]);

  return (
    <>
      {showSplash && <SplashScreen />}

      <PresenceManager />
      <InviteNotification />

      <div className="fixed inset-0 cosmic-core-bg pointer-events-none z-[-2]">
        {/* Subdued orbs to prevent washout while keeping depth */}
        <div className="cosmic-orb cosmic-orb-1 opacity-20 scale-100" />
        <div className="cosmic-orb cosmic-orb-2 opacity-15 scale-75" />
        <div className="cosmic-orb cosmic-orb-3 opacity-10 scale-50" />

        {/* High-Contrast Dots (Cosmic Dark) */}
        <div className="boot-dot !w-[180px] !h-[180px] top-[10%] left-[5%] opacity-[0.03]" />
        <div className="boot-dot !w-[180px] !h-[180px] top-[40%] right-[15%] opacity-[0.02]" />
        <div className="boot-dot !w-[180px] !h-[180px] bottom-[20%] left-[20%] opacity-[0.03]" />
        <div className="boot-dot !w-[180px] !h-[180px] bottom-[15%] right-[5%] opacity-[0.015]" />
      </div>

      {!isConnected ? (
        <div className="fixed inset-0 z-40 bg-black/80 flex items-center justify-center">
          <WalletConnectCard />
        </div>
      ) : (
        <div className="app-shell dashboard-shell">
          {/* ── Dashboard State ── */}
          {appState === 'dashboard' && (
            <div className="dashboard-container relative">
              {/* Cosmic Orbs (Rendered behind content) */}


              {/* Header */}
                <HeaderNavPanel
                    finalAvatar={profile?.avatar_url || null}
                    finalName={finalName}
                    level={level}
                    tier={tier}
                    coins={profile?.coins || 0}
                    unreadCount={totalUnreadCount}
                    onMessagesClick={() => toggle('messages')}
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
                  onStartGame={onStartGame}
                  onWatchMatch={handleWatchMatch}
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

              {/* Universal Panel Layer (Sandwich Layout) */}
              <>
                {activeTab === 'profile' && (
                  <UserProfilePanel key="profile" onClose={closeTab} />
                )}
                {activeTab === 'friends' && (
                  <FriendsPanel
                    key="friends"
                    onClose={closeTab}
                    onDM={(friendId: string) => {
                      setSelectedChatId(friendId);
                      toggle('messages');
                    }}
                    onSpectate={(roomCode: string) => {
                      setSpectatingRoomCode(roomCode);
                      setAppState('spectating');
                      closeTab();
                    }}
                    onOpenProfile={(uid: string) => setSelectedProfileAddress(uid)}
                  />
                )}
                {activeTab === 'leaderboard' && (
                  <RankingsPanel
                    key="rankings"
                    isOpen={true}
                    onClose={closeTab}
                    onOpenProfile={(uid: string) => setSelectedProfileAddress(uid)}
                  />
                )}
                {activeTab === 'tournaments' && (
                  <TournamentPanel key="tournaments" isOpen={true} onClose={closeTab} />
                )}
                {activeTab === 'mission' && (
                  <MissionPanel key="mission" isOpen={true} onClose={closeTab} onSwitchTab={toggle} />
                )}
                {activeTab === 'marketplace' && (
                  <MarketplacePanel key="marketplace" isOpen={true} onClose={closeTab} />
                )}
                {activeTab === 'messages' && (
                  <MessagesPanel
                    key="messages"
                    onClose={() => {
                        closeTab();
                        setSelectedChatId(null);
                    }}
                    initialChatId={selectedChatId}
                    onOpenProfile={(uid: string) => setSelectedProfileAddress(uid)}
                  />
                )}
                {activeTab === 'settings' && (
                  <SettingsPanel key="settings" onClose={closeTab} />
                )}
              </>

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


          {/* ── Spectating State ── */}
          {appState === 'spectating' && spectatingRoomCode && (
            <>
              {/* Spectator top bar */}
              <div className="game-top-bar">
                <div className="game-header-left">
                  <button className="back-btn" onClick={handleLeaveSpectating}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '20px', height: '20px' }}>
                      <line x1="19" y1="12" x2="5" y2="12"></line>
                      <polyline points="12 19 5 12 12 5"></polyline>
                    </svg>
                  </button>
                  <div className="game-status-info">
                    <span className="game-mode-title">👁️ Live Match</span>
                    <span className="game-status">
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-pink-400 animate-pulse mr-1" />
                      {spectatorCount} watching · #{spectatingRoomCode}
                    </span>
                  </div>
                </div>
                <div className="game-header-right">
                  <div className="game-bet-pill" style={{ background: '#ec489920', borderColor: '#ec489940' }}>
                    <span className="text-pink-400 text-[10px] font-black uppercase">GambleFi</span>
                  </div>
                </div>
              </div>

              <main className="board-main has-top-back" style={{ paddingRight: spectatorGameState ? '296px' : undefined }}>
                <Board
                  playerCount="4P"
                  gameMode="classic"
                  isBotMatch={false}
                  spectatorMode={true}
                  externalGameState={spectatorGameState ?? undefined}
                />
              </main>

              {/* SpectatorHUD — positioned on the right */}
              {spectatorGameState && (
                <SpectatorHUD
                  roomCode={spectatingRoomCode}
                  matchId={''}
                  activeBetWindow={activeBetWindow}
                  positions={spectatorGameState.positions}
                  onClose={handleLeaveSpectating}
                />
              )}
            </>
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

                <div className="game-header-right flex items-center gap-2">
                  <StreamToggle matchId={gameState?.matchId} isHost={isHost} />
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
                  <Board
                    playerCount={playerCount}
                    gameMode={selectedMode as any}
                    isBotMatch={isBotMatch}
                    onOpenProfile={(addr) => setSelectedProfileAddress(addr)}
                    initialPlayers={gameState?.initialBoardConfig?.players}
                    initialColorCorner={gameState?.initialBoardConfig?.colorCorner}
                  />
                )}
              </main>

              {/* ── Quit Match Warning Overlay ── */}
              {showQuitWarning && (
                <div className="absolute inset-0 z-[999] bg-black/60 backdrop-blur-md flex items-center justify-center">
                  <div className="bg-white/5 border border-white/10 backdrop-blur-2xl p-8 rounded-2xl shadow-2xl max-w-sm w-[90%] text-center">
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
                        className="flex-1 py-3 px-4 rounded-xl font-bold text-white bg-red-600/80 hover:bg-red-500 transition-colors"
                      >
                        Quit Game
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Host Migration Overlay ── */}
              {!isLobbyConnected && gameState?.isStarted && !gameState?.winner && (
                <HostMigrationPanel onQuit={() => leaveGame()} />
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}

