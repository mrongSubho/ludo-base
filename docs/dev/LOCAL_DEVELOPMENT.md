# Local Development & Room WebSocket Architecture

> **Server Authority Migration — Local Dev Story (P0 Deliverable per §4.13)**

In production, Ludo Base match rooms run as Cloudflare Durable Objects routed through `src/worker.ts`.
However, `npm run dev` runs Next.js (Turbopack) on `http://localhost:3000`, which has no knowledge of workerd or Durable Objects.

To prevent 404s when connecting to `/api/room/:matchId/ws` in local development, three modes are supported:

| Mode | Configuration | Use Case |
|---|---|---|
| **Option A: Staging DO Tunnel (Default for networked dev)** | Set `NEXT_PUBLIC_ROOM_WS_URL=wss://staging.ludobase.com/api/room` in `.env.local` | Full multiplayer room testing against real Cloudflare Durable Objects while running UI and Next.js locally |
| **Option B: Dev WS Sidecar** | Run `npx tsx scripts/dev-room-server.ts` on port 8787 and set `NEXT_PUBLIC_ROOM_WS_URL=ws://localhost:8787/api/room` | Offline protocol development without needing an internet connection or staging deployment |
| **Option C: Offline Pass-and-Play** | Leave `ROOM_V2=0` (or `SAM_ROOM_V2=0`) | Local pass-and-play and legacy PeerJS paths; no room WebSocket required |

### Environment Variable Contract

```bash
# .env.local (optional in local dev)
NEXT_PUBLIC_ROOM_WS_URL=wss://staging.ludobase.com/api/room
```

When `NEXT_PUBLIC_ROOM_WS_URL` is unset in browser environments, the client defaults to `window.location.origin.replace(/^http/, 'ws') + '/api/room'`.
In production on Cloudflare, `src/worker.ts` intercepts `/api/room/:matchId/ws` and upgrades directly to `MATCH_ROOM`.
