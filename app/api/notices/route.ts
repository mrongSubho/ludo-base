import { NextResponse } from 'next/server';
import {
    buildNoticeMessage,
    filterActiveNotices,
    type SignedNoticeBundle,
    type OpsNotice,
} from '@/lib/notices';

/**
 * G4 live-ops notices. Static seed for now; swap `NOTICE_BUNDLE_JSON` env
 * for production drops. Signature covers the canonical message (content hash).
 */
export async function GET() {
    const seed: OpsNotice[] = [
        {
            id: 'netcode-drills',
            level: 'info',
            title: 'Netcode drills live',
            body: 'Reconnect and resync drills run against every multiplayer build.',
            href: '/docs/ops/NETCODE_DRILLS.md',
            issuedAt: '2026-09-22T00:00:00.000Z',
        },
    ];

    let notices = filterActiveNotices(seed);

    const raw = process.env.NOTICE_BUNDLE_JSON;
    if (raw) {
        try {
            const parsed = JSON.parse(raw) as SignedNoticeBundle;
            if (Array.isArray(parsed.notices)) notices = filterActiveNotices(parsed.notices);
        } catch {
            /* keep seed */
        }
    }

    const issuedAt = new Date().toISOString();
    const bundle = {
        version: 1,
        issuedAt,
        notices,
    };
    const message = buildNoticeMessage(bundle);
    // Lightweight content stamp until ops signing key lands (crypto.subtle / eth_sig).
    const signature = `unsigned:${simpleHash(message)}`;

    return NextResponse.json({ ...bundle, signature });
}

function simpleHash(input: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
        h ^= input.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
}
