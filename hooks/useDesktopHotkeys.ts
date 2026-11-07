'use client';

import { useEffect, useCallback } from 'react';

export interface DesktopHotkeysOptions {
  onRollDice?: () => void;
  onSelectToken?: (tokenIndex: number) => void;
  onUsePower?: (slotIndex: number) => void;
  onOpenChat?: () => void;
  onEscape?: () => void;
  enabled?: boolean;
  canRoll?: boolean;
  legalTokenIndices?: number[];
}

/**
 * useDesktopHotkeys — Desktop keyboard ergonomics for match play.
 *
 * Hotkeys:
 * - Spacebar: Roll dice (when canRoll is true)
 * - 1, 2, 3, 4 (or Digit1-Digit4): Select & move legal token index 0..3
 * - Q, W, E: Activate Power card slots 0, 1, 2
 * - C or Enter: Focus tactical chat composer
 * - Escape: Close active drawers or trigger match menu
 *
 * Guard:
 * Automatically bails out when typing inside an <input>, <textarea>, or contentEditable node.
 */
export function useDesktopHotkeys({
  onRollDice,
  onSelectToken,
  onUsePower,
  onOpenChat,
  onEscape,
  enabled = true,
  canRoll = false,
  legalTokenIndices = [],
}: DesktopHotkeysOptions) {
  const isInputFocused = useCallback(() => {
    if (typeof document === 'undefined') return false;
    const active = document.activeElement;
    if (!active) return false;
    const tag = active.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || (active as HTMLElement).isContentEditable) {
      return true;
    }
    return false;
  }, []);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept when user is typing in chat or input
      if (isInputFocused()) {
        if (e.key === 'Escape') {
          (document.activeElement as HTMLElement)?.blur?.();
          e.preventDefault();
        }
        return;
      }

      // Spacebar: Roll dice
      if (e.code === 'Space' && !e.repeat) {
        if (canRoll && onRollDice) {
          e.preventDefault();
          onRollDice();
          return;
        }
      }

      // 1, 2, 3, 4: Select Token
      const numMatch = e.code.match(/^Digit([1-4])$/);
      if (numMatch && onSelectToken) {
        const tokenIndex = parseInt(numMatch[1], 10) - 1;
        if (legalTokenIndices.includes(tokenIndex)) {
          e.preventDefault();
          onSelectToken(tokenIndex);
          return;
        }
      }

      // Q, W, E: Power cards
      if (!e.repeat && onUsePower) {
        if (e.code === 'KeyQ') {
          e.preventDefault();
          onUsePower(0);
          return;
        }
        if (e.code === 'KeyW') {
          e.preventDefault();
          onUsePower(1);
          return;
        }
        if (e.code === 'KeyE') {
          e.preventDefault();
          onUsePower(2);
          return;
        }
      }

      // C: Quick Chat
      if ((e.code === 'KeyC' || e.code === 'Enter') && !e.repeat && onOpenChat) {
        e.preventDefault();
        onOpenChat();
        return;
      }

      // Escape
      if (e.code === 'Escape' && onEscape) {
        e.preventDefault();
        onEscape();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled, canRoll, legalTokenIndices, onRollDice, onSelectToken, onUsePower, onOpenChat, onEscape, isInputFocused]);
}
