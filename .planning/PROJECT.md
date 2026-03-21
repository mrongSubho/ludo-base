# Ludo Base: Onchain Arena

## What This Is
Ludo Base is a high-polish, multiplayer tabletop game platform built for the **Farcaster** mini-app ecosystem and the **Base** web3 audience. It offers Ludo and Snakes & Ladders gameplay with hybrid real-time synchronization (PeerJS) and onchain identity (Coinbase OnchainKit).

## Core Value
End-to-end functional multiplayer Ludo gameplay (Quick Match, Team Up, Offline) that "just works" for the web3 community.

## Requirements

### Validated
(Inferred from existing codebase mapping)
- [x] Basic Board UI for Ludo and Snakes & Ladders
- [x] Local "Offline" match logic
- [x] Onchain Identity integration (Wagmi/Viem/Coinbase)
- [x] Farcaster SDK integration
- [x] Supabase backend for profiles, messages, and leaderboard

### Active
- [ ] **Fully Functional Quick Match**: Reliable matchmaking system that connects players without friction.
- [ ] **Functional Team Up**: Reliable lobby system for P2P/P2A (2v2) matches.
- [ ] **Gameplay Polish**: Smooth transitions, consistent turn-sync, and reliable state recovery.

### Out of Scope
- [ ] Mobile-native app — Focus is on Farcaster Mini-App and Web-first.
- [ ] Complex AI Engine — Initial focus is on basic bot-play for missing slots.

## Context
- **Infrastructure**: Next.js 16, Supabase, PeerJS.
- **Audience**: Farcaster users seeking interactive social games.
- **Constraints**: P2P networking must handle firewall/carrier NAT issues through relays or fallback mechanisms.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Hybrid P2P | PeerJS for low-latency turns, Supabase for state persistence. | — Pending |
| Base Ecosystem | Leveraging L2 speed and Coinbase OnchainKit for identity. | ✓ Good |

---
*Last updated: 2026-03-22 after project initialization*
