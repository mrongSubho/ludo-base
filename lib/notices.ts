/**
 * G4 — live-ops notices (signed server-driven strip). No CMS.
 * Notices are operational copy: maintenance, rules, drills, freezes.
 */

export type NoticeLevel = 'info' | 'warn' | 'critical';

export interface OpsNotice {
    id: string;
    level: NoticeLevel;
    title: string;
    body: string;
    /** ISO — hide after this when set. */
    expiresAt?: string;
    /** Optional deep link (docs/ops, status). */
    href?: string;
    /** ISO issuedAt for signature payload. */
    issuedAt: string;
}

/**
 * SEC-26: there is no signature here.
 *
 * The field was called `signature` and held `unsigned:<fnv>`. FNV is unkeyed, so
 * anyone could recompute it for a forged bundle — calling that a signature
 * invites exactly the trust it cannot support. The stamp survives under the name
 * that describes it, and `signature` is explicitly null on the wire so no caller
 * reaches for it.
 */
export interface NoticeBundle {
    version: number;
    issuedAt: string;
    notices: OpsNotice[];
    /** Unkeyed content stamp. NOT a signature — do not verify against it. */
    contentHash?: string;
}

/** Canonical string the content stamp is computed over. */
export function buildNoticeMessage(bundle: Omit<NoticeBundle, 'contentHash'>): string {
    const notices = bundle.notices
        .map((n) => `${n.id}|${n.level}|${n.title}|${n.body}|${n.expiresAt ?? ''}|${n.href ?? ''}|${n.issuedAt}`)
        .join('\n');
    return `Ludo Base notices v${bundle.version}\n${bundle.issuedAt}\n${notices}`;
}

export function isNoticeActive(n: OpsNotice, nowMs: number = Date.now()): boolean {
    if (!n.expiresAt) return true;
    const exp = Date.parse(n.expiresAt);
    return Number.isFinite(exp) ? exp > nowMs : true;
}

export function filterActiveNotices(notices: OpsNotice[], nowMs: number = Date.now()): OpsNotice[] {
    return notices.filter((n) => isNoticeActive(n, nowMs));
}

/** Parse/validate a remote bundle — parse-or-drop like the wire protocol. */
export function parseNoticeBundle(raw: unknown): NoticeBundle | null {
    if (!raw || typeof raw !== 'object') return null;
    const b = raw as Partial<NoticeBundle>;
    if (typeof b.version !== 'number' || !Array.isArray(b.notices)) return null;
    const notices: OpsNotice[] = [];
    for (const n of b.notices) {
        if (!n || typeof n !== 'object') continue;
        const row = n as Partial<OpsNotice>;
        if (typeof row.id !== 'string' || !row.id) continue;
        if (row.level !== 'info' && row.level !== 'warn' && row.level !== 'critical') continue;
        if (typeof row.title !== 'string' || typeof row.body !== 'string') continue;
        notices.push({
            id: row.id,
            level: row.level,
            title: row.title,
            body: row.body,
            expiresAt: typeof row.expiresAt === 'string' ? row.expiresAt : undefined,
            href: typeof row.href === 'string' ? row.href : undefined,
            issuedAt: typeof row.issuedAt === 'string' ? row.issuedAt : (b.issuedAt ?? ''),
        });
    }
    return {
        version: b.version,
        issuedAt: typeof b.issuedAt === 'string' ? b.issuedAt : new Date().toISOString(),
        notices,
        // SEC-26: read the content stamp under its real name. `signature` is
        // gone from the wire, so nothing should expect it here either.
        contentHash: typeof b.contentHash === 'string' ? b.contentHash : undefined,
    };
}

/**
 * Fallback when `/api/notices` is unreachable. Empty on purpose: lobby must
 * never show internal ops drills / docs links. Real player-facing copy ships
 * only via `NOTICE_BUNDLE_JSON` (maintenance, freezes, rules).
 */
export function defaultSeedNotices(): OpsNotice[] {
    return [];
}
