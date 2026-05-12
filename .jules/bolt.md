## 2025-03-03 - Board Rendering Optimizations
**Learning:** In a React 19 app with frequent timer-driven state updates (e.g., 1s game timer), even small components like board cells and tokens can cause significant CPU overhead if they perform O(N) array searches or re-calculate complex derived data (like occupancy) on every render.
**Action:** Use `useMemo` to convert array-based lookups into `Set`/`Map` O(1) lookups and to cache expensive derivations. Use `React.memo` for leaf components that receive frequently changing props (like `timeLeft`) only indirectly.
