import { NextResponse } from 'next/server';
import {
    validateCsrf,
    verifyAndConsumeChallenge,
    issueAppSession,
    getCapabilitiesForScope,
} from '@/lib/sessionV2';

export async function POST(request: Request) {
    try {
        if (!validateCsrf(request)) {
            return NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 });
        }

        const body = await request.json().catch(() => null);
        if (!body) {
            return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
        }

        const { challengeId, signature, wallet, message, chainId, deviceId } = body;
        if (!challengeId || !signature || !wallet || !message) {
            return NextResponse.json({ error: 'Missing required authentication fields' }, { status: 400 });
        }

        // Verify and consume the challenge
        const verification = await verifyAndConsumeChallenge({
            challengeId: String(challengeId),
            signature: String(signature),
            wallet: String(wallet),
            message: String(message),
            chainId: typeof chainId === 'number' ? chainId : undefined,
        });

        if (!verification.ok) {
            return NextResponse.json(
                { error: verification.error || 'Authentication failed', code: verification.code },
                { status: 401 },
            );
        }

        // Issue app session
        const { token, session, cookieHeader } = await issueAppSession({
            wallet: String(wallet),
            deviceId: deviceId ? String(deviceId) : null,
        });

        const capabilities = getCapabilitiesForScope('app');

        const response = NextResponse.json({
            wallet: session.wallet_address,
            sessionId: session.id,
            token, // Provided for webview/bearer capability probe fallback
            scope: session.scope,
            expiresAt: session.expires_at,
            idleExpiresAt: session.idle_expires_at,
            capabilities,
        });

        // Set __Host-ludo_session cookie
        response.headers.append('Set-Cookie', cookieHeader);

        return response;
    } catch (error) {
        console.error('[auth/verify] error', error);
        return NextResponse.json({ error: (error as Error).message }, { status: 500 });
    }
}
