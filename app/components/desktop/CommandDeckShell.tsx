'use client';

import React, { useRef } from 'react';
import CommandDeckHeader from './CommandDeckHeader';
import CommandDeckLeftWing from './CommandDeckLeftWing';
import CommandDeckConsole from './CommandDeckConsole';
import CommandDeckRightWing, { CombatLogEvent } from './CommandDeckRightWing';
import { useDesktopHotkeys } from '@/hooks/useDesktopHotkeys';
import { Player } from '@/hooks/useGameEngine';
import { GameState, PowerType, BoardPlayer } from '@/lib/types';
import { ColorCorner, Corner } from '@/lib/boardLayout';
import { PlayerColor } from '@/lib/engine/core';

interface CommandDeckShellProps {
  children: React.ReactNode;
  players: (Player | BoardPlayer)[];
  colorCorner: ColorCorner;
  uiSlots?: Partial<Record<Corner, PlayerColor | null>>;
  localGameState: GameState;
  myPlayer?: Player | BoardPlayer | null;
  playerCount: string | number;
  gameMode?: string;
  roomCode?: string | null;
  matchId?: string | null;
  wager?: number;
  spectators?: number;
  spectatorMode?: boolean;
  matchConnectionStatus?: string;
  onExitMatch?: () => void;
  onReturnToLanding?: () => void;
  onOpenSettings?: () => void;
  onRollDice?: () => void;
  onSelectToken?: (tokenIndex: number) => void;
  onUsePower?: (type: PowerType) => void;
  onSendChat?: (text: string, audience: 'all' | 'team') => void;
  onSendEmote?: (stickerId: string, glyph: string, assetUrl?: string) => void;
  streamNode?: React.ReactNode;
  canRoll?: boolean;
  legalTokenIndices?: number[];
  canUsePowers?: boolean;
  targetingType?: PowerType | null;
  combatEvents?: CombatLogEvent[];
  externalRightWing?: React.ReactNode;
}

export default function CommandDeckShell({
  children,
  players,
  colorCorner,
  uiSlots,
  localGameState,
  myPlayer,
  playerCount,
  gameMode = 'classic',
  roomCode,
  matchId,
  wager = 0,
  spectators = 0,
  spectatorMode = false,
  matchConnectionStatus,
  onExitMatch,
  onReturnToLanding,
  onOpenSettings,
  onRollDice,
  onSelectToken,
  onUsePower,
  onSendChat,
  onSendEmote,
  streamNode,
  canRoll = false,
  legalTokenIndices = [],
  canUsePowers = false,
  targetingType = null,
  combatEvents,
  externalRightWing,
}: CommandDeckShellProps) {
  const chatInputRef = useRef<HTMLInputElement | null>(null);

  useDesktopHotkeys({
    enabled: !spectatorMode,
    onRollDice,
    onSelectToken,
    onUsePower: (slotIdx) => {
      const types: PowerType[] = ['boost', 'shield', 'teleport', 'nuke'];
      if (types[slotIdx] && onUsePower) {
        onUsePower(types[slotIdx]);
      }
    },
    onOpenChat: () => {
      chatInputRef.current?.focus();
    },
    onEscape: onOpenSettings || onExitMatch,
    canRoll,
    legalTokenIndices,
  });

  return (
    <div className="command-deck-root">
      {/* 1. Header Bar */}
      <CommandDeckHeader
        roomCode={roomCode}
        matchId={matchId}
        gameMode={gameMode}
        playerCount={playerCount}
        wager={wager}
        spectators={spectators}
        matchConnectionStatus={matchConnectionStatus}
        onExitMatch={onExitMatch}
        onReturnToLanding={onReturnToLanding}
        onOpenSettings={onOpenSettings}
        streamNode={streamNode}
      />

      {/* 2. Main 3-Column Cockpit Grid */}
      <div className="command-deck-grid">
        {/* Left Wing: Player & Team Telemetry Deck */}
        <CommandDeckLeftWing
          players={players}
          colorCorner={colorCorner}
          uiSlots={uiSlots}
          localGameState={localGameState}
          myPlayer={myPlayer}
          playerCount={playerCount}
          gameMode={gameMode}
          onUsePower={onUsePower}
          canUsePowers={canUsePowers}
          targetingType={targetingType}
        />

        {/* Center Stage: Scalable Arena Board + Action Console */}
        <div className="command-deck-stage">
          <div className="w-full flex-1 min-h-0 flex flex-col items-center justify-center">
            {children}
          </div>

          {/* Action Console Dock (Players only) */}
          {!spectatorMode && onRollDice && onSelectToken && (
            <CommandDeckConsole
              localGameState={localGameState}
              colorCorner={colorCorner}
              myPlayer={myPlayer}
              onRollDice={onRollDice}
              onSelectToken={onSelectToken}
              canRoll={canRoll}
              legalTokenIndices={legalTokenIndices}
            />
          )}
        </div>

        {/* Right Wing: Tactical Comms, Stickers & Match Log (or External SpectatorHUD spacer) */}
        <CommandDeckRightWing
          onSendChat={onSendChat}
          onSendEmote={onSendEmote}
          playerCount={playerCount}
          isTeamMatch={playerCount === '2v2'}
          myColor={myPlayer?.color}
          combatEvents={combatEvents}
          chatInputRef={chatInputRef}
          externalRightWing={externalRightWing}
        />
      </div>
    </div>
  );
}
