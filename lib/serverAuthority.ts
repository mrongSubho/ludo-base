/**
 * Server Authority Migration — Feature Flags
 *
 * P0 deliverable: three flags controlling the strangler-fig migration from
 * host-centric authority to server-authoritative rooms.
 *
 * Flags default to OFF and are evaluated as follows:
 * - `AUTH_V2`: at session creation (P1)
 * - `ROOM_V2`: at **match creation** — a match is owned by the path that
 *   seeded it for its entire lifetime (§4.12 in-flight cutover rule)
 * - `SERVER_LIFECYCLE`: at room lifecycle events (P4)
 *
 * Environment variable overrides (server-side only, never NEXT_PUBLIC_):
 *   SAM_AUTH_V2=1        — enable cookie sessions + scope model
 *   SAM_ROOM_V2=1        — enable DO room for new matches
 *   SAM_SERVER_LIFECYCLE=1 — enable server-owned clock, lifecycle, settlement
 *
 * See: docs/planning/SERVER_AUTHORITY_MIGRATION_PLAN.md §5-P0, §4.12
 */

/** Migration flag names. */
export type MigrationFlag = 'AUTH_V2' | 'ROOM_V2' | 'SERVER_LIFECYCLE';

/**
 * Read a migration flag. Server-side only — these are never exposed to the
 * client bundle (no `NEXT_PUBLIC_` prefix). In tests the flag can be
 * forced via `process.env`.
 */
function readFlag(flag: MigrationFlag): boolean {
  const envKey = `SAM_${flag}`;
  const raw = typeof process !== 'undefined' ? process.env[envKey] : undefined;
  return raw === '1' || raw === 'true';
}

/** P1: true when the v2 cookie-session model is active. */
export function isAuthV2Enabled(): boolean {
  return readFlag('AUTH_V2');
}

/**
 * P3: true when the Durable Object match room is active for **new** matches.
 *
 * IMPORTANT (§4.12): this flag is evaluated at match creation and persisted
 * as `match_states.room_version`. A running match always uses the version
 * it was created with — flipping the flag mid-match does NOT change the
 * authority for in-flight matches.
 */
export function isRoomV2Enabled(): boolean {
  return readFlag('ROOM_V2');
}

/** P4: true when the server owns clock, lifecycle, and settlement. */
export function isServerLifecycleEnabled(): boolean {
  return readFlag('SERVER_LIFECYCLE');
}

/**
 * Resolve the room version for a **new** match. Call this exactly once at
 * match creation and persist the result in `match_states.room_version`.
 *
 * Returns 2 if `ROOM_V2` is enabled, 1 otherwise. The returned value
 * controls transport for the match's entire lifetime.
 */
export function resolveRoomVersion(): 1 | 2 {
  return isRoomV2Enabled() ? 2 : 1;
}

/**
 * Helper for route handlers: returns the set of active flags. Useful for
 * the telemetry baseline (P0) and for the `/api/auth/session` response.
 */
export function activeMigrationFlags(): Record<MigrationFlag, boolean> {
  return {
    AUTH_V2: isAuthV2Enabled(),
    ROOM_V2: isRoomV2Enabled(),
    SERVER_LIFECYCLE: isServerLifecycleEnabled(),
  };
}
