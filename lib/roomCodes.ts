/**
 * Room Error Codes & Disconnect Taxonomy
 * Standardized error surface for MatchRoom Durable Object, netcode transports, and telemetry.
 * Parity with Ludo World network error classification (§10.16 & ADR-03).
 */

export enum DisconnectReason {
  SOCKET_NULL = 'WS_IS_NULL',              // 3000: WebSocket failed instantiation
  NET_DOWN = 'NET_NOT_CONNECTED',          // 3001: Device offline / navigator.onLine false
  HEARTBEAT_TIMEOUT = 'HEARTBEAT_TIMEOUT',  // 3002: Ping unacknowledged > 60 s
  SERVER_CLOSED = 'SERVER_TERMINATED',      // 3003: Durable Object eviction / restart
  NETWORK_SWITCH = 'NETWORK_CHANGED',       // 3004: IP/interface change (WiFi -> Cellular)
  INTENT_TIMEOUT = 'INTENT_TIMEOUT',        // 3005: Room intent uncommitted > 10 s
}

export type RoomErrorCode =
  | 'MALFORMED_FRAME'
  | 'NOT_AUTHORIZED'
  | 'UNKNOWN_FRAME_TYPE'
  | 'INTERNAL_ERROR'
  | 'ROOM_UNAVAILABLE'
  | 'ILLEGAL_ACTION'
  | 'NOT_YOUR_TURN'
  | 'ROOM_NOT_READY'
  | 'THREE_SIXES'
  | 'NOT_IN_MATCH'
  | 'MATCH_FINISHED'
  | 'UNKNOWN_INTENT'
  | 'INVALID_MOVE'
  | 'RATE_LIMITED'
  | 'SEAT_TAKEN'
  | 'TICKET_INVALID';

export interface RoomErrorResponse {
  ok: false;
  code: RoomErrorCode | string;
  error: string;
  seq?: number;
  intentId?: string;
}
