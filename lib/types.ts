export type PlayerColor = 'green' | 'red' | 'yellow' | 'blue';
export type PowerType = 'shield' | 'boost' | 'bomb' | 'warp';

export type GameActionType = 'ROLL_DICE' | 'MOVE_TOKEN' | 'SYNC_STATE' | 'TURN_SWITCH' | 'SYNC_PROFILE' | 'START_GAME';
export type GameIntentType = 'REQUEST_ROLL' | 'REQUEST_MOVE';

export interface GameState {
    positions: {
        green: number[];
        red: number[];
        yellow: number[];
        blue: number[];
    };
    currentPlayer: PlayerColor;
    diceValue: number | null;
    gamePhase: 'rolling' | 'moving';
    status: 'waiting' | 'playing' | 'finished';
    winner: string | null;
    winners: string[];
    captureMessage: string | null;
    timeLeft: number;
    strikes: Record<PlayerColor, number>;
    powerTiles: { r: number, c: number }[];
    playerPowers: Record<PlayerColor, PowerType | null>;
    activeTraps: { r: number, c: number, owner: PlayerColor }[];
    activeShields: { color: PlayerColor, tokenIdx: number }[];
    consecutiveSixes: number;
    isStarted: boolean;
    lastUpdate: number;
    playerCount: '1v1' | '4P' | '2v2';
    lastAction?: { type: GameActionType; payload: any };
    initialBoardConfig?: {
        players: any[];
        colorCorner: any;
    };
}
