## 2026-03-24 - Timer Tick Render Bottleneck
 **Learning:** In React applications with frequent state updates (like a 1s game timer), passing the entire state object to complex child components causes expensive re-renders even when the visual state hasn't changed.
 **Action:** Use `React.memo` with a custom comparison function that explicitly ignores high-frequency, non-visual state changes (like `timeLeft`). Ensure handlers passed to these components are stable references (destructured from stable objects or wrapped in `useCallback`).

## 2026-03-24 - Geometric Loop Optimization
 **Learning:** Calculations that depend on static or semi-static mappings (like `cornerToColor`) should be hoisted out of tight loops (like a 15x15 board grid traversal).
 **Action:** Hoist object transformations and mapping lookups outside of loops in geometric utility functions.
