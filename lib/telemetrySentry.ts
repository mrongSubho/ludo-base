/**
 * Sentry-compatible telemetry transport (no @sentry/* dependency).
 * When NEXT_PUBLIC_SENTRY_DSN is set, events post to the Sentry store endpoint.
 * Signature/session/seed keys remain redacted by lib/telemetry before this sees them.
 */

import type { TelemetryProps } from './telemetry';

export type SentryTransportOptions = {
    dsn: string;
    release?: string;
    environment?: string;
};

type DsnParts = {
    publicKey: string;
    host: string;
    path: string;
    projectId: string;
};

/** Parse `https://<key>@host/<project>` (path-prefixed SaaS DSNs supported). */
export function parseSentryDsn(dsn: string): DsnParts | null {
    try {
        const url = new URL(dsn);
        const publicKey = url.username;
        if (!publicKey) return null;
        const parts = url.pathname.split('/').filter(Boolean);
        const projectId = parts.pop() ?? '';
        const path = parts.length ? `/${parts.join('/')}` : '';
        if (!projectId) return null;
        return { publicKey, host: url.host, path, projectId };
    } catch {
        return null;
    }
}

export function sentryStoreUrl(parts: DsnParts): string {
    const proto = parts.host.includes('localhost') ? 'http' : 'https';
    return `${proto}://${parts.host}${parts.path}/api/${parts.projectId}/store/`;
}

export function createSentryTransport(opts: SentryTransportOptions) {
    const parts = parseSentryDsn(opts.dsn);
    if (!parts) {
        throw new Error('invalid Sentry DSN');
    }
    const endpoint = sentryStoreUrl(parts);
    const headers = {
        'Content-Type': 'application/json',
        'X-Sentry-Auth': [
            'Sentry sentry_version=7',
            `sentry_client=ludo-base/0.1`,
            `sentry_key=${parts.publicKey}`,
        ].join(', '),
    };

    async function send(body: Record<string, unknown>): Promise<void> {
        try {
            await fetch(endpoint, {
                method: 'POST',
                headers,
                body: JSON.stringify(body),
                keepalive: true,
            });
        } catch {
            /* never break play */
        }
    }

    return {
        track(event: string, props?: TelemetryProps) {
            void send({
                event: 'log',
                message: event,
                level: 'info',
                platform: 'javascript',
                timestamp: Math.floor(Date.now() / 1000),
                environment: opts.environment ?? process.env.NODE_ENV ?? 'development',
                release: opts.release ?? 'ludo-base@0.1.0',
                tags: { kind: 'funnel', event },
                extra: props ?? {},
            });
        },
        exception(error: unknown, props?: TelemetryProps) {
            const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
            void send({
                event: 'log',
                message,
                level: 'error',
                platform: 'javascript',
                timestamp: Math.floor(Date.now() / 1000),
                environment: opts.environment ?? process.env.NODE_ENV ?? 'development',
                release: opts.release ?? 'ludo-base@0.1.0',
                tags: { kind: 'exception' },
                extra: {
                    ...(props ?? {}),
                    stack: error instanceof Error ? error.stack : undefined,
                },
            });
        },
    };
}

/** True when a usable DSN is present in env (client-safe name). */
export function readSentryDsn(): string | undefined {
    return (
        process.env.NEXT_PUBLIC_SENTRY_DSN ||
        process.env.SENTRY_DSN ||
        undefined
    );
}
