# Hybrid TeamUp Deployment Guide

This document outlines the infrastructure and configuration required to deploy the Ludo Hybrid TeamUp system (WebRTC + PeerJS).

## Architecture Overview

The system uses a hybrid approach to balance performance and reliability:
- **WebRTC (UDP) via Edge Server**: Used for low-latency matchmaking, entry fee validation, and initial peer negotiation.
- **PeerJS (P2P)**: Used for game state synchronization and turn-based logic.
- **Supabase**: Used for persistent storage, user profiles, and fallback signaling.

## Infrastructure Requirements

### 1. Edge Server (Signaling & Validation)
You need to deploy a WebRTC-compatible signaling server that supports the `Matchmaking` protocol.
- **Recommendation**: Node.js + `ws` + `node-datachannel` (or similar).
- **Endpoint**: Set `NEXT_PUBLIC_EDGE_SERVER_URL` in your environment variables.
- **Role**: Validates user tokens, manages the matchmaking queue, and generates `validationTokens` for peers.

### 2. PeerJS Server
While PeerJS works P2P, a relay server (TURN/STUN) is required for NAT traversal.
- **Recommendation**: Use PeerJS Cloud or host your own `peerjs-server`.
- **STUN/TURN**: Add your TURN server credentials to `lib/teamup/edge-server-client.ts` or via environment variables.

## Environment Variables

Add the following to your `.env.production`:

```bash
# Edge Server for Matchmaking
NEXT_PUBLIC_EDGE_SERVER_URL=wss://your-edge-server.com

# Optional: Custom STUN/TURN servers (comma separated)
NEXT_PUBLIC_STUN_SERVERS=stun:stun.l.google.com:19302,turn:your-turn-server.com
```

## Security & Anti-Cheat

1. **Commit-Reveal Dice**: Cryptographically ensures the host cannot manipulate dice rolls.
2. **Server-Validated Entry**: The Edge Server verifies that players have enough balance before matching.
3. **Validation Tokens**: The `TeamUpContext` verifies that every connecting peer has been authorized by the Edge Server.

## Verification

To verify the deployment:
1. Ensure the Edge Server is reachable.
2. Monitor the `CompetitiveGameWrapper` UI for the "Verified Competitive Session" badge.
3. Check browser console for "🛡️ Verifying guest validation token..." messages.
