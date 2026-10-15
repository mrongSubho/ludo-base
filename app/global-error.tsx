"use client";

import React from 'react';

// REA-08: the app had a single error boundary around the whole page, so one
// throwing panel unmounted MountedApp and took the dashboard down with it.
// That is now scoped per panel (`app/page.tsx`), and this file is the last
// resort for an error outside them — the root layout itself, or a render
// error before the panel tree exists.

// It must render its own <html>/<body>: the root layout failed to produce
// them, so Next.js replaces the document with this file's output. For the
// same reason the values below are LITERAL, not `--err-*` tokens — no
// stylesheet is guaranteed here. They mirror ErrorCard's Retro palette so
// the last-resort screen reads as the same card as every other error.

const CARD = {
    maxWidth: 500,
    width: '100%',
    textAlign: 'center' as const,
    background: 'rgba(20, 8, 10, 0.96)',
    border: '1px solid rgba(239, 68, 68, 0.30)',
    borderRadius: 28,
    padding: 20,
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.55)',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: 10,
};

const KICKER = {
    fontSize: 10,
    fontWeight: 900,
    letterSpacing: '0.3em',
    textTransform: 'uppercase' as const,
    color: '#f87171',
    margin: 0,
};

const HEADING = {
    fontSize: 18,
    fontWeight: 900,
    textTransform: 'uppercase' as const,
    letterSpacing: '-0.02em',
    color: '#ffffff',
    margin: 0,
};

const COPY = {
    fontSize: 12,
    fontWeight: 700,
    color: '#ffffff',
    lineHeight: 1.6,
    margin: 0,
};

const BUTTON = {
    minHeight: 44,
    width: '100%',
    padding: '12px 0',
    borderRadius: 16,
    border: '1px solid rgba(255, 255, 255, 0.18)',
    background: '#ffffff',
    color: '#000000',
    fontSize: 11,
    fontWeight: 900,
    letterSpacing: '0.18em',
    textTransform: 'uppercase' as const,
    cursor: 'pointer',
};

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
                <div style={CARD}>
                    <p style={KICKER}>Ludo Base · Something broke</p>
                    <h1 style={HEADING}>The app hit an error</h1>
                    <p style={COPY}>
                        Your match is not affected — nothing was sent to the chain. Try
                        reloading; if it keeps happening, the panel that caused it can be
                        reopened individually.
                    </p>
                    <button type="button" onClick={reset} style={BUTTON}>
                        Try again
                    </button>
                </div>
            </body>
        </html>
    );
}
