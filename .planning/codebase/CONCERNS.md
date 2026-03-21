# Concerns: ludo-base

## Technical Debt & Fragility
- **[next.config.ts](file:///Users/mrongsubho/Documents/Termninal/ludo-base/next.config.ts#L4)**: The `turbopack: {}` block and resolution fallbacks indicate a fragile build environment.
- **Type Safety**: `ignoreBuildErrors: true` in [next.config.ts](file:///Users/mrongsubho/Documents/Termninal/ludo-base/next.config.ts#L22) hides potential runtime errors.
- **Deep Hook Complexity**: [useGameEngine.ts](file:///Users/mrongsubho/Documents/Termninal/ludo-base/hooks/useGameEngine.ts) and [TeamUpContext.tsx](file:///Users/mrongsubho/Documents/Termninal/ludo-base/hooks/TeamUpContext.tsx) are very large files with mixed state and networking logic, making debugging difficult.

## Reliability & Networking
- **P2P Connectivity**: PeerJS ID collisions are possible; current logic uses a random suffix to mitigate this, but long-term reliability of client-side ID brokering is a concern.
- **Host Migration**: If a host leaves, a "Host Migration" overlay appears; this process depends on lobby state consistency.

## Environment & Security
- **API Keys**: Relies on `.env` variables for Supabase. No built-in protection against client-side key leakage beyond standard Next.js practices.
- **PWA Context**: Hardware back-button hijacking is functional but can be brittle across different browser/OS versions.
