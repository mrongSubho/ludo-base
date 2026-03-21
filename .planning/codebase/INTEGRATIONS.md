# Integrations: ludo-base

## Backend Services
- **Supabase**: Primary database and authentication provider.
  - Client initialization: [lib/supabase.ts](file:///Users/mrongsubho/Documents/Termninal/ludo-base/lib/supabase.ts)
  - Schema details: [supabase/schema_list.md](file:///Users/mrongsubho/Documents/Termninal/ludo-base/supabase/schema_list.md)

## Real-time Networking
- **PeerJS**: Used for peer-to-peer game synchronization.
  - Core connection logic: [hooks/useCompetitiveConnection.ts](file:///Users/mrongsubho/Documents/Termninal/ludo-base/hooks/useCompetitiveConnection.ts)

## Blockchain & Web3
- **Coinbase OnchainKit**: Wallet connectivity and onchain interactions.
- **Farcaster**: Integrated as a Frames/Mini-app environment.
  - Providers: [app/Providers.tsx](file:///Users/mrongsubho/Documents/Termninal/ludo-base/app/Providers.tsx)

## APIs & External
- **Canvas Confetti**: Visual feedback for game wins.
- **PeerJS Cloud**: (Implicitly) used for ID brokering unless self-hosted.
