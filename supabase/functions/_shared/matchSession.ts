/**
 * Match-session verification, shared by `move-auth` and `roll-dice`.
 *
 * This was inlined in `move-auth` and is used by both boundaries now. A security
 * primitive that exists twice is a primitive that will be fixed in one place and
 * left broken in the other — which is exactly what happened to the Etherscan
 * chainid earlier in this repo.
 *
 * The session is the *appended* match-session grant (`match_sessions`), NOT the
 * SIWE app session (`app_sessions`). SIWE covers chat/profile/settings only and
 * must never authorize an in-match action.
 */

import { isExpired } from "./networkBoundary.ts";
// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

export type SessionVerdict = { ok: true } | { ok: false; error: string };

/**
 * Resolve an in-match session to the wallet it authorizes for `matchId`.
 *
 * Fails closed on every path: unknown session, revoked, expired, bound to a
 * different match, or bound to a different wallet than the claimed actor.
 */
export async function verifyMatchSession(
  supabase: SupabaseClient,
  sessionId: string,
  matchId: string,
  expectedWallet: string,
): Promise<SessionVerdict> {
  const { data: sess, error } = await supabase
    .from("match_sessions")
    .select("id, match_id, wallet_address, expires_at, revoked_at")
    .eq("id", sessionId)
    .maybeSingle();
  if (error || !sess) return { ok: false, error: "Session not found" };
  if (sess.revoked_at) return { ok: false, error: "Session revoked" };
  if (isExpired(sess.expires_at, Date.now())) return { ok: false, error: "Session expired" };
  if (String(sess.match_id) !== String(matchId)) {
    return { ok: false, error: "Session match mismatch" };
  }
  if (String(sess.wallet_address).toLowerCase() !== String(expectedWallet).toLowerCase()) {
    return { ok: false, error: "Session wallet mismatch" };
  }
  return { ok: true };
}
