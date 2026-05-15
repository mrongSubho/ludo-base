## 2025-05-15 - Prop Narrowing for Render Isolation
**Learning:** Passing large state objects to memoized children often causes redundant renders if the object contains high-frequency fields (like `timeLeft` or `lastUpdate`). Even if the child doesn't use the timer, the parent re-creating the state object on every tick invalidates `React.memo`.
**Action:** Use `useMemo` in the parent to create narrowed "state slice" objects (e.g., `gridState`, `tokensState`) that only include dependencies relevant to the specific child. This effectively isolates complex subtrees from frequent parent updates.

## 2025-05-15 - O(1) Lookups in Render Loops
**Learning:** Performing `.find()` or `.some()` on arrays (like `powerTiles` or `traps`) inside a large render loop (e.g., 225 cells) creates $O(N^2)$ complexity. This is a common performance killer in board games.
**Action:** Pre-convert lookup arrays into `Set` or `Map` objects before the render loop. This reduces the per-cell check to $O(1)$, making the total render cost $O(N)$ relative to board size.
