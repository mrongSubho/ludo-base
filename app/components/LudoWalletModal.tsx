"use client";

import React, { useEffect, useState } from 'react';
import { useConnect, Connector } from 'wagmi';
import { IoClose } from 'react-icons/io5';
import { motion, AnimatePresence } from 'framer-motion';
import InGameWalletPanel from './InGameWalletPanel';
import { isInGameWalletEnabled, writeWalletMode } from '@/lib/walletMode';

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
    const { connect, connectors } = useConnect();
    const [mounted, setMounted] = useState(false);
    const [showInGame, setShowInGame] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    /** Must run synchronously in onClick — no await before connect(). */
    const handleSignInWithBase = (e: React.MouseEvent) => {
        e.preventDefault();
        writeWalletMode('external');
        const baseConn =
            connectors.find((c) => c.id === 'baseAccount' || c.type === 'baseAccount') ||
            connectors.find((c) => c.name.toLowerCase().includes('coinbase'));
        if (baseConn) {
            connect({ connector: baseConn });
        }
    };

    const handleConnect = (connector: Connector) => {
        writeWalletMode('external');
        connect({ connector });
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
