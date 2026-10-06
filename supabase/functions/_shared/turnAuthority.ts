/**
 * Turn-authority rules for `move-auth` (Phase 3 / SEC-15, SEC-18, SEC-19, SEC-30).
 *
 * Pure functions, no Deno or Supabase dependency, so they are unit-tested in
 * Node by `scripts/authority.test.ts` rather than asserted by reading Edge
 * source. Deno is not in CI, so anything left inline in the handler can only be
 * checked by a human reading it.
 */

export type Verdict =
  | { ok: true }
  | { ok: false; status: number; error: string; code?: string };

export type SeatLike = { kind: string; wallet?: string | null };

export type Seats = Record<string, SeatLike | undefined>;

/**
 * SEC-19: may `actor` act on `color` in this role?
 *
 * `move` already refuses host-assist for a human seat. `pass` did not, so the
 * host could spend a human's turn — including ending it with a pass the human
 * never chose. The two handlers must agree on this exactly.
 */
export function checkSeatAuthority(opts: {
  source: 'player' | 'host-assist' | string;
  seats: Seats;
  color: string;
  actor: string;
  hostAddress: string | null | undefined;
}): Verdict {
  const { source, seats, color, actor, hostAddress } = opts;
  const host = String(hostAddress || '').toLowerCase();
  const who = String(actor || '').toLowerCase();
  const seat = seats[color];

  if (!seat) return { ok: false, status: 403, error: 'Not your seat' };

  if (source === 'host-assist') {
    if (who !== host) return { ok: false, status: 403, error: 'Only host may assist' };
    // The host may only drive seats that are not human. A human seat is that
    // player's own turn, however much the host wants to help.
    if (seat.kind === 'human') {
      return { ok: false, status: 403, error: 'host-assist only for bot/AFK seats' };
    }
    return { ok: true };
  }

  if (seat.kind !== 'human') {
    return { ok: false, status: 403, error: 'Seat is not a human player' };
  }
  if (String(seat.wallet || '').toLowerCase() !== who) {
    return { ok: false, status: 403, error: 'Not your seat' };
  }
  return { ok: true };
}

/**
 * SEC-18: may this turn be passed?
 *
 * Forced-ness is derived, never declared. `pass` used to accept
 * `reason: 'forced'` from the caller, which let any player hand over their turn
 * at will — the client simply asserted there were no legal moves.
 *
 * A pass is valid only when the engine agrees:
 *   - the third consecutive six (a forfeited turn), or
 *   - no legal token for this face.
 */
export function checkPassLegality(opts: {
  legal: number[];
  dice: number;
  consecutiveSixes: number;
}): Verdict {
  const { legal, dice, consecutiveSixes } = opts;
  if (!Number.isInteger(dice) || dice < 1 || dice > 6) {
    return { ok: false, status: 400, error: 'Invalid dice face' };
  }
  const counter = Number.isFinite(consecutiveSixes) ? Math.max(0, Math.trunc(consecutiveSixes)) : 0;
  const isThirdSix = dice === 6 && counter + 1 >= 3;
  if (isThirdSix) return { ok: true };
  if (legal.length === 0) return { ok: true };
  return { ok: false, status: 400, error: 'Legal moves exist', code: 'ILLEGAL_ACTION' };
}

/**
 * SEC-15: did our compare-and-swap actually win?
 *
 * A `.update()` with a `.eq('seq', seq)` guard that matches **zero** rows is not
 * an error in PostgREST — it returns 200 with an empty body. The caller then
 * believed it had persisted a move it never wrote, and returned
 * `200 {success:true}` to a client whose state was never stored. Selecting the
 * column back is the only way to distinguish "wrote it" from "matched nothing".
 */
export function casWon(input: {
  error: unknown;
  data: unknown[] | null | undefined;
}): Verdict {
  if (input.error) return { ok: false, status: 500, error: 'State write failed' };
  const rows = Array.isArray(input.data) ? input.data : [];
  if (rows.length !== 1) {
    return {
      ok: false,
      status: 409,
      error: 'Stale state',
      code: 'STALE_SEQ',
    };
  }
  return { ok: true };
}

/**
 * SEC-30: the fields a completed pass must set on the next state.
 *
 * `powerSpentThisTurn` was left untouched by `pass`, so a player who spent a
 * power and then had no legal move kept `true` into the *next* turn and was
 * refused every power until they moved. Turn handover resets the budget.
 */
export function passStatePatch(input: {
  currentPlayer: string;
  dice: number;
  consecutiveSixes: number;
  now: number;
}): {
  currentPlayer: string;
  consecutiveSixes: number;
  diceValue: null;
  gamePhase: 'rolling';
  powerSpentThisTurn: false;
  lastUpdate: number;
} {
  const { currentPlayer, dice, consecutiveSixes, now } = input;
  return {
    currentPlayer,
    consecutiveSixes: dice === 6 ? (consecutiveSixes + 1) % 3 : 0,
    diceValue: null,
    gamePhase: 'rolling',
    powerSpentThisTurn: false,
    lastUpdate: now,
  };
}
