/**
 * MatchRoom Wire Protocol v1 — versioning, frame size cap, rate limit, reconnect constants,
 * and Durable Object instance identity formatting.
 */
import type { GameState } from './types';
import type { RoomErrorCode } from './roomCodes';

export const ROOM_PROTOCOL_VERSION = 1 as const;
export const MAX_ROOM_FRAME_BYTES = 32 * 1024;

export const ROOM_INTENT_RATE_LIMIT = {
  maxIntents: 8,
  windowMs: 2_000,
} as const;

export const ROOM_RECONNECT_CONFIG = {
  baseDelayMs: 3_000,
  maxAttempts: 10,
  maxDelayMs: 12_000,
  pingIntervalMs: 25_000,
  pongTimeoutMs: 60_000,
} as const;

export function isSupportedProtocolVersion(v: unknown): boolean {
  return v === undefined || v === ROOM_PROTOCOL_VERSION;
}

export function formatRoomInstance(doId: string | undefined, bootId: string): string {
  return `${(doId || 'local').slice(0, 12)}:${bootId.slice(0, 8)}`;
}

const utf8Encoder = new TextEncoder();

export function utf8ByteLength(input: string | ArrayBuffer): number {
  if (input instanceof ArrayBuffer) return input.byteLength;
  return utf8Encoder.encode(input).byteLength;
}

export interface RoomTimerFrame {
  v: number;
  roomInstance: string;
  t: 'timer';
  timerId: string;
  kind: string;
  deadlineAt: number;
  remainingMs: number;
}

export interface RoomJoinedFrame {
  v: number;
  roomInstance: string;
  t: 'joined';
  role: 'seat' | 'spectator';
  seat: string | null;
  wallet: string | null;
  seq: number;
  hasState: boolean;
  state?: GameState;
}

export interface RoomStateFrame {
  v: number;
  roomInstance: string;
  t: 'state';
  seq: number;
  state: GameState;
  source: string;
  deadlineAt: number | null;
  lastIntentId?: string;
  resync?: boolean;
}

export interface RoomIntentAckFrame {
  v: number;
  roomInstance: string;
  t: 'intent_ack';
  intentId: string;
  ok?: boolean;
  data: {
    seq: number;
    roomInstance: string;
    noop?: boolean;
  };
}

export interface RoomRejectedFrame {
  v: number;
  roomInstance: string;
  t: 'rejected';
  intentId?: string;
  code: RoomErrorCode;
  error: string;
  seq?: number;
}

export interface RoomSyncNeededFrame {
  v: number;
  roomInstance: string;
  t: 'sync_needed';
  serverSeq: number;
  clientSeq: number;
}
