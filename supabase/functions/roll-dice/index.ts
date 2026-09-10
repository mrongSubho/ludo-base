import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const { matchId, walletAddress, actionId, isPreWarm } = await req.json();

    if (isPreWarm) return json({ status: 'warmed' });

    if (!matchId || !walletAddress) {
      return json({ error: 'Missing required parameters: matchId, walletAddress' }, 400);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Idempotent receipt: same (match_id, action_id) always returns the same face.
    // Prevents spam-retry until a host-favorable roll.
    if (actionId) {
      const { data: existing } = await supabase
        .from('match_rolls')
        .select('id, result, wallet_address')
        .eq('match_id', String(matchId))
        .eq('action_id', String(actionId))
        .maybeSingle();
      if (existing) {
        return json({
          success: true,
          result: existing.result,
          rollId: existing.id,
          actionId,
          walletAddress: existing.wallet_address,
          replay: true,
        });
      }
    }

    const array = new Uint32Array(1);
    crypto.getRandomValues(array);
    const result = (array[0] % 6) + 1;

    const { data: row, error: insErr } = await supabase
      .from('match_rolls')
      .insert({
        match_id: String(matchId),
        wallet_address: String(walletAddress).toLowerCase(),
        action_id: actionId ? String(actionId) : null,
        result,
      })
      .select('id')
      .single();

    if (insErr) {
      // Unique violation → concurrent duplicate; re-read
      const { data: again } = await supabase
        .from('match_rolls')
        .select('id, result, wallet_address')
        .eq('match_id', String(matchId))
        .eq('action_id', String(actionId))
        .maybeSingle();
      if (again) {
        return json({
          success: true,
          result: again.result,
          rollId: again.id,
          actionId,
          walletAddress: again.wallet_address,
          replay: true,
        });
      }
      console.error('❌ [Roll] insert failed', insErr);
      return json({ error: insErr.message }, 500);
    }

    console.log(`🎲 [Roll] Match: ${matchId}, Player: ${walletAddress}, Result: ${result}, Id: ${row?.id}`);

    return json({
      success: true,
      result,
      rollId: row?.id ?? null,
      actionId,
      walletAddress,
    });
  } catch (err) {
    console.error('❌ [Roll] Edge Function Error:', err);
    return json({ error: (err as Error).message }, 400);
  }
});
