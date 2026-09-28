"use client";

/**
 * Wallet — light Coinbase-style **popup card** (our previous wallet chrome).
 * Centered modal over the game (not full-screen canvas). CDP dual-path +
 * CHIPS / game activity stay; visuals = white card, Coinbase blue #0052FF.
 */

import React, { useMemo, useState } from 'react';
import { formatUnits } from 'viem';
import { useWalletAssets } from '@/hooks/useWalletAssets';
import { useWalletMode } from '@/hooks/useWalletMode';
import { useWalletActivity } from '@/hooks/useWalletActivity';
import SendTokenSheet from './SendTokenSheet';
import ReceiveSheet from './ReceiveSheet';
import WalletActivityList from './WalletActivityList';
import WcWalletPanel from './WcWalletPanel';
import WalletSecurityPanel from './WalletSecurityPanel';
import WalletLinkPanel from './WalletLinkPanel';

type Screen = 'home' | 'send' | 'receive' | 'activity' | 'apps' | 'security';

function shortAddr(a: string | undefined) {
    if (!a) return '—';
    return `${a.slice(0, 4)}…${a.slice(-4)}`;
}

function TokenIcon({ kind }: { kind: 'eth' | 'usdc' | 'chips' }) {
    if (kind === 'eth') {
        return (
            <div className="cb-asset-icon" style={{ background: '#627EEA' }}>
                <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none">
                    <path d="M12 2 6.5 12.2 12 15.5l5.5-3.3L12 2z" fill="#fff" opacity=".85" />
                    <path d="M12 16.8 6.5 13.5 12 22l5.5-8.5L12 16.8z" fill="#fff" opacity=".65" />
                </svg>
            </div>
        );
    }
    if (kind === 'usdc') {
        return (
            <div className="cb-asset-icon" style={{ background: '#2775CA' }}>
                <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none">
                    <circle cx="12" cy="12" r="9" stroke="#fff" strokeWidth="2" />
                    <path d="M12 7v10M9.5 9.5h5M9.5 14.5h5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
            </div>
        );
    }
    return (
        <div
            className="cb-asset-icon"
            style={{ background: 'linear-gradient(145deg, #0052FF 0%, #6B8CFF 55%, #A8C0FF 100%)' }}
        >
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="#fff" strokeWidth="2">
                <circle cx="12" cy="12" r="8" />
                <circle cx="12" cy="12" r="3" fill="#fff" stroke="none" />
            </svg>
        </div>
    );
}

function ActionButton({
    label,
    icon,
    onClick,
    primary,
}: {
    label: string;
    icon: React.ReactNode;
    onClick: () => void;
    primary?: boolean;
}) {
    return (
        <button type="button" className="cb-action" onClick={onClick}>
            <span className={`cb-action-circle ${primary ? 'primary' : ''}`}>{icon}</span>
            <span className="cb-action-label">{label}</span>
        </button>
    );
}

export default function WalletPanel({ onClose }: { onClose: () => void }) {
    const { tokens, loading, refresh, needsReconnect, address, usdc } = useWalletAssets();
    const mode = useWalletMode();
    const { items: activity } = useWalletActivity();
    const [screen, setScreen] = useState<Screen>('home');
    const [copied, setCopied] = useState(false);

    // H2 — CHIPS never priced into USD total.
    const usdTotal = useMemo(() => Number(formatUnits(usdc ?? BigInt(0), 6)), [usdc]);

    const copyAddress = async () => {
        if (!address) return;
        try {
            await navigator.clipboard.writeText(address);
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
        } catch {
            /* clipboard blocked */
        }
    };

    const isHome = screen === 'home';
    const title =
        screen === 'home'
            ? 'Wallet'
            : screen === 'send'
              ? 'Send'
              : screen === 'receive'
                ? 'Receive'
                : screen === 'activity'
                  ? 'Activity'
                  : screen === 'apps'
                    ? 'Apps'
                    : 'Settings';

    return (
        <>
            <div className="cb-wallet-backdrop" aria-hidden onClick={onClose} />
            <div className="cb-wallet-root" role="dialog" aria-modal="true" aria-label="Wallet">
                <header className="cb-nav">
                    {!isHome ? (
                        <button type="button" className="cb-icon-btn" aria-label="Back" onClick={() => setScreen('home')}>
                            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M15 18l-6-6 6-6" />
                            </svg>
                        </button>
                    ) : (
                        <span className="cb-nav-title">Wallet</span>
                    )}
                    {isHome && (
                        <span className="cb-mode-pill">{mode === 'ingame' ? 'Smart wallet' : 'Connected'}</span>
                    )}
                    {!isHome && <h1 className="cb-nav-title">{title}</h1>}
                    <button type="button" className="cb-icon-btn" aria-label="Close wallet" onClick={onClose}>
                        <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                            <path d="M18 6 6 18M6 6l12 12" />
                        </svg>
                    </button>
                </header>

                {needsReconnect && (
                    <div className="cb-banner">
                        Session expired — reconnect to restore in-game wallet. External wallets stay connected.
                    </div>
                )}

                <main className="cb-main">
                    {isHome && (
                        <>
                            <button type="button" className="cb-address" onClick={copyAddress} title="Copy address">
                                <span className="cb-addr-text">{shortAddr(address)}</span>
                                <span className="cb-copy">{copied ? 'Copied' : 'Copy'}</span>
                            </button>

                            <div className="cb-balance">
                                <div className="cb-balance-label">Portfolio</div>
                                <div className="cb-balance-row">
                                    <span className="cb-balance-num">
                                        $
                                        {usdTotal.toLocaleString(undefined, {
                                            minimumFractionDigits: 2,
                                            maximumFractionDigits: 2,
                                        })}
                                    </span>
                                    <span className="cb-balance-ccy">USD</span>
                                </div>
                                <div className="cb-balance-sub">Priced assets only · CHIPS not included</div>
                            </div>

                            <div className="cb-actions">
                                <ActionButton
                                    label="Send"
                                    primary
                                    onClick={() => setScreen('send')}
                                    icon={
                                        <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M12 19V5M6 11l6-6 6 6" />
                                        </svg>
                                    }
                                />
                                <ActionButton
                                    label="Receive"
                                    onClick={() => setScreen('receive')}
                                    icon={
                                        <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M12 5v14M6 13l6 6 6-6" />
                                        </svg>
                                    }
                                />
                                <ActionButton
                                    label="Activity"
                                    onClick={() => setScreen('activity')}
                                    icon={
                                        <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                                            <path d="M4 7h16M4 12h10M4 17h7" />
                                        </svg>
                                    }
                                />
                                <ActionButton
                                    label="More"
                                    onClick={() => setScreen('security')}
                                    icon={
                                        <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.2">
                                            <circle cx="6" cy="12" r="1.6" fill="currentColor" />
                                            <circle cx="12" cy="12" r="1.6" fill="currentColor" />
                                            <circle cx="18" cy="12" r="1.6" fill="currentColor" />
                                        </svg>
                                    }
                                />
                            </div>

                            <div className="cb-section">
                                <div className="cb-section-head">
                                    <span>Assets</span>
                                    <button type="button" className="cb-link" onClick={() => void refresh()}>
                                        {loading ? 'Updating…' : 'Refresh'}
                                    </button>
                                </div>
                                <div className="cb-card">
                                    {(tokens as { key: string; label: string; formatted: string; unpriced?: boolean }[]).map(
                                        (t) => (
                                            <button
                                                key={t.key}
                                                type="button"
                                                className="cb-asset-row"
                                                onClick={() => setScreen('send')}
                                            >
                                                <TokenIcon kind={t.key as 'eth' | 'usdc' | 'chips'} />
                                                <div className="cb-asset-meta">
                                                    <div className="cb-asset-name">
                                                        {t.label}
                                                        {t.unpriced && <span className="cb-badge">Unpriced</span>}
                                                    </div>
                                                    <div className="cb-asset-sub">
                                                        {t.key === 'chips' ? 'Game token · Base' : 'Base'}
                                                    </div>
                                                </div>
                                                <div className="cb-asset-bal">
                                                    <div className="cb-asset-amt">{loading ? '…' : t.formatted}</div>
                                                    <div className="cb-asset-fiat">
                                                        {t.unpriced || t.key === 'eth' ? '—' : `$${Number(t.formatted).toFixed(2)}`}
                                                    </div>
                                                </div>
                                            </button>
                                        )
                                    )}
                                </div>
                            </div>

                            <div className="cb-section">
                                <div className="cb-section-head">
                                    <span>Recent</span>
                                    <button type="button" className="cb-link" onClick={() => setScreen('activity')}>
                                        See all
                                    </button>
                                </div>
                                <div className="cb-card">
                                    {activity.length === 0 ? (
                                        <p className="cb-empty">No transfers yet. Sends you confirm show up here.</p>
                                    ) : (
                                        activity.slice(0, 4).map((i) => (
                                            <div key={i.hash || i.id} className="cb-asset-row static">
                                                <div className="cb-asset-icon neutral">{i.kind === 'receive' ? '↓' : '↑'}</div>
                                                <div className="cb-asset-meta">
                                                    <div className="cb-asset-name">
                                                        {i.kind === 'receive' ? 'Received' : i.kind === 'send' ? 'Sent' : i.kind}
                                                    </div>
                                                    <div className="cb-asset-sub font-mono">{i.counterparty}</div>
                                                </div>
                                                <div className="cb-asset-bal">
                                                    <div className="cb-asset-amt">
                                                        {i.kind === 'receive' ? '+' : '−'}
                                                        {i.amount} {i.token}
                                                    </div>
                                                    <div className={`cb-asset-fiat status-${i.status}`}>{i.status}</div>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        </>
                    )}

                    {screen === 'send' && (
                        <div className="cb-screen">
                            <SendTokenSheet onDone={() => setScreen('activity')} />
                        </div>
                    )}
                    {screen === 'receive' && (
                        <div className="cb-screen">
                            <ReceiveSheet />
                        </div>
                    )}
                    {screen === 'activity' && (
                        <div className="cb-screen">
                            <WalletActivityList />
                        </div>
                    )}
                    {screen === 'apps' && (
                        <div className="cb-screen">
                            <WcWalletPanel />
                        </div>
                    )}
                    {screen === 'security' && (
                        <div className="cb-screen space-y-4">
                            <WalletSecurityPanel />
                            <WalletLinkPanel />
                        </div>
                    )}
                </main>

                <nav className="cb-tabs" aria-label="Wallet sections">
                    {(
                        [
                            ['home', 'Home'],
                            ['activity', 'Activity'],
                            ['apps', 'Apps'],
                            ['security', 'Settings'],
                        ] as const
                    ).map(([id, label]) => {
                        const active =
                            screen === id || (id === 'home' && (screen === 'send' || screen === 'receive'));
                        return (
                            <button
                                key={id}
                                type="button"
                                className={`cb-tab ${active ? 'active' : ''}`}
                                onClick={() => setScreen(id as Screen)}
                            >
                                <span>{label}</span>
                            </button>
                        );
                    })}
                </nav>
            </div>
        </>
    );
}
