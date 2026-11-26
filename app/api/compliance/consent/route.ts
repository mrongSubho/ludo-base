import { NextResponse } from 'next/server';
import { requireAppSession, requireSessionWallet, serviceDb } from '@/lib/serverAuth';
import { getServerConfig } from '@/lib/configRegistry';
import {
    extractCountryCode,
    getComplianceStatus,
    hashClientIp,
    isBlockedCountry,
    isEuDmaCountry,
} from '@/lib/compliance';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const rawWallet = searchParams.get('walletAddress')?.trim().toLowerCase();
        const wallet = await requireSessionWallet(request, {
            scope: 'app',
            ...(rawWallet ? { expectedWallet: rawWallet } : {}),
        });
        const authHeader = request.headers.get('authorization');
        const bearer = authHeader?.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : null;
        const headerSid = request.headers.get('x-session-id')?.trim() || bearer;
        const fallback = !wallet && headerSid ? await requireAppSession(rawWallet, headerSid) : null;
        const effectiveWallet = (wallet || fallback || '').toLowerCase();

        if (!effectiveWallet) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const status = await getComplianceStatus(request, effectiveWallet);
        return NextResponse.json(status);
    } catch (err: unknown) {
        return NextResponse.json({ error: (err as Error).message || 'Failed to read compliance status' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const body = (await request.json().catch(() => ({}))) as {
            walletAddress?: string;
            sessionId?: string;
            tosAccepted?: boolean;
            privacyAccepted?: boolean;
            age18Confirmed?: boolean;
            analyticsConsent?: boolean;
            euDmaAcknowledged?: boolean;
        };

        const rawWallet = typeof body.walletAddress === 'string' ? body.walletAddress.trim().toLowerCase() : undefined;
        const sessionWallet = await requireSessionWallet(request, {
            scope: 'app',
            ...(rawWallet ? { expectedWallet: rawWallet } : {}),
        });
        const fallbackWallet =
            !sessionWallet && rawWallet && body.sessionId
                ? await requireAppSession(rawWallet, body.sessionId)
                : null;
        const wallet = (sessionWallet || fallbackWallet || '').toLowerCase();

        if (!wallet) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const cfg = await getServerConfig();
        const country = extractCountryCode(request);
        if (isBlockedCountry(country, cfg)) {
            return NextResponse.json(
                { error: `Paid features are restricted in your region (${country}).`, code: 'GEO_RESTRICTED', country },
                { status: 451 },
            );
        }

        const isEuDma = isEuDmaCountry(country, cfg);
        if (body.tosAccepted !== true || body.privacyAccepted !== true || body.age18Confirmed !== true) {
            return NextResponse.json(
                { error: 'Must affirmatively accept Terms, Privacy Policy, and confirm age 18+.' },
                { status: 400 },
            );
        }
        if (isEuDma && body.euDmaAcknowledged !== true) {
            return NextResponse.json(
                { error: 'EU/EEA DSA & DMA statutory disclosure acknowledgment is required.' },
                { status: 400 },
            );
        }

        const ipHash = await hashClientIp(request);
        const nowIso = new Date().toISOString();
        const db = serviceDb();

        // Ensure players FK row exists cleanly before upserting player_consents
        await db.from('players').upsert(
            {
                wallet_address: wallet,
            },
            { onConflict: 'wallet_address', ignoreDuplicates: true },
        );

        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- player_consents table upsert
        const adminDb = db as any;
        const { error: upsertErr } = await adminDb.from('player_consents').upsert(
            {
                wallet_address: wallet,
                tos_version: cfg[1005].tosVersion,
                privacy_version: cfg[1005].privacyVersion,
                age_18_confirmed: true,
                region_code: country,
                analytics_consent: Boolean(body.analyticsConsent),
                eu_dma_acknowledged: isEuDma ? Boolean(body.euDmaAcknowledged) : Boolean(body.euDmaAcknowledged),
                ip_hash: ipHash,
                accepted_at: nowIso,
                updated_at: nowIso,
            },
            { onConflict: 'wallet_address' },
        );

        if (upsertErr) {
            return NextResponse.json({ error: upsertErr.message || 'Failed to save consent' }, { status: 500 });
        }

        const updated = await getComplianceStatus(request, wallet, cfg);
        return NextResponse.json(updated);
    } catch (err: unknown) {
        return NextResponse.json({ error: (err as Error).message || 'Unexpected error' }, { status: 500 });
    }
}
