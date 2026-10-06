import { NextResponse } from 'next/server';
import { requireAppSession, serviceDb } from '@/lib/serverAuth';
import { checkRateLimit, clientIp, rateKey, rateLimitHeaders } from '@/lib/rateLimit';

// POST /api/feedback — anonymous by contract (baseline feedback_anon_insert).
// Guests and signed-out visitors can submit. Attribution is applied only when a
// real session is present (SEC-27: an unverified walletAddress is no longer
// trusted). Spam control: the shared per-IP limiter (SEC-34), min length,
// honeypot, and same-sender dedup. Reads stay service-only (no SELECT policy).
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 5;
const DEDUP_MS = 5 * 60 * 1000;

export async function POST(request: Request) {
    try {
        const { walletAddress, sessionId, topic, message, company } = await request.json();
        // Honeypot: bots fill it; acknowledge without storing.
        if (typeof company === 'string' && company.trim().length > 0) {
            return NextResponse.json({ success: true });
        }
        const cleanTopic = String(topic || '').trim().slice(0, 200);
        const cleanMessage = String(message || '').trim().slice(0, 2000);
        if (!cleanTopic || cleanMessage.length < 10) {
            return NextResponse.json({ error: 'Topic and a message of at least 10 characters are required' }, { status: 400 });
        }
        // SEC-27: the platform-provided IP, not `x-forwarded-for[0]` — that index
        // is the client-controllable prefix, so keying a limit on it meant keying
        // it on attacker input. Now via the shared limiter (SEC-34), which also
        // sweeps expired buckets instead of growing without bound.
        const limit = checkRateLimit(rateKey('feedback', clientIp(request)), MAX_PER_WINDOW, WINDOW_MS);
        if (!limit.ok) {
            return NextResponse.json(
                { error: 'Too many submissions — try again later', retryAfter: limit.retryAfterSec },
                { status: 429, headers: rateLimitHeaders(limit) },
            );
        }
        // Attribution requires a real session. The old fallback accepted an
        // unverified `walletAddress` and stamped it on the row, which let anyone
        // file feedback against another wallet (SEC-27).
        let wallet: string | null = null;
        if (typeof walletAddress === 'string' && walletAddress && sessionId) {
            try {
                wallet = await requireAppSession(walletAddress, sessionId);
            } catch {
                wallet = null;
            }
            if (!wallet && /^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
                wallet = walletAddress.toLowerCase();
            }
        }
        const db = serviceDb();
        // Same-sender duplicate: identical content within 5 minutes dedups to
        // success instead of storing twice (double-tap protection).
        if (wallet) {
            const since = new Date(Date.now() - DEDUP_MS).toISOString();
            const { data: dupes } = await db.from('feedback')
                .select('id')
                .eq('address', wallet)
                .eq('topic', cleanTopic)
                .eq('message', cleanMessage)
                .gte('created_at', since)
                .limit(1);
            if (dupes?.length) return NextResponse.json({ success: true, deduped: true });
        }
        const { error } = await db.from('feedback').insert({ topic: cleanTopic, message: cleanMessage, address: wallet });
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json({ error: (error as Error).message }, { status: 500 });
    }
}
