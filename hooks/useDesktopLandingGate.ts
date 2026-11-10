"use client";

import { useEffect, useState, useCallback } from 'react';

export interface ArenaLaunchConfig {
  matchType?: 2 | 4 | '1v1' | '2v2';
  gameMode?: 'classic' | 'power';
  joinRoomCode?: string;
  spectateRoomCode?: string;
  startBotMatch?: boolean;
}

export interface DesktopLandingGateOptions {
  appState: 'dashboard' | 'game' | 'spectating';
  onApplyLaunchConfig?: (config: ArenaLaunchConfig) => void;
}

/**
 * useDesktopLandingGate — Deterministic routing state machine for Ludo 3077 Desktop.
 *
 * Enforces Option A (Adaptive Root):
 * 1. Viewport & Pointer: Only desktop viewports (>= 1024px) with fine pointer (mouse/trackpad).
 * 2. Embedded Webview: Farcaster / Base App frames (window.self !== window.top) bypass directly to the game.
 * 3. Deep Links: Query params (?room=, ?s=, ?spectate=, ?play=1, ?tab=) bypass directly to game.
 * 4. Active Match: Never interrupt active gameplay or spectating.
 * 5. Session Storage: Once "Enter Arena" is chosen, preserve state for the session.
 */
export function useDesktopLandingGate({ appState, onApplyLaunchConfig }: DesktopLandingGateOptions) {
  const [showLanding, setShowLanding] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    setIsHydrated(true);
    if (typeof window === 'undefined') return;

    // Rule 1: Viewport & Pointer
    const isDesktop = window.matchMedia('(min-width: 1024px) and (pointer: fine)').matches;
    if (!isDesktop) {
      setShowLanding(false);
      return;
    }

    // Rule 2: Embedded Webview (Farcaster Frame / Base App)
    try {
      if (window.self !== window.top) {
        setShowLanding(false);
        return;
      }
    } catch {
      setShowLanding(false);
      return;
    }

    // Rule 3: Deep Links & Params
    const params = new URLSearchParams(window.location.search);
    if (
      params.has('room') ||
      params.has('s') ||
      params.has('spectate') ||
      params.has('play') ||
      params.has('tab')
    ) {
      setShowLanding(false);
      return;
    }

    // Rule 4: Active match or spectating
    if (appState !== 'dashboard') {
      setShowLanding(false);
      return;
    }

    // Rule 5: User already entered arena in this session
    try {
      if (sessionStorage.getItem('ludo-arena-entered') === '1') {
        setShowLanding(false);
        return;
      }
    } catch {
      // Storage unavailable — fail open to landing
    }

    setShowLanding(true);
  }, [appState]);

  const enterArena = useCallback((config?: ArenaLaunchConfig) => {
    try {
      sessionStorage.setItem('ludo-arena-entered', '1');
    } catch {
      // Storage unavailable
    }
    if (config && onApplyLaunchConfig) {
      onApplyLaunchConfig(config);
    }
    setShowLanding(false);
  }, [onApplyLaunchConfig]);

  const returnToLanding = useCallback(() => {
    try {
      sessionStorage.removeItem('ludo-arena-entered');
    } catch {
      // Storage unavailable
    }
    setShowLanding(true);
  }, []);

  return {
    showLanding,
    isHydrated,
    enterArena,
    returnToLanding,
  };
}
