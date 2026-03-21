# Roadmap: Ludo Base v1

## Milestone 1: Multiplayer Foundation (Current)
*Goal: Fix Quick Match and Team Up core mechanics.*
- [ ] Implement `join_matchmaking` RPC (exact & range matching).
- [ ] Connect `QuickMatchPanel.tsx` and verify Realtime sync.
- [ ] Fix PeerJS registration and slot assignment race conditions in Team Up.
- [ ] Validate 2v2 diagonal seating in P2P matches.

## Milestone 2: Gameplay Polish & Reliability
*Goal: Smooth out turns, AFK, and state recovery.*
- [ ] Hardened Host Migration (re-connecting to new host seamlessly).
- [ ] Turn timer consistency and AFK strike visual feedback.
- [ ] Capture and safe-cell animation sync.
- [ ] Offline bot behavior refinements for missing slots.

## Milestone 3: Social & Economy
*Goal: Friends, messaging, and basic currency.*
- [ ] Replace mock friend logic with Supabase Realtime graph.
- [ ] Fully functional DMs with unread badges.
- [ ] Wager lock/release logic (Coinbase OnchainKit).
- [ ] Basic Leaderboard hydration.

## Milestone 4: Launch & Distribution
*Goal: Farcaster Frames v2 Ready.*
- [ ] Performance optimization for mobile viewports.
- [ ] Final asset pass (avatars, sound packs).
- [ ] Global PWA installation polish.
