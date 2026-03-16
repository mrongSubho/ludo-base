# Edge Server package.json

Copy this into the `package.json` file in your **ludo-edge-server** repository.

```json
{
  "name": "ludo-edge-server",
  "version": "1.0.0",
  "description": "Hybrid Matchmaking Edge Server for Ludo",
  "main": "index.js",
  "scripts": {
    "start": "node index.js",
    "dev": "node --watch index.js"
  },
  "keywords": [
    "ludo",
    "matchmaking",
    "webrtc",
    "websocket"
  ],
  "author": "",
  "license": "ISC",
  "dependencies": {
    "@supabase/supabase-js": "^2.39.7",
    "ws": "^8.16.0"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```
