import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/serverAuth';
import { getCapabilitiesForScope } from '@/lib/sessionV2';

export async function GET(request: Request) {
    try {
        const auth = await requireSession(request, { scope: 'app' });
        if (!auth) {
            // Also check match scope in case a client polls its match session
            const matchAuth = await requireSession(request, { scope: 'match' });
            if (!matchAuth) {
                return NextResponse.json({ authenticated: false }, { status: 401 });
            }
            return NextResponse.json({
                authenticated: true,
                wallet: matchAuth.wallet,
                scope: matchAuth.scope,
                matchId: matchAuth.matchId,
                capabilities: getCapabilitiesForScope(matchAuth.scope),
            });
        }

        const capabilities = getCapabilitiesForScope(auth.scope);
        return NextResponse.json({
            authenticated: true,
            wallet: auth.wallet,
            scope: auth.scope,
            matchId: auth.matchId,
            expiresAt: auth.session?.expires_at,
            idleExpiresAt: auth.session?.idle_expires_at,
            capabilities,
        });
    } catch (error) {
        return NextResponse.json({ error: (error as Error).message }, { status: 500 });
    }
}
