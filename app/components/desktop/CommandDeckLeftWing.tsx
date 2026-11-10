'use client';

import React from 'react';
import { Player } from '@/hooks/useGameEngine';
import { GameState, PowerType, PowerItem, BoardPlayer } from '@/lib/types';
import { ColorCorner, Corner } from '@/lib/boardLayout';
import { PlayerColor } from '@/lib/engine/core';

interface CommandDeckLeftWingProps {
  players: (Player | BoardPlayer)[];
  colorCorner: ColorCorner;
  uiSlots?: Partial<Record<Corner, PlayerColor | null>>;
  localGameState: GameState;
  myPlayer?: Player | BoardPlayer | null;
  playerCount: string | number;
  gameMode?: string;
  onUsePower?: (type: PowerType) => void;
  canUsePowers?: boolean;
  targetingType?: PowerType | null;
}

const COLOR_ACCENTS: Record<PlayerColor, { text: string; bg: string; border: string; name: string }> = {
  green: { text: 'text-positive', bg: 'bg-positive/10', border: 'border-positive/40', name: 'GREEN' },
  blue: { text: 'text-accent', bg: 'bg-accent/10', border: 'border-accent/40', name: 'BLUE' },
  red: { text: 'text-negative', bg: 'bg-negative/10', border: 'border-negative/40', name: 'RED' },
  yellow: { text: 'text-warn', bg: 'bg-warn/10', border: 'border-warn/40', name: 'YELLOW' },
};

const POWER_SLOTS: { type: PowerType; keycap: string; icon: string }[] = [
  { type: 'boost', keycap: 'Q', icon: '⚡' },
  { type: 'shield', keycap: 'W', icon: '🛡️' },
  { type: 'teleport', keycap: 'E', icon: '🌀' },
  { type: 'nuke', keycap: 'R', icon: '💣' },
];

export default function CommandDeckLeftWing({
  players,
  colorCorner,
  uiSlots,
  localGameState,
  myPlayer,
  playerCount,
  gameMode = 'classic',
  onUsePower,
  canUsePowers = false,
  targetingType = null,
}: CommandDeckLeftWingProps) {
  const is2v2 = playerCount === '2v2';
  const ownColor = myPlayer?.color;
  const activeColor = localGameState.currentPlayer as PlayerColor;
  const timeLeft = typeof localGameState.timeLeft === 'number' ? Math.max(0, Math.ceil(localGameState.timeLeft)) : 15;

  const visualCornerFor = (c: PlayerColor): string => {
    if (uiSlots) {
      const match = (Object.entries(uiSlots) as [Corner, PlayerColor | null | undefined][]).find(
        ([, val]) => val === c,
      );
      if (match) return match[0];
    }
    return colorCorner[c] || 'BL';
  };

  const myPowers: PowerItem[] =
    gameMode === 'power' && ownColor
      ? (localGameState.playerPowers?.[ownColor] || []).filter((p) => p.expiresAt > Date.now())
      : [];

  const renderPlayerCard = (player: Player | BoardPlayer) => {
    const color = player.color as PlayerColor;
    const isTurn = activeColor === color && !localGameState.winner;
    const corner = visualCornerFor(color);
    const positions = (localGameState.positions?.[color] as number[]) || [-1, -1, -1, -1];

    const inYard = positions.filter((p) => Number(p) === -1).length;
    const home = positions.filter((p) => Number(p) === 57).length;
    const onTrack = positions.filter((p) => Number(p) >= 0 && Number(p) < 57).length;

    const styling = COLOR_ACCENTS[color] || COLOR_ACCENTS.green;
    const isMe = ownColor === color;

    return (
      <div
        key={color}
        className={`p-3 rounded-xl border transition-all ${
          isTurn
            ? 'bg-surface-panel border-accent shadow-[0_0_15px_rgba(0,229,255,0.2)]'
            : 'bg-surface-recessed/70 border-line-soft'
        }`}
      >
        {/* Header: Name, Corner & Turn Clock */}
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className={`w-2.5 h-2.5 rounded-full ${isTurn ? 'animate-ping' : ''} ${styling.bg} border ${styling.border}`} />
            <span className={`font-bold text-ludo-xs truncate ${styling.text}`}>
              {player.name}
            </span>
            {isMe && (
              <span className="px-1.5 py-0.2 rounded text-ludo-xs font-mono font-semibold bg-surface-panel text-accent border border-accent/40">
                YOU
              </span>
            )}
            {player.isAi && (
              <span className="px-1.5 py-0.2 rounded text-ludo-xs font-mono bg-surface-panel text-ink-faint border border-line-soft">
                BOT
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <span className="px-1.5 py-0.5 rounded text-ludo-xs font-mono font-bold bg-surface-panel text-ink-muted border border-line-soft">
              {corner}
            </span>
            {isTurn && (
              <span className={`px-2 py-0.5 rounded text-ludo-xs font-mono font-bold ${timeLeft <= 5 ? 'bg-warn text-surface-page animate-pulse' : 'bg-accent text-surface-page'}`}>
                {timeLeft}s
              </span>
            )}
          </div>
        </div>

        {/* Token Counts */}
        <div className="grid grid-cols-3 gap-1.5 text-center text-ludo-xs font-mono pt-1 border-t border-line-soft">
          <div className="bg-surface-panel/80 p-1 rounded border border-line-soft">
            <span className="text-ink-faint block">YARD</span>
            <span className="font-bold text-ink-muted">{inYard}</span>
          </div>
          <div className="bg-surface-panel/80 p-1 rounded border border-line-soft">
            <span className="text-ink-faint block">TRACK</span>
            <span className="font-bold text-accent">{onTrack}</span>
          </div>
          <div className="bg-surface-panel/80 p-1 rounded border border-line-soft">
            <span className="text-ink-faint block">HOME</span>
            <span className="font-bold text-positive">{home}/4</span>
          </div>
        </div>
      </div>
    );
  };

  const teamAlphaPlayers = players.filter((p) => p.color === 'green' || p.color === 'blue');
  const teamOmegaPlayers = players.filter((p) => p.color === 'red' || p.color === 'yellow');

  const countHomeFor = (group: (Player | BoardPlayer)[]) =>
    group.reduce((acc, p) => {
      const pos = (localGameState.positions?.[p.color as PlayerColor] as number[]) || [];
      return acc + pos.filter((x) => Number(x) === 57).length;
    }, 0);

  const teamAlphaHome = countHomeFor(teamAlphaPlayers);
  const teamOmegaHome = countHomeFor(teamOmegaPlayers);

  const alphaAssistReady = teamAlphaPlayers.some((p) =>
    ((localGameState.positions?.[p.color as PlayerColor] as number[]) || []).every((x) => Number(x) === 57),
  ) && teamAlphaHome < 8;

  const omegaAssistReady = teamOmegaPlayers.some((p) =>
    ((localGameState.positions?.[p.color as PlayerColor] as number[]) || []).every((x) => Number(x) === 57),
  ) && teamOmegaHome < 8;

  return (
    <aside className="command-deck-wing-left">
      {/* 2v2 Teams Mode */}
      {is2v2 ? (
        <div className="flex flex-col gap-3">
          {/* Team Alpha (Green + Blue) */}
          <div className="p-3 rounded-2xl bg-surface-panel border border-line-soft flex flex-col gap-2.5">
            <div className="flex items-center justify-between border-b border-line-soft pb-2">
              <div className="flex items-center gap-1.5">
                <span className="text-accent font-bold">❖</span>
                <span className="text-ludo-xs font-extrabold uppercase tracking-wider text-ink-strong">
                  TEAM ALPHA (GB)
                </span>
              </div>
              <span className="text-ludo-xs font-mono font-bold text-positive bg-surface-recessed px-2 py-0.5 rounded border border-line-soft">
                {teamAlphaHome}/8 HOME
              </span>
            </div>

            <div className="flex flex-col gap-2">
              {teamAlphaPlayers.map(renderPlayerCard)}
            </div>

            <div className="flex items-center justify-between text-ludo-xs text-ink-muted pt-1 border-t border-line-soft font-mono">
              <span>{alphaAssistReady ? 'TEAM ASSIST:' : 'TRAP TRUCE:'}</span>
              <span className="text-positive font-semibold">
                {alphaAssistReady ? 'ASSIST ACTIVE' : 'IMMUNE'}
              </span>
            </div>
          </div>

          {/* Team Omega (Red + Yellow) */}
          <div className="p-3 rounded-2xl bg-surface-panel border border-line-soft flex flex-col gap-2.5">
            <div className="flex items-center justify-between border-b border-line-soft pb-2">
              <div className="flex items-center gap-1.5">
                <span className="text-warn font-bold">❖</span>
                <span className="text-ludo-xs font-extrabold uppercase tracking-wider text-ink-strong">
                  TEAM OMEGA (RY)
                </span>
              </div>
              <span className="text-ludo-xs font-mono font-bold text-positive bg-surface-recessed px-2 py-0.5 rounded border border-line-soft">
                {teamOmegaHome}/8 HOME
              </span>
            </div>

            <div className="flex flex-col gap-2">
              {teamOmegaPlayers.map(renderPlayerCard)}
            </div>

            {omegaAssistReady && (
              <div className="flex items-center justify-between text-ludo-xs text-ink-muted pt-1 border-t border-line-soft font-mono">
                <span>TEAM ASSIST:</span>
                <span className="text-positive font-semibold">ASSIST ACTIVE</span>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* FFA Mode (1v1 or 4P) */
        <div className="p-3 rounded-2xl bg-surface-panel border border-line-soft flex flex-col gap-2.5">
          <div className="flex items-center justify-between border-b border-line-soft pb-2">
            <span className="text-ludo-xs font-extrabold uppercase tracking-wider text-ink-strong">
              COMBATANTS
            </span>
            <span className="text-ludo-xs font-mono text-ink-faint">
              {players.length} SEATED
            </span>
          </div>

          <div className="flex flex-col gap-2">
            {players.map(renderPlayerCard)}
          </div>
        </div>
      )}

      {/* Power Cards Inventory Deck (Power Mode Only) */}
      {gameMode === 'power' && (
        <div className="p-3 rounded-2xl bg-surface-panel border border-line-soft flex flex-col gap-2.5">
          <div className="flex items-center justify-between border-b border-line-soft pb-2">
            <div className="flex items-center gap-1.5">
              <span>⚡</span>
              <span className="text-ludo-xs font-extrabold uppercase tracking-wider text-ink-strong">
                POWER CARDS
              </span>
            </div>
            <span className="text-ludo-xs font-mono text-accent">
              {targetingType ? `TARGET ${targetingType.toUpperCase()}` : `${myPowers.length} HELD`}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {POWER_SLOTS.map(({ type, keycap, icon }) => {
              const count = myPowers.filter((p) => p.type === type).length;
              const isArmed = targetingType === type;
              const hasCard = count > 0;
              return (
                <button
                  key={type}
                  type="button"
                  disabled={!hasCard || !canUsePowers}
                  onClick={() => onUsePower?.(type)}
                  className={`p-2 rounded-xl border flex items-center justify-between gap-2 transition-all ${
                    isArmed
                      ? 'bg-warn/20 border-warn shadow-[0_0_12px_rgba(255,170,0,0.3)] cursor-pointer'
                      : hasCard && canUsePowers
                        ? 'bg-surface-recessed border-accent hover:brightness-110 active:scale-95 cursor-pointer shadow-sm'
                        : 'bg-surface-recessed/40 border-line-soft opacity-40 cursor-not-allowed'
                  }`}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-sm">{icon}</span>
                    <div className="flex flex-col items-start min-w-0">
                      <span className="text-ludo-xs font-bold uppercase text-ink-strong truncate">
                        {type}
                      </span>
                      <span className="text-ludo-xs font-mono text-ink-faint">x{count}</span>
                    </div>
                  </div>
                  <span className="keycap-badge shrink-0">{keycap}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </aside>
  );
}
