## 2026-05-14 - Optimized Board Grid with O(1) Lookups and Memoization
**Learning:** In highly interactive components like the Ludo Board, the render loop for 52+ path cells was a significant bottleneck. Each cell was performing O(N) searches for power-ups and traps. By pre-calculating Map/Set lookups and memoizing the JSX array, we eliminated redundant computations during frequent state updates (like timer ticks).
**Action:** Always check render loops for grid-based UIs and replace array searches (.find, .some) with memoized O(1) lookups.
