'use client';

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import Button from './Button';
import { CheckGlyphIcon } from './icons';
import type { ComplianceStatusPayload, SubmitComplianceInput } from '@/hooks/useComplianceConsent';
import { hasAnalyticsConsent } from '@/lib/complianceClient';

interface ComplianceGateModalProps {
    open: boolean;
    status: ComplianceStatusPayload | null;
    isSubmitting: boolean;
    error: string | null;
    onSubmit: (input: SubmitComplianceInput) => Promise<boolean> | void;
    onClose: () => void;
    contextLabel?: string;
}

export default function ComplianceGateModal({
    open,
    status,
    isSubmitting,
    error,
    onSubmit,
    onClose,
    contextLabel = 'Paid Arena Play & Vault Deposits',
}: ComplianceGateModalProps) {
    const [age18, setAge18] = useState(false);
    const [tosAccepted, setTosAccepted] = useState(false);
    const [euDmaAck, setEuDmaAck] = useState(false);
    const [analyticsConsent, setAnalyticsConsent] = useState(false);

    useEffect(() => {
        if (!open) return;
        setAge18(Boolean(status?.consent?.age_18_confirmed));
        const tosCurrent =
            Boolean(status?.consent?.tos_version) &&
            status?.consent?.tos_version === (status?.requiredTosVersion ?? 'v1');
        setTosAccepted(tosCurrent);
        setEuDmaAck(Boolean(status?.consent?.eu_dma_acknowledged));
        setAnalyticsConsent(
            typeof status?.consent?.analytics_consent === 'boolean'
                ? status.consent.analytics_consent
                : hasAnalyticsConsent(),
        );
    }, [open, status]);

    if (!open) return null;

    const isBlocked = Boolean(status?.isBlocked);
    const isEuDma = Boolean(status?.isEuDma);
    const country = status?.country || 'XX';
    const tosVersion = status?.requiredTosVersion || 'v1';
    const privacyVersion = status?.requiredPrivacyVersion || 'v1';

    const canSubmit = !isBlocked && age18 && tosAccepted && (!isEuDma || euDmaAck) && !isSubmitting;

    const handleConfirm = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!canSubmit) return;
        await onSubmit({
            age18Confirmed: age18,
            tosAccepted,
            privacyAccepted: tosAccepted,
            euDmaAcknowledged: isEuDma ? euDmaAck : false,
            analyticsConsent,
        });
    };

    const modal = (
        <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="compliance-gate-title"
            className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/75 backdrop-blur-md"
        >
            <div className="panel-shell-3077 w-full max-w-[440px] rounded-[28px] bg-surface-panel border border-line-soft shadow-2xl p-6 space-y-4 text-left">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <p className="font-mono text-ludo-xs font-bold uppercase tracking-[0.22em] text-accent">
                            Compliance Gate // {country}
                        </p>
                        <h2
                            id="compliance-gate-title"
                            className="text-lg font-extrabold uppercase tracking-wide text-ink-strong mt-0.5"
                        >
                            {isBlocked ? 'Region Restricted' : 'Verify Eligibility'}
                        </h2>
                        <p className="text-ludo-xs text-ink-muted mt-0.5">{contextLabel}</p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close compliance modal"
                        className="px-2.5 py-1 rounded-lg bg-surface-recessed border border-line-soft text-ludo-xs font-mono font-bold text-ink-muted hover:text-ink-strong"
                    >
                        ESC
                    </button>
                </div>

                {isBlocked ? (
                    <div className="space-y-4">
                        <div className="p-3.5 rounded-2xl bg-danger/10 border border-danger/40 text-ludo-xs text-ink-strong leading-relaxed">
                            Paid wagers, spectator betting pools, and CHIPS vault deposits are unavailable in your region ({country}).
                            Free play, offline matches, and withdrawing existing balances remain accessible.
                        </div>
                        <div className="flex justify-end">
                            <Button type="button" variant="secondary" size="sm" onClick={onClose}>
                                Understood
                            </Button>
                        </div>
                    </div>
                ) : (
                    <form onSubmit={handleConfirm} className="space-y-3">
                        <label className="flex items-start gap-2.5 p-3 rounded-2xl bg-surface-recessed border border-line-soft cursor-pointer">
                            <input
                                type="checkbox"
                                checked={age18}
                                onChange={(e) => setAge18(e.target.checked)}
                                className="sr-only"
                            />
                            <span
                                aria-hidden="true"
                                className={`mt-0.5 w-4 h-4 rounded flex items-center justify-center border shrink-0 transition-colors ${
                                    age18
                                        ? 'bg-accent border-accent text-ink-invert'
                                        : 'bg-surface-panel border-line-strong'
                                }`}
                            >
                                {age18 && <CheckGlyphIcon className="w-3 h-3" />}
                            </span>
                            <span className="text-ludo-xs text-ink-strong leading-snug">
                                I confirm I am at least <strong>18 years old</strong> (or legal age of majority in my jurisdiction).
                            </span>
                        </label>

                        <label className="flex items-start gap-2.5 p-3 rounded-2xl bg-surface-recessed border border-line-soft cursor-pointer">
                            <input
                                type="checkbox"
                                checked={tosAccepted}
                                onChange={(e) => setTosAccepted(e.target.checked)}
                                className="sr-only"
                            />
                            <span
                                aria-hidden="true"
                                className={`mt-0.5 w-4 h-4 rounded flex items-center justify-center border shrink-0 transition-colors ${
                                    tosAccepted
                                        ? 'bg-accent border-accent text-ink-invert'
                                        : 'bg-surface-panel border-line-strong'
                                }`}
                            >
                                {tosAccepted && <CheckGlyphIcon className="w-3 h-3" />}
                            </span>
                            <span className="text-ludo-xs text-ink-strong leading-snug">
                                I agree to the Arena <strong>Terms of Service ({tosVersion})</strong> and <strong>Privacy Notice ({privacyVersion})</strong>, including non-custodial wallet settlement rules.
                            </span>
                        </label>

                        {isEuDma && (
                            <label className="flex items-start gap-2.5 p-3 rounded-2xl bg-accent-soft/20 border border-accent/40 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={euDmaAck}
                                    onChange={(e) => setEuDmaAck(e.target.checked)}
                                    className="sr-only"
                                />
                                <span
                                    aria-hidden="true"
                                    className={`mt-0.5 w-4 h-4 rounded flex items-center justify-center border shrink-0 transition-colors ${
                                        euDmaAck
                                            ? 'bg-accent border-accent text-ink-invert'
                                            : 'bg-surface-panel border-line-strong'
                                    }`}
                                >
                                    {euDmaAck && <CheckGlyphIcon className="w-3 h-3" />}
                                </span>
                                <span className="text-ludo-xs text-ink-strong leading-snug">
                                    <strong>EU/EEA DSA &amp; DMA Disclosure:</strong> Arena matches execute via provably verifiable dice &amp; transparent smart contracts; third-party RPC/wallet connections process public addresses only as required to sign and submit transactions.
                                </span>
                            </label>
                        )}

                        <div className="p-3 rounded-2xl bg-surface-recessed border border-line-soft space-y-2">
                            <div className="flex items-center justify-between gap-2">
                                <span className="font-mono text-ludo-xs font-bold uppercase tracking-wider text-ink-muted">
                                    Telemetry Preference
                                </span>
                                <span className="font-mono text-ludo-xs text-ink-faint">
                                    {analyticsConsent ? 'Essential + Diagnostics' : 'Essential Only'}
                                </span>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    type="button"
                                    onClick={() => setAnalyticsConsent(false)}
                                    className={`px-2.5 py-1.5 rounded-xl border font-mono text-ludo-xs font-bold transition-colors ${
                                        !analyticsConsent
                                            ? 'bg-accent-soft border-accent text-accent'
                                            : 'bg-surface-panel border-line-soft text-ink-muted'
                                    }`}
                                >
                                    Essential Only
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setAnalyticsConsent(true)}
                                    className={`px-2.5 py-1.5 rounded-xl border font-mono text-ludo-xs font-bold transition-colors ${
                                        analyticsConsent
                                            ? 'bg-accent-soft border-accent text-accent'
                                            : 'bg-surface-panel border-line-soft text-ink-muted'
                                    }`}
                                >
                                    Essential + Telemetry
                                </button>
                            </div>
                        </div>

                        {error && (
                            <p className="text-ludo-xs font-mono text-danger bg-danger/10 border border-danger/30 rounded-xl px-3 py-2">
                                {error}
                            </p>
                        )}

                        <div className="flex items-center justify-end gap-2 pt-1">
                            <Button type="button" variant="secondary" size="sm" onClick={onClose}>
                                Cancel
                            </Button>
                            <Button type="submit" variant="primary" size="sm" disabled={!canSubmit}>
                                {isSubmitting ? 'Saving...' : 'Confirm & Continue'}
                            </Button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );

    if (typeof document === 'undefined') return null;
    return createPortal(modal, document.body);
}
