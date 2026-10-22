/**
 * MatchRoom — the Durable Object binding for a match.
 *
 * This file is deliberately tiny: it exists only to attach the Workers runtime
 * (`DurableObject` from `cloudflare:workers`) to the behaviour in
 * `MatchRoomCore`. All logic lives in the core, which has no Workers dependency
 * and can therefore be constructed in a plain Node test.
 *
 * Why the split: `cloudflare:workers` is an ESM bare specifier that neither
 * `tsx` nor Node can resolve. The S3 two-client gate used to import this file
 * directly and shim the specifier by patching `Module.prototype.require` — which
 * can never intercept an ESM import, so the gate died at `MatchRoom is not a
 * constructor` and verified nothing. Importing the core instead makes the gate
 * real.
 *
 * Do not add behaviour here. If something needs to run, it belongs in the core.
 */
import { DurableObject } from 'cloudflare:workers';
import { MatchRoomCore } from './MatchRoomCore';
import type { RoomEnv } from './MatchRoomCore';
import type { RateLimitDO } from '../rateLimit/RateLimitDO';

export { MatchRoomCore } from './MatchRoomCore';
export type { RoomEnv, ScheduledTimer } from './MatchRoomCore';

/** The Worker's bindings. The core only needs the Supabase subset (`RoomEnv`). */
export interface Env extends RoomEnv {
  MATCH_ROOM: DurableObjectNamespace<MatchRoom>;
  RATE_LIMITER?: DurableObjectNamespace<RateLimitDO>;
}

export class MatchRoom extends DurableObject<Env> {
  private readonly core: MatchRoomCore;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.core = new MatchRoomCore(ctx, env);
  }

  fetch(request: Request): Promise<Response> {
    return this.core.fetch(request);
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    return this.core.webSocketMessage(ws, message);
  }

  webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    return this.core.webSocketClose(ws, code, reason);
  }

  webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    return this.core.webSocketError(ws, error);
  }

  alarm(): Promise<void> {
    return this.core.alarm();
  }
}
