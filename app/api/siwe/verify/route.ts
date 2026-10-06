import { NextResponse } from 'next/server';
import { buildSiweMessage, APP_SESSION_TTL_MS } from '@/lib/sessionProof';
import { parseChainId, DEFAULT_CHAIN_ID } from '@/lib/chains';
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
 * Domains this deployment will issue a session for.
 *
 * The request `Host` is the primary answer — it is what the user actually
 * reached. `SIWE_ALLOWED_DOMAINS` adds anything else this deployment is served
 * from (a custom domain, a preview host), because the Host header alone would
 * reject a legitimate alias and there is no safe default for that.
 */
function allowedDomains(host: string): Set<string> {
    const set = new Set<string>();
    if (host) set.add(host.toLowerCase());
    for (const d of (process.env.SIWE_ALLOWED_DOMAINS || '').split(',')) {
        const t = d.trim().toLowerCase();
        if (t) set.add(t);
    }
    return set;
}

/**
 * SIWE app session for chat / profile / settings.
 * NOT for match moves (those use match_sessions / move-auth).
 *
 * SEC-21: `domain` arrives in the body and is inside the signed message — which
 * sounds like protection and is not. The server rebuilt the message using the
 * same attacker-chosen domain, verified the signature against it, and issued a
 * session. So a signature harvested on a phishing site (`domain: evil.example`)
 * replayed straight into this endpoint and minted a session here. The domain has
 * to be compared against the request we are actually serving.
 */
export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { domain, address, nonce, issuedAt, expirationTime, signature } = body;
        if (!domain || !address || !nonce || !issuedAt || !expirationTime || !signature) {
            return NextResponse.json({ error: 'Missing SIWE fields' }, { status: 400 });
        }
        // Dual-chain gate: explicit chain ids must be allowlisted (84532/8453).
        // Absent = mainnet default (existing sessions keep verifying).
        if (body.chainId !== undefined && parseChainId(body.chainId) === null) {
            return NextResponse.json({ error: 'Unsupported chain' }, { status: 400 });
        }
        const chainId = parseChainId(body.chainId) ?? DEFAULT_CHAIN_ID;
        if (new Date(expirationTime).getTime() < Date.now()) {
            return NextResponse.json({ error: 'Already expired' }, { status: 400 });
        }
        if (new Date(expirationTime).getTime() > Date.now() + APP_SESSION_TTL_MS + 60_000) {
            return NextResponse.json({ error: 'Expiration too far' }, { status: 400 });
        }

        // SEC-21 (1): the domain must be one we are actually serving.
        const host = request.headers.get('host') || '';
        const allowed = allowedDomains(host);
        if (!allowed.has(String(domain).toLowerCase())) {
            console.warn('[siwe] rejected domain', JSON.stringify({ domain, host }));
            return NextResponse.json({ error: 'Domain not allowed' }, { status: 401 });
        }

        const message = buildSiweMessage({
            domain,
            address,
            issuedAt,
            expirationTime,
            nonce,
            chainId,
        });
        if (body.message && body.message !== message) {
            return NextResponse.json({ error: 'Message mismatch' }, { status: 401 });
        }

        // 6492-aware: plain ecrecover for EOAs, universal-validator
        // (1271 + counterfactual 6492) for smart accounts on the message chain.
        // Distinct codes so storms are observable, not silent.
        const verdict = await verifyPersonalSign({
            address: String(address),
            message,
            signature,
            chainId,
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
            console.error('[siwe] player provision failed', JSON.stringify({
                code: playerError.code, message: playerError.message, hint: playerError.hint,
            }));
            return NextResponse.json({ error: 'Could not provision profile' }, { status: 500 });
        }
        await db
            .from('app_sessions')
            .update({ revoked_at: new Date().toISOString() })
            .eq('wallet_address', recovered)
            .is('revoked_at', null);

        // SEC-21 (2): a nonce is single-use. The client used to choose it and the
        // server only stored it, so one signature could mint unlimited sessions
        // for the TTL. A server-issued challenge endpoint would be the full fix;
        // refusing a nonce that has already been used gets the same replay
        // property without adding a round trip to every sign-in.
        const { data: seenNonce } = await db
            .from('app_sessions')
            .select('id')
            .eq('nonce', nonce)
            .limit(1);
        if (seenNonce && seenNonce.length > 0) {
            return NextResponse.json({ error: 'Nonce already used' }, { status: 409 });
        }

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
            console.error('[siwe] session insert failed', JSON.stringify({
                code: error?.code, message: error?.message, hint: error?.hint,
            }));
            return NextResponse.json({ error: 'Could not create session' }, { status: 500 });
        }

        return NextResponse.json({
            success: true,
            sessionId: row.id,
            expiresAt: row.expires_at,
            wallet: recovered,
        });
    } catch (err) {
        console.error('[siwe] unhandled', (err as Error)?.stack || String(err));
        return NextResponse.json({ error: 'Sign-in failed' }, { status: 500 });
    }
}
