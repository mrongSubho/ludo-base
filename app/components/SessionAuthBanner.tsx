"use client";

import React, { useState } from 'react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAppSession } from '@/hooks/useAppSession';
import { Button } from './Button';
import { useToast } from './Toast';

export function SessionAuthBanner({ className = '' }: { className?: string }) {
    const { address, isGuest } = useCurrentUser();
    const { sessionId, ready, ensureAppSession } = useAppSession();
    const [signing, setSigning] = useState(false);
    const toast = useToast();

    // Only display when user has a connected non-guest wallet and NO active session
    if (!ready || !address || isGuest || sessionId) {
        return null;
    }

    const handleSignIn = async () => {
        setSigning(true);
        try {
            const sid = await ensureAppSession({ context: 'social' });
            if (sid) {
                toast('Session connected successfully!', 'success');
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Authentication cancelled';
            toast(msg, 'error');
        } finally {
            setSigning(false);
        }
    };

    return (
        <div
            className={`w-full rounded-2xl border border-cyan-400/30 bg-gradient-to-r from-cyan-950/40 via-cyan-900/20 to-black/40 backdrop-blur-xl px-4 py-3 shadow-[0_0_24px_rgba(0,229,255,0.08)] flex items-center justify-between gap-3 ${className}`}
            role="status"
            aria-live="polite"
        >
            <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-xl bg-cyan-500/15 border border-cyan-400/30 flex items-center justify-center shrink-0 shadow-[0_0_12px_rgba(34,211,238,0.2)]">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-cyan-300">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                </div>
                <div className="flex flex-col min-w-0">
                    <span className="text-white font-bold text-ludo-sm tracking-wide truncate">
                        App Session Inactive
                    </span>
                    <span className="text-white/50 text-ludo-xs truncate">
                        Activate session to sync friends, DMs, and match history
                    </span>
                </div>
            </div>

            <Button
                variant="primary"
                size="sm"
                onClick={handleSignIn}
                loading={signing}
                className="shrink-0 uppercase tracking-widest text-xs px-3.5"
            >
                Activate
            </Button>
        </div>
    );
}
