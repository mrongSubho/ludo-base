This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-onchain`](https://www.npmjs.com/package/create-onchain).

**Ludo Base Superstar** is a Ludo-style board game built on [Base](https://base.org) (Coinbase L2). It's a Next.js app targeting both web and Farcaster Frame v2, with multiplayer Ludo, several game modes, dashboard, and social features.

- **Deployment**: [ludo-base.vercel.app](https://ludo-base.vercel.app)
- **Tech stack**: Next.js 16, React 19, Tailwind CSS 4, Framer Motion, PeerJS, OnchainKit

---

## Implementation Checklist

### ✅ Implemented

#### Core Game
- [x] **Classic Ludo** – Standard rules, 15×15 board, 4 tokens per player
- [x] **Power Ludo** – Power tiles, traps, shields, boost (partial logic)
- [x] **Snakes & Ladders** – 10×10 board, 8 ladders, 8 snakes
- [x] **Player modes** – 2, 4, or 2v2
- [x] **Bet selection UI** – 10, 25, 50, 100, 250 (UI only)
- [x] **Token movement** – Path, capture, safe squares
- [x] **Roll 6 to start** – Bonus roll on capture
- [x] **Win condition** – All 4 tokens home; 2v2 team win
- [x] **AI opponents** – Heuristic-based moves
- [x] **Turn timer** – 15s, 3 strikes → auto-play
- [x] **Overshoot feedback** – Shake animation

#### UI Components
- [x] **Board** – Classic/Power Ludo (15×15)
- [x] **SnakesBoard** – Snakes & Ladders variant
- [x] **Dice** – Roll animation
- [x] **ThemeSwitcher** – 4 themes (Pastel, Midnight, Cyberpunk, Classic)
- [x] **AudioToggle** – SFX and music controls

#### Dashboard & Panels
- [x] **Splash screen** – Mode selection
- [x] **Game config** – Mode, players, bet
- [x] **UserProfilePanel** – Avatar, name, win rate chart, stats, privacy
- [x] **FriendsPanel** – Game/Base friends, requests (mock data)
- [x] **Leaderboard** – Tier/Daily/Monthly, Global/Friends, 5 tiers
- [x] **MissionPanel** – Daily/weekly missions (mock)
- [x] **MarketplacePanel** – Themes, skins, dice (mock)
- [x] **PlayerProfileSheet** – In-game player popup (stats, add friend, DM, block)
- [x] **SettingsPanel** – Theme, sound, music, help, about
- [x] **MessagesPanel** – Placeholder ("No new messages")

#### Theming & Audio
- [x] **4 themes** – Pastel, Midnight, Cyberpunk, Classic
- [x] **Theme persistence** – `localStorage`
- [x] **SFX** – Move, capture, win, turn, strike (Web Audio API)
- [x] **Ambient music** – Per theme

#### Multiplayer & Blockchain
- [x] **PeerJS multiplayer** – Host/guest, state sync
- [x] **Farcaster Frame metadata** – Frame v2 support
- [x] **Base app metadata** – Chain config

#### UX & Polish
- [x] **Confetti on win**
- [x] **Quit-game confirmation**
- [x] **Hardware back button** – PWA-style
- [x] **Ladder/snake messages** – Snakes & Ladders

### ⏳ Not Implemented / Partial

#### Blockchain & Wallet
- [ ] **OnchainKit wired** – `RootProvider` not used in `layout.tsx`
- [ ] **Wallet connect UI**
- [ ] **Real bet/payment flow**

#### Assets
- [ ] **`/public/avatars/`** – FriendsPanel expects `/avatars/1.png`
- [ ] **`/public/backgrounds/`** – Pastel, midnight, cyberpunk, classic
- [ ] **`/public/og-image.png`**

#### Backend & Data
- [ ] **API routes**
- [ ] **Database** – Data is mock or `localStorage`
- [ ] **Real friends system**
- [ ] **Real missions and rewards**
- [ ] **Real marketplace purchases**

#### Game Logic
- [ ] **Power mode effects** – Shield, bomb, warp, etc. (UI/logic partial)

#### Multiplayer UX
- [ ] **Connect/share flow** – Multiplayer in code but not exposed in UI

#### Quality & Docs
- [ ] **Tests** – No test files
- [ ] **README** – Minimal setup only

