# Edge Server Matchmaking Logic (index.js)

Copy this code into your `index.js` file in your **ludo-edge-server** repository. This implementation handles real-time matchmaking, wager verification via Supabase, and room allocation.

```javascript
const http = require('http');
const WebSocket = require('ws');
const { createClient } = require('@supabase/supabase-js');

// --- Configuration ---
const port = process.env.PORT || 8080;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('❌ Missing Supabase Environment Variables!');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// --- Matchmaking State ---
// Structure: pools[wager][matchType][gameMode] = [ { playerId, ws, requestId }, ... ]
const pools = {};

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Ludo Edge Server: Online 🚀');
});

const wss = new WebSocket.Server({ server });

// --- Helper: Get/Create Pool ---
function getPool(wager, matchType, gameMode) {
    if (!pools[wager]) pools[wager] = {};
    if (!pools[wager][matchType]) pools[wager][matchType] = {};
    if (!pools[wager][matchType][gameMode]) pools[wager][matchType][gameMode] = [];
    return pools[wager][matchType][gameMode];
}

// --- Helper: Find and Remove Player from all pools ---
function removePlayer(playerId) {
    for (const wager in pools) {
        for (const type in pools[wager]) {
            for (const mode in pools[wager][type]) {
                pools[wager][type][mode] = pools[wager][type][mode].filter(p => p.playerId !== playerId);
            }
        }
    }
}

wss.on('connection', (ws) => {
    let currentPlayerId = null;

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            const { type, requestId, playerId, entryFee, matchType, mode } = data;

            if (type === 'find_match') {
                currentPlayerId = playerId;
                const wager = entryFee || 0;

                console.log(`🔍 Player ${playerId} searching for ${matchType} ${mode} (Wager: ${wager})`);

                // 1. Validate Wager via Supabase
                const { data: profile, error } = await supabase
                    .from('profiles')
                    .select('balance, username')
                    .eq('id', playerId)
                    .single();

                if (error || !profile || profile.balance < wager) {
                    return ws.send(JSON.stringify({
                        type: 'match_error',
                        requestId,
                        message: 'Insufficient balance or profile not found.'
                    }));
                }

                // 2. Add to Pool
                removePlayer(playerId); // Clean up any old sessions
                const pool = getPool(wager, matchType, mode);
                pool.push({
                    playerId,
                    username: profile.username || 'Guest',
                    ws,
                    requestId
                });

                // 3. Matchmaking Algorithm (Simplified: Exact Match)
                const playersNeeded = matchType === '1v1' ? 2 : 4;
                if (pool.length >= playersNeeded) {
                    const participants = pool.splice(0, playersNeeded);
                    const matchId = `match_${Math.random().toString(36).substring(2, 10)}`;
                    const validationToken = `v_${Math.random().toString(36).substring(2, 20)}`;

                    console.log(`🎉 Match Found! ID: ${matchId}`);

                    // Notify all participants
                    participants.forEach((p, index) => {
                        p.ws.send(JSON.stringify({
                            type: 'match_found',
                            requestId: p.requestId,
                            data: {
                                matchId,
                                validationToken,
                                serverTimestamp: Date.now(),
                                players: participants.map(part => ({
                                    id: part.playerId,
                                    name: part.username,
                                    skillLevel: 0 // Mocked for now
                                })),
                                gameConfig: {
                                    mode,
                                    matchType,
                                    wager
                                }
                            }
                        }));
                    });
                }
            }
        } catch (e) {
            console.error('❌ Message Error:', e);
        }
    });

    ws.on('close', () => {
        if (currentPlayerId) {
            console.log(`🚪 Player ${currentPlayerId} disconnected, removing from pools.`);
            removePlayer(currentPlayerId);
        }
    });
});

server.listen(port, () => {
    console.log(`🚀 Edge Server Listening on Port ${port}`);
});
```

### Deployment Checklist:
1. **GitHub**: Push this new code to your `ludo-edge-server` repository.
2. **Render**: It will auto-deploy. Check the logs for `🚀 Edge Server Listening on Port...`.
3. **Environment**: Ensure `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are still set in Render.
4. **Test**: Try searching for a match from two different browser windows in your Ludo app.
