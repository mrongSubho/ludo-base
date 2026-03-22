# UAT: Multiplayer Foundation (Milestone 1)

## Functional Tests
- [x] **Quick Match RPC**: `join_matchmaking` returns valid data.
- [x] **Radius Sync**: UI updates when a match is found via RPC.
- [ ] **2v2 Diagonal Seating**: Verify physical board positions match teammate expectations (Teammates across from each other).
- [ ] **Start Signal Recovery**: Verify Guest joins successfully even if initial P2P handshake fails (Supabase relay fallback).
- [ ] **4-Player Stability**: Verify all 4 players join the lobby without slot collisions.

## Device Specific
- [ ] **Farcaster Context**: Verify `currrentUser` is correctly identified when running inside Farcaster overlay.
- [ ] **Haptic Feedback**: Verify "Match Found" vibration on Android/iOS devices.

## Performance
- [x] **Latency**: Handshake completion in <1.5s.
