"use client";

import React from 'react';

// REA-08: the app had a single error boundary around the whole page, so one
// throwing panel unmounted MountedApp and took the dashboard down with it.
// That is now scoped per panel (`app/page.tsx`), and this file is the last
// resort for an error outside them — the root layout itself, or a render
// error before the panel tree exists.

// It must render its own <html>/<body>: the root layout failed to produce
// them, so Next.js replaces the document with this file's output.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
    return (
        <html lang="en">
            <body
                style={{
                    margin: 0,
                    minHeight: '100vh',
                    background: '#0b0e14',
                    color: '#e6edf7',
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 24,
                }}
            >
                <div style={{ maxWidth: 420, width: '100%', textAlign: 'center' }}>
                    <p
                        style={{
                            fontSize: 10,
                            letterSpacing: '0.25em',
                            textTransform: 'uppercase',
                            color: '#00e5ff',
                            marginBottom: 12,
                        }}
                    >
                        Ludo Base
                    </p>
                    <h1 style={{ fontSize: 22, fontWeight: 900, margin: '0 0 12px' }}>
                        The app hit an error
                    </h1>
                    <p style={{ fontSize: 13, color: 'rgba(230,237,247,0.6)', lineHeight: 1.6, margin: '0 0 24px' }}>
                        Your match is not affected — nothing was sent to the chain. Try
                        reloading; if it keeps happening, the panel that caused it can be
                        reopened individually.
                    </p>
                    <button
                        onClick={reset}
                        style={{
                            minHeight: 44,
                            width: '100%',
                            borderRadius: 16,
                            border: '1px solid rgba(0,229,255,0.4)',
                            background: 'rgba(0,229,255,0.15)',
                            color: '#00e5ff',
                            fontSize: 11,
                            fontWeight: 900,
                            letterSpacing: '0.2em',
                            textTransform: 'uppercase',
                            cursor: 'pointer',
                        }}
                    >
                        Try again
                    </button>
                </div>
            </body>
        </html>
    );
}
