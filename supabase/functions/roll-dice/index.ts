import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';
import { verifyPersonalSign } from '../_shared/walletVerify.ts';
import { verifyMatchSession } from '../_shared/matchSession.ts';
import { isTerminalMatch } from '../_shared/networkBoundary.ts';
import { decideRollMint, isFreshRollRequest, isSeatColor } from '../_shared/rollReceipt.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/**
 * Roll receipt minting (SEC-01, SEC-33).
 *
 * The face is always `crypto.getRandomValues` here. The caller supplies no face
 * and cannot influence one — `SEC-02` removed the client-side `value` from the
 * roll intent, and this function never reads one from the body either.
 *
 * What the caller does supply is *authorization to mint*: either the in-match
 * `match_sessions` grant or a one-off personal_sign. Everything that identifies
 * the receipt — the minter's wallet, the seat, the turn — is derived server-side
 * from the match row. Previously all three came from the request body, which is
 * why anyone could forge attribution and retry until they rolled a six.
 */
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const body = await req.json().catch(() => null);
    if (!body) return json({ error: 'Invalid JSON body' }, 400);

    // Pre-warm must not require auth: it is a liveness probe with no state change.
    if (body.isPreWarm) return json({ status: 'warmed' });

    const matchId = body.matchId;
    const seatColor = body.seatColor;
    const actor = typeof body.actor === 'string' ? body.actor : '';
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
    const message = typeof body.message === 'string' ? body.message : '';
    const signature = typeof body.signature === 'string' ? body.signature : '';
    const issuedAt = typeof body.issuedAt === 'string' ? body.issuedAt : '';

    if (!matchId || !seatColor) {
      return json({ error: 'Missing required parameters: matchId, seatColor' }, 400);
    }
    if (String(matchId) === 'local') {
      // There is no authoritative match, so there can be no authoritative roll.
      // Previously this inserted a row with match_id='local'.
      return json({ error: 'No authoritative match for this roll' }, 400);
    }
    if (!isSeatColor(seatColor)) {
      return json({ error: 'Unknown seat' }, 400);
    }
    if (!actor || !/^0x[a-f0-9]{40}$/i.test(actor)) {
      return json({ error: 'Missing actor wallet' }, 400);
    }
    if (!sessionId && !signature) {
      return json({ error: 'Missing session or signature' }, 401);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // ── 1. Authenticate the minter ───────────────────────────────────────
    if (sessionId) {
      const v = await verifyMatchSession(supabase, sessionId, String(matchId), actor);
      if (!v.ok) return json({ error: v.error }, 401);
    } else {
      if (!isFreshRollRequest(issuedAt, Date.now())) return json({ error: 'Stale or missing issuedAt' }, 401);
      const v = await verifyPersonalSign({
        address: actor,
        message,
        signature,
        chainId: body.chainId,
      });
      if (!v.ok) return json({ error: 'Invalid signature', code: v.code }, 401);
    }
    const minter = actor.toLowerCase();

    // ── 2. Load the authoritative match row and state ─────────────────────
    const { data: row, error: rowErr } = await supabase
      .from('live_matches')
      .select('id, host_address, player_seats, status')
      .eq('id', String(matchId))
      .maybeSingle();
    if (rowErr) return json({ error: 'Match lookup failed' }, 500);

    const { data: stateRow, error: stateErr } = await supabase
      .from('match_states')
      .select('seq, state')
      .eq('match_id', String(matchId))
      .maybeSingle();
    if (stateErr) return json({ error: 'State lookup failed' }, 500);

    const seq = Number(stateRow?.seq ?? 0);
    const state = stateRow?.state as { currentPlayer?: string } | null;
    const statePresent = Boolean(stateRow) && Boolean(state) && typeof state === 'object';

    // ── 3. Authorize the mint (pure rules, unit-tested in Node) ───────────
    const { data: existingTurn } = await supabase
      .from('match_rolls')
      .select('id, result, seat_color, wallet_address, turn_seq')
      .eq('match_id', String(matchId))
      .eq('turn_seq', seq)
      .maybeSingle();

    const verdict = decideRollMint({
      matchFound: Boolean(row),
      hostAddress: row?.host_address,
      minter,
      statePresent,
      terminal: statePresent && isTerminalMatch(state as { winner?: unknown; status?: string }),
      currentPlayer: state?.currentPlayer,
      seatColor: String(seatColor),
      existingRoll: existingTurn ?? null,
    });
    if (!verdict.ok) {
      return json({ error: verdict.error, code: verdict.code }, verdict.status);
    }
    if (verdict.action === 'replay') {
      // One roll per (match, turn). This is the anti retry-until-a-six rule:
      // a second attempt can never produce a second face, whatever the caller
      // sends. Replaying rather than refusing keeps a dropped response
      // recoverable instead of wedging the turn.
      return json({
        success: true,
        result: verdict.roll.result,
        rollId: verdict.roll.id,
        seatColor: verdict.roll.seat_color,
        minter: verdict.roll.wallet_address,
        turnSeq: verdict.roll.turn_seq,
        replay: true,
      });
    }

    const array = new Uint32Array(1);
    crypto.getRandomValues(array);
    const result = (array[0] % 6) + 1;

    const { data: inserted, error: insErr } = await supabase
      .from('match_rolls')
      .insert({
        match_id: String(matchId),
        // The minter, derived from the recovered signer — never the request body.
        wallet_address: minter,
        seat_color: String(seatColor),
        turn_seq: seq,
        action_id: body.actionId ? String(body.actionId) : null,
        result,
      })
      .select('id')
      .single();

    if (insErr) {
      // Lost a concurrent race for this turn: re-read the winner's row.
      const { data: again } = await supabase
        .from('match_rolls')
        .select('id, result, seat_color, wallet_address, turn_seq')
        .eq('match_id', String(matchId))
        .eq('turn_seq', seq)
        .maybeSingle();
      if (again) {
        return json({
          success: true,
          result: again.result,
          rollId: again.id,
          seatColor: again.seat_color,
          minter: again.wallet_address,
          turnSeq: again.turn_seq,
          replay: true,
        });
      }
      console.error('❌ [Roll] insert failed', insErr);
      return json({ error: 'Roll could not be recorded' }, 500);
    }

    console.log(
      `🎲 [Roll] match=${matchId} turn=${seq} seat=${seatColor} by=${minter} result=${result} id=${inserted?.id}`
    );

    return json({
      success: true,
      result,
      rollId: inserted?.id ?? null,
      seatColor: String(seatColor),
      minter,
      turnSeq: seq,
    });
  } catch (err) {
    console.error('❌ [Roll] Edge Function Error:', err);
    return json({ error: 'Roll failed' }, 400);
  }
});
