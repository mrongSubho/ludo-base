"use client";

import React, { useEffect, useState } from 'react';
import { useConnect, Connector } from 'wagmi';
import { IoClose } from 'react-icons/io5';
import { motion, AnimatePresence } from 'framer-motion';
import InGameWalletPanel from './InGameWalletPanel';
import { isInGameWalletEnabled, writeWalletMode, readWalletMode } from '@/lib/walletMode';
import { useIsSignedIn, useCurrentUser } from '@coinbase/cdp-hooks';
import { resolvePlayerIdentity } from '@/lib/playerIdentity';
import { hasSeenWalletReady } from '@/lib/walletOnboarding';

interface LudoWalletModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const WALLET_ICONS: Record<string, React.ReactNode> = {
    metamask: (
        <img loading="lazy" decoding="async" src="/metamask.svg" alt="" style={{ width: '22px', height: '22px' }} />
    ),
    phantom: (
        <div style={{ width: '22px', height: '22px', backgroundColor: '#AB9FF2', borderRadius: '7px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <img loading="lazy" decoding="async" src="/phantom.svg" alt="" style={{ width: '14px', height: '14px', objectFit: 'contain' }} />
        </div>
    ),
    base: (
        <svg viewBox="0 0 48 48" style={{ width: '22px', height: '22px', borderRadius: '6px' }}>
            <rect width="48" height="48" rx="10" fill="#0052ff" />
            <circle cx="24" cy="24" r="11" fill="white" />
            <circle cx="24" cy="24" r="5" fill="#0052ff" />
        </svg>
    ),
    walletconnect: (
        <svg viewBox="0 0 24 24" style={{ width: '22px', height: '22px' }} fill="none" aria-hidden>
            <path
                d="M5.2 9.8c3.75-3.7 9.85-3.7 13.6 0l.95.94a.75.75 0 0 1 0 1.06l-1.3 1.28a.38.38 0 0 1-.54 0l-1.32-1.3a6.3 6.3 0 0 0-9.18 0l-1.32 1.3a.38.38 0 0 1-.54 0l-1.3-1.28a.75.75 0 0 1 0-1.06l.95-.94Z"
                fill="#3B99FC"
            />
            <path
                d="m8.1 14.1 1.35-1.32a.38.38 0 0 1 .54 0l1.04 1.02a1.38 1.38 0 0 0 1.94 0l1.04-1.02a.38.38 0 0 1 .54 0l1.35 1.32a.38.38 0 0 1 0 .54l-1.93 1.9a2.8 2.8 0 0 1-3.94 0l-1.93-1.9a.38.38 0 0 1 0-.54Z"
                fill="#3B99FC"
            />
        </svg>
    ),
    email: (
        <svg viewBox="0 0 24 24" style={{ width: '20px', height: '20px' }} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="5" width="18" height="14" rx="3" />
            <path d="M4 8l8 6 8-6" />
        </svg>
    ),
};

function WalletRow({
    label,
    hint,
    icon,
    onClick,
    primary,
}: {
    label: string;
    hint?: string;
    icon: React.ReactNode;
    onClick: (e: React.MouseEvent) => void;
    primary?: boolean;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`ludo-wallet-row ${primary ? 'primary' : ''}`}
        >
            <span className="ludo-wallet-row-icon" aria-hidden>
                {icon}
            </span>
            <span className="ludo-wallet-row-text">
                <span className="ludo-wallet-row-label">{label}</span>
                {hint && <span className="ludo-wallet-row-hint">{hint}</span>}
            </span>
        </button>
    );
}

export default function LudoWalletModal({ isOpen, onClose }: LudoWalletModalProps) {
    const { connect, connectors, error: connectError, isPending: connectPending } = useConnect();
    const { isSignedIn } = useIsSignedIn();
    const { currentUser } = useCurrentUser();
    const [mounted, setMounted] = useState(false);
    const [showInGame, setShowInGame] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    // First-time OAuth return: open the in-game page (ready / welcome stage).
    useEffect(() => {
        if (!isOpen) return;
        const id = resolvePlayerIdentity(currentUser);
        if (isSignedIn && id.address && !hasSeenWalletReady(id.address)) {
            setShowInGame(true);
        }
    }, [isOpen, isSignedIn, currentUser]);

    // Silent restore only after the user has completed "wallet ready" once.
    // First-time OAuth return must land on ready → passkey, not skip the gate.
    useEffect(() => {
        if (!isOpen) return;
        const id = resolvePlayerIdentity(currentUser);
        if (
            isSignedIn &&
            id.address &&
            readWalletMode() === 'ingame' &&
            hasSeenWalletReady(id.address)
        ) {
            onClose();
        }
    }, [isOpen, isSignedIn, currentUser, onClose]);

    /** Must run synchronously in onClick — no await before connect().
     * Mode flips to external only after connect succeeds: writing it in the
     * click handler strands in-game users in a disconnected external slot
     * when the popup is dismissed or fails. */
    const handleSignInWithBase = (e: React.MouseEvent) => {
        e.preventDefault();
        const baseConn =
            connectors.find((c) => c.id === 'baseAccount' || c.type === 'baseAccount') ||
            connectors.find((c) => c.name.toLowerCase().includes('coinbase'));
        if (baseConn) {
            connect({ connector: baseConn }, { onSuccess: () => writeWalletMode('external') });
        }
    };

    const handleConnect = (connector: Connector) => {
        connect(
            { connector },
            {
                onSuccess: () => writeWalletMode('external'),
                onError: () => {
                    // Desktop fallback: the MetaMask SDK connector can fail
                    // where the raw injected provider works (and vice versa).
                    // Retry once through injected before surfacing the error.
                    if (typeof window === 'undefined') return;
                    const eth = (window as unknown as { ethereum?: unknown }).ethereum;
                    if (!eth || connector.id === 'injected') return;
                    const injectedConn = connectors.find((c) => c.id === 'injected');
                    if (!injectedConn) return;
                    connect(
                        { connector: injectedConn },
                        { onSuccess: () => writeWalletMode('external') },
                    );
                },
            },
        );
    };

    const getWalletIcon = (connector: Connector) => {
        const id = connector.id.toLowerCase();
        const name = connector.name.toLowerCase();
        if (id.includes('coinbase') || name.includes('coinbase')) return WALLET_ICONS.base;
        if (id.includes('metamask') || name.includes('metamask')) return WALLET_ICONS.metamask;
        if (id.includes('phantom') || name.includes('phantom')) return WALLET_ICONS.phantom;
        return WALLET_ICONS.base;
    };

    if (!mounted) return null;

    const metamaskConnector = connectors.find((c) => c.name.toLowerCase().includes('metamask'));
    const phantomConnector = connectors.find((c) => c.name.toLowerCase().includes('phantom'));
    const walletConnectConnector = connectors.find(
        (c) => c.id.toLowerCase().includes('walletconnect') || c.name.toLowerCase().includes('walletconnect'),
    );

    return (
        <AnimatePresence>
            {isOpen && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }}
                    />

                    <motion.div
                        initial={{ scale: 0.98, opacity: 0, y: 10 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        exit={{ scale: 0.98, opacity: 0, y: 10 }}
                        className="ludo-walletsheet-scope"
                        style={{
                            position: 'relative',
                            width: '100%',
                            maxWidth: '380px',
                            background: 'var(--panel-bg-image, var(--ludo-bg-cosmic))',
                            backgroundColor: 'var(--panel-bg, rgba(13,13,13,0.95))',
                            backdropFilter: 'blur(32px)',
                            borderRadius: '28px',
                            boxShadow: '0 20px 50px rgba(0,0,0,0.45)',
                            display: 'flex',
                            flexDirection: 'column',
                            padding: '22px 20px 18px',
                            color: 'var(--modal-ink, #ffffff)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            zIndex: 10,
                            overflow: 'hidden',
                        }}
                    >
                        {/* Header — hidden on the in-game sign-in page */}
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', marginBottom: '18px' }} hidden={showInGame}>
                            <div>
                                <p style={{ margin: 0, fontSize: '11px', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--modal-muted, rgba(255,255,255,0.45))' }}>
                                    Sign in
                                </p>
                                <h3 style={{ margin: '4px 0 0', fontSize: '18px', fontWeight: 700, color: 'var(--modal-ink, #ffffff)', textTransform: 'none', lineHeight: 1.25 }}>
                                    Ludo Base · Onchain Arena
                                </h3>
                            </div>
                            <button
                                onClick={onClose}
                                aria-label="Close wallet options"
                                className="bg-white/10 hover:bg-white/20 transition-colors"
                                style={{
                                    width: '32px',
                                    height: '32px',
                                    flexShrink: 0,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    borderRadius: '50%',
                                    color: 'var(--modal-ink-soft, rgba(255,255,255,0.7))',
                                    border: '1px solid rgba(255,255,255,0.1)',
                                    cursor: 'pointer',
                                }}
                            >
                                <IoClose size={18} />
                            </button>
                        </div>

                        {/* 1 · In-game wallet (primary) — opens its own sign-in page */}
                        {isInGameWalletEnabled() && !showInGame && (
                            <WalletRow
                                primary
                                label="Continue with in-game wallet"
                                hint="Email · Google · Apple · X · Telegram"
                                icon={WALLET_ICONS.email}
                                onClick={() => setShowInGame(true)}
                            />
                        )}
                        {isInGameWalletEnabled() && showInGame && (
                            <InGameWalletPanel
                                onBack={() => setShowInGame(false)}
                                onDone={() => {
                                    setShowInGame(false);
                                    onClose();
                                }}
                            />
                        )}

                        {/* Divider — hidden on the in-game sign-in page */}
                        <div style={{ padding: '16px 0 12px', display: 'flex', alignItems: 'center', gap: '12px' }} hidden={showInGame}>
                            <div style={{ height: '1px', flex: 1, backgroundColor: 'rgba(255,255,255,0.1)' }} />
                            <span style={{ color: 'var(--modal-muted, rgba(255,255,255,0.45))', fontSize: '11px', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                                or connect wallet
                            </span>
                            <div style={{ height: '1px', flex: 1, backgroundColor: 'rgba(255,255,255,0.1)' }} />
                        </div>

                        {/* 2–4 · External wallets */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }} hidden={showInGame}>
                            <WalletRow
                                label="Continue with Base"
                                hint="Base app · passkey"
                                icon={WALLET_ICONS.base}
                                onClick={handleSignInWithBase}
                            />
                            {metamaskConnector && (
                                <WalletRow
                                    label="MetaMask"
                                    icon={getWalletIcon(metamaskConnector)}
                                    onClick={() => handleConnect(metamaskConnector)}
                                />
                            )}
                            {phantomConnector && (
                                <WalletRow
                                    label="Phantom"
                                    icon={getWalletIcon(phantomConnector)}
                                    onClick={() => handleConnect(phantomConnector)}
                                />
                            )}
                            {walletConnectConnector && (
                                <WalletRow
                                    label="WalletConnect"
                                    hint="Connect with 500+ wallets"
                                    icon={WALLET_ICONS.walletconnect}
                                    onClick={() => handleConnect(walletConnectConnector)}
                                />
                            )}
                            {connectPending && (
                                <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--modal-muted, rgba(255,255,255,0.55))', textAlign: 'center' }}>
                                    Waiting for wallet approval…
                                </p>
                            )}
                            {connectError && !connectPending && (
                                <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#f87171', textAlign: 'center' }} role="alert">
                                    Connection failed: {connectError.message?.split('\n')[0] || 'unknown error'} Tap the wallet again to retry.
                                </p>
                            )}
                        </div>

                        {/* Footer */}
                        <div style={{ marginTop: '18px', textAlign: 'center', padding: '0 8px' }} hidden={showInGame}>
                            <p style={{ margin: 0, fontSize: '11px', color: 'var(--modal-muted, rgba(255,255,255,0.45))', fontWeight: 500, lineHeight: 1.5, textTransform: 'none' }}>
                                By connecting a wallet, you agree to our{' '}
                                <a href="/terms" target="_blank" rel="noopener" style={{ color: '#22d3ee', textDecoration: 'none' }}>Terms</a>
                                {' and '}
                                <a href="/privacy" target="_blank" rel="noopener" style={{ color: '#22d3ee', textDecoration: 'none' }}>Privacy</a>.
                            </p>
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
}
