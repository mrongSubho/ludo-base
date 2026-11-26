import { NextResponse } from 'next/server';
import { getServerConfigEnvelope } from '@/lib/configRegistry';

/**
 * GET /api/config?v=1
 * Serves versioned, ETag-cached operational & compliance buckets signed with ECDSA P-256
 * when NEXT_PUBLIC_CONFIG_PUBKEY / CONFIG_KV are provisioned.
 */
export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const rawVersion = searchParams.get('v') ?? '1';
    const version = Number(rawVersion);

    if (!Number.isInteger(version) || version !== 1) {
        return NextResponse.json(
            { error: 'Unsupported config version', supportedVersions: [1] },
            { status: 400 },
        );
    }

    const envelope = await getServerConfigEnvelope();
    const etag = `"v${envelope.version}-${envelope.issuedAt}-${envelope.signature.slice(0, 12)}"`;

    if (request.headers.get('if-none-match') === etag) {
        return new NextResponse(null, {
            status: 304,
            headers: {
                ETag: etag,
                'Cache-Control': 'public, max-age=30, stale-while-revalidate=60',
            },
        });
    }

    return NextResponse.json(envelope, {
        status: 200,
        headers: {
            ETag: etag,
            'Cache-Control': 'public, max-age=30, stale-while-revalidate=60',
        },
    });
}
