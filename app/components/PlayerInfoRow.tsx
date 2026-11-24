/* eslint-disable @typescript-eslint/no-explicit-any -- lint burn-down quarantine 2026-09-23 */
import React, { useState, useEffect, useRef } from 'react';
import LudoDice from './LudoDice';
import { Player } from '@/hooks/useGameEngine';
import { PlayerColor } from '@/lib/types';
import { Corner } from '@/lib/boardLayout';
import { getTierInfo } from '@/lib/progression';
import { usePreferences } from '@/hooks/usePreferences';
import { isDirectImage, resolveAvatarDef } from '@/lib/avatars';
import { PilotAvatar } from './PilotAvatar';
import { TerminalTypeText } from './TerminalTypeText';
import { DirectiveTargetIcon, OverdriveBoltIcon, PilotAvatarFallbackIcon } from './icons';

export const getDisplayNameHelper = (player: Player) => {
    let baseName = player.name;
    if (!player.isAi) {
        // If the name is already specific (not 'Guest' or 'Host' default), use it.
        if (!player.name || ['Guest', 'Host'].includes(player.name) || player.name.startsWith('0x')) {
            // If we have a wallet address, show User + last 4 uppercase characters
            if (player.walletAddress) {
                const addr = player.walletAddress;
                baseName = `User ${addr.slice(-4).toUpperCase()}`;
            } else {
                baseName = player.name || 'Guest';
            }
        }
    }

    const tag = player.clanTag || player.clan_tag;
    if (tag) {
        return `[${tag}] ${baseName}`;
    }

    return baseName;
};

const AWAIT_RING_COLORS: Record<string, string> = {
    green: '#10b981',
    red: '#ef4444',
    yellow: '#eab308',
    blue: '#3b82f6',
};

const AWAIT_RING_COLORS_3077: Record<string, string> = {
    green: '#00FF66',
    red: '#FF0055',
    yellow: '#FFD000',
    blue: '#0099FF',
};

interface PlayerCardProps {
    player: Player;
    isActive: boolean;
    awaitingMove?: boolean;
    isKicked?: boolean;
}

export function PlayerCard({
    player,
    isActive,
    awaitingMove,
    isKicked = false,
}: PlayerCardProps) {
    const { preferences } = usePreferences();
    const is3077 = preferences.theme === '3077';
    const [levelUp, setLevelUp] = useState(false);
    const prevLevelRef = useRef(player.level);

    useEffect(() => {
        if (player.level > prevLevelRef.current) {
            prevLevelRef.current = player.level;
            setLevelUp(true);
            const timer = setTimeout(() => setLevelUp(false), 800);
            return () => clearTimeout(timer);
        }
        prevLevelRef.current = player.level;
    }, [player.level]);

    const ringColor = (is3077 ? AWAIT_RING_COLORS_3077 : AWAIT_RING_COLORS)[player.color] || '#00E5FF';

    return (
        <div className={`player-card player-card-corner ${player.position} ${isActive ? 'player-card-active' : ''}`}>
            <div className="avatar-circle-wrapper" style={{ position: 'relative' }}>
                {awaitingMove && ([0, 0.8] as const).map(delay => (
                    <span
                        key={delay}
                        className="await-ring"
                        style={{ borderColor: ringColor, animationDelay: `${delay}s` }}
                        aria-hidden
                    />
                ))}
                <div
                    className={`avatar-circle hud-avatar-frame ${player.color} ${isActive ? 'active-glow' : ''} ${awaitingMove ? 'await-move' : ''}`}
                    title={getDisplayNameHelper(player)}
                >
                    {resolveAvatarDef(player.avatar) || isDirectImage(player.avatar) ? (
                        <PilotAvatar
                            avatarUrl={player.avatar}
                            name={getDisplayNameHelper(player)}
                            size="md"
                            className="!w-full !h-full !border-0 !rounded-none !bg-transparent"
                        />
                    ) : player.avatar && !player.avatar.startsWith('avatar:') && player.avatar.length <= 8 ? (
                        <span className="avatar-emoji">{player.avatar}</span>
                    ) : (
                        <span className="avatar-emoji flex items-center justify-center text-accent/80">
                            <PilotAvatarFallbackIcon className="w-5 h-5" />
                        </span>
                    )}
                </div>
                <div className={`avatar-level-badge ${levelUp ? 'level-up' : ''}`} style={{ background: getTierInfo(player.rxp || 0).tier === 'Arena Master' ? '#ea580c' : getTierInfo(player.rxp || 0).tier === 'Diamond' ? '#0891b2' : getTierInfo(player.rxp || 0).tier === 'Platinum' ? '#2563eb' : getTierInfo(player.rxp || 0).tier === 'Gold' ? '#ca8a04' : getTierInfo(player.rxp || 0).tier === 'Silver' ? '#64748b' : '#b45309' }}>
                    <span className="text-ludo-xs font-extrabold">{player.level}</span>
                </div>
                <span className={`player-connection-dot ${isKicked ? 'offline' : player.isAi ? 'ai' : ''}`} title={isKicked ? 'Disconnected' : player.isAi ? 'AI opponent' : 'Connected'} />
            </div>
        </div>
    );
}

export interface BoardSelfPrompt {
    label: string;
    kind: 'roll' | 'move' | 'deploy' | 'target';
}

interface PlayerRowProps {
    corners: ('TL' | 'TR')[] | ('BL' | 'BR')[];
    uiSlots: Record<string, PlayerColor | null>;
    players: Player[];
    localGameState: any;
    // No face argument: the engine rolls, the UI never supplies the value.
    handleRoll: () => void;
    spectatorMode: boolean;
    myPlayerColor: PlayerColor | undefined;
    centerPrompt?: BoardSelfPrompt | null;
}

export function PlayerRow({
    corners,
    uiSlots,
    players,
    localGameState,
    handleRoll,
    spectatorMode,
    myPlayerColor,
    centerPrompt = null,
}: PlayerRowProps) {
    const isTop = (corners as any).includes('TL');
    const items = (corners as any as Corner[]).map((corner) => {
        const color = uiSlots[corner];
        const p = players.find(player => player.color === color);
        if (!p) {
            return (
                <div
                    key={`empty-${corner}`}
                    className={`player-placeholder ${isTop ? 'w-[140px]' : 'w-14 sm:w-[116px] shrink-0'}`}
                />
            );
        }

        const isMyTurn = localGameState.currentPlayer === p.color;
        const isMyColor = p.color === myPlayerColor;
        const isCurrentlyBot = p.isAi || localGameState.afkStats[p.color].isKicked;
        const canRoll = isMyTurn && (isMyColor || spectatorMode) && !isCurrentlyBot && localGameState.gamePhase === 'rolling' && localGameState.diceValue === null && !localGameState.isRolling;

        const flexDir = (corner === 'TL' || corner === 'BL') ? 'flex-row' : 'flex-row-reverse';

        return (
            <div key={p.color} className={`player-wrapper ${isMyTurn ? 'active-turn' : ''} flex ${flexDir} items-center gap-3`}>
                <PlayerCard
                    player={p}
                    isActive={isMyTurn}
                    awaitingMove={isMyTurn && localGameState.gamePhase === 'moving' && !p.isAi}
                    isKicked={isCurrentlyBot && !p.isAi}
                />
                {isMyTurn && !spectatorMode && (
                    <LudoDice
                        key={p.color}
                        onRoll={handleRoll}
                        disabled={!canRoll}
                        currentValue={localGameState.diceValue}
                        isRolling={localGameState.isRolling}
                        activeColor={p.color}
                    />
                )}
                {isMyTurn && spectatorMode && localGameState.diceValue != null && (
                    <div className="hud-chamfer-sm w-10 h-10 rounded-xl bg-surface-recessed border border-accent/40 flex items-center justify-center text-accent font-mono font-extrabold text-lg tabular-nums shadow-[0_0_12px_color-mix(in_srgb,var(--accent)_20%,transparent)]">
                        {localGameState.diceValue}
                    </div>
                )}
            </div>
        );
    });

    return (
        <div className={`player-row player-row-${isTop ? 'top' : 'bottom'}`}>
            {items[0]}
            {!isTop && (
                <div className="board-self-prompt-slot" aria-live="polite">
                    {centerPrompt && (
                        <div className="board-turn-status is-yours board-self-prompt">
                            <span className="board-turn-status-dot shrink-0" />
                            {centerPrompt.kind === 'target' || centerPrompt.kind === 'move' ? (
                                <DirectiveTargetIcon className="w-3 h-3 shrink-0" active />
                            ) : (
                                <OverdriveBoltIcon className="w-3 h-3 shrink-0" active />
                            )}
                            <TerminalTypeText
                                key={centerPrompt.label}
                                text={centerPrompt.label}
                                charMs={18}
                                showCursor
                            />
                        </div>
                    )}
                </div>
            )}
            {items[1]}
        </div>
    );
}
