'use client';

import React from 'react';
import CommandDeckHeader from './CommandDeckHeader';
import CommandDeckLeftWing from './CommandDeckLeftWing';
import CommandDeckConsole from './CommandDeckConsole';
import CommandDeckRightWing from './CommandDeckRightWing';
import { useDesktopHotkeys } from '@/hooks/useDesktopHotkeys';
import { Player } from '@/hooks/useGameEngine';
import { GameState, PowerType, BoardPlayer } from '@/lib/types';
import { ColorCorner } from '@/lib/boardLayout';

interface CommandDeckShellProps {
  children: React.ReactNode;
  players: (Player | BoardPlayer)[];
  colorCorner: ColorCorner;
  localGameState: GameState;
  myPlayer?: Player | BoardPlayer | null;
  playerCount: string | number;
  gameMode?: string;
  roomCode?: string | null;
  matchId?: string | null;
  wager?: number;
  spectators?: number;
  matchConnectionStatus?: string;
  onExitMatch?: () => void;
  onReturnToLanding?: () => void;
  onOpenSettings?: () => void;
  onRollDice?: () => void;
  onSelectToken?: (tokenIndex: number) => void;
  onUsePower?: (type: PowerType) => void;
  onSendChat?: (text: string, audience: 'all' | 'team') => void;
  onSendEmote?: (glyph: string, assetUrl?: string) => void;
  streamNode?: React.ReactNode;
  canRoll?: boolean;
  legalTokenIndices?: number[];
  canUsePowers?: boolean;
}

export default function CommandDeckShell({
  children,
  players,
  colorCorner,
  localGameState,
  myPlayer,
  playerCount,
  gameMode = 'classic',
  roomCode,
  matchId,
  wager = 0,
  spectators = 0,
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
}: CommandDeckShellProps) {
  // Wire desktop hotkeys
  useDesktopHotkeys({
    onRollDice,
    onSelectToken,
    onUsePower: (slotIdx) => {
      const types: PowerType[] = ['boost', 'shield', 'teleport'];
      if (types[slotIdx] && onUsePower) {
        onUsePower(types[slotIdx]);
      }
    },
    onEscape: onExitMatch,
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
          localGameState={localGameState}
          myPlayer={myPlayer}
          playerCount={playerCount}
          gameMode={gameMode}
          onUsePower={onUsePower}
          canUsePowers={canUsePowers}
        />

        {/* Center Stage: Scalable Arena Board + Action Console */}
        <div className="command-deck-stage">
          <div className="w-full h-full flex flex-col items-center justify-center min-h-0">
            {children}
          </div>

          {/* Action Console Dock */}
          {onRollDice && onSelectToken && (
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

        {/* Right Wing: Tactical Comms, Stickers & Match Log */}
        <CommandDeckRightWing
          onSendChat={onSendChat}
          onSendEmote={onSendEmote}
          playerCount={playerCount}
          isTeamMatch={playerCount === '2v2'}
        />
      </div>
    </div>
  );
}
