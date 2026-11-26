/**
 * Room Error Codes & Disconnect Taxonomy
 * Standardized error surface for MatchRoom Durable Object, netcode transports, and telemetry.
 * Parity with Ludo World network error classification (§10.16 & ADR-03).
 */

export enum DisconnectReason {
  SOCKET_NULL = 'WS_IS_NULL',              // 3000: WebSocket failed instantiation
  NET_DOWN = 'NET_NOT_CONNECTED',          // 3001: Device offline / navigator.onLine false
  HEARTBEAT_TIMEOUT = 'HEARTBEAT_TIMEOUT', // 3002: Ping unacknowledged > 60 s
  SERVER_CLOSED = 'SERVER_TERMINATED',     // 3003: Durable Object eviction / restart
  NETWORK_SWITCH = 'NETWORK_CHANGED',      // 3004: IP/interface change (WiFi -> Cellular)
  INTENT_TIMEOUT = 'INTENT_TIMEOUT',       // 3005: Room intent uncommitted > 10 s
  AUTH_EXPIRED = 'AUTH_EXPIRED',           // 3006: Match/app session expired or rejected
  PROTOCOL_MISMATCH = 'PROTOCOL_MISMATCH', // 3007: Client/server protocol version mismatch
  CLIENT_DISCONNECT = 'CLIENT_DISCONNECT', // 3008: Intentional client disconnect
}

export const ROOM_ERROR_CODES = [
  'POWER_ARMED',
  'POWER_REFUSED',
  'ILLEGAL_MOVE',
  'ILLEGAL_ACTION',
  'INVALID_MOVE',
  'ALREADY_ROLLED',
  'NOT_ROLLED',
  'MATCH_FINISHED',
  'ROOM_NOT_READY',
  'NOT_YOUR_TURN',
  'THREE_SIXES',
  'RATE_LIMITED',
  'UNKNOWN_INTENT',
  'NOT_AUTHORIZED',
  'SPECTATOR_READ_ONLY',
  'TICKET_INVALID',
  'SESSION_EXPIRED',
  'SEAT_TAKEN',
  'NOT_IN_MATCH',
  'MALFORMED_FRAME',
  'UNKNOWN_FRAME_TYPE',
  'FRAME_TOO_LARGE',
  'PROTOCOL_MISMATCH',
  'INTERNAL_ERROR',
  'ROOM_UNAVAILABLE',
  'NO_ROOM',
  'INTENT_TIMEOUT',
  'SOCKET_CLOSED',
  'ROOM_INTENT_FAILED',
] as const;

export type RoomErrorCode = (typeof ROOM_ERROR_CODES)[number];

export class RoomError extends Error {
  readonly code: RoomErrorCode;
  readonly reason: string;
  readonly seq?: number;
  readonly intentId?: string;
  readonly roomInstance?: string;

  constructor(
    code: RoomErrorCode,
    reason: string,
    opts?: { seq?: number; intentId?: string; roomInstance?: string },
  ) {
    super(`[${code}] ${reason}`);
    this.name = 'RoomError';
    this.code = code;
    this.reason = reason;
    this.seq = opts?.seq;
    this.intentId = opts?.intentId;
    this.roomInstance = opts?.roomInstance;
    Object.setPrototypeOf(this, RoomError.prototype);
  }
}

export function isRoomError(err: unknown): err is RoomError {
  return (
    err instanceof RoomError ||
    (err instanceof Error &&
      err.name === 'RoomError' &&
      typeof (err as Partial<RoomError>).code === 'string' &&
      typeof (err as Partial<RoomError>).reason === 'string')
  );
}

export type RoomIntentResult<T = unknown> =
  | { ok: true; data?: T; roomInstance?: string }
  | {
      ok: false;
      code: RoomErrorCode;
      error: string;
      seq?: number;
      roomInstance?: string;
      data: {
        code: RoomErrorCode;
        error: string;
        seq?: number;
        roomInstance?: string;
      };
    };

export interface RoomErrorResponse {
  ok: false;
  code: RoomErrorCode | string;
  error: string;
  seq?: number;
  intentId?: string;
  roomInstance?: string;
}
