# Architecture: ludo-base

## System Pattern
- **Framework**: Next.js App Router (Client-side heavy for game logic).
- **Paradigm**: Hybrid P2P / Server-Relay.
  - Game actions are synchronized via PeerJS.
  - Periodic state syncing occurs through Supabase Realtime/DB.

## Core Abstractions
- **[GameDataContext](file:///Users/mrongsubho/Documents/Termninal/ludo-base/hooks/GameDataContext.tsx)**: 
  - Centralized state for the active player (profile, friends, messages).
  - Handles the "Boot Sequence" (Promise.all fetching of all initial data).
  - Implements LocalStorage optimistic caching for ultra-fast startup.
- **[TeamUpContext](file:///Users/mrongsubho/Documents/Termninal/ludo-base/hooks/TeamUpContext.tsx)**: Manages multiplayer lobby and match state.
- **[useGameEngine](file:///Users/mrongsubho/Documents/Termninal/ludo-base/hooks/useGameEngine.ts)**: Orchestrates game rules, turns, and state transitions.

## Data Flow & Lifecycle
1. **Boot Sequence**: `useEffect` in `GameDataContext` fetches profile, leaderboard, friends, and conversations in parallel.
2. **Realtime Sync**: Supabase Channels listen for `postgres_changes` in `messages`, `conversations`, and `players` for global consistency.
3. **P2P Lifecycle**: PeerJS initializes with a unique ID (`wallet-randomSuffix`) and syncs to the `players` table so others can initiate direct data connections.
4. **Game Actions**: UI -> `useGameEngine` -> PeerJS Broadcast -> Remote Peer receiver.

## PWA & Experience
- **Navigation**: `app/page.tsx` uses a custom `popstate` interceptor to prevent accidental PWA exits, treating the back button as a "close drawer" or "quit game" action.
- **Visuals**: Framer Motion and custom CSS orbs (`app/globals.css`) provide a premium "Cosmic" aesthetic.
