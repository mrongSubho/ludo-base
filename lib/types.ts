export type PlayerColor = 'green' | 'red' | 'yellow' | 'blue';
export type PowerType = 'shield' | 'boost' | 'bomb' | 'warp';

export type GameActionType = 'ROLL_DICE' | 'MOVE_TOKEN' | 'SYNC_STATE' | 'TURN_SWITCH' | 'SYNC_PROFILE' | 'START_GAME' | 'DICE_COMMIT' | 'DICE_REVEAL' | 'DICE_REVEAL_SIGNAL' | 'BET_WINDOW_OPEN' | 'BET_WINDOW_CLOSED';
export type GameIntentType = 'REQUEST_ROLL' | 'REQUEST_MOVE' | 'DICE_COMMIT' | 'DICE_REVEAL';

// ─── Spectator & Betting Types ───
export type BetType = 'winner' | 'dice_roll' | 'elimination' | 'custom';

export interface BetWindowPayload {
    windowId: string;
    betType: BetType;
    expiresAt: number;           // epoch ms — spectators close UI at this time
    matchId?: string;
}

export interface BetWindowClosedPayload {
    windowId: string;
    windowClosedAt: string;      // ISO — bets after this are invalid server-side
}

export interface SpectatorBet {
    match_id: string;
    bet_type: BetType;
    bet_value: string;
    amount: number;
    odds?: number;
    potential_payout?: number;
    window_closed_at: string;    // snapshot from BET_WINDOW_CLOSED event
}


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
    matchId?: string;
    lastAction?: { type: GameActionType; payload: any };
    initialBoardConfig?: {
        players: any[];
        colorCorner: any;
    };
}

export interface StartGamePayload {
    initialBoardConfig: {
        players: any[]; // Add more specific type if possible
        colorCorner: any; // Add more specific type if possible
    };
    playerCount: '1v1' | '2v2' | '4P';
    isBotMatch: boolean;
    matchId?: string;
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
    invitedAt?: number;          // Timestamp for expiration
}

export interface LobbyState {
    roomCode: string;
    hostId: string;
    matchType: '1v1' | '2v2' | '4P';
    gameMode: 'classic' | 'power';
    entryFee: number;
    slots: LobbySlot[];
    status: 'forming' | 'ready' | 'quickmatch' | 'starting' | 'playing';
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
