/**
 * MatchRoom — Durable Object stub for the P0 spike.
 *
 * This is a skeleton proving the integration path (custom worker entry,
 * hibernatable WebSockets, alarms, SQLite storage) inside an OpenNext app.
 * It is NOT the production room — that ships in P3.
 *
 * P0 spike criteria it must satisfy:
 *   1. Exported from src/worker.ts alongside the OpenNext handler
 *   2. Reachable via /api/room/:id/ws (bypasses Next handler)
 *   3. Hibernatable sockets (state.acceptWebSocket)
 *   4. Alarm fires on schedule and is observable
 *   5. Existing 47 routes still work through openNextHandler.fetch
 *
 * See: docs/planning/SERVER_AUTHORITY_MIGRATION_PLAN.md §4.4, §5-P0
 */
import { DurableObject } from 'cloudflare:workers';

interface Env {
  MATCH_ROOM: DurableObjectNamespace<MatchRoom>;
}

export class MatchRoom extends DurableObject<Env> {
  /**
   * Handle HTTP requests routed to this DO. The only expected request is
   * a WebSocket upgrade on /api/room/:id/ws.
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // WebSocket upgrade
    if (url.pathname.endsWith('/ws')) {
      const upgradeHeader = request.headers.get('Upgrade');
      if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
        return new Response('Expected WebSocket upgrade', { status: 426 });
      }

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      // Use the hibernation API — the DO can be evicted while idle and
      // will be woken on the next incoming message.
      this.ctx.acceptWebSocket(server);

      // Schedule an alarm to prove timer capability (P0 criterion 4).
      // In the production room this becomes the timer min-heap scheduler.
      const existing = await this.ctx.storage.getAlarm();
      if (!existing) {
        await this.ctx.storage.setAlarm(Date.now() + 30_000); // 30s
      }

      return new Response(null, { status: 101, webSocket: client });
    }

    // Health / info endpoint for the spike verification
    if (url.pathname.endsWith('/info')) {
      const alarm = await this.ctx.storage.getAlarm();
      const alarmFired = (await this.ctx.storage.get<number>('alarmFiredAt')) ?? null;
      return Response.json({
        ok: true,
        sockets: this.ctx.getWebSockets().length,
        alarmScheduled: alarm,
        alarmFiredAt: alarmFired,
      });
    }

    return new Response('Not found', { status: 404 });
  }

  /**
   * Hibernation API — called when a WebSocket message arrives while the
   * DO may have been idle. This proves hibernation works (P0 criterion 3).
   */
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    // Echo back for the spike test
    const text = typeof message === 'string' ? message : new TextDecoder().decode(message);
    try {
      const parsed = JSON.parse(text);
      if (parsed.t === 'ping') {
        ws.send(JSON.stringify({ t: 'pong', ts: Date.now() }));
        return;
      }
    } catch {
      // Not JSON — echo raw
    }
    ws.send(JSON.stringify({ t: 'echo', payload: text, ts: Date.now() }));
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    ws.close(code, reason);
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    console.error('[MatchRoom] WebSocket error:', error);
    ws.close(1011, 'Internal error');
  }

  /**
   * Alarm handler — proves the DO can schedule and fire timers
   * (P0 criterion 4). In the production room, this drains the timer
   * min-heap and reschedules.
   */
  async alarm(): Promise<void> {
    const now = Date.now();
    await this.ctx.storage.put('alarmFiredAt', now);

    // Broadcast to all connected sockets
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(JSON.stringify({ t: 'timer', kind: 'alarm', firedAt: now }));
      } catch {
        // Socket may be closed
      }
    }
  }
}
