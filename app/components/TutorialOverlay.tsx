'use client';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Button from './Button';
import { HudCornerTicks } from './HudPrimitives';

interface TutorialStep {
    code: string;
    title: string;
    summary: string;
    detail: string;
    svg: React.ReactNode;
}

const TUTORIAL_STEPS: readonly TutorialStep[] = [
    {
        code: 'STEP 01 // DEPLOY',
        title: 'Launch on Sixes',
        summary: 'Roll a 6 to deploy an orb from your corner base onto the main ring.',
        detail: 'Rolling a 6 or capturing an opponent earns a bonus roll — but three consecutive 6s forfeit your turn.',
        svg: (
            <svg viewBox="0 0 64 64" width={48} height={48} className="text-accent" aria-hidden="true">
                <rect x="10" y="10" width="44" height="44" rx="10" fill="none" stroke="currentColor" strokeWidth="2.5" />
                <circle cx="23" cy="22" r="3" fill="currentColor" />
                <circle cx="41" cy="22" r="3" fill="currentColor" />
                <circle cx="23" cy="32" r="3" fill="currentColor" />
                <circle cx="41" cy="32" r="3" fill="currentColor" />
                <circle cx="23" cy="42" r="3" fill="currentColor" />
                <circle cx="41" cy="42" r="3" fill="currentColor" />
            </svg>
        ),
    },
    {
        code: 'STEP 02 // SAFE HAVENS & POWERS',
        title: 'Control Power Tiles',
        summary: 'Star tiles shield your tokens from capture. Pick up Boost, Shield, Teleport, and Nuke in Power Mode.',
        detail: 'Use shields before crossing contested enemy gates or drop a Nuke carefully around 2v2 allied pairs.',
        svg: (
            <svg viewBox="0 0 64 64" width={48} height={48} className="text-accent" aria-hidden="true">
                <path
                    d="M32 8 L52 16 V31 C52 44 43 52 32 56 C21 52 12 44 12 31 V16 Z"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                />
                <path d="M35 20 L25 34 H33 L29 45 L40 31 H32 Z" fill="currentColor" />
            </svg>
        ),
    },
    {
        code: 'STEP 03 // WINNING LANES',
        title: 'Enter Home Stretch',
        summary: 'Circle the outer track to enter your private colored finish lane on an exact roll.',
        detail: 'In Quick Turbo mode two tokens start near finish and home so full matches resolve in minutes; in 2v2 teammates assist once all four tokens finish.',
        svg: (
            <svg viewBox="0 0 64 64" width={48} height={48} className="text-accent" aria-hidden="true">
                <circle cx="32" cy="32" r="22" fill="none" stroke="currentColor" strokeWidth="2.5" strokeDasharray="4 4" />
                <polygon points="32,14 48,32 32,50 16,32" fill="none" stroke="currentColor" strokeWidth="2.5" />
                <circle cx="32" cy="32" r="5" fill="currentColor" />
            </svg>
        ),
    },
    {
        code: 'STEP 04 // VAULT & FAIRNESS',
        title: '0-Gas Vault & Server Authority',
        summary: 'Match Rooms adjudicate turns and dice server-side. Vault CHIPS enter paid tables without per-match gas.',
        detail: 'Completed matches credit XP, Ranked XP, Clan War scores, and Claim Hub pull payouts automatically.',
        svg: (
            <svg viewBox="0 0 64 64" width={48} height={48} className="text-accent" aria-hidden="true">
                <rect x="14" y="26" width="36" height="26" rx="6" fill="none" stroke="currentColor" strokeWidth="2.5" />
                <path d="M22 26 V20 A10 10 0 0 1 42 20 V26" fill="none" stroke="currentColor" strokeWidth="2.5" />
                <circle cx="32" cy="39" r="3.5" fill="currentColor" />
            </svg>
        ),
    },
];

interface TutorialOverlayProps {
    open: boolean;
    walletAddress?: string;
    ensureAppSession: () => Promise<string | null>;
    onClose: () => void;
    onComplete: () => void;
}

export function TutorialOverlay({
    open,
    walletAddress,
    ensureAppSession,
    onClose,
    onComplete,
}: TutorialOverlayProps) {
    const [stepIdx, setStepIdx] = useState(0);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open) return;
        setStepIdx(0);
        setError(null);
        const onKey = (ev: KeyboardEvent) => {
            if (ev.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [open, onClose]);

    if (!open || typeof document === 'undefined') return null;

    const step = TUTORIAL_STEPS[stepIdx];
    const isLast = stepIdx === TUTORIAL_STEPS.length - 1;

    const handleFinish = async () => {
        if (!walletAddress) {
            onComplete();
            onClose();
            return;
        }
        setSubmitting(true);
        setError(null);
        try {
            const sessionId = await ensureAppSession();
            if (!sessionId) {
                setError('Sign in first to record tutorial completion.');
                return;
            }
            const res = await fetch('/api/onboarding/progress', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({
                    walletAddress,
                    sessionId,
                    track: 'tutorial',
                    delta: 1,
                }),
            });
            const body = (await res.json().catch(() => ({}))) as { error?: string };
            if (!res.ok) {
                setError(body.error || 'Could not record tutorial progress.');
                return;
            }
            onComplete();
            onClose();
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Network error');
        } finally {
            setSubmitting(false);
        }
    };

    const modal = (
        <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="tutorial-overlay-title"
            className="fixed inset-0 z-[125] flex items-center justify-center p-4 bg-black/75 backdrop-blur-md"
        >
            <div className="panel-shell-3077 relative w-full max-w-[440px] rounded-[28px] bg-surface-panel border border-line-soft shadow-2xl p-6 space-y-4 text-left overflow-hidden">
                <HudCornerTicks />

                <div className="flex items-start justify-between gap-3">
                    <div>
                        <p className="font-mono text-ludo-xs font-bold uppercase tracking-[0.22em] text-accent">
                            {step.code}
                        </p>
                        <h2 id="tutorial-overlay-title" className="text-ludo-lg font-extrabold uppercase tracking-wide text-ink-strong mt-1">
                            {step.title}
                        </h2>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close tutorial"
                        className="px-2.5 py-1 rounded-lg bg-surface-recessed border border-line-soft text-ludo-xs font-mono font-bold text-ink-muted hover:text-ink-strong"
                    >
                        ESC
                    </button>
                </div>

                <div className="flex items-center gap-4 p-4 rounded-2xl bg-surface-recessed border border-line-soft">
                    <div className="w-16 h-16 rounded-2xl bg-surface-panel border border-accent/35 flex items-center justify-center shrink-0">
                        {step.svg}
                    </div>
                    <div className="space-y-1">
                        <p className="text-ludo-sm font-bold text-ink-strong leading-snug">
                            {step.summary}
                        </p>
                        <p className="text-ludo-xs text-ink-muted leading-relaxed">
                            {step.detail}
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-1.5" aria-label="Tutorial step progress">
                    {TUTORIAL_STEPS.map((s, idx) => (
                        <button
                            key={s.code}
                            type="button"
                            onClick={() => setStepIdx(idx)}
                            aria-label={`Go to step ${idx + 1}`}
                            className={`h-1.5 flex-1 rounded-full transition-colors ${
                                idx <= stepIdx ? 'bg-accent' : 'bg-surface-recessed border border-line-soft'
                            }`}
                        />
                    ))}
                </div>

                {error && (
                    <p className="text-ludo-xs font-mono text-danger bg-danger/10 border border-danger/30 rounded-xl px-3 py-2">
                        {error}
                    </p>
                )}

                <div className="flex items-center justify-between gap-2 pt-1">
                    <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={stepIdx === 0 || submitting}
                        onClick={() => setStepIdx((i) => Math.max(0, i - 1))}
                    >
                        Back
                    </Button>
                    {isLast ? (
                        <Button
                            type="button"
                            variant="primary"
                            size="sm"
                            loading={submitting}
                            disabled={submitting}
                            onClick={() => void handleFinish()}
                        >
                            Complete Tutorial
                        </Button>
                    ) : (
                        <Button
                            type="button"
                            variant="primary"
                            size="sm"
                            onClick={() => setStepIdx((i) => Math.min(TUTORIAL_STEPS.length - 1, i + 1))}
                        >
                            Next Step
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );

    return createPortal(modal, document.body);
}
