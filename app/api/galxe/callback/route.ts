import { NextResponse } from 'next/server';
import { serviceDb, ensurePlayerRow } from '@/lib/serverAuth';
import {
    isOnboardingTrack,
    ONBOARDING_TRACKS,
    normalizeReferralCode,
    referralTierForSuccessOrder,
    verifyGalxeHmac,
    type OnboardingTrack,
} from '@/lib/onboardingServer';

/**
 * POST /api/galxe/callback
 * Galxe webhook (HMAC-callback-ready). Requires GALXE_HMAC_SECRET — when
 * unset the route fails closed with a clear error (no production Galxe
 * credentials are invented here).
 *
 * Signature headers tried: x-galxe-signature, x-signature, x-hub-signature-256.
 * HMAC-SHA256 over the raw body (hex or base64, optional `sha256=` prefix).
 *
 * Body (JSON):
 *   { event?, walletAddress?, track?, delta?, referrerAddress?, refereeAddress?, referralCode? }
 *   - track + walletAddress  → upsert onboarding_progress
 *   - event 'referral_success' (or track 'referral_success') → resolve referral
 */
export async function POST(request: Request) {
    try {
        const secret = process.env.GALXE_HMAC_SECRET;
        if (!secret) {
            return NextResponse.json(
                { error: 'GALXE_HMAC_SECRET is not configured' },
                { status: 503 },
            );
        }

        const rawBody = await request.text();
        const signature =
            request.headers.get('x-galxe-signature') ??
            request.headers.get('x-signature') ??
            request.headers.get('x-hub-signature-256');
        if (!signature) {
            return NextResponse.json({ error: 'Missing signature header' }, { status: 401 });
        }
        if (!verifyGalxeHmac(rawBody, signature, secret)) {
            return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
        }

        let payload: {
            event?: string;
            walletAddress?: string;
            track?: string;
            delta?: number;
            referrerAddress?: string;
            refereeAddress?: string;
            referralCode?: string;
        };
        try {
            payload = JSON.parse(rawBody);
        } catch {
            return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
        }

        const db = serviceDb();
        const event = String(payload.event ?? '').toLowerCase();
        const trackRaw = payload.track;
        const isReferralEvent =
            event.includes('referral') ||
            trackRaw === 'referral_success' ||
            (payload.referrerAddress && payload.refereeAddress);

        if (isReferralEvent) {
            return await resolveReferralSuccess(db, payload);
        }

        const wallet = String(payload.walletAddress ?? '').toLowerCase();
        if (!/^0x[a-f0-9]{40}$/.test(wallet)) {
            return NextResponse.json({ error: 'Missing walletAddress' }, { status: 400 });
        }
        if (!isOnboardingTrack(trackRaw)) {
            return NextResponse.json({ error: 'Unknown track' }, { status: 400 });
        }
        const track = trackRaw as OnboardingTrack;
        const def = ONBOARDING_TRACKS[track];
        const rawDelta = payload.delta;
        let delta = 1;
        if (rawDelta !== undefined && rawDelta !== null) {
            const n = Number(rawDelta);
            if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
                return NextResponse.json({ error: 'Invalid delta' }, { status: 400 });
            }
            delta = Math.min(n, def.target);
        }

        const provision = await ensurePlayerRow(wallet);
        if (provision) return NextResponse.json({ error: provision }, { status: 500 });

        const { data: existing, error: readError } = await db
            .from('onboarding_progress')
            .select('progress, target, is_claimed')
            .eq('wallet_address', wallet)
            .eq('track', track)
            .maybeSingle();
        if (readError) return NextResponse.json({ error: readError.message }, { status: 500 });

        const target = existing?.target && existing.target > 0 ? existing.target : def.target;
        const progress = Math.min((existing?.progress ?? 0) + delta, target);
        const { error: upsertError } = await db.from('onboarding_progress').upsert(
            {
                wallet_address: wallet,
                track,
                progress,
                target,
                is_claimed: existing?.is_claimed ?? false,
                updated_at: new Date().toISOString(),
            },
            { onConflict: 'wallet_address,track' },
        );
        if (upsertError) return NextResponse.json({ error: upsertError.message }, { status: 500 });

        return NextResponse.json({ success: true, track, progress, target, complete: progress >= target });
    } catch (err) {
        return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
}

type Db = ReturnType<typeof serviceDb>;

async function resolveReferralSuccess(
    db: Db,
    payload: {
        referrerAddress?: string;
        refereeAddress?: string;
        referralCode?: string;
        walletAddress?: string;
    },
) {
    // Referee is explicit, or implied by walletAddress; referrer by wallet or code.
    const referee = String(payload.refereeAddress ?? payload.walletAddress ?? '').toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(referee)) {
        return NextResponse.json({ error: 'Missing refereeAddress' }, { status: 400 });
    }

    let referrer: string | null = String(payload.referrerAddress ?? '').toLowerCase() || null;
    if (referrer && !/^0x[a-f0-9]{40}$/.test(referrer)) referrer = null;
    if (!referrer) {
        const parsed = normalizeReferralCode(payload.referralCode);
        if (parsed?.kind === 'wallet') referrer = parsed.wallet;
        else if (parsed?.kind === 'code') {
            const { data: matches } = await db
                .from('players')
                .select('wallet_address')
                .ilike('wallet_address', `0x${parsed.code}%`)
                .limit(2);
            if (matches && matches.length === 1) referrer = String(matches[0].wallet_address).toLowerCase();
        }
    }
    if (!referrer) {
        // Fall back to the bound link for this referee.
        const { data: bound } = await db
            .from('referral_links')
            .select('referrer_wallet')
            .eq('referee_wallet', referee)
            .limit(1);
        referrer = bound?.[0]?.referrer_wallet ? String(bound[0].referrer_wallet).toLowerCase() : null;
    }
    if (!referrer || referrer === referee) {
        return NextResponse.json({ error: 'Referral pair not found' }, { status: 404 });
    }

    const { data: link, error: linkError } = await db
        .from('referral_links')
        .select('referrer_wallet, referee_wallet, status, tier_paid')
        .eq('referrer_wallet', referrer)
        .eq('referee_wallet', referee)
        .maybeSingle();
    if (linkError) return NextResponse.json({ error: linkError.message }, { status: 500 });
    if (!link) return NextResponse.json({ error: 'Referral link not found' }, { status: 404 });
    if (link.status === 'successful') {
        return NextResponse.json({ success: true, status: 'successful', tier_paid: link.tier_paid });
    }

    const { data: successRows, error: countError } = await db
        .from('referral_links')
        .select('referee_wallet')
        .eq('referrer_wallet', referrer)
        .eq('status', 'successful');
    if (countError) return NextResponse.json({ error: countError.message }, { status: 500 });
    const tier = referralTierForSuccessOrder(successRows?.length ?? 0);

    const { error: updateError } = await db
        .from('referral_links')
        .update({
            status: 'successful',
            tier_paid: tier,
            completed_at: new Date().toISOString(),
        })
        .eq('referrer_wallet', referrer)
        .eq('referee_wallet', referee)
        .eq('status', 'pending');
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

    return NextResponse.json({ success: true, status: 'successful', tier_paid: tier });
}
