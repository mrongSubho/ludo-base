'use client';

import React, { useState, useEffect } from 'react';
import LudoWalletModal from './LudoWalletModal';
import { acceptTos } from '@/lib/onboarding';
import { Ludo3077Emblem } from './Ludo3077Logo';
import { HudCornerTicks } from './HudPrimitives';
import { Button } from './Button';
import { CheckGlyphIcon } from './icons';

interface WalletConnectCardProps {
    onConnect?: () => void;
    onGuest?: () => void;
}

export default function WalletConnectCard({ onGuest }: WalletConnectCardProps) {
    const [mounted, setMounted] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    // ToS + Privacy consent: pre-ticked so new players can launch cleanly;
    // unchecking locks both sign-in and guest entrance.
    const [agreed, setAgreed] = useState(true);

    useEffect(() => {
        setMounted(true);
    }, []);

    const toggleAgreed = () => {
        setAgreed((prev) => {
            const next = !prev;
            if (next) acceptTos();
            return next;
        });
    };

    return (
        <div
            className="panel-shell-3077 ludo-wallet-scope w-[calc(100%-32px)] max-w-[404px] rounded-[32px] px-7 py-8 flex flex-col items-center gap-6 relative overflow-hidden"
            style={{
                background: 'var(--panel-bg)',
                border: '1px solid var(--panel-border)',
                boxShadow: 'var(--panel-shadow)',
                color: 'var(--ink-strong)',
                backdropFilter: 'blur(32px)',
                WebkitBackdropFilter: 'blur(32px)',
            }}
        >
            <HudCornerTicks />

            {/* Subtle top HUD scan wash */}
            <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 top-0 h-28 opacity-75"
                style={{
                    background:
                        'radial-gradient(ellipse at 50% 0%, color-mix(in srgb, var(--accent) 18%, transparent), transparent 72%)',
                }}
            />

            {/* Official 3077 Emblem + Entrance Kicker */}
            <div className="relative z-10 flex flex-col items-center gap-3.5">
                <Ludo3077Emblem size="lg" showReticle />

                <div className="inline-flex items-center gap-2 px-3.5 py-1 bg-surface-recessed border border-line-soft rounded-full">
                    <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                    <span className="text-ink-strong text-ludo-xs font-mono font-bold uppercase tracking-[0.24em]">
                        Arena Entrance
                    </span>
                </div>
            </div>

            {/* Official Title & Copy */}
            <div className="text-center flex flex-col gap-1.5 relative z-10">
                <h1 className="text-3xl sm:text-4xl font-extrabold uppercase tracking-[0.06em] text-ink-strong leading-none">
                    LUDO <span className="text-accent">3077</span>
                </h1>
                <p className="font-mono text-ludo-xs font-bold uppercase tracking-[0.26em] text-accent">
                    {'// THE ONCHAIN ARENA //'}
                </p>
                <p className="text-ludo-md text-ink-muted font-medium leading-relaxed max-w-[285px] mx-auto mt-1">
                    Connect your Web3 identity to access global matchmaking and claim your victory rewards.
                </p>
            </div>

            {/* Entrance Controls */}
            <div className="w-full relative z-20 flex flex-col">
                {mounted ? (
                    <div className="w-full flex flex-col items-stretch gap-3">
                        {/* ToS + Privacy Consent */}
                        <button
                            type="button"
                            onClick={toggleAgreed}
                            aria-pressed={agreed}
                            className="flex items-start gap-2.5 text-left px-1 py-1 active:scale-[0.99] transition-transform cursor-pointer"
                        >
                            <span
                                className={`mt-0.5 w-5 h-5 flex-none rounded-md border flex items-center justify-center transition-colors ${
                                    agreed
                                        ? 'bg-accent border-accent text-accent-ink'
                                        : 'bg-surface-recessed border-line-strong text-transparent'
                                }`}
                                aria-hidden="true"
                            >
                                <CheckGlyphIcon className="w-3 h-3" />
                            </span>
                            <span className="text-ludo-xs font-bold text-ink-muted leading-relaxed">
                                I agree to the{' '}
                                <a
                                    href="/terms"
                                    target="_blank"
                                    rel="noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="text-accent underline underline-offset-2 hover:brightness-110"
                                >
                                    Terms of Service
                                </a>{' '}
                                and{' '}
                                <a
                                    href="/privacy"
                                    target="_blank"
                                    rel="noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="text-accent underline underline-offset-2 hover:brightness-110"
                                >
                                    Privacy Policy
                                </a>
                                .
                            </span>
                        </button>

                        {/* Primary Sign-In CTA */}
                        <Button
                            variant="primary"
                            size="lg"
                            fullWidth
                            disabled={!agreed}
                            onClick={() => {
                                if (!agreed) return;
                                acceptTos();
                                setIsModalOpen(true);
                            }}
                            className="uppercase tracking-[0.18em] font-extrabold shadow-[0_0_24px_color-mix(in_srgb,var(--accent)_28%,transparent)]"
                        >
                            Sign in to start
                        </Button>

                        {/* Guest Entrance */}
                        {onGuest && (
                            <div className="flex flex-col items-center gap-1.5 pt-0.5">
                                <Button
                                    variant="secondary"
                                    size="md"
                                    disabled={!agreed}
                                    onClick={() => {
                                        if (!agreed) return;
                                        acceptTos();
                                        onGuest();
                                    }}
                                    className="px-5 rounded-full uppercase tracking-[0.18em] text-ludo-xs font-bold"
                                >
                                    Continue as Guest
                                </Button>
                                <span className="text-ludo-xs font-mono font-bold text-ink-faint tracking-wide">
                                    No wallet needed · practice vs AI
                                </span>
                            </div>
                        )}

                        <LudoWalletModal
                            isOpen={isModalOpen}
                            onClose={() => setIsModalOpen(false)}
                        />
                    </div>
                ) : (
                    <div className="w-full h-12 bg-surface-recessed rounded-2xl animate-pulse border border-line-soft" />
                )}
            </div>

            {/* Footer Security Telemetry */}
            <div className="flex items-center gap-2.5 text-ink-faint relative z-10 w-full justify-center">
                <div className="h-px w-8 bg-line-soft" />
                <span className="text-ludo-xs font-mono font-bold tracking-[0.22em] uppercase">
                    Safe &amp; Secure · Base
                </span>
                <div className="h-px w-8 bg-line-soft" />
            </div>
        </div>
    );
}
