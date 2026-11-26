'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { setAnalyticsConsent } from '@/lib/complianceClient';

export interface ComplianceStatusPayload {
    compliant: boolean;
    country: string;
    isBlocked: boolean;
    isEuDma: boolean;
    missing: string[];
    requiredTosVersion: string;
    requiredPrivacyVersion: string;
    consent?: {
        analytics_consent?: boolean;
        tos_version?: string;
        privacy_version?: string;
        age_18_confirmed?: boolean;
        eu_dma_acknowledged?: boolean;
    } | null;
}

export interface SubmitComplianceInput {
    age18Confirmed: boolean;
    tosAccepted: boolean;
    privacyAccepted: boolean;
    euDmaAcknowledged: boolean;
    analyticsConsent: boolean;
}

export function useComplianceConsent(walletAddress?: string) {
    const [status, setStatus] = useState<ComplianceStatusPayload | null>(null);
    const [isChecking, setIsChecking] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [modalOpen, setModalOpen] = useState(false);

    const pendingResolveRef = useRef<((ok: boolean) => void) | null>(null);
    const pendingSessionRef = useRef<string | undefined>(undefined);

    const normalizedWallet = walletAddress?.trim().toLowerCase() || '';

    const fetchStatus = useCallback(
        async (sessionId?: string): Promise<ComplianceStatusPayload | null> => {
            if (!normalizedWallet) return null;
            setIsChecking(true);
            setError(null);
            try {
                const headers: Record<string, string> = {};
                if (sessionId) headers['x-session-id'] = sessionId;
                const res = await fetch(
                    `/api/compliance/consent?walletAddress=${encodeURIComponent(normalizedWallet)}`,
                    { method: 'GET', headers, credentials: 'same-origin' },
                );
                if (!res.ok) {
                    return null;
                }
                const data = (await res.json()) as ComplianceStatusPayload;
                setStatus(data);
                if (data.consent && typeof data.consent.analytics_consent === 'boolean') {
                    setAnalyticsConsent(data.consent.analytics_consent);
                }
                return data;
            } catch {
                return null;
            } finally {
                setIsChecking(false);
            }
        },
        [normalizedWallet],
    );

    useEffect(() => {
        return () => {
            if (pendingResolveRef.current) {
                pendingResolveRef.current(false);
                pendingResolveRef.current = null;
            }
        };
    }, []);

    const closeModal = useCallback(() => {
        setModalOpen(false);
        setError(null);
        if (pendingResolveRef.current) {
            const resolve = pendingResolveRef.current;
            pendingResolveRef.current = null;
            resolve(false);
        }
    }, []);

    const ensureCompliance = useCallback(
        async (sessionId?: string): Promise<boolean> => {
            if (!normalizedWallet) return false;
            pendingSessionRef.current = sessionId;

            if (status?.compliant) {
                return true;
            }

            const fresh = await fetchStatus(sessionId);
            if (fresh?.compliant) {
                return true;
            }

            if (pendingResolveRef.current) {
                pendingResolveRef.current(false);
                pendingResolveRef.current = null;
            }

            setModalOpen(true);
            return new Promise<boolean>((resolve) => {
                pendingResolveRef.current = resolve;
            });
        },
        [normalizedWallet, status?.compliant, fetchStatus],
    );

    const submitConsent = useCallback(
        async (input: SubmitComplianceInput): Promise<boolean> => {
            if (!normalizedWallet) {
                setError('Connect a wallet first.');
                return false;
            }
            setIsSubmitting(true);
            setError(null);
            try {
                const res = await fetch('/api/compliance/consent', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'same-origin',
                    body: JSON.stringify({
                        walletAddress: normalizedWallet,
                        sessionId: pendingSessionRef.current,
                        tosAccepted: input.tosAccepted,
                        privacyAccepted: input.privacyAccepted,
                        age18Confirmed: input.age18Confirmed,
                        euDmaAcknowledged: input.euDmaAcknowledged,
                        analyticsConsent: input.analyticsConsent,
                    }),
                });
                const body = (await res.json().catch(() => ({}))) as {
                    error?: string;
                    status?: ComplianceStatusPayload;
                };
                if (!res.ok) {
                    setError(body.error || 'Failed to save compliance confirmation.');
                    return false;
                }
                setAnalyticsConsent(input.analyticsConsent);
                if (body.status) {
                    setStatus(body.status);
                } else {
                    setStatus((prev) =>
                        prev
                            ? { ...prev, compliant: true, missing: [] }
                            : {
                                  compliant: true,
                                  country: 'XX',
                                  isBlocked: false,
                                  isEuDma: false,
                                  missing: [],
                                  requiredTosVersion: 'v1',
                                  requiredPrivacyVersion: 'v1',
                              },
                    );
                }
                setModalOpen(false);
                if (pendingResolveRef.current) {
                    const resolve = pendingResolveRef.current;
                    pendingResolveRef.current = null;
                    resolve(true);
                }
                return true;
            } catch (err: unknown) {
                setError(err instanceof Error ? err.message : 'Network error');
                return false;
            } finally {
                setIsSubmitting(false);
            }
        },
        [normalizedWallet],
    );

    return {
        status,
        isChecking,
        isSubmitting,
        error,
        modalOpen,
        openModal: () => setModalOpen(true),
        closeModal,
        fetchStatus,
        ensureCompliance,
        submitConsent,
    };
}
