import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/serverAuth';
import {
    validateCsrf,
    parseSessionToken,
    issueMatchSession,
    getCapabilitiesForScope,
    type SessionScope,
} from '@/lib/sessionV2';

export async function POST(request: Request) {
    try {
        if (!validateCsrf(request)) {
            return NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 });
        }

        const auth = await requireSession(request, { scope: 'app' });
        const appToken = parseSessionToken(request);
        if (!auth || !appToken) {
            return NextResponse.json({ error: 'Valid app session required' }, { status: 401 });
        }

        const body = await request.json().catch(() => null);
        if (!body || !body.matchId) {
            return NextResponse.json({ error: 'Missing matchId' }, { status: 400 });
        }

        const matchId = String(body.matchId);
        const asRole = body.as === 'spectator' ? 'spectator' : 'match';

        const { token, session, ticket, cookieHeader } = await issueMatchSession({
            appSessionToken: appToken,
            matchId,
            scope: asRole,
        });

        const capabilities = getCapabilitiesForScope(session.scope as SessionScope);

        const response = NextResponse.json({
            matchId: session.match_id,
            scope: session.scope,
            token, // Token for in-band join frame or bearer
            ticket, // Single-use ticket for wss upgrade URL (?ticket=...)
            expiresAt: session.expires_at,
            idleExpiresAt: session.idle_expires_at,
            capabilities,
        });

        response.headers.append('Set-Cookie', cookieHeader);
        return response;
    } catch (error) {
        const msg = (error as Error).message;
        const status = msg.includes('not a participant') ? 403 : msg.includes('not found') ? 404 : 401;
        return NextResponse.json({ error: msg }, { status });
    }
}
