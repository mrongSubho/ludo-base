'use client';

import React from 'react';
import { GameState } from '@/lib/types';
import { ColorCorner } from '@/lib/boardLayout';
import { Player } from '@/hooks/useGameEngine';
import { PlayerColor } from '@/lib/engine/core';

interface CommandDeckConsoleProps {
  localGameState: GameState;
  colorCorner: ColorCorner;
  myPlayer?: Player | null;
  onRollDice: () => void;
  onSelectToken: (tokenIndex: number) => void;
  canRoll: boolean;
  legalTokenIndices: number[];
}

export default function CommandDeckConsole({
  localGameState,
  colorCorner: _colorCorner,
  myPlayer,
  onRollDice,
  onSelectToken,
  canRoll,
  legalTokenIndices,
}: CommandDeckConsoleProps) {
  const ownColor = myPlayer?.color as PlayerColor | undefined;
  const turnColor = localGameState.currentPlayer as PlayerColor;
  const isMyTurn = !!ownColor && turnColor === ownColor;
  const gamePhase = localGameState.gamePhase;
  const diceValue = localGameState.diceValue;

  return (
    <div className="w-full max-w-xl mx-auto mt-2 p-2.5 rounded-2xl bg-surface-panel/90 backdrop-blur-md border border-line-soft shadow-xl flex items-center justify-between gap-4">
      {/* Turn Status Message */}
      <div className="flex items-center gap-3">
        <div
          className={`w-3 h-3 rounded-full ${
            isMyTurn ? 'bg-positive animate-pulse' : 'bg-ink-faint'
          }`}
        />
        <div className="flex flex-col">
          <span className="text-ludo-xs font-bold uppercase tracking-wider text-ink-strong">
            {isMyTurn ? 'YOUR TURN' : `${turnColor.toUpperCase()}'S TURN`}
          </span>
          <span className="text-ludo-xs text-ink-muted font-mono">
            {gamePhase === 'rolling'
              ? isMyTurn
                ? 'Roll the dice'
                : 'Waiting for roll'
              : gamePhase === 'moving'
                ? isMyTurn
                  ? `Rolled ${diceValue} · Choose token`
                  : `Rolled ${diceValue} · Moving`
                : 'Processing turn'}
          </span>
        </div>
      </div>

      {/* Action Area: Roll Dice or Pawn Buttons */}
      <div className="flex items-center gap-2">
        {isMyTurn && gamePhase === 'rolling' && (
          <button
            type="button"
            onClick={onRollDice}
            disabled={!canRoll}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-ludo-xs uppercase tracking-widest label-chrome font-black bg-accent text-surface-page hover:brightness-110 active:scale-95 transition-all shadow-[0_0_20px_rgba(0,229,255,0.4)] disabled:opacity-50 cursor-pointer"
          >
            <span>🎲</span>
            <span>ROLL DICE</span>
            <span className="keycap-badge">SPACE</span>
          </button>
        )}

        {isMyTurn && gamePhase === 'moving' && (
          <div className="flex items-center gap-1.5">
            <span className="text-ludo-xs text-ink-muted uppercase mr-1 hidden sm:inline font-mono">
              PAWN:
            </span>
            {[0, 1, 2, 3].map((tokenIdx) => {
              const isLegal = legalTokenIndices.includes(tokenIdx);
              return (
                <button
                  key={tokenIdx}
                  type="button"
                  disabled={!isLegal}
                  onClick={() => onSelectToken(tokenIdx)}
                  className={`px-3 py-1.5 rounded-xl text-ludo-xs font-mono font-bold flex items-center gap-1.5 transition-all ${
                    isLegal
                      ? 'bg-accent text-surface-page shadow-[0_0_12px_rgba(0,229,255,0.35)] hover:brightness-110 active:scale-95 cursor-pointer'
                      : 'bg-surface-recessed text-ink-faint border border-line-soft opacity-40 cursor-not-allowed'
                  }`}
                >
                  <span>P{tokenIdx + 1}</span>
                  <span className={isLegal ? 'keycap-badge' : 'opacity-0'}>
                    {tokenIdx + 1}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {!isMyTurn && (
          <div className="px-4 py-2 rounded-xl bg-surface-recessed border border-line-soft text-ludo-xs font-mono text-ink-muted">
            WAITING…
          </div>
        )}
      </div>
    </div>
  );
}
