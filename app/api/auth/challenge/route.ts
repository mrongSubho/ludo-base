import { NextResponse } from 'next/server';
import { createAuthChallenge } from '@/lib/sessionV2';
import { clientIp } from '@/lib/rateLimit';

export async function POST(request: Request) {
    try {
        const body = await request.json().catch(() => ({}));
        const { walletAddress, chainId } = body;

        const host = request.headers.get('host') || 'ludobase.com';
        const userAgent = request.headers.get('user-agent');
        const ip = clientIp(request);

        const challenge = await createAuthChallenge({
            walletAddress: walletAddress ? String(walletAddress) : null,
            host,
            userAgent,
            ip,
            chainId: typeof chainId === 'number' ? chainId : undefined,
        });

        return NextResponse.json(challenge);
    } catch (error) {
        console.error('[auth/challenge] error', error);
        return NextResponse.json({ error: (error as Error).message }, { status: 500 });
    }
}
