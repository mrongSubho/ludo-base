"use client";

import React, { useEffect } from 'react';
import ErrorCard, { type ErrorCardAction } from './components/ErrorCard';
import { friendlyErrorFromMessage } from '@/lib/errorCopy';
import { captureException } from '@/lib/telemetry';

// ─── Route error boundary ────────────────────────────────────────────────────
// Catches uncaught client exceptions under this route and contains them:
// shows the real error (message, not a dead screen) with a retry. Without
// this, one throwing panel takes down the whole app with no diagnosis.
//
// The card is the shared ErrorCard (image-1 design), centred full-viewport.
// Only the CTA changes per case: a chunk-load failure can't heal via reset()
// — the bundle URL itself is dead — so it hard-reloads to a fresh manifest
// and is labelled "Reload arena"; everything else retries the route.
export default function Error({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        console.error('[ludo-route-error]', error);
        captureException(error, { where: 'route' });
    }, [error]);

    const friendly = friendlyErrorFromMessage(error.message);
    const isChunkError = friendly.code === 'CHUNK';

    const actions: ErrorCardAction[] = [
        isChunkError
            ? { label: 'Reload arena', onClick: () => window.location.reload() }
            : { label: 'Try again', onClick: reset },
    ];

    return (
        <main
            className="min-h-[100dvh] flex items-center justify-center px-4 py-10"
            style={{ background: 'var(--err-backdrop)' }}
        >
            <ErrorCard
                kicker={`ARENA · ${friendly.title}`}
                heading="The arena hit a snag"
                copy={friendly.copy}
                raw={`${isChunkError ? 'CHUNK' : error.message || 'Unknown client error'}${
                    !isChunkError && error.digest ? ` · ${error.digest}` : ''
                }`}
                actions={actions}
            />
        </main>
    );
}
