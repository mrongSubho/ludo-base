/**
 * Local Development WebSocket Sidecar Server (Option B)
 *
 * Emulates Cloudflare Durable Object MatchRoom frames during local development:
 * - Listens for WebSocket upgrades at `/api/room/:matchId/ws`
 * - Maintains in-memory room connections, sequence counter, and frame ordering
 * - Broadcasts ordered state to all connected room sockets
 *
 * Run with: `npx tsx scripts/dev-room-server.ts`
 * Set `NEXT_PUBLIC_ROOM_WS_URL=ws://localhost:8787/api/room/:matchId/ws`
 *
 * See docs/dev/LOCAL_DEVELOPMENT.md and docs/planning/SERVER_AUTHORITY_MIGRATION_PLAN.md §4.13
 */

import http from 'node:http';
import WebSocket from 'ws';

const PORT = Number(process.env.ROOM_DEV_PORT || 8787);

interface RoomSocketMeta {
  matchId: string;
  role: 'seat' | 'spectator';
  seatColor?: string;
  wallet?: string;
}

interface RoomState {
  matchId: string;
  seq: number;
  state: Record<string, unknown>;
  sockets: Set<WebSocket>;
}

const rooms = new Map<string, RoomState>();
const socketMeta = new WeakMap<WebSocket, RoomSocketMeta>();

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Ludo Base Dev Match Room Sidecar running.\n');
});

const wss = new WebSocket.Server({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const match = url.pathname.match(/^\/api\/room\/([^/]+)\/ws$/);

  if (!match) {
    socket.destroy();
    return;
  }

  const matchId = decodeURIComponent(match[1]);

  wss.handleUpgrade(req, socket as unknown as import('node:net').Socket, head, (ws: WebSocket) => {
    wss.emit('connection', ws, req, matchId);
  });
});

wss.on('connection', (ws: WebSocket, _req: http.IncomingMessage, matchId: string) => {
  let room = rooms.get(matchId);
  if (!room) {
    room = {
      matchId,
      seq: 0,
      state: {},
      sockets: new Set(),
    };
    rooms.set(matchId, room);
  }

  room.sockets.add(ws);
  socketMeta.set(ws, {
    matchId,
    role: 'spectator',
  });

  ws.on('message', (raw: Buffer | ArrayBuffer | Buffer[]) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    const currentRoom = rooms.get(matchId);
    if (!currentRoom) return;

    if (msg.t === 'join') {
      const meta = socketMeta.get(ws);
      if (meta) {
        meta.role = 'seat';
        meta.seatColor = (msg.seat as string) || 'red';
      }
      ws.send(
        JSON.stringify({
          t: 'joined',
          role: meta?.role || 'seat',
          seat: meta?.seatColor || 'red',
          seq: currentRoom.seq,
          state: currentRoom.state,
        })
      );
      return;
    }

    if (msg.t === 'ping') {
      ws.send(JSON.stringify({ t: 'pong' }));
      return;
    }

    if (msg.t === 'intent') {
      const intentId = msg.intentId as string;
      const kind = msg.kind as string;
      const payload = (msg.payload as Record<string, unknown>) || {};

      currentRoom.seq++;

      // Acknowledge intent to sender
      ws.send(
        JSON.stringify({
          t: 'intent_ack',
          intentId,
          ok: true,
          data: { seq: currentRoom.seq, kind, payload },
        })
      );

      // Fan out state update
      const stateBroadcast = JSON.stringify({
        t: 'state',
        seq: currentRoom.seq,
        state: currentRoom.state,
        lastIntentId: intentId,
      });

      for (const client of currentRoom.sockets) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(stateBroadcast);
        }
      }
    }
  });

  ws.on('close', () => {
    const currentRoom = rooms.get(matchId);
    if (currentRoom) {
      currentRoom.sockets.delete(ws);
      if (currentRoom.sockets.size === 0) {
        // Keep room around briefly for reconnection
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`[Dev Room Server] Listening at ws://localhost:${PORT}/api/room/:matchId/ws`);
});
