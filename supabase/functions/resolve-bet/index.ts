import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';
import { verifyPersonalSign } from '../_shared/walletVerify.ts';

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

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

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
      .select('host_address, match_id')
      .eq('match_id', matchId)
      .maybeSingle();

    if (liveErr) {
      return new Response(JSON.stringify({ error: liveErr.message }), {
        status: 500,
        headers: corsHeaders,
      });
    }
    if (!live?.host_address || live.host_address.toLowerCase() !== recovered) {
      return new Response(JSON.stringify({ error: 'Host not authorized for this match' }), {
        status: 403,
        headers: corsHeaders,
      });
    }

    console.log(`🎰 [Resolve] Match: ${matchId}, Result: ${result}, Type: ${betType}, Host: ${recovered}`);

    // Call the atomic resolution RPC (server-owned settlement)
    const { data, error } = await supabase.rpc('settle_match_bets', {
      p_match_id: matchId,
      p_result: String(result),
      p_bet_type: betType
    });

    if (error) {
      console.error('❌ [Resolve] RPC Error:', error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: corsHeaders,
      });
    }

    return new Response(JSON.stringify({ success: true, summary: data }), {
      headers: corsHeaders,
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: corsHeaders,
    });
  }
});
