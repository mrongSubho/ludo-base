import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } });
  }

  try {
    const { matchId, result, betType } = await req.json();

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log(`🎰 [Resolve] Match: ${matchId}, Result: ${result}, Type: ${betType}`);

    // Call the atomic resolution RPC
    const { data, error } = await supabase.rpc('settle_match_bets', {
      p_match_id: matchId,
      p_result: String(result),
      p_bet_type: betType
    });

    if (error) {
      console.error('❌ [Resolve] RPC Error:', error);
      return new Response(JSON.stringify({ error: error.message }), { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ success: true, summary: data }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { 
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});
