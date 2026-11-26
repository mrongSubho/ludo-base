/* eslint-disable @typescript-eslint/no-explicit-any -- lint burn-down quarantine 2026-09-23 */
import React, { useState, useEffect, useRef } from 'react';
import { AnchoredDiceBay } from './AnchoredDiceBay';
import { Player } from '@/hooks/useGameEngine';
import { PlayerColor } from '@/lib/types';
import { Corner } from '@/lib/boardLayout';
import type { TurnRollEntry } from '@/lib/diceVisuals';
import { getTierInfo } from '@/lib/progression';
import { usePreferences } from '@/hooks/usePreferences';
import { isDirectImage, resolveAvatarDef } from '@/lib/avatars';
import { PilotAvatar } from './PilotAvatar';
import { PilotAvatarFallbackIcon } from './icons';
import { PROJECTILES, type ProjectileId } from '@/lib/emotes';

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
    isAutoPlaying?: boolean;
    isKicked?: boolean;
    canQuickThrow?: boolean;
    onQuickThrow?: (toColor: PlayerColor, projectileId: ProjectileId) => void;
}

export function PlayerCard({
    player,
    isActive,
    awaitingMove,
    isAutoPlaying = false,
    isKicked = false,
    canQuickThrow = false,
    onQuickThrow,
}: PlayerCardProps) {
    const { preferences } = usePreferences();
    const is3077 = preferences.theme === '3077';
    const [levelUp, setLevelUp] = useState(false);
    const [throwOpen, setThrowOpen] = useState(false);
    const prevLevelRef = useRef(player.level);
    const cardRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!throwOpen) return;
        const onDocClick = (ev: MouseEvent) => {
            if (cardRef.current && !cardRef.current.contains(ev.target as Node)) {
                setThrowOpen(false);
            }
        };
        const onKey = (ev: KeyboardEvent) => {
            if (ev.key === 'Escape') setThrowOpen(false);
        };
        document.addEventListener('mousedown', onDocClick);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDocClick);
            document.removeEventListener('keydown', onKey);
        };
    }, [throwOpen]);

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
        <div ref={cardRef} className={`player-card player-card-corner ${player.position} ${isActive ? 'player-card-active' : ''}`}>
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
                    className={`avatar-circle hud-avatar-frame ${player.color} ${isActive ? 'active-glow' : ''} ${awaitingMove ? 'await-move' : ''} ${canQuickThrow ? 'cursor-pointer' : ''}`}
                    title={canQuickThrow ? `${getDisplayNameHelper(player)} · Tap to throw reaction` : getDisplayNameHelper(player)}
                    role={canQuickThrow ? 'button' : undefined}
                    tabIndex={canQuickThrow ? 0 : undefined}
                    aria-expanded={canQuickThrow ? throwOpen : undefined}
                    onClick={canQuickThrow ? () => setThrowOpen((prev) => !prev) : undefined}
                    onKeyDown={
                        canQuickThrow
                            ? (ev) => {
                                  if (ev.key === 'Enter' || ev.key === ' ') {
                                      ev.preventDefault();
                                      setThrowOpen((prev) => !prev);
                                  }
                              }
                            : undefined
                    }
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
                {player.isAi && (
                    <span
                        data-testid="ai-seat-badge"
                        className="absolute -top-1 -right-1 z-10 px-1.5 py-0.5 rounded-full bg-surface-panel border border-accent/60 text-accent font-mono font-extrabold text-ludo-xs leading-none uppercase tracking-wider shadow-sm"
                        title="Server AI Bot Seat"
                    >
                        AI
                    </span>
                )}
                <span className={`player-connection-dot ${isKicked ? 'offline' : (player.isAi || isAutoPlaying) ? 'ai' : ''}`} title={isKicked ? 'Disconnected' : player.isAi ? 'AI opponent' : isAutoPlaying ? 'Autopilot Active' : 'Connected'} />
                {canQuickThrow && onQuickThrow && throwOpen && (
                    <div
                        role="menu"
                        aria-label={`Throw reaction at ${getDisplayNameHelper(player)}`}
                        className="absolute left-1/2 -translate-x-1/2 top-full mt-1.5 z-50 flex items-center gap-1 p-1 rounded-xl bg-surface-panel/95 border border-accent/40 shadow-xl backdrop-blur-md"
                    >
                        {PROJECTILES.map((proj) => (
                            <button
                                key={proj.id}
                                type="button"
                                role="menuitem"
                                title={proj.label}
                                onClick={(ev) => {
                                    ev.stopPropagation();
                                    onQuickThrow(player.color, proj.id);
                                    setThrowOpen(false);
                                }}
                                className="px-1.5 py-1 rounded-lg bg-surface-recessed hover:bg-accent-soft border border-line-soft text-xs transition-colors"
                            >
                                <span aria-hidden="true">{proj.badge}</span>
                                <span className="sr-only">{proj.label}</span>
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
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
    bustState?: { color: PlayerColor; key: number } | null;
    turnRolls?: TurnRollEntry[];
    onQuickThrow?: (toColor: PlayerColor, projectileId: ProjectileId) => void;
}

export function PlayerRow({
    corners,
    uiSlots,
    players,
    localGameState,
    handleRoll,
    spectatorMode,
    myPlayerColor,
    bustState = null,
    turnRolls = [],
    onQuickThrow,
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
        const afkEntry = localGameState.afkStats?.[p.color];
        const isAutoPlaying = Boolean(afkEntry?.isAutoPlaying);
        const isKicked = Boolean(afkEntry?.isKicked);
        const isCurrentlyBot = p.isAi || isKicked || isAutoPlaying;
        const canRoll = isMyTurn && (isMyColor || spectatorMode) && !isCurrentlyBot && localGameState.gamePhase === 'rolling' && localGameState.diceValue === null && !localGameState.isRolling;

        const flexDir = (corner === 'TL' || corner === 'BL') ? 'flex-row' : 'flex-row-reverse';
        const side = (corner === 'TL' || corner === 'BL') ? 'left' : 'right';
        const rowEdge = isTop ? 'top' : 'bottom';
        const consecutiveSixes = Number(localGameState.consecutiveSixes || 0);
        const canQuickThrow = Boolean(
            !spectatorMode &&
                onQuickThrow &&
                myPlayerColor &&
                !isMyColor &&
                localGameState.isStarted &&
                !localGameState.winner,
        );

        return (
            <div key={p.color} className={`player-wrapper ${isMyTurn ? 'active-turn' : ''} flex ${flexDir} items-center gap-0`}>
                <PlayerCard
                    player={p}
                    isActive={isMyTurn}
                    awaitingMove={isMyTurn && localGameState.gamePhase === 'moving' && !p.isAi && !isAutoPlaying && !isKicked}
                    isAutoPlaying={isAutoPlaying && !p.isAi}
                    isKicked={isKicked && !p.isAi}
                    canQuickThrow={canQuickThrow}
                    onQuickThrow={onQuickThrow}
                />
                {isMyTurn && !spectatorMode && (
                    <AnchoredDiceBay
                        color={p.color}
                        corner={corner}
                        side={side}
                        rowEdge={rowEdge}
                        canRoll={canRoll}
                        isRolling={Boolean(localGameState.isRolling)}
                        diceValue={localGameState.diceValue ?? null}
                        boostActive={localGameState.activeBoost === p.color}
                        boostPendingDice={isMyTurn ? (localGameState.boostPendingDice ?? null) : null}
                        bustKey={bustState?.color === p.color ? bustState.key : 0}
                        turnRolls={turnRolls}
                        dangerSixes={consecutiveSixes >= 2}
                        onRoll={handleRoll}
                    />
                )}
                {isMyTurn && spectatorMode && localGameState.diceValue != null && (
                    <div className="hud-chamfer-sm ml-2 mr-2 w-10 h-10 rounded-xl bg-surface-recessed border border-accent/40 flex items-center justify-center text-accent font-mono font-extrabold text-lg tabular-nums shadow-[0_0_12px_color-mix(in_srgb,var(--accent)_20%,transparent)]">
                        {localGameState.diceValue}
                    </div>
                )}
            </div>
        );
    });

    return (
        <div className={`player-row player-row-${isTop ? 'top' : 'bottom'}`}>
            {items[0]}
            {items[1]}
        </div>
    );
}
