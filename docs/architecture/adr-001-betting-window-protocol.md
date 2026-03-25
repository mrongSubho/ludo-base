# ADR-001: Host-Controlled Betting Window Protocol

## Status
Accepted

## Context
Spectators in Ludo Base need a way to place bets on live game outcomes (e.g., dice rolls, match winners) in a "GambleFi" setting. 
- **The Problem**: A significant gap exists between the time a player (Host) generates a result and the time spectators see it. Without a protocol, spectators could potentially "front-run" the result if they receive the data faster than the UI reveals it, or if the Host reveals it prematurely.
- **Constraints**: 
  - Low latency for players is a priority.
  - Zero-bandwidth streaming (state-syncing only).
  - Provably fair dice must be maintained.

## Decision
We implemented a **Host-Controlled Betting Window Protocol** (V2 Hardened).

1.  **Orchestration**: The Host broadcasts a `BET_WINDOW_OPEN` event via Supabase Realtime *before* triggering the dice commit.
2.  **Mandatory Delay**: A fixed 3-second delay is enforced on the Host client before the `BET_WINDOW_CLOSED` event and subsequent dice reveal.
3.  **Synchronization**: The `live_matches` table tracks the `window_closed_at` timestamp.
4.  **Security V2 (Hardened)**: The payout RPC (`settle_match_bets`) performs a server-side validation against the `live_matches.window_closed_at` timestamp. Any resolution attempt before `NOW() > window_closed_at` is rejected.

## Rationale
- **Simplicity**: Leverages existing Supabase Realtime infrastructure without requiring complex WebSockets or video encoding.
- **Security**: Server-side enforcement in the RPC mitigates the "dishonest host" risk.
- **Scalability**: State-syncing allows thousands of spectators to watch without increasing the Host's bandwidth load.

## Trade-offs
- **Game Pace**: Adds a mandatory 3-second wait to every dice roll. While this builds "hype" for spectators, it might feel slow for high-stakes speed players.
- **Host Dependency**: If the Host disconnects during the window, the match state must be recovered or the window closed by a standby peer.

## Consequences
- **Positive**: Front-running is economically impossible due to the 3-second lock. Immersive UX with "Betting Open" countdowns.
- **Negative**: Increased match duration (~15-20% increase for active betting games).
- **Mitigation**: The UI clearly displays the countdown to spectators and players, turning the delay into a "suspense" mechanic.
