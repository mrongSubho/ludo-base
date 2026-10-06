import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';
import { verifyPersonalSign } from '../_shared/walletVerify.ts';
import { CORS_HEADERS, edgeError, jsonOk } from '../_shared/errors.ts';

const BET_RESOLVE_PREFIX = 'Ludo Base bet resolve';
const MAX_AGE_MS = 10 * 60 * 1000;

function buildBetResolveMessage(params: {
  matchId: string;
  result: string;
  betType: string;
  hostAddress: string;
  issuedAt: string;
}): string {
  return [
    BET_RESOLVE_PREFIX,
    'Settle the bets for this match.',
    `match: ${params.matchId}`,
    `result: ${params.result}`,
    `type: ${params.betType}`,
    `host: ${params.hostAddress.toLowerCase()}`,
    `issued: ${params.issuedAt}`,
  ].join('\n');
}

function isFresh(issuedAt: string): boolean {
  const t = Date.parse(issuedAt);
  if (!Number.isFinite(t)) return false;
  const age = Date.now() - t;
  return age >= -60_000 && age <= MAX_AGE_MS;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
    });
  }

  const corsHeaders = CORS_HEADERS;

  try {
    const { matchId, result, betType, hostAddress, message, signature, issuedAt } = await req.json();

    if (!matchId || !result || !betType || !hostAddress || !message || !signature || !issuedAt) {
      return new Response(JSON.stringify({ error: 'Missing signed resolve payload' }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    if (!isFresh(issuedAt)) {
      return new Response(JSON.stringify({ error: 'Proof expired' }), {
        status: 401,
        headers: corsHeaders,
      });
    }

    const expected = buildBetResolveMessage({
      matchId: String(matchId),
      result: String(result),
      betType: String(betType),
      hostAddress: String(hostAddress),
      issuedAt: String(issuedAt),
    });
    if (message !== expected) {
      return new Response(JSON.stringify({ error: 'Message payload mismatch' }), {
        status: 401,
        headers: corsHeaders,
      });
    }

    // 6492-aware host proof (EOA ecrecover + 1271/6492 on the 8453/84532 allowlist).
    const verdict = await verifyPersonalSign({
      address: String(hostAddress),
      message,
      signature,
    });
    if (!verdict.ok) {
      const error = verdict.code === 'ecrecover-invalid' ? 'Invalid signature' : 'Signer is not the claimed host';
      return new Response(JSON.stringify({ error, code: verdict.code }), {
        status: verdict.code === 'ecrecover-invalid' ? 401 : 403,
        headers: corsHeaders,
      });
    }
    const recovered = String(hostAddress).toLowerCase();

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Host must be the recorded host for this match (fail closed if unset).
    const { data: live, error: liveErr } = await supabase
      .from('live_matches')
      .select('host_address, match_id, bet_window_status, window_closed_at, current_bet_type')
      .eq('match_id', matchId)
      .maybeSingle();

    // SEC-31: a PostgREST error names the table, column and constraint, and its
    // hint suggests the exact GRANT to add. Never echoed.
    if (liveErr) {
      return edgeError('INTERNAL', { scope: 'resolve-bet', cause: liveErr, log: { matchId } });
    }
    if (!live?.host_address || live.host_address.toLowerCase() !== recovered) {
      return new Response(JSON.stringify({ error: 'Host not authorized for this match' }), {
        status: 403,
        headers: corsHeaders,
      });
    }

    // SEC-29 (1): the betting window must be CLOSED before anything settles.
    // The RPC also guards this, but it does so by raising a SQL exception, which
    // would reach the caller as an opaque 500. Deciding it here gives a truthful
    // 409, and refuses an already-settled window before any money moves.
    if (live.bet_window_status === 'open') {
      return edgeError('CONFLICT', {
        scope: 'resolve-bet',
        log: { matchId, reason: 'window_open', status: live.bet_window_status },
      });
    }
    if (live.bet_window_status === 'settled') {
      return edgeError('CONFLICT', {
        scope: 'resolve-bet',
        log: { matchId, reason: 'already_settled' },
      });
    }

    // SEC-29 (2): the market is the one the AUTHORITY recorded, not the one the
    // caller names. The signed message binds `betType`, so a host cannot swap it
    // — but it could still sign a type the match never opened, and the RPC's own
    // check is conditional (`if current_bet_type is not null and ... distinct`),
    // so a null recorded type would let ANY type through. Compare here, and fail
    // closed when nothing was recorded.
    const recordedType = live.current_bet_type ? String(live.current_bet_type) : null;
    if (!recordedType) {
      return edgeError('CONFLICT', {
        scope: 'resolve-bet',
        log: { matchId, reason: 'no_recorded_bet_type', claimed: String(betType) },
      });
    }
    if (recordedType !== String(betType)) {
      return edgeError('CONFLICT', {
        scope: 'resolve-bet',
        log: { matchId, reason: 'bet_type_mismatch', recorded: recordedType, claimed: String(betType) },
      });
    }
    const settledBetType = recordedType;

    console.log(`🎰 [Resolve] Match: ${matchId}, Result: ${result}, Type: ${betType}, Host: ${recovered}`);

    // The signed result must match what the authority recorded, otherwise the
    // host could settle a market to a value of their choosing (SEC-29).
    const { data: authority, error: authErr } = await supabase
      .from('match_states')
      .select('state')
      .eq('match_id', matchId)
      .maybeSingle();

    if (authErr) {
      return edgeError('INTERNAL', {
        scope: 'resolve-bet',
        cause: authErr,
        log: { matchId },
        status: 503,
      });
    }

    const winner = ((authority?.state as { winner?: unknown } | null)?.winner ?? null) as string | null;
    const status = ((authority?.state as { status?: unknown } | null)?.status ?? null) as string | null;
    const isFinished = winner != null || status === 'finished';
    if (!isFinished) {
      return new Response(JSON.stringify({ error: 'match not finished' }), {
        status: 409,
        headers: corsHeaders,
      });
    }
    // The cross-check the audit asks for: the signed result must equal the winner
    // the authority recorded. Previously this was guarded by `winner != null`, so
    // a match that finished with NO winner skipped the comparison entirely and
    // any result settled the market. Require a winner.
    if (winner == null) {
      return edgeError('CONFLICT', {
        scope: 'resolve-bet',
        log: { matchId, reason: 'finished_without_winner', status },
      });
    }
    if (String(result).toLowerCase() !== String(winner).toLowerCase()) {
      return edgeError('CONFLICT', {
        scope: 'resolve-bet',
        log: { matchId, reason: 'result_mismatch', signed: String(result), authority: winner },
      });
    }

    // Escrow settlement. It owns the window gate (the guard the canonical
    // settle_match_bets lost, DB-04), the idempotency, the stake refund, the
    // gross-minus-rake payout, and the treasury credit — all in one transaction.
    const { data, error } = await supabase.rpc('chips_escrow_settle_bets', {
      p_match_id: matchId,
      p_result: String(result),
      // The recorded type, not the caller's.
      p_bet_type: settledBetType,
    });

    // The RPC raises named exceptions (BET_WINDOW_STILL_OPEN, BET_TYPE_MISMATCH,
    // …). Those are useful in the log and are exactly what must not be echoed.
    if (error) {
      return edgeError('INTERNAL', { scope: 'resolve-bet', cause: error, log: { matchId } });
    }

    return jsonOk({ success: true, summary: data });
  } catch (err) {
    // SEC-31: a caught exception may be anything, including a Supabase error
    // object with a grant hint in it.
    return edgeError('INTERNAL', { scope: 'resolve-bet', cause: err });
  }
});
