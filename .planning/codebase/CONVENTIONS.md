# Conventions: ludo-base

## UI Development & PWA
- **Framework**: Next.js App Router with React 19.
- **Styling**: Tailwind CSS 4 utility classes directly in TSX.
- **PWA UX**: Custom `popstate` interceptor in [app/page.tsx](file:///Users/mrongsubho/Documents/Termninal/ludo-base/app/page.tsx) to manage hardware back button behavior.
- **Components**: Functional components in PascalCase. Use of "Panels" or "Sheets" for major UI overlays (dashboard-style navigation).

## Data & State Management
- **Context**: Domain-specific state is isolated in Context Providers under [hooks/](file:///Users/mrongsubho/Documents/Termninal/ludo-base/hooks).
- **Caching**: LocalStorage is used for "Boot Hydration" in `GameDataContext` to provide immediate UI feedback.
- **Supabase**: Direct client usage. SQL migrations are preferred for schema updates ([supabase/migrations/](file:///Users/mrongsubho/Documents/Termninal/ludo-base/supabase/migrations)).

## Logic Separation
- **Pure Logic**: Core game rules (`lib/gameLogic.ts`), board geometry (`lib/boardLayout.ts`), and progression mapping (`lib/progression.ts`) are separated from React hooks to facilitate deterministic game execution.

## Error & Session Management
- **Patterns**: Inline error handling in hooks.
- **Connectivity**: Real-time listeners for Supabase (`postgres_changes`) and P2P ([PeerJS](file:///Users/mrongsubho/Documents/Termninal/ludo-base/hooks/GameDataContext.tsx#L383)) define the connection lifecycle.
