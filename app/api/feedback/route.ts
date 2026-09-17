import { NextResponse } from 'next/server';
import { requireAppSession, serviceDb } from '@/lib/serverAuth';

// POST /api/feedback — anonymous by contract (baseline feedback_anon_insert).
// Guests and signed-out visitors can submit; attribution is best-effort only.
// Spam control without identity: per-IP throttle, min length, honeypot, and
// same-sender duplicate dedup. Reads stay service-only (no SELECT policy).
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 5;
const DEDUP_MS = 5 * 60 * 1000;
const ipHits = new Map<string, number[]>();

function throttleOk(ip: string): boolean {
    const now = Date.now();
    const hits = (ipHits.get(ip) || []).filter(t => now - t < WINDOW_MS);
    if (hits.length >= MAX_PER_WINDOW) {
        ipHits.set(ip, hits);
        return false;
    }
    hits.push(now);
    ipHits.set(ip, hits);
    // Opportunistic cleanup so the map can't grow without bound.
    if (ipHits.size > 5000) {
        for (const [k, v] of ipHits) {
            if (v.length === 0 || now - v[v.length - 1] >= WINDOW_MS) ipHits.delete(k);
        }
    }
    return true;
}

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
        const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() || 'unknown';
        if (!throttleOk(ip)) {
            return NextResponse.json({ error: 'Too many submissions — try again later' }, { status: 429 });
        }
        // Optional attribution: a valid session pins the sender, anything
        // else submits unattributed. Never rejects.
        let wallet: string | null = null;
        if (typeof walletAddress === 'string' && walletAddress) {
            try {
                wallet = await requireAppSession(walletAddress, sessionId ?? null);
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
