# Deploying Edge Server to Render

Since Render is your chosen provider, follow these steps to get your **Matchmaking Edge Server** live.

## Step 1: Create a New Repository
Do **NOT** put the server code inside your current `ludo-base` frontend repo. Create a new, empty repository on GitHub (e.g., `ludo-edge-server`).

## Step 2: Minimal Server Code
In your new repository, create these two files:

### `package.json`
```json
{
  "name": "ludo-edge-server",
  "version": "1.0.0",
  "main": "index.js",
  "scripts": {
    "start": "node index.js"
  },
  "dependencies": {
    "ws": "^8.16.0",
    "@supabase/supabase-js": "^2.39.7"
  }
}
```

### `index.js` (Basic Template)
```javascript
const WebSocket = require('ws');
const port = process.env.PORT || 8080;

const wss = new WebSocket.Server({ port }, () => {
    console.log(`🚀 Edge Server running on port ${port}`);
});

wss.on('connection', (ws) => {
    console.log('New client connected');
    
    ws.on('message', (message) => {
        const data = JSON.parse(message);
        // Implement your matchmaking logic here
        console.log('Received:', data);
    });

    ws.on('close', () => console.log('Client disconnected'));
});
```

## Step 3: Deploy to Render
1. Go to [Render Dashboard](https://dashboard.render.com/).
2. Click **New +** -> **Web Service**.
3. Connect your `ludo-edge-server` GitHub repo.
4. **Settings**:
   - **Environment**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Free

## Step 4: Environment Variables
In the Render dashboard for your service, go to **Environment** and add:
- `SUPABASE_URL`: Your Supabase URL.
- `SUPABASE_SERVICE_ROLE_KEY`: Your secret admin key (keep this secret!).

## Step 5: Critical Fix (Keep-Alive)
Render Free Tier sleeps after 15 minutes. To prevent players from waiting:
1. Go to [Cron-job.org](https://cron-job.org/).
2. Create a free account.
3. Set a job to "ping" your Render URL (e.g., `https://your-app.onrender.com`) every 10 minutes.

## Step 6: Connect your Ludo App
In your `ludo-base` project, update your `.env.local`:
```bash
NEXT_PUBLIC_EDGE_SERVER_URL=wss://your-app.onrender.com
```
*(Note: Use `wss://` for secure WebSockets on Render)*.
