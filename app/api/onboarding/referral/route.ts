import { NextResponse } from 'next/server';
import { requireAppSession, serviceDb, ensurePlayerRow } from '@/lib/serverAuth';
import {
    REFERRAL_SLOTS,
    REFERRAL_TIER_TAIL,
    REFERRAL_TIER_TOP,
    REFERRAL_TIER_WINNERS,
    normalizeReferralCode,
    referralCodeFor,
} from '@/lib/onboardingServer';

/**
 * GET /api/onboarding/referral?walletAddress=0x…&sessionId=…
 * My referral code, invite link, and slot/resolve counters.
 *
 * POST /api/onboarding/referral
 * Body: { walletAddress, sessionId, code }
 * Bind this wallet as referee of `code` (full referrer wallet or short code).
 * Anti-self-referral; one referrer per referee, ever.
 */
export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const wallet = await requireAppSession(
            searchParams.get('walletAddress'),
            searchParams.get('sessionId'),
        );
        if (!wallet) return NextResponse.json({ error: 'Invalid session' }, { status: 401 });

        const db = serviceDb();
        const { data: outgoing, error } = await db
            .from('referral_links')
            .select('referee_wallet, status, tier_paid, created_at, completed_at')
            .eq('referrer_wallet', wallet);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });

        const links = outgoing ?? [];
        const successful = links.filter((l: { status: string }) => l.status === 'successful').length;
        const unsuccessful = links.filter((l: { status: string }) => l.status === 'unsuccessful').length;
        const pending = links.filter((l: { status: string }) => l.status === 'pending').length;

        const { data: inbound } = await db
            .from('referral_links')
            .select('referrer_wallet, code, status, created_at')
            .eq('referee_wallet', wallet)
            .limit(1);

        const code = referralCodeFor(wallet);
        return NextResponse.json({
            wallet,
            code,
            referrer: inbound?.[0]?.referrer_wallet ?? null,
            successful,
            unsuccessful,
            pending,
            slotsUsed: links.length,
            slotsRemaining: Math.max(REFERRAL_SLOTS - links.length, 0),
            tierTop: REFERRAL_TIER_TOP,
            tierTail: REFERRAL_TIER_TAIL,
            tierWinners: REFERRAL_TIER_WINNERS,
            links: links.map((l: { referee_wallet: string; status: string; tier_paid: number | null; completed_at: string | null }) => ({
                referee: l.referee_wallet,
                status: l.status,
                tier_paid: l.tier_paid,
                completed_at: l.completed_at,
            })),
        });
    } catch (err) {
        return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const wallet = await requireAppSession(body?.walletAddress, body?.sessionId);
        if (!wallet) return NextResponse.json({ error: 'Invalid session' }, { status: 401 });

        const parsed = normalizeReferralCode(body?.code ?? body?.referralCode);
        if (!parsed) {
            return NextResponse.json({ error: 'Invalid referral code' }, { status: 400 });
        }

        const db = serviceDb();
        let referrer: string | null = null;
        if (parsed.kind === 'wallet') {
            referrer = parsed.wallet;
        } else {
            // Short code = first 8 hex of the referrer wallet; resolve by prefix.
            const { data: matches, error: lookupError } = await db
                .from('players')
                .select('wallet_address')
                .ilike('wallet_address', `0x${parsed.code}%`)
                .limit(2);
            if (lookupError) return NextResponse.json({ error: lookupError.message }, { status: 500 });
            if (!matches || matches.length !== 1) {
                return NextResponse.json({ error: 'Referral code not found' }, { status: 404 });
            }
            referrer = String(matches[0].wallet_address).toLowerCase();
        }

        // Anti-self-referral (DB CHECK enforces too).
        if (!referrer || referrer === wallet) {
            return NextResponse.json({ error: 'Cannot refer yourself' }, { status: 400 });
        }

        // One referrer per referee, ever (no code rotation / re-bind farming).
        const { data: prior, error: priorError } = await db
            .from('referral_links')
            .select('referrer_wallet, code, status')
            .eq('referee_wallet', wallet)
            .limit(1);
        if (priorError) return NextResponse.json({ error: priorError.message }, { status: 500 });
        if (prior && prior.length > 0) {
            return NextResponse.json({ error: 'Already referred' }, { status: 409 });
        }

        const { data: referrerRow, error: referrerError } = await db
            .from('players')
            .select('wallet_address')
            .eq('wallet_address', referrer)
            .maybeSingle();
        if (referrerError) return NextResponse.json({ error: referrerError.message }, { status: 500 });
        if (!referrerRow) {
            return NextResponse.json({ error: 'Referrer not found' }, { status: 404 });
        }

        for (const w of [wallet, referrer]) {
            const provision = await ensurePlayerRow(w);
            if (provision) return NextResponse.json({ error: provision }, { status: 500 });
        }

        const code = referralCodeFor(referrer);
        const { error: insertError } = await db.from('referral_links').insert({
            referrer_wallet: referrer,
            referee_wallet: wallet,
            code,
            status: 'pending',
        });
        if (insertError) {
            // Unique (referrer, referee) or self-check — surface as conflict.
            return NextResponse.json({ error: insertError.message }, { status: 409 });
        }

        return NextResponse.json({
            success: true,
            referrer,
            code,
            status: 'pending',
        });
    } catch (err) {
        return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
}
