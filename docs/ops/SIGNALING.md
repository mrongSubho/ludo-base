# Signaling ownership spike (N0)

| Field | Value |
| --- | --- |
| **Status** | Spike notes — 2026-09-23 |
| **Decision** | **Stay on PeerJS with npm-pinned client; no CDN.** Self-hosted PeerServer is an **opt-in** via env, not required for un-park. |
| **Code** | `lib/peerFactory.ts` · `lib/netcode/resyncProof.ts` · Edge `move-auth` `resync` |

## What shipped in this spike

1. **No `esm.sh` PeerJS in the prod path** — `createPeerInstance` loads `peerjs@1.5.5` from `package.json` only (Turbopack-safe single entry).
2. **Optional self-hosted signaling** — `NEXT_PUBLIC_PEERJS_{HOST,PORT,PATH,KEY,SECURE}` → PeerServer. Empty → peerjs.com cloud.
3. **Resync auth (N0)** — player resume uses `action: resync` + match-session proof (`sessionId` + `actor`); Edge `verifyMatchSession` before snapshot. Public `get` remains for spectators / cold start.

## Options considered

| Option | p95 / reconnect | Ops cost | Verdict |
| --- | --- | --- | --- |
| **A. PeerJS cloud (npm client)** | Good enough for turn-based | Zero | **Default now** |
| **B. Self-hosted PeerServer** | Same client; own TLS/region | Small VPS + updates | Optional via env |
| **C. Realtime-only signaling (drop PeerJS)** | Supabase already dual-path | Lowest | Later, if Peer cloud flaps in N3 live drills |

## Measurement plan (when two devices are free)

- Join time (peer `open`) p50/p95  
- Reconnect success within 10s (D1)  
- Intent delivery when Peer down (D2 dual-path)  
- If Peer cloud fails D1–D3 in `UNPARK_DECISION` §1.2 → flip env to self-hosted PeerServer or evaluate option C.

## Resync contract (player)

```json
{ "action": "resync", "matchId": "…", "sessionId": "…", "actor": "0x…", "sinceSeq": 12 }
```

- **401** `SESSION_EXPIRED` — no unauthenticated player resume  
- **404** `MATCH_NOT_FOUND`  
- Spectators continue to use `GET /api/match/state` (board-only, world-readable)

## Follow-ups

- [ ] Two-client D1–D3 numbers under option A (un-park gate)  
- [ ] Optional PeerServer deploy if cloud fails  
- [ ] Consider Realtime-only (option C) only after measured Peer pain — not before un-park  
