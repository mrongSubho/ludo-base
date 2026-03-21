# Testing: ludo-base

## Frameworks
- **Primary**: [Playwright](file:///Users/mrongsubho/Documents/Termninal/ludo-base/package.json#L37) for end-to-end and integration testing.

## Infrastructure
- **Browser Testing**: Playwright is configured for Chromium, Firefox, and Webkit.
- **P2P Testing**: PeerJS and Supabase Realtime testing requires multi-session coordination (manual or complex E2E flows).

## Coverage & Gaps
- **Status**: No unit tests (Jest/Vitest/Vitest) detected.
- **Gap**: Pure logic in `lib/` (game rules, progression) is currently only verified via manual play or E2E flows. Adding Unit Tests for `lib/gameLogic.ts` is a recommended future task.
