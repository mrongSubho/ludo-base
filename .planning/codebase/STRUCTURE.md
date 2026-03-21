# Structure: ludo-base

## Directory Layout
- **[app/](file:///Users/mrongsubho/Documents/Termninal/ludo-base/app)**: Next.js application layer.
  - `components/`: UI components. Large components like `Board.tsx`, `MarketplacePanel.tsx`, and `FriendsPanel.tsx`.
  - `Providers.tsx`: Orchestrates Wagmi, QueryClient, and custom Context providers.
- **[lib/](file:///Users/mrongsubho/Documents/Termninal/ludo-base/lib)**: Core business and game logic.
  - `gameLogic.ts`: Fundamental rules and state management.
  - `boardLayout.ts`: Geometric definitions for Ludo/Snakes boards and corner assignments.
  - `progression.ts`: Maps XP/Rating to Tiers and Levels.
- **[hooks/](file:///Users/mrongsubho/Documents/Termninal/ludo-base/hooks)**: Custom React hooks and context providers.
  - `useCurrentUser.ts`: Simple hook for session/address mapping.
  - `useMessages.ts`: Specialized hook for conversation fetching and unread counts.
- **[supabase/](file:///Users/mrongsubho/Documents/Termninal/ludo-base/supabase)**: SQL migrations and schema documentation in `schema_list.md`.
- **[public/](file:///Users/mrongsubho/Documents/Termninal/ludo-base/public)**: Static assets (images, sounds).

## Key Loctions
- **Main Entry**: [app/page.tsx](file:///Users/mrongsubho/Documents/Termninal/ludo-base/app/page.tsx)
- **Global Data Hub**: [hooks/GameDataContext.tsx](file:///Users/mrongsubho/Documents/Termninal/ludo-base/hooks/GameDataContext.tsx)
- **Multiplayer Hub**: [hooks/TeamUpContext.tsx](file:///Users/mrongsubho/Documents/Termninal/ludo-base/hooks/TeamUpContext.tsx)
- **Global Styles**: [app/globals.css](file:///Users/mrongsubho/Documents/Termninal/ludo-base/app/globals.css)
