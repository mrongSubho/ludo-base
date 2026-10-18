import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/serverAuth';
import {
    validateCsrf,
    parseSessionToken,
    revokeSessionByToken,
    buildClearCookieHeader,
} from '@/lib/sessionV2';

export async function POST(request: Request) {
    try {
        if (!validateCsrf(request)) {
            return NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 });
        }

        // Validate session if present
        await requireSession(request);
        const token = parseSessionToken(request);
        if (token) {
            await revokeSessionByToken(token);
        }

        const response = NextResponse.json({ success: true });
        response.headers.append('Set-Cookie', buildClearCookieHeader());
        return response;
    } catch (error) {
        console.error('[auth/logout] error', error);
        return NextResponse.json({ error: (error as Error).message }, { status: 500 });
    }
}
