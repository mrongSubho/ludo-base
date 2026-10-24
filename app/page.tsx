/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars -- legacy types; tracked burn-down */
 
'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
import WalletConnectCard from './components/WalletConnectCard';
import GameLobby from './components/GameLobby';
import { PanelErrorBoundary } from './components/PanelErrorBoundary';
const AudioDriver = dynamic(() => import('./components/AudioToggle'));
import NoticeStrip from './components/NoticeStrip';
import { SessionAuthBanner } from './components/SessionAuthBanner';
import { HeaderNavPanel, TokenIcon } from './components/HeaderNavPanel';
import { BurnPanel } from './components/BurnPanel';
import { FooterNavPanel } from './components/FooterNavPanel';
import { ConnectionBadge } from './components/ConnectionBadge';
import LandscapeGuard from './components/LandscapeGuard';
import { useAppSession } from '../hooks/useAppSession';

// ─── Phase 3 loading diet: heavy/below-fold surfaces split into lazy chunks.
// First paint ships lobby + chrome only; board and panels load on demand. ──
const BoardLoader = () => (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 py-16">
        <div className="w-10 h-10 border-[3px] border-cyan-500/20 border-t-cyan-400 rounded-full animate-spin" />
        <span className="text-ludo-xs font-black text-white/40 uppercase tracking-[0.3em]">Entering arena</span>
    </div>
);
const Board = dynamic(() => import('./components/Board'), {
    loading: () => <BoardLoader />,
});
import { derivePoolId, matchPoolAddress } from '@/lib/chips';
import { DEFAULT_CHAIN_ID, parseChainId } from '@/lib/chains';
const SettingsPanel = dynamic(() => import('./components/SettingsPanel').then(m => m.SettingsPanel));
const WalletPanel = dynamic(() => import('./components/WalletPanel'));
const UserProfilePanel = dynamic(() => import('./components/UserProfilePanel'));
const FriendsPanel = dynamic(() => import('./components/FriendsPanel'));
// REA-27: the never-rendered dynamic Leaderboard import lived here.
// RankingsPanel (already imported statically via the dashboard layer) is the
// live surface; a second lazy copy only doubled the chunk graph.
const RankingsPanel = dynamic(() => import('./components/RankingsPanel'));
const ArenaPanel = dynamic(() => import('./components/ArenaPanel'));
const MissionPanel = dynamic(() => import('./components/MissionPanel'));
const MarketplacePanel = dynamic(() => import('./components/MarketplacePanel'));
const MessagesPanel = dynamic(() => import('./components/MessagesPanel'));
const PublicProfileModal = dynamic(() => import('./components/PublicProfileModal'));
const SpectatorHUD = dynamic(() => import('./components/SpectatorHUD').then(m => m.SpectatorHUD));
const HostMigrationPanel = dynamic(() => import('./components/HostMigrationPanel').then(m => m.HostMigrationPanel));
import { useAccount, useDisconnect, useSignMessage } from 'wagmi';
import { useWalletMode } from '@/hooks/useWalletMode';
import { ThinkingOrb } from './components/ThinkingOrb';
import { useTeamUp } from '@/hooks/useTeamUp';
import PresenceManager from './components/PresenceManager';
import { assignCornersForShape, shufflePlayers, CORNER_TO_POSITION } from '@/lib/boardLayout';
import { Player } from '@/hooks/useGameEngine';
import { calculateLevel, getProgression } from '@/lib/progression';
import { GuestWallProvider } from '@/hooks/GuestWallContext';
import { enterGuest } from '@/lib/guest';
import { hasOnboarded } from '@/lib/onboarding';
import { FirstRunSetupPanel } from './components/FirstRunSetupPanel';
import { useSpectatorSync } from '@/hooks/useSpectatorSync';
import { useSpectatorPresence } from '@/hooks/useSpectatorPresence';
import { useScreenWakeLock } from '@/hooks/useScreenWakeLock';
import { buildStreamMessage } from '@/lib/matchProof';

// ─── User Profile Dashboard (slides in from right) ───────────────────────────

type AppState = 'dashboard' | 'game' | 'spectating';
type Tab = 'profile' | 'friends' | 'leaderboard' | 'mission' | 'arena' | 'marketplace' | 'settings' | 'messages' | 'wallet' | null;

/** Short brand dwell for the splash sweep; measured from hydration, never from navigation start. */
const SPLASH_MIN_DWELL_MS = 600;
/** Hard safety timeout so splash never hangs indefinitely if providers stall. */
const SPLASH_MAX_TIMEOUT_MS = 2500;

// Mock user data has been removed

const SplashScreen = () => (
  <div
    className="ludo-splash-scope fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-[#07090e] text-white"
    style={{ background: 'var(--panel-bg-image, var(--ludo-bg-cosmic, #07090e))', backgroundColor: '#07090e' }}
  >
    <div
      className="flex flex-col items-center"
    >
      <div className="w-24 h-24 mb-6 relative">
        <div
          className="absolute inset-0 rounded-3xl bg-gradient-to-tr from-cyan-600 to-teal-400 opacity-20 blur-xl animate-slow-rotate"
        />
        <div className="absolute inset-0 bg-gradient-to-tr from-cyan-600 to-teal-400 rounded-3xl shadow-[0_0_40px_rgba(34,211,238,0.4)] flex items-center justify-center border border-white/20">
          <svg viewBox="0 0 100 100" className="w-12 h-12 drop-shadow-lg">
            <rect x="6" y="6" width="88" height="88" rx="20" fill="#fff" />
            {[[30, 30], [70, 30], [50, 50], [30, 70], [70, 70]].map(([cx, cy], i) => (
              <circle key={i} cx={cx} cy={cy} r="9" fill="#0b0b12" />
            ))}
          </svg>
        </div>
      </div>

      <h1 className="text-4xl md:text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-white via-cyan-200 to-teal-200 tracking-tight mb-2 drop-shadow-sm text-center">
        LUDO BASE
      </h1>
      <p className="text-cyan-400 font-black tracking-[0.4em] uppercase text-ludo-xs mb-12 text-center drop-shadow-[0_0_10px_rgba(34,211,238,0.5)]">
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
import { useGameData } from '@/hooks/GameDataContext';
import { useNotifications } from '@/hooks/useNotifications';
import { prefersReducedMotion } from '@/lib/motion';

const StreamToggle = ({ matchId, roomCode, hostAddress, isHost, small }: {
   matchId?: string;
   roomCode?: string | null;
   hostAddress?: string;
   isHost: boolean;
   small?: boolean;
}) => {
   const [isStreaming, setIsStreaming] = useState(false);
   const [isPending, setIsPending] = useState(false);
   const [err, setErr] = useState<string | null>(null);
   const { signMessageAsync } = useSignMessage();

   if (!isHost || !matchId || !roomCode) return null;

   const toggleStream = async () => {
     setIsPending(true);
     setErr(null);
     try {
       if (!hostAddress) throw new Error('Host wallet unavailable');
       const issuedAt = new Date().toISOString();
       const message = buildStreamMessage({ matchId, roomCode: String(roomCode), hostAddress, enabled: !isStreaming, issuedAt });
       const signature = await signMessageAsync({ account: hostAddress as `0x${string}`, message });
       const res = await fetch('/api/match/stream', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         signal: AbortSignal.timeout(15000),
         body: JSON.stringify({
           matchId,
           roomCode,
           hostAddress,
           enabled: !isStreaming,
           message, signature, issuedAt,
         }),
       });
       const data = await res.json().catch(() => ({}));
       if (res.ok) {
         setIsStreaming(!isStreaming);
       } else {
         setErr(data?.error || 'Stream toggle failed');
       }
     } catch (e) {
       const name = (e as { name?: string })?.name;
       setErr(name === 'TimeoutError' || name === 'AbortError'
         ? 'Timed out — Supabase slow or unreachable'
         : 'Network error');
     } finally {
       setIsPending(false);
     }
   };

   return (
      <div className="flex flex-col items-end gap-0.5">
        <button
           onClick={toggleStream}
           disabled={isPending}
           aria-pressed={isStreaming}
           className={`flex items-center gap-1.5 rounded-full font-black tracking-widest transition-all ${small ? 'px-2 py-1 text-ludo-xs' : 'px-3 py-1.5 text-ludo-xs'} ${isStreaming ? 'bg-pink-500/20 text-pink-400 border border-pink-500/30 shadow-[0_0_15px_rgba(236,72,153,0.3)]' : 'bg-white/5 text-white/50 border border-white/10 hover:text-white/80'} ${isPending ? 'opacity-70 cursor-wait' : ''}`}
        >
           <div className={`w-1.5 h-1.5 rounded-full ${isPending ? 'bg-cyan-400 animate-pulse' : isStreaming ? 'bg-pink-400 animate-pulse' : 'bg-white/30'}`} />
           {isPending ? (isStreaming ? 'Stopping…' : 'Going live…') : isStreaming ? 'LIVE' : 'Go live'}
        </button>
        {err && (
          <span className="text-ludo-xs font-bold text-amber-300 max-w-[160px] text-right leading-tight">{err}</span>
        )}
      </div>
   );
}

const MatchStatusStrip = ({
  modeLabel,
  spectators = 0,
  watching = false,
  matchConnectionStatus,
  streamNode,
  revealToken = 0,
}: {
  modeLabel: string;
  spectators?: number;
  watching?: boolean;
  matchConnectionStatus?: import('@/lib/matchProtocol').MatchConnectionStatus;
  streamNode?: React.ReactNode;
  revealToken?: number;
}) => {
  const [visible, setVisible] = useState(true);
  const [mode, format = '1v1', wager = 'Free'] = modeLabel.split(' · ');
  const connectionLabel = matchConnectionStatus === 'connected'
    ? 'NET'
    : matchConnectionStatus === 'reconnecting'
      ? 'DEGRADED'
      : matchConnectionStatus === 'syncing'
        ? 'RESYNC'
        : 'LOCAL';
  const qualityLevel = matchConnectionStatus === 'connected'
    ? 4
    : matchConnectionStatus === 'reconnecting'
      ? 2
      : matchConnectionStatus === 'syncing'
        ? 1
        : 3;

  useEffect(() => {
    setVisible(true);
    const timer = window.setTimeout(() => setVisible(false), 3000);
    return () => window.clearTimeout(timer);
  }, [modeLabel, revealToken]);

  return (
    <div className={`match-status-strip ${visible ? 'is-visible' : 'is-hidden'}`} aria-label="Match status">
      <button
        type="button"
        className="match-status-panel"
        onClick={() => setVisible(false)}
        aria-label="Hide match status"
      >
        <span className="match-status-side match-status-left">
          <span className="match-status-pill match-status-connection-pill">{connectionLabel}</span>
          <span className={`match-status-quality quality-${qualityLevel}`} aria-label={`${connectionLabel} connection quality`}>
            <i /><i /><i /><i />
          </span>
        </span>
        <span className="match-status-center">
          <span className="match-status-mode">{mode}</span>
          <span className="match-status-separator">·</span>
          <span>{format}</span>
          <span className="match-status-separator">·</span>
          <span>{wager}</span>
        </span>
        <span className="match-status-side match-status-right">
          <span className={`match-status-pill match-status-live-pill ${watching ? 'watching' : ''}`}>
            <span className="match-status-live-dot" />
            {watching ? 'Inspecting' : 'Live'}
          </span>
          {spectators > 0 && <span className="match-status-spectator-count">◉ {spectators}</span>}
        </span>
      </button>
      {streamNode && visible && (
        <span className="match-status-stream">{streamNode}</span>
      )}
    </div>
  );
};


export default function Page() {
  const [appState, setAppState] = useState<AppState>('dashboard');
  const [activeTab, setActiveTab] = useState<Tab>(null);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [showQuitWarning, setShowQuitWarning] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const [matchStatusReveal, setMatchStatusReveal] = useState(0);
  const [selectedProfileAddress, setSelectedProfileAddress] = useState<string | null>(null);
  const [spectatingRoomCode, setSpectatingRoomCode] = useState<string | null>(null);
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const { profile, address, isConnected, displayName: finalName, isGuest, isSessionChecking } = useCurrentUser();
  // Needed to prove the canonical host to /api/match/start (SEC-06). Best-effort:
  // offline/bot games still post the anonymous marker and are simply not settleable.
  const { ensureAppSession, peekAppSession } = useAppSession();
  const walletMode = useWalletMode();

  // Auto-bootstrap SIWE session on boot for CDP in-game wallets with autoSign
  useEffect(() => {
    if (address && !isGuest && walletMode === 'ingame' && !peekAppSession()) {
      void ensureAppSession({ context: 'general' }).catch(() => null);
    }
  }, [address, isGuest, walletMode, peekAppSession, ensureAppSession]);
  const { signMessageAsync } = useSignMessage();
  // DM unread badge reads the same GameData store the panel writes, so it
  // cleans the instant a thread opens (no second source of truth).
  const { totalUnreadCount } = useGameData();
  const { notifCount } = useNotifications();
  const { gameState, broadcastAction, broadcastLobbyAction, updateGameState, isHost, isLobbyConnected, participants, lobbyState, leaveGame, roomId, matchConnectionStatus, hasAuthoritativeSnapshot, connectRoom, roomAuthority } = useTeamUp();

  // NET-07: the HOST_ELECT handshake's authority layer. The panel asks this to
  // elect; the answer must be a seat that can prove it holds the current
  // board (a verified snapshot). A candidate without one is refused by
  // returning null — which is what stops a presence-only client from
  // electing itself during a host outage. The match FSM's HOST_ELECT event
  // is fired by TeamUpContext when the elected compute host actually changes.
  const handleHostElect = useCallback(async (): Promise<string | null> => {
    if (matchConnectionStatus !== 'connected' || !gameState?.isStarted) return null;
    if (!hasAuthoritativeSnapshot) return null;
    const seated = Object.values(participants || {}).filter(p => !String(p.address || '').startsWith('bot-'));
    if (seated.length === 0) return null;
    // Seat order is deterministic (TeamUp seating), so the candidate does not
    // depend on anyone's clock. The first seated wallet with a verified
    // snapshot takes the seat.
    const elected = seated[0]?.address;
    return elected ? String(elected).toLowerCase() : null;
  }, [matchConnectionStatus, gameState?.isStarted, hasAuthoritativeSnapshot, participants]);

  const _finalAvatar = profile?.avatar_url || null;

  // Match Configuration State (Synced with GameLobby)
  const [selectedMode, setSelectedMode] = useState<'classic' | 'power'>('classic');
  const [playerCount, setPlayerCount] = useState<'1v1' | '2v2' | '4P'>('1v1');
  const [betAmount, setBetAmount] = useState<number>(0);
  const [isBotMatch, setIsBotMatch] = useState(false);
  const [botDifficulty, setBotDifficulty] = useState<import('@/lib/types').BotDifficulty>('pro');
  const [boardSeed, setBoardSeed] = useState<{ players: Player[]; colorCorner: any; isBotMatch: boolean } | null>(null);
  // First-run setup (per device): theme + tokens before the lobby.
  const [onboarded, setOnboarded] = useState<boolean>(() => hasOnboarded());

  const progression = getProgression(profile?.lxp || 0, profile?.rxp || 0);
  const { level, tier } = progression;
  const prevLevelRef = useRef(level);
  const milestoneRef = useRef<number | null>(null);

  useEffect(() => {
    if (level > prevLevelRef.current) {
      prevLevelRef.current = level;

      // Reduced motion: no level-up particles (CSS_LAYOUT_ANIMATION_PLAN §3.4).
      if (prefersReducedMotion()) return;

      void import('canvas-confetti').then(({ default: confetti }) => {
        // §3.3: confetti capped at 1.5s, single loop, auto-disposed.
        const duration = 1.5 * 1000;
        const end = Date.now() + duration;
        const colors = ['#00E5FF', '#10b981', '#f59e0b', '#ef4444', '#a855f7', '#ffffff'];
        (function frame() {
          confetti({
            particleCount: 30,
            spread: 100,
            origin: { x: 0.5, y: 0.6 },
            colors: colors.slice(0, Math.floor(Math.random() * colors.length) + 2),
            gravity: 0.6,
            scalar: 1.2,
          });
          if (Date.now() < end) requestAnimationFrame(frame);
        })();

        if (level % 5 === 0 && level !== milestoneRef.current) {
          milestoneRef.current = level;
          setTimeout(() => {
            confetti({ particleCount: 80, spread: 120, origin: { x: 0.5, y: 0.5 }, colors: ['#f59e0b', '#00E5FF', '#ffffff'], scalar: 1.5 });
          }, 400);
        }
      }).catch((error: unknown) => {
        console.error('Unable to load level-up celebration:', error);
      });
    }
  }, [level]);

  // ─── Spectator mode hooks (only active when spectatingRoomCode is set) ───────
  const {
    gameState: spectatorGameState,
    activeBetWindow,
    isConnected: spectatorConnected,
  } = useSpectatorSync(spectatingRoomCode);
  const { spectatorCount } = useSpectatorPresence(spectatingRoomCode, address?.toLowerCase());

  // Screen stays on while playing, spectating, reading DMs or watching the
  // live broadcast feed; released everywhere else.
  useScreenWakeLock(appState === 'game' || appState === 'spectating' || activeTab === 'messages' || broadcastOpen);

  // Read-only spectator count for the match we're PLAYING (no wallet passed,
  // so we never track ourselves into the count — players just observe it).
  const { spectatorCount: liveSpectators } = useSpectatorPresence(
    appState === 'game' ? (lobbyState?.roomCode ?? null) : null
  );

  /**
   * SEC-07: the arena is host-gated. A session is required to open it, and the
   * first session-holding caller becomes its host. Only the host drives the
   * tick; other spectators watch the same broadcast stream without writing.
   */
  const [arenaIsHost, setArenaIsHost] = useState(false);

  const handleWatchMatch = useCallback(async (roomCode: string) => {
    // REA-17: the arena bootstrap was unguarded, so a slow/hostile endpoint hung
    // the listener on an icon with no feedback. Bounded + exception-safe.
    let resolvedRoom = roomCode;
    if (roomCode === 'ARENA-POWER-4P') {
      const sid = await ensureAppSession();
      if (!sid || !address) return;
      const qs = new URLSearchParams({
        walletAddress: address.toLowerCase(),
        sessionId: sid,
      });
      const response = await fetch(`/api/live-arena/power4p?${qs.toString()}`, { method: 'POST', signal: AbortSignal.timeout(15000) });
      const data = await response.json();
      if (!response.ok || !data.roomCode) return;
      resolvedRoom = data.roomCode;
      setArenaIsHost(Boolean(data.isHost));
    }
    setSpectatingRoomCode(resolvedRoom);
    setAppState('spectating');
  }, [address, ensureAppSession]);

  useEffect(() => {
    if (appState !== 'spectating' || spectatingRoomCode !== 'ARENA-POWER-4P') return;
    // Not the host: watch only. Sending a tick would just earn a 403.
    if (!arenaIsHost || !address) return;
    const authorityId = crypto.randomUUID();
    const sid = peekAppSession();
    if (!sid) return;
    const tick = () => fetch('/api/live-arena/power4p', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        arenaKey: 'power4p-ai',
        authorityId,
        walletAddress: address.toLowerCase(),
        sessionId: sid,
      }),
    }).catch(() => undefined);
    void tick();
    const timer = window.setInterval(tick, 3000);
    return () => window.clearInterval(timer);
  }, [appState, spectatingRoomCode, arenaIsHost, address, peekAppSession]);

  const handleLeaveSpectating = useCallback(() => {
    setSpectatingRoomCode(null);
    setAppState('dashboard');
  }, []);

  const [minDwellPassed, setMinDwellPassed] = useState(false);
  const [maxTimeoutPassed, setMaxTimeoutPassed] = useState(false);

  useEffect(() => {
    let alive = true;
    const dwellTimer = setTimeout(() => {
      if (alive) setMinDwellPassed(true);
    }, SPLASH_MIN_DWELL_MS);

    const maxTimer = setTimeout(() => {
      if (alive) setMaxTimeoutPassed(true);
    }, SPLASH_MAX_TIMEOUT_MS);

    return () => {
      alive = false;
      clearTimeout(dwellTimer);
      clearTimeout(maxTimer);
    };
  }, []);

  useEffect(() => {
    // Fail-safe timeout ensures the app never hangs on splash indefinitely
    if (maxTimeoutPassed) {
      setShowSplash(false);
      return;
    }

    // Keep splash screen visible while credentials / session are actively being restored,
    // so the sign-in modal never flashes before transitioning into the lobby.
    if (minDwellPassed && !isSessionChecking) {
      setShowSplash(false);
    }
  }, [minDwellPassed, isSessionChecking, maxTimeoutPassed]);

  // Sync state to ref for back-button hardware popstate interceptor
  const stateRef = useRef({ activeTab, appState, showQuitWarning });
  useEffect(() => {
    stateRef.current = { activeTab, appState, showQuitWarning };
  }, [activeTab, appState, showQuitWarning]);

  useEffect(() => {
    // Push an initial history state so the hardware back button has something to pop instead of leaving the PWA
    window.history.pushState({ ludoState: 'active' }, '', window.location.href);

    const handlePopState = (_e: PopStateEvent) => {
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

      // MM-15: a guest must never reach the board without the host's roster.
      if (!isHost) {
        const roster = gameState?.initialBoardConfig?.players;
        if (!Array.isArray(roster) || roster.length === 0) {
          console.warn('⏳ [Page] guest start pending — waiting for the host roster before mounting the board');
          return;
        }
        setBoardSeed({
          players: roster,
          colorCorner: gameState?.initialBoardConfig?.colorCorner,
          isBotMatch: false,
        });
      } else {
        const roster = gameState?.initialBoardConfig?.players;
        const cc = gameState?.initialBoardConfig?.colorCorner;
        if (Array.isArray(roster) && roster.length > 0 && cc) {
          setBoardSeed({ players: roster, colorCorner: cc, isBotMatch: false });
        }
      }

      // 🔧 SYNC FIX: If we are joining a game as a Guest, reset local isBotMatch
      // based on the authoritative Host broadcast.
      if (!isHost && gameState?.isBotMatch !== undefined) {
        setIsBotMatch(gameState.isBotMatch);
      }

      setAppState('game');
    }
  }, [gameState?.isStarted, gameState?.isBotMatch, gameState?.initialBoardConfig, lobbyState?.status, appState, isHost]);

  const closeTab = () => setActiveTab(null);
  const [burnOpen, setBurnOpen] = useState(false);
  const toggle = (tab: Tab) => setActiveTab(prev => prev === tab ? null : tab);

  // REA-16: re-check whenever identity flips — wallet connect, disconnect, OR
  // guest mode. The old effect fired only on `isConnected`, so a returning guest
  // (local storage already completed onboarding) was shown the setup again when
  // the flag for the current identity said otherwise, and a fresh guest never got
  // it. `isGuest` comes from the same identity source, so both paths re-resolve.
  useEffect(() => {
    setOnboarded(hasOnboarded());
  }, [isConnected, isGuest]);

   // REA-24: useCallback so memoized panels receiving these handlers (lobby,
   // arena, board chrome) don't re-render on every unrelated Page render.
   const handlePlayNow = useCallback(async (isBotOverride?: boolean) => {
    const effectiveIsBotMatch = isBotOverride ?? isBotMatch;
    let resolvedMatchId = gameState?.matchId;

    if (!effectiveIsBotMatch && !resolvedMatchId && isLobbyConnected && isHost && lobbyState) {
      try {
        const myWallet = address?.toLowerCase();
        const sid = peekAppSession() || (myWallet ? await ensureAppSession() : null);
        const slotWallets = (lobbyState.slots || [])
          .map(s => s.playerId?.trim().toLowerCase())
          .filter((w): w is string => Boolean(w && /^0x[a-f0-9]{40}$/i.test(w)));
        const orderedParticipants = myWallet
          ? [myWallet, ...slotWallets.filter(w => w !== myWallet)]
          : slotWallets.length > 0
            ? slotWallets
            : ['anonymous'];
        const res = await fetch('/api/match/start', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(sid ? { Authorization: `Bearer ${sid}`, 'x-session-id': sid } : {}),
          },
          body: JSON.stringify({
            roomCode: lobbyState.roomCode || roomId,
            gameMode: lobbyState.gameMode || selectedMode,
            matchShape: lobbyState.matchType || playerCount,
            participants: orderedParticipants,
            walletAddress: myWallet,
            sessionId: sid,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && typeof data.matchId === 'string') {
          resolvedMatchId = data.matchId;
          updateGameState({ matchId: resolvedMatchId, isStarted: true });
          broadcastLobbyAction('LOBBY_SYNC', {
            lobbyState: { ...lobbyState, status: 'playing', matchId: resolvedMatchId },
          });
        }
      } catch (err) {
        console.error('❌ [Page] Custom lobby /api/match/start failed:', err);
      }
    }

    const currentMatchId = resolvedMatchId;
    const isLocalMatch =
      effectiveIsBotMatch ||
      !currentMatchId ||
      currentMatchId === 'local' ||
      currentMatchId.startsWith('local-');

    if (isLocalMatch) {
      // ── ARM 1: OFFLINE / BOT / LOCAL MATCH ──
      const effectiveMatchType = playerCount;
      const cc = assignCornersForShape(effectiveMatchType);
      let players = shufflePlayers(playerCount, effectiveIsBotMatch, cc) as Player[];

      const myAddr = address?.toLowerCase();
      if (myAddr && effectiveIsBotMatch) {
        const profileData = participants[myAddr];
        players = players.map(p => {
          if (p && !p.isAi && !p.walletAddress) {
            return {
              ...p,
              walletAddress: myAddr,
              name: finalName || profileData?.username || 'You',
              avatar: profileData?.avatar_url || p.avatar
            } as Player;
          }
          return p;
        });
      }

      setBoardSeed({ players, colorCorner: cc, isBotMatch: effectiveIsBotMatch });
      setAppState('game');
      return;
    }

    // ── ARM 2: NETWORKED MATCH (Server room DO is sole authority) ──
    const roster = gameState?.initialBoardConfig?.players;
    const cc = gameState?.initialBoardConfig?.colorCorner;
    if (Array.isArray(roster) && roster.length > 0 && cc) {
      setBoardSeed({ players: roster, colorCorner: cc, isBotMatch: false });
      setAppState('game');
    }
    connectRoom(currentMatchId);
  }, [isBotMatch, gameState?.matchId, gameState?.initialBoardConfig, isLobbyConnected, isHost, lobbyState, roomId, selectedMode, playerCount, address, peekAppSession, ensureAppSession, updateGameState, broadcastLobbyAction, broadcastAction, participants, finalName, setBoardSeed, setAppState, connectRoom]);

  const handleBackToSubMenu = useCallback(async () => {
    // Host leaving a live stream should drop the Live Arena row.
    if (isHost && gameState?.matchId && lobbyState?.roomCode) {
      try {
        const issuedAt = new Date().toISOString();
        const hostAddress = String(address || '').toLowerCase();
        const message = buildStreamMessage({
          matchId: String(gameState.matchId),
          roomCode: String(lobbyState.roomCode),
          hostAddress,
          enabled: false,
          issuedAt,
        });
        const signature = await signMessageAsync({
          account: hostAddress as `0x${string}`,
          message,
        });
        await fetch('/api/match/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            matchId: gameState.matchId,
            roomCode: lobbyState.roomCode,
            hostAddress,
            enabled: false,
            issuedAt,
            message,
            signature,
          }),
        });
      } catch {
        // Stream cleanup is best-effort; leaving the local game must continue.
      }
    }
    leaveGame();
    setBoardSeed(null);
    setAppState('dashboard');
  }, [isHost, gameState, lobbyState, address, signMessageAsync, leaveGame]);

  const onStartGame = useCallback((isBot?: boolean, difficulty: import('@/lib/types').BotDifficulty = 'pro') => {
    setIsBotMatch(!!isBot);
    setBotDifficulty(difficulty);
    handlePlayNow(!!isBot);
  }, [handlePlayNow]);

  return (
    <>
      {showSplash && <SplashScreen />}

      <PresenceManager />

      {/* REA-13: the ambient-audio driver. Mounted once at the app root, next to
          the presence manager (same "app-wide, no DOM" role), so the Game Music
          preference finally plays something. */}
      <AudioDriver />

      <div className={`fixed inset-0 cosmic-core-bg pointer-events-none z-[-2]${appState !== 'dashboard' ? ' orbs-calm' : ''}`}>
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

      {showSplash ? null : !isConnected ? (
        <div className="fixed inset-0 z-40 bg-black/80 flex items-center justify-center">
          <WalletConnectCard onGuest={() => enterGuest()} />
        </div>
      ) : !onboarded ? (
        <FirstRunSetupPanel onDone={() => setOnboarded(true)} />
      ) : (
        <GuestWallProvider>
        <div className="app-shell dashboard-shell no-scrollbar">
          {/* ── Dashboard State ── */}
          {appState === 'dashboard' && (
            <div className="dashboard-container relative h-full">
              {/* Cosmic Orbs (Rendered behind content) */}


              {/* Header */}
                <HeaderNavPanel
                    finalAvatar={profile?.avatar_url || null}
                    finalName={finalName}
                    level={level}
                    tier={tier}
                    coins={profile?.coins || 0}
                    unreadCount={totalUnreadCount}
                    hasNotifications={notifCount > 0}
                    onMessagesClick={() => toggle('messages')}
                    onSettingsClick={() => toggle('settings')}
                    onFeedClick={() => { closeTab(); setBurnOpen(true); }}
                    onOpenWallet={() => toggle('wallet')}
                    onOpenProfile={() => toggle('profile')}
                    onRevealMatchStatus={() => setMatchStatusReveal(value => value + 1)}
                />

              {/* flex:1 + min-height:0 — never h-full: header + 100% main overflows the shell */}
              <main className="dash-main pb-safe-footer px-safe">
                <NoticeStrip className="mb-2" />
                <SessionAuthBanner className="mb-2" />

                <GameLobby
                  gameMode={selectedMode as any}
                  setGameMode={setSelectedMode as any}
                  matchType={playerCount as any}
                  setMatchType={setPlayerCount as any}
                  wager={betAmount}
                  setWager={setBetAmount}
                  onStartGame={onStartGame}
                  onStartPassAndPlay={() => onStartGame(false)}
                  onOpenProfile={(uid: string) => setSelectedProfileAddress(uid)}
                  onBroadcastOpenChange={setBroadcastOpen}
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
                <PanelErrorBoundary name="profile" onClose={closeTab}>
                    <UserProfilePanel
                      key="profile"
                      onClose={closeTab}
                      onOpenMarketplace={() => toggle('marketplace')}
                      onOpenWallet={() => toggle('wallet')}
                    />
                </PanelErrorBoundary>
              )}
                {activeTab === 'friends' && (
                <PanelErrorBoundary name="friends" onClose={closeTab}>
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
                </PanelErrorBoundary>
              )}
                {activeTab === 'leaderboard' && (
                <PanelErrorBoundary name="leaderboard" onClose={closeTab}>
                    <RankingsPanel
                      key="rankings"
                      isOpen={true}
                      onClose={closeTab}
                      onOpenProfile={(uid: string) => setSelectedProfileAddress(uid)}
                    />
                </PanelErrorBoundary>
              )}
                {activeTab === 'mission' && (
                <PanelErrorBoundary name="mission" onClose={closeTab}>
                    <MissionPanel key="mission" isOpen={true} onClose={closeTab} onSwitchTab={toggle} />
                </PanelErrorBoundary>
              )}
                {activeTab === 'arena' && (
                <PanelErrorBoundary name="arena" onClose={closeTab}>
                    <ArenaPanel key="arena" isOpen={true} onClose={closeTab} onSwitchTab={toggle} onWatchMatch={handleWatchMatch} />
                </PanelErrorBoundary>
              )}
                {activeTab === 'marketplace' && (
                <PanelErrorBoundary name="marketplace" onClose={closeTab}>
                    <MarketplacePanel key="marketplace" isOpen={true} onClose={closeTab} />
                </PanelErrorBoundary>
              )}
                {activeTab === 'messages' && (
                <PanelErrorBoundary name="messages" onClose={closeTab}>
                    <MessagesPanel
                      key="messages"
                      onClose={() => {
                          closeTab();
                          setSelectedChatId(null);
                      }}
                      initialChatId={selectedChatId}
                      onOpenProfile={(uid: string) => setSelectedProfileAddress(uid)}
                    />
                </PanelErrorBoundary>
              )}
                {activeTab === 'settings' && (
                <PanelErrorBoundary name="settings" onClose={closeTab}>
                    <SettingsPanel key="settings" onClose={closeTab} onOpenWallet={() => toggle('wallet')} />
                </PanelErrorBoundary>
              )}
                {activeTab === 'wallet' && (
                <PanelErrorBoundary name="wallet" onClose={closeTab}>
                    <WalletPanel key="wallet" onClose={closeTab} />
                </PanelErrorBoundary>
              )}
                {burnOpen && (
                  <BurnPanel key="burn" onClose={() => setBurnOpen(false)} />
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
              {/* Rotation failsafe: covers the portrait-built board in landscape */}
              <LandscapeGuard onExitMatch={handleLeaveSpectating} />
              <HeaderNavPanel
                finalAvatar={profile?.avatar_url || null}
                finalName={finalName}
                level={level}
                tier={tier}
                coins={profile?.coins || 0}
                unreadCount={totalUnreadCount}
                hasNotifications={notifCount > 0}
                onMessagesClick={() => toggle('messages')}
                onSettingsClick={() => toggle('settings')}
                onOpenWallet={() => toggle('wallet')}
                onOpenProfile={() => toggle('profile')}
                onRevealMatchStatus={() => setMatchStatusReveal(value => value + 1)}
              />
              <MatchStatusStrip
                modeLabel={`Live #${spectatingRoomCode}`}
                spectators={spectatorCount}
                watching
                matchConnectionStatus={matchConnectionStatus}
                revealToken={matchStatusReveal}
              />

              <main className="board-main has-top-back" style={{ position: 'relative', paddingRight: spectatorGameState ? '296px' : undefined }}>
                <Board
                  playerCount={spectatorGameState?.playerCount || "4P"}
                  gameMode={(spectatorGameState?.powerTiles?.length ?? 0) > 0 ? "power" : "classic"}
                  isBotMatch={true}
                  spectatorMode={true}
                  externalGameState={spectatorGameState ?? undefined}
                />
                {/* First paint of a spectated match: the board has no state yet
                    and `isConnected` only flips after the first snapshot (or a
                    SYNC_STATE broadcast), so this is a real wait, not a flash.
                    Gated on BOTH flags so a future reconnect can never cover a
                    board that is already live. */}
                {!spectatorConnected && !spectatorGameState && (
                  <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 pointer-events-none">
                    <ThinkingOrb state="connecting" size={64} />
                    {/* Token, not `text-white/45`: the board area is light in
                        Daybreak (--ludo-bg #e6e8ec), so white ink disappears. */}
                    <span
                      className="text-ludo-xs font-black uppercase tracking-[0.25em]"
                      style={{ color: 'var(--ludo-muted)' }}
                    >
                      Connecting to live match
                    </span>
                  </div>
                )}
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

              {/* ── Spectator overlays: DM + full settings work while watching ── */}
              {activeTab === 'messages' && (
                <MessagesPanel
                  key="messages-spectate"
                  onClose={() => {
                      closeTab();
                      setSelectedChatId(null);
                  }}
                  initialChatId={selectedChatId}
                  onOpenProfile={(uid: string) => setSelectedProfileAddress(uid)}
                />
              )}
              {activeTab === 'settings' && (
                <SettingsPanel key="settings-spectate" onClose={closeTab} onOpenWallet={() => toggle('wallet')} />
              )}
              {activeTab === 'wallet' && (
                <WalletPanel key="wallet-spectate" onClose={closeTab} />
              )}
            </>
          )}

          {/* ── Game State ── */}
          {appState === 'game' && (
            <>
              {/* Rotation failsafe: covers the portrait-built board in landscape */}
              <LandscapeGuard onExitMatch={handleBackToSubMenu} />
              <HeaderNavPanel
                finalAvatar={profile?.avatar_url || null}
                finalName={finalName}
                level={level}
                tier={tier}
                coins={profile?.coins || 0}
                unreadCount={totalUnreadCount}
                hasNotifications={notifCount > 0}
                onMessagesClick={() => toggle('messages')}
                onSettingsClick={() => toggle('settings')}
                onOpenWallet={() => toggle('wallet')}
                onOpenProfile={() => toggle('profile')}
                onRevealMatchStatus={() => setMatchStatusReveal(value => value + 1)}
              />
              <MatchStatusStrip
                modeLabel={`${selectedMode === 'power' ? 'Power' : 'Classic'} · ${playerCount} · ${betAmount === 0 ? 'Free' : betAmount >= 1000 ? `${parseFloat((betAmount / 1000).toFixed(1))}k` : betAmount}`}
                spectators={liveSpectators}
                matchConnectionStatus={matchConnectionStatus}
                revealToken={matchStatusReveal}
                streamNode={<StreamToggle
                  matchId={gameState?.matchId}
                  roomCode={lobbyState?.roomCode || roomId || null}
                  hostAddress={address}
                  isHost={isHost}
                  small
                />}
              />
              <main className="board-main has-top-back">
                {(
                  <Board
                    playerCount={playerCount}
                    gameMode={selectedMode as any}
                    isBotMatch={boardSeed?.isBotMatch ?? (gameState?.initialBoardConfig?.players?.length ? gameState.isBotMatch : isBotMatch)}
                    onOpenProfile={(addr) => setSelectedProfileAddress(addr)}
                    initialPlayers={boardSeed?.players ?? gameState?.initialBoardConfig?.players}
                    initialColorCorner={boardSeed?.colorCorner ?? gameState?.initialBoardConfig?.colorCorner}
                    wager={betAmount}
                    poolId={
                      matchPoolAddress() && roomId
                        ? derivePoolId({
                            chainId:
                              parseChainId(
                                (typeof window !== 'undefined' ? (window as any).__ludoChainId : null),
                              ) ?? DEFAULT_CHAIN_ID,
                            matchId: roomId,
                            roomCode: roomId,
                          })
                        : null
                    }
                    botDifficulty={botDifficulty}
                    onExitMatch={handleBackToSubMenu}
                    onOpenChat={() => toggle('messages')}
                  />
                )}
              </main>

              {/* ── In-game overlays: DM + settings work mid-match; settings
                    carries the Leave Match exit (header strip stays pure status) ── */}
              {activeTab === 'messages' && (
                <MessagesPanel
                  key="messages-game"
                  onClose={() => {
                      closeTab();
                      setSelectedChatId(null);
                  }}
                  initialChatId={selectedChatId}
                  onOpenProfile={(uid: string) => setSelectedProfileAddress(uid)}
                />
              )}
              {activeTab === 'settings' && (
                <SettingsPanel key="settings-game" onClose={closeTab} onLeaveMatch={() => setShowQuitWarning(true)} onOpenWallet={() => toggle('wallet')} />
              )}
              {activeTab === 'wallet' && (
                <WalletPanel key="wallet-game" onClose={closeTab} />
              )}

              {/* ── Quit Match Warning Overlay ── */}
              {showQuitWarning && (
                <div className="absolute inset-0 z-[999] bg-black/60 backdrop-blur-md flex items-center justify-center p-5">
                  <div
                    className="ludo-quit-scope border border-white/10 rounded-[32px] shadow-2xl max-w-sm w-full text-center p-5"
                    style={{ background: 'var(--panel-bg-image, var(--ludo-bg-cosmic))', backgroundColor: 'var(--panel-bg, rgba(13,13,13,0.92))', backdropFilter: 'blur(32px)' }}
                  >
                    <h2 className="text-xl font-bold text-white mb-1">Leave Match?</h2>
                    <p className="text-white/60 text-sm font-medium mb-4">All progress will be lost. Are you sure you want to quit?</p>
                    <div className="flex gap-2 justify-center">
                      <button
                        onClick={() => setShowQuitWarning(false)}
                        className="flex-1 py-3 px-4 rounded-2xl text-sm font-black uppercase tracking-[0.2em] text-white bg-white/10 hover:bg-white/20 transition-all active:scale-95"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => {
                          setShowQuitWarning(false);
                          handleBackToSubMenu();
                        }}
                        className="flex-1 py-3 px-4 rounded-2xl text-sm font-black uppercase tracking-[0.2em] text-white bg-red-600/80 hover:bg-red-500 transition-all active:scale-95"
                      >
                        Quit Game
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Host Migration Overlay ── */}
              {/* Only show for Guest if connection is lost after game started.
                   `isHost` / `isLobbyConnected` are P2P-lobby concepts. A quick match
                   never opens a P2P lobby — it goes matchmaking → connectRoom(), so
                   `isLobbyConnected` is false by design while the Durable Object is
                   the authority. Gating on `roomAuthority` too means the panel only
                   appears when NOTHING authoritative is connected: the room is live
                   (no host to migrate — the room *is* the authority), or the room is
                   down and the P2P fallback genuinely has no host. */}
              {!isHost && !isLobbyConnected && !roomAuthority && gameState?.isStarted && !gameState?.winner && (
                <HostMigrationPanel onQuit={() => leaveGame()} onElect={handleHostElect} />
              )}
            </>
          )}
        </div>
        </GuestWallProvider>
      )}
    </>
  );
}
