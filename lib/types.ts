export type PlayerColor = 'green' | 'red' | 'yellow' | 'blue';
export type PowerType = 'shield' | 'boost' | 'bomb' | 'warp';

export type GameActionType = 'ROLL_DICE' | 'MOVE_TOKEN' | 'SYNC_STATE' | 'TURN_SWITCH' | 'SYNC_PROFILE' | 'START_GAME' | 'DICE_COMMIT' | 'DICE_REVEAL' | 'DICE_REVEAL_SIGNAL';
export type GameIntentType = 'REQUEST_ROLL' | 'REQUEST_MOVE' | 'DICE_COMMIT' | 'DICE_REVEAL';

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
    afkStats: Record<PlayerColor, { isAutoPlaying: boolean; consecutiveTurns: number; totalTriggers: number; isKicked: boolean }>;
    idleWarning: { player: PlayerColor; timeLeft: number } | null;
    participantPeers: Record<string, string>; // walletAddress -> peerId
    isStarted: boolean;
    lastUpdate: number;
    playerCount: '1v1' | '4P' | '2v2';
    lastAction?: { type: GameActionType; payload: any };
    initialBoardConfig?: {
        players: any[];
        colorCorner: any;
    };
}

// --- Lobby System Types ---

export interface LobbySlot {
    slotIndex: number;           // 0-3
    role: 'host' | 'teammate' | 'opponent';
    color: PlayerColor;
    status: 'empty' | 'invited' | 'joined';
    playerId?: string;           // wallet address
    playerName?: string;
    playerAvatar?: string;
    peerId?: string;             // PeerJS peer ID for this connection
}

export interface LobbyState {
    roomCode: string;
    hostId: string;
    matchType: '1v1' | '2v2' | '4P';
    gameMode: 'classic' | 'power';
    entryFee: number;
    slots: LobbySlot[];
    status: 'forming' | 'ready' | 'quickmatch' | 'starting';
    createdAt: number;
}

export interface InvitePayload {
    roomCode: string;
    hostName: string;
    hostAvatar?: string;
    matchType: '1v1' | '2v2' | '4P';
    gameMode: 'classic' | 'power';
    entryFee: number;
}

export type LobbyActionType =
    | 'LOBBY_SYNC'
    | 'LOBBY_JOIN'
    | 'LOBBY_LEAVE'
    | 'LOBBY_SWAP'
    | 'LOBBY_KICK'
    | 'LOBBY_QUICKMATCH_START'
    | 'LOBBY_QUICKMATCH_FOUND'
    | 'INVITE_SEND'
    | 'INVITE_ACCEPT'
    | 'INVITE_REJECT';
