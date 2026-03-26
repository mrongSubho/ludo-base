"use client";

import React, { useEffect, useState } from 'react';
import { useConnect, Connector } from 'wagmi';
import { IoClose } from 'react-icons/io5';
import { motion, AnimatePresence } from 'framer-motion';

interface LudoWalletModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const WALLET_ICONS: Record<string, React.ReactNode> = {
    metamask: (
        <img src="/metamask.svg" alt="MetaMask" style={{ width: '24px', height: '24px' }} />
    ),
    coinbase: (
        <svg viewBox="0 0 48 48" style={{ width: '24px', height: '24px', borderRadius: '6px' }}>
            <rect width="48" height="48" fill="#0052ff" />
            <circle cx="24" cy="24" r="14" fill="white" />
            <circle cx="24" cy="24" r="6" fill="#0052ff" />
        </svg>
    ),
    phantom: (
        <div style={{ width: '24px', height: '24px', backgroundColor: '#AB9FF2', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <img src="/phantom.svg" alt="Phantom" style={{ width: '16px', height: '16px', objectFit: 'contain' }} />
        </div>
    ),
    base: (
        <svg viewBox="0 0 48 48" style={{ width: '24px', height: '24px', borderRadius: '6px' }}>
            <rect width="48" height="48" fill="#0052ff" />
        </svg>
    )
};

export default function LudoWalletModal({ isOpen, onClose }: LudoWalletModalProps) {
    const { connect, connectors } = useConnect();
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    const handleConnect = (connector: Connector) => {
        connect({ connector });
    };

    const getWalletIcon = (connector: Connector) => {
        const id = connector.id.toLowerCase();
        const name = connector.name.toLowerCase();

        if (id.includes('coinbase') || name.includes('coinbase')) return WALLET_ICONS.coinbase;
        if (id.includes('metamask') || name.includes('metamask')) return WALLET_ICONS.metamask;
        if (id.includes('phantom') || name.includes('phantom')) return WALLET_ICONS.phantom;

        return WALLET_ICONS.base;
    };

    if (!mounted) return null;

    const coinbaseConnector = connectors.find(c => c.name.toLowerCase().includes('coinbase'));
    const metamaskConnector = connectors.find(c => c.name.toLowerCase().includes('metamask'));
    const phantomConnector = connectors.find(c => c.name.toLowerCase().includes('phantom'));

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
                        style={{
                            position: 'relative',
                            width: '100%',
                            maxWidth: '360px',
                            backgroundColor: '#ffffff',
                            borderRadius: '24px',
                            boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
                            display: 'flex',
                            flexDirection: 'column',
                            padding: '24px',
                            color: '#000000',
                            border: '1px solid #f3f4f6',
                            zIndex: 10,
                            overflow: 'hidden'
                        }}
                    >
                        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '20px' }}>
                            <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#000', textTransform: 'none' }}>
                                Ludo Base : The Onchain Arena
                            </h3>
                            <button
                                onClick={onClose}
                                className="!bg-[#f3f4f6] hover:!bg-[#e5e7eb] transition-colors"
                                style={{
                                    position: 'absolute',
                                    right: 0,
                                    width: '28px',
                                    height: '28px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    borderRadius: '50%',
                                    color: '#6b7280',
                                    border: 'none',
                                    cursor: 'pointer'
                                }}
                            >
                                <IoClose size={18} />
                            </button>
                        </div>

                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            <button
                                onClick={() => coinbaseConnector && handleConnect(coinbaseConnector)}
                                className="!bg-[#f3f4f6] hover:!bg-[#e5e7eb] transition-colors"
                                style={{
                                    width: '100%',
                                    height: '50px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    padding: '0 16px',
                                    borderRadius: '12px',
                                    border: 'none',
                                    cursor: 'pointer'
                                }}
                            >
                                <span style={{ color: '#000', fontSize: '15px', fontWeight: 600, textTransform: 'none' }}>Sign in with Base</span>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    {WALLET_ICONS.base}
                                </div>
                            </button>

                            <div style={{ padding: '16px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px' }}>
                                <div style={{ height: '1px', flex: 1, backgroundColor: '#e5e7eb' }} />
                                <span style={{ color: '#9ca3af', fontSize: '12px', fontWeight: 500, textTransform: 'none' }}>or use another wallet</span>
                                <div style={{ height: '1px', flex: 1, backgroundColor: '#e5e7eb' }} />
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                {[
                                    { connector: coinbaseConnector, name: 'Coinbase Wallet' },
                                    { connector: metamaskConnector, name: 'MetaMask' },
                                    { connector: phantomConnector, name: 'Phantom' }
                                ].map((item) => (
                                    item.connector && (
                                        <button
                                            key={item.connector.uid}
                                            onClick={() => handleConnect(item.connector!)}
                                            className="!bg-[#f3f4f6] hover:!bg-[#e5e7eb] transition-colors"
                                            style={{
                                                width: '100%',
                                                height: '50px',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'space-between',
                                                padding: '0 16px',
                                                borderRadius: '12px',
                                                border: 'none',
                                                cursor: 'pointer'
                                            }}
                                        >
                                            <span style={{ color: '#000', fontSize: '15px', fontWeight: 600, textTransform: 'none' }}>{item.name}</span>
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                {getWalletIcon(item.connector)}
                                            </div>
                                        </button>
                                    )
                                ))}
                            </div>
                        </div>

                        <div style={{ marginTop: '24px', textAlign: 'center', padding: '0 8px' }}>
                            <p style={{ margin: 0, fontSize: '12px', color: '#6b7280', fontWeight: 500, lineHeight: 1.4, textTransform: 'none' }}>
                                By connecting a wallet, you agree to our<br />
                                <a href="#" style={{ color: '#0052FF', textDecoration: 'none' }}>Terms of Service</a> and <a href="#" style={{ color: '#0052FF', textDecoration: 'none' }}>Privacy Policy</a>.
                            </p>
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
}
