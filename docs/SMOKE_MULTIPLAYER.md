# Multiplayer smoke-test checklist

Run after networking/security changes. Use **two browsers** (or normal + private window) with two wallets, plus one offline bot match.

Env: `npm run dev` → `http://localhost:3000`. Confirm `.env.local` has Supabase + wallet project IDs.

---

## A. Offline / bot multiplayer

| # | Step | Pass |
|---|------|------|
| A1 | Dashboard → Offline / vs Bots → Classic 4P → Play | |
| A2 | Confirm board seats you + bots; dice rolls | |
| A3 | Roll until a forced auto-move (all tokens home + 6) | |
| A4 | Let a bot take a full turn (roll → move) | |
| A5 | Power mode: land on a hidden tile → inventory badge appears | |
| A6 | Win a short bot match (or force via 3 sixes turn-pass sanity) | |
| A7 | `npm test` green (engine unit tests) | |

---

## B. Invite lobby (room secret)

| # | Step | Pass |
|---|------|------|
| B1 | Wallet A: Team Up → Host 1v1/2v2/4P | |
| B2 | Copy invite link — URL must include `?room=CODE&s=<secret>` | |
| B3 | Wallet B (clean profile): open link → joins and gets a seat | |
| B4 | Wallet C: open **room code only** (strip `s=`) → **rejected** (connection closed / not seated) | |
| B5 | Friend invite (Supabase `game_invites`): B accepts toast → joins with token | |
| B6 | Host Start Match when seats full → both enter board | |
| B7 | Guest rolls/moves; host sees state; guest sees host broadcasts | |

---

## C. Hybrid fill (public pool)

| # | Step | Pass |
|---|------|------|
| C1 | Host a 4P lobby with empty seats | |
| C2 | **Fill Remaining with Quick Match** | |
| C3 | Wallet B starts a public Quick Match (same mode/type) | |
| C4 | B lands in host room (not “rejected for secret”) | |
| C5 | Host cancel hunt returns to invite roster | |
| C6 | Edge HUD / logs show join, not silent stall | |

---

## D. Full matchmaking (non-hybrid)

| # | Step | Pass |
|---|------|------|
| D1 | Both wallets: same mode/type/wager Quick Match | |
| D2 | Match found → room + validation token path | |
| D3 | Guest `SYNC_PROFILE` with token → seated | |
| D4 | Wrong/missing token (if host required) → join fails | |
| D5 | Both play one turn each | |

---

## E. Dual-path intents + Edge RNG

| # | Step | Pass |
|---|------|------|
| E1 | Networked human roll: Network tab → `roll-dice` 200 with `result` 1–6 and `rollId` | |
| E1b | Replay same `actionId` → same face (`replay: true`) | |
| E1c | Dashboard: `match_rolls` row for the match | |
| E2 | Block PeerJS (devtools offline for peer host is hard) **or** kill peer briefly — guest still rolls via Supabase `GAME_INTENT` | |
| E3 | Host log: intent applied once (`processedIntentIds`) — no double move | |
| E4 | Bot turn in networked match: also hits `roll-dice` (no local-only face) | |
| E5 | Edge failure (bad URL): roll aborts, UI unlocks, no `Math.random` face | |
| E6 | AFK strike: idle 15s → auto-play; networked AFK uses Edge | |

---

## F. Settlement (if streaming/betting enabled)

| # | Step | Pass |
|---|------|------|
| F1 | Host STREAM MATCH → `live_matches.host_address` set | |
| F2 | Win match → wallet **sign** prompt for `/api/match/record` | |
| F3 | API 200; second identical record → 409 already settled | |
| F4 | Unsigned POST to `/api/match/record` → 401 | |
| F5 | Spectator resolve without host signature → Edge 403 | |

---

## G. DMs (ECDH)

| # | Step | Pass |
|---|------|------|
| G1 | Both wallets open app once (publish `ecdh_pubkey`) | |
| G2 | A messages B → B decrypts plaintext | |
| G3 | New wallet D who never loaded chat: A → D fails closed, retryable | |
| G4 | After D opens app, retry succeeds | |

---

## H. Regression

| # | Step | Pass |
|---|------|------|
| H1 | `npm test` | |
| H2 | `npx tsc -p tsconfig.json --noEmit` → **0 errors** | |
| H3 | `npm run build` succeeds (typescript gate on) | |
| H4 | Theme switch + token style still apply | |

---

### Notes for testers

- Use **two funded/test wallets**; do not reuse the same browser profile.
- Room secret is **not** sent on `LOBBY_SYNC` — only via invite link / `game_invites.validation_token`.
- Hybrid fill intentionally calls `allowOpenJoins()` — public pool guests do not need `?s=`.
- Live-chat “join room” announce still has **no** secret (discovery path); treat as open while announced.

*Last updated with `dc9942e` + typedown slice.*
