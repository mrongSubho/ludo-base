# Edge Server Technical Specifications

The Edge Server is the backbone of the **Competitive Hybrid Flow**. It handles low-latency matchmaking via WebRTC and ensures competitive integrity.

## Core Responsibilities

### 1. Matchmaking Queue (WebSocket)
- **Endpoint**: `wss://your-edge-server.com`
- **Logic**:
    - Manage a pool of connected clients.
    - Group players based on: `matchType` (1v1, 4P), `gameMode` (Classic, Power), and `wager` (Entry Fee).
    - Use a FIFO queue or skill-based matching if available.

### 2. Wager Validation (Supabase Integration)
- **Action**: Before placing a player in the queue, the server MUST verify their profile.
- **Verification**: 
    - Query Supabase: `profiles` table -> `balance`.
    - Ensure `balance >= wager`.
    - (Optional) Lock the wager amount so they can't spend it during matchmaking.

### 3. WebRTC Signaling (Handshake)
Once a match is found (e.g., 2 players in a 1v1 classic room with 100 wager):
- The server acts as a **Signaling Relay**.
- Exchange **SDP Offers/Answers** and **ICE Candidates** between the peers.
- Facilitate the opening of the `matchmaking-channel` (WebRTC DataChannel).

### 4. Validation Token (Security)
- **Token Generation**: When a match is successful, generate a unique `validationToken`.
- **Purpose**: This token is sent to all peers in the match. When they connect to each other via PeerJS, they exchange this token to prove they were matched by the official Edge Server.
- **Structure**: A JWT or a cryptographically signed JSON object containing `roomId`, `playerIds`, and `timestamp`.

## Suggested Implementation (Node.js)

```javascript
const WebSocket = require('ws');
const { RTCPeerConnection } = require('node-datachannel');

const wss = new WebSocket.Server({ port: 8080 });

wss.on('connection', (ws) => {
  ws.on('message', (message) => {
    const data = JSON.parse(message);
    
    // 1. JOIN_QUEUE
    if (data.type === 'JOIN_QUEUE') {
      // Validate wager via Supabase Admin API
      // If valid, add to internal queue map: [wager][gameMode][matchType]
    }
    
    // 2. SIGNALING (Once matched)
    if (data.type === 'SIGNAL') {
      // Forward SDP/ICE to target peer
    }
  });
});
```

## Next Steps for You
1. **Choose a Hosting Provider**: DigitalOcean, AWS, or Vercel Edge Functions (if using a WebRTC-compatible runtime).
2. **Setup Supabase Admin**: Use the Service Role Key on the server to check user balances securely.
3. **Configure STUN/TURN**: Essential for players behind strict firewalls/NATs.
