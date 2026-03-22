# UAT: Smart Match Optimizer (Phase 29)

## User Story
As a player searching for a match, I want to see suggestions for other active wager pools so I can join a game instantly instead of waiting.

## Criteria
- [x] **Auto-Reveal**: Optimizer panel appears automatically after 15 seconds of searching.
- [x] **Auto-Vanish**: Optimizer panel vanishes after 6 seconds if no interaction is detected.
- [x] **Search Extension**: Hovering or clicking the panel extends total search time by 20 seconds.
- [x] **Dynamic Suggestions**: Panel shows real-time waiter counts (e.g., "Switch to 10k (3 Waiting)").
- [x] **Fallback Options**: "Match Any" and "Priority Queue" are shown if no nearby pools have waiters.

## Results
- **Auto-Reveal**: Verified (15s mark).
- **Auto-Vanish**: Verified (21s mark without touch).
- **Extension**: Verified (maxSearchTimeRef updates to 50s+).
- **Dynamic Data**: Verified (fetchNearbyPools logic maps to UI).
