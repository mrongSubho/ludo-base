"use client";

import React, { useEffect } from 'react';

// ─── Route error boundary ────────────────────────────────────────────────────
// Catches uncaught client exceptions under this route and contains them:
// shows the real error (message, not a dead screen) with a retry. Without
// this, one throwing panel takes down the whole app with no diagnosis.
export default function Error({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        // eslint-disable-next-line no-console
        console.error('[ludo-route-error]', error);
    }, [error]);

    return (
        <main className="min-h-[100dvh] flex items-center justify-center px-4 py-10 bg-black">
            <div className="panel-error-card w-full max-w-[420px] rounded-[28px] border border-white/10 bg-[#0d0d15]/95 px-6 py-8 shadow-2xl flex flex-col items-center gap-3 text-center">
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-red-400">
                    Something broke
                </p>
                <h1 className="text-lg font-black text-white uppercase tracking-tight">
                    The arena hit a snag
                </h1>
                <p className="text-[12px] font-bold text-white/80 break-words max-w-full">
                    {error.message || 'Unknown client error'}
                    {error.digest ? ` · ${error.digest}` : ''}
                </p>
                <button
                    onClick={() => reset()}
                    className="mt-2 w-full py-3.5 rounded-2xl bg-white text-black text-xs font-black uppercase tracking-[0.2em] hover:bg-white/90 active:scale-[0.99] transition-all"
                >
                    Try again
                </button>
            </div>
        </main>
    );
}
