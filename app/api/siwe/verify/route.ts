import { NextResponse } from 'next/server';
import { buildSiweMessage, APP_SESSION_TTL_MS } from '@/lib/sessionProof';
import { verifyPersonalSign } from '@/lib/walletVerify';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

/** Lazy client — module eval at build time must not require secrets. */
let _sb: SupabaseClient | null = null;
function supabase(): SupabaseClient {
    if (_sb) return _sb;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
        throw new Error('Supabase service key is not configured');
    }
    _sb = createClient(url, key);
    return _sb;
}

/**
 * SIWE app session for chat / profile / settings.
 * NOT for match moves (those use match_sessions / move-auth).
 */
export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { domain, address, nonce, issuedAt, expirationTime, signature } = body;
        if (!domain || !address || !nonce || !issuedAt || !expirationTime || !signature) {
            return NextResponse.json({ error: 'Missing SIWE fields' }, { status: 400 });
        }
        if (new Date(expirationTime).getTime() < Date.now()) {
            return NextResponse.json({ error: 'Already expired' }, { status: 400 });
        }
        if (new Date(expirationTime).getTime() > Date.now() + APP_SESSION_TTL_MS + 60_000) {
            return NextResponse.json({ error: 'Expiration too far' }, { status: 400 });
        }

        const message = buildSiweMessage({
            domain,
            address,
            issuedAt,
            expirationTime,
            nonce,
        });
        if (body.message && body.message !== message) {
            return NextResponse.json({ error: 'Message mismatch' }, { status: 401 });
        }

        // 6492-aware: plain ecrecover for EOAs, universal-validator
        // (1271 + counterfactual 6492) for smart accounts on Base 8453.
        // Distinct codes so storms are observable, not silent.
        const verdict = await verifyPersonalSign({
            address: String(address),
            message,
            signature,
        });
        if (!verdict.ok) {
            const error = verdict.code === 'ecrecover-invalid' ? 'Invalid signature' : 'Signer mismatch';
            return NextResponse.json({ error, code: verdict.code }, { status: 401 });
        }
        const recovered = String(address).toLowerCase();

        const db = supabase();
        // First-time wallets have no players row yet, and app_sessions FKs to
        // it — provision minimally or every fresh sign-in 500s in a retry
        // storm (constant signing popups). Idempotent, defaults fill the rest.
        const { error: playerError } = await db
            .from('players')
            .upsert({ wallet_address: recovered }, { onConflict: 'wallet_address', ignoreDuplicates: true });
        if (playerError) {
            return NextResponse.json({ error: playerError.message }, { status: 500 });
        }
        await db
            .from('app_sessions')
            .update({ revoked_at: new Date().toISOString() })
            .eq('wallet_address', recovered)
            .is('revoked_at', null);

        const { data: row, error } = await db
            .from('app_sessions')
            .insert({
                wallet_address: recovered,
                nonce,
                expires_at: new Date(expirationTime).toISOString(),
            })
            .select('id, expires_at')
            .single();
        if (error || !row) {
            return NextResponse.json({ error: error?.message || 'insert failed' }, { status: 500 });
        }

        return NextResponse.json({
            success: true,
            sessionId: row.id,
            expiresAt: row.expires_at,
            wallet: recovered,
        });
    } catch (err) {
        return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
}
