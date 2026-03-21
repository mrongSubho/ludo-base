# V1 Requirements: Multiplayer Polish

## User Stories
- **As a Player**, I want to join a "Quick Match" and be paired with another searching player within 30 seconds.
- **As a Player**, I want to invite a friend to a "Team Up" lobby and have them join reliably via a room code.
- **As a Host**, I want to fill empty Team Up slots with Quick Match players (Hybrid Matchmaking).

## Functional Requirements

### 1. Matchmaking Engine (RPC)
- **Status**: Missing/Non-functional.
- **Task**: Implement `join_matchmaking` SQL function in Supabase.
  - Support exact wager matching.
  - Support range expansion (+/- 20%, +/- 50%).
  - Ensure atomicity to prevent double-matching.
- **Success**: Calling the RPC returns a valid `match_id` or `ticket_id`.

### 2. Team Up Lobby Hardening
- **Status**: Partially functional (PeerJS prone to failures).
- **Task**: 
  - Verify PeerJS ID generation and collision handling.
  - Ensure the "Host Migration" logic is robust during lobby formation.
  - Fix slot assignment race conditions in `assignJoinerToSlot`.

### 3. Quick Match Integration
- **Status**: Failing (no matches found).
- **Task**:
  - Connect `QuickMatchPanel.tsx` to the new RPC.
  - Ensure Realtime subscriptions correctly transition the UI to the match state once found.

## Non-Functional Requirements
- **Latency**: Matchfound notification within <500ms of the second player joining.
- **Reliability**: 100% success rate for room-code joins (if room is open).

## Verification Criteria
- [ ] Two separate browser sessions can find each other in Quick Match.
- [ ] A Host can create a 2v2 room and a Guest can join via code.
- [ ] Match state (currentPlayer, diceValue) remains in sync across all clients.
