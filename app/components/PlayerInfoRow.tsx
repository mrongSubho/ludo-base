import React from 'react';
import LudoDice from './LudoDice';
import { Player } from '@/hooks/useGameEngine';
import { PowerType, PlayerColor } from '@/lib/types';
import { Corner } from '@/lib/boardLayout';

export const getDisplayNameHelper = (player: Player) => {
    if (player.isAi) return player.name;
    
    // If the name is already specific (not 'Guest' or 'Host' default), use it.
    if (player.name && !['Guest', 'Host'].includes(player.name) && !player.name.startsWith('0x')) {
        return player.name;
    }

    // If we have a wallet address, show Guest + last 6 uppercase characters
    if (player.walletAddress) {
        const addr = player.walletAddress;
        return `Guest ${addr.slice(-6).toUpperCase()}`;
    }

    return player.name || 'Guest';
};

interface PlayerCardProps {
    player: Player;
    isActive: boolean;
    power: PowerType | null;
    onPowerClick?: () => void;
}

export function PlayerCard({
    player,
    isActive,
    power,
    onPowerClick,
}: PlayerCardProps) {
    const powerEmojis: Record<PowerType, string> = { shield: '🛡️', boost: '⚡', bomb: '💣', warp: '🧲' };

    return (
        <div className={`player-card player-card-corner ${player.position}`}>
            <div className="avatar-circle-wrapper">
                <div
                    className={`avatar-circle ${player.color} ${isActive ? 'active-glow' : ''}`}
                    title={getDisplayNameHelper(player)}
                    onClick={onPowerClick}
                >
                    {player.avatar && (player.avatar.startsWith('http') || player.avatar.startsWith('/')) ? (
                        <img
                            src={player.avatar}
                            alt={player.name}
                            className="w-full h-full object-cover rounded-full"
                        />
                    ) : (
                        <span className="avatar-emoji">{player.avatar || '👤'}</span>
                    )}
                    {power && (
                        <div className="absolute -bottom-1 -right-1 bg-black/50 backdrop-blur-sm rounded-full w-6 h-6 flex items-center justify-center text-xs border border-white/20">
                            {powerEmojis[power]}
                        </div>
                    )}
                </div>
                <div className="avatar-level-badge">{player.level}</div>
            </div>
        </div>
    );
}

interface PlayerRowProps {
    corners: ('TL' | 'TR')[] | ('BL' | 'BR')[];
    uiSlots: Record<string, PlayerColor | null>;
    players: Player[];
    localGameState: any;
    handleRoll: (val?: number) => void;
    handleUsePower: (color: PlayerColor) => void;
    spectatorMode: boolean;
    myPlayerColor: PlayerColor | undefined;
}

export function PlayerRow({
    corners,
    uiSlots,
    players,
    localGameState,
    handleRoll,
    handleUsePower,
    spectatorMode,
    myPlayerColor
}: PlayerRowProps) {
    return (
        <div className={`player-row player-row-${(corners as any).includes('TL') ? 'top' : 'bottom'}`}>
            {(corners as any as Corner[]).map((corner) => {
                const color = uiSlots[corner];
                const p = players.find(player => player.color === color);
                if (!p) {
                    return <div key={`empty-${corner}`} className="player-placeholder" style={{ width: 140 }}></div>;
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
                            power={localGameState.playerPowers[p.color]}
                            onPowerClick={() => !spectatorMode && handleUsePower(p.color)}
                        />
                        {isMyTurn && !spectatorMode && (
                            <LudoDice
                                onRoll={(val) => handleRoll(val)}
                                disabled={!canRoll}
                                currentValue={localGameState.diceValue}
                                isRolling={localGameState.isRolling}
                                activeColor={p.color}
                            />
                        )}
                        {isMyTurn && spectatorMode && localGameState.diceValue != null && (
                            <div className="w-10 h-10 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center text-white font-black text-lg">
                                {localGameState.diceValue}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
