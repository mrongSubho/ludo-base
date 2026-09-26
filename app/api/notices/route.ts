import { NextResponse } from 'next/server';
import {
    buildNoticeMessage,
    filterActiveNotices,
    type SignedNoticeBundle,
    type OpsNotice,
} from '@/lib/notices';

/**
 * G4 live-ops notices. Empty by default (no lobby noise). Production drops
 * come from `NOTICE_BUNDLE_JSON`. Signature covers the canonical message.
 */
export async function GET() {
    // No baked-in seed: internal drills/docs never belong on the player lobby.
    let notices: OpsNotice[] = [];

    const raw = process.env.NOTICE_BUNDLE_JSON;
    if (raw) {
        try {
            const parsed = JSON.parse(raw) as SignedNoticeBundle;
            if (Array.isArray(parsed.notices)) notices = filterActiveNotices(parsed.notices);
        } catch {
            /* stay empty */
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
