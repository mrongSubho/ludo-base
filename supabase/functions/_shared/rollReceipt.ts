/**
 * Roll-receipt binding rules (SEC-01, SEC-33).
 *
 * Pure functions, no Deno or Supabase dependency, so they are unit-tested in
 * Node by `scripts/roll-trust.test.ts` rather than only asserted by reading the
 * Edge source. `roll-dice` and `move-auth` both import from here — a security
 * rule that exists in two places gets fixed in one and left broken in the other.
 *
 * A receipt answers three questions, and all three have to hold before a face
 * can be spent:
 *
 *   seat   — whose turn the face belongs to
 *   turn   — which `match_states.seq` minted it
 *   minter — who was authorized to mint it
 *
 * A receipt with a null `seat_color` or `turn_seq` predates migration
 * 202609300011. It is refused, not guessed at: a wrong guess would let a roll be
 * spent against the wrong seat.
 */

export const SEAT_COLORS = ["green", "red", "yellow", "blue"] as const;

export function isSeatColor(value: unknown): value is (typeof SEAT_COLORS)[number] {
  return typeof value === "string" && (SEAT_COLORS as readonly string[]).includes(value);
}

export type RollReceipt = {
  id?: string | null;
  result?: number | null;
  match_id?: string | null;
  status?: string | null;
  seat_color?: string | null;
  turn_seq?: number | null;
  wallet_address?: string | null;
};

export type BindingVerdict =
  | { ok: true }
  | { ok: false; status: number; error: string; code?: string };

/** wallet that owns `color`, or null when the seat is a bot/AFK/unowned. */
export type SeatWalletLookup = (color: string) => string | null;

/**
 * May this receipt be spent by this move, on this seat, at this seq?
 *
 * `seq` must be the match's *current* seq, which the caller has already CAS'd
 * the move against. Comparing the receipt's `turn_seq` to the same value is what
 * makes a roll unable to outlive its turn.
 */
export function checkRollBinding(opts: {
  roll: RollReceipt | null | undefined;
  color: string;
  seq: number;
  hostAddress: string | null | undefined;
  seatWallet: SeatWalletLookup;
}): BindingVerdict {
  const { roll, color, seq, hostAddress, seatWallet } = opts;
  if (!roll) return { ok: false, status: 404, error: "Roll not found" };

  if (!isSeatColor(roll.seat_color)) {
    return { ok: false, status: 409, error: "Roll is not bound to a seat", code: "ROLL_UNBOUND" };
  }
  if (roll.seat_color !== color) {
    return { ok: false, status: 403, error: "Roll belongs to another seat" };
  }

  if (roll.turn_seq === null || roll.turn_seq === undefined) {
    return { ok: false, status: 409, error: "Roll is not bound to a turn", code: "ROLL_UNBOUND" };
  }
  if (!Number.isSafeInteger(Number(roll.turn_seq)) || Number(roll.turn_seq) < 0) {
    return { ok: false, status: 409, error: "Roll turn binding is invalid", code: "ROLL_UNBOUND" };
  }
  if (Number(roll.turn_seq) !== Number(seq)) {
    return { ok: false, status: 409, error: "Roll is from an earlier turn", code: "STALE_SEQ" };
  }

  // The minter must be the host — which is how bot and AFK seats roll, since the
  // host drives them — or the wallet that owns this seat.
  const minter = String(roll.wallet_address || "").toLowerCase();
  const host = String(hostAddress || "").toLowerCase();
  const owner = String(seatWallet(color) || "").toLowerCase();
  if (!minter) {
    return { ok: false, status: 403, error: "Roll has no minter" };
  }
  if (minter !== host && (!owner || minter !== owner)) {
    return { ok: false, status: 403, error: "Roll was not minted by this match" };
  }

  return { ok: true };
}

export type MintVerdict =
  | { ok: true; action: "mint" }
  | { ok: true; action: "replay"; roll: RollReceipt }
  | { ok: false; status: number; error: string; code?: string };

/**
 * May a new face be minted for `seatColor` in this match, by `minter`, now?
 *
 * `existingRoll` is the receipt already recorded for this (match, turn). When one
 * exists the answer is `replay` — hand back the face that was already rolled.
 * That is the anti retry-until-a-six rule: a second attempt within the same turn
 * can never produce a second face, whatever the caller sends. It is also what
 * makes a dropped response recoverable without re-rolling.
 */
export function decideRollMint(opts: {
  matchFound: boolean;
  hostAddress: string | null | undefined;
  minter: string;
  statePresent: boolean;
  terminal: boolean;
  currentPlayer: string | null | undefined;
  seatColor: string;
  existingRoll: RollReceipt | null | undefined;
}): MintVerdict {
  const { matchFound, hostAddress, minter, statePresent, terminal, currentPlayer, seatColor, existingRoll } = opts;

  if (!matchFound) return { ok: false, status: 404, error: "Match not found" };
  if (terminal) return { ok: false, status: 409, error: "Match finished", code: "MATCH_FINISHED" };
  if (!statePresent) return { ok: false, status: 409, error: "Match state not seeded" };

  // Only the host mints. A guest asks for a roll over the game-intent channel
  // and the host calls in here, which keeps the betting window and dice order
  // with the host.
  const m = String(minter || "").toLowerCase();
  const host = String(hostAddress || "").toLowerCase();
  if (!host) return { ok: false, status: 403, error: "Match has no host" };
  if (m !== host) return { ok: false, status: 403, error: "Only the host may mint rolls" };

  if (!isSeatColor(seatColor)) return { ok: false, status: 400, error: "Unknown seat" };
  if (!currentPlayer || String(currentPlayer) !== seatColor) {
    return { ok: false, status: 403, error: "Not this seat turn", currentPlayer: currentPlayer ?? null } as MintVerdict;
  }

  // One roll per (match, turn). Replay rather than refuse, so a lost response
  // recovers instead of wedging the turn.
  if (existingRoll && existingRoll.id) {
    return { ok: true, action: "replay", roll: existingRoll };
  }

  return { ok: true, action: "mint" };
}

/** Freshness window for a one-off personal_sign that authorizes a roll. */
export const ROLL_MESSAGE_MAX_AGE_MS = 120_000;

export function isFreshRollRequest(issuedAt: string | null | undefined, nowMs: number): boolean {
  if (!issuedAt) return false;
  const t = Date.parse(issuedAt);
  if (!Number.isFinite(t)) return false;
  const age = nowMs - t;
  return age >= -60_000 && age <= ROLL_MESSAGE_MAX_AGE_MS;
}
