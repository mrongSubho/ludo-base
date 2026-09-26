"use client";

import React, { useCallback, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useChipsBalance } from "@/hooks/useChipsBalance";
import { useClaimAll } from "@/hooks/useChipsPool";
import { chipsAddress, shortHex } from "@/lib/chips";

interface ChipsWalletPanelProps {
    isOpen: boolean;
    onClose: () => void;
    claimablePoolIds?: `0x${string}`[];
    /** In-app feed panel (not a full-page route). */
    onFeed?: () => void;
}

/* Coinbase Wallet language: white sheet, blue primary, account row, action grid.
   Theme-proof: all paint lives on .cw-root vars — never ludo-* / cyan-* tokens. */
const CW_CSS = `
.cw-root {
  --cw-blue: #0052FF;
  --cw-blue-soft: rgba(0, 82, 255, 0.18);
  --cw-bg: #0B0D12;
  --cw-ink: #F5F7FA;
  --cw-muted: #9AA3B2;
  --cw-line: rgba(255, 255, 255, 0.1);
  --cw-chip: #151A22;
  --cw-icon-bg: rgba(255, 255, 255, 0.1);
  --cw-icon-ink: #F5F7FA;
  --cw-primary-ink: #FFFFFF;
  --cw-shadow: 0 24px 80px rgba(0, 0, 0, 0.55);
  color-scheme: dark;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, sans-serif;
  color: var(--cw-ink);
  background: var(--cw-bg);
  border-radius: 24px;
  box-shadow: var(--cw-shadow);
  overflow: hidden;
  width: 100%;
  max-width: 400px;
}
body.theme-daybreak .cw-root {
  --cw-blue: #0052FF;
  --cw-blue-soft: rgba(0, 82, 255, 0.12);
  --cw-bg: #FFFFFF;
  --cw-ink: #0A0B0D;
  --cw-muted: #5B616E;
  --cw-line: rgba(10, 11, 13, 0.08);
  --cw-chip: #F5F7FA;
  --cw-icon-bg: rgba(0, 82, 255, 0.1);
  --cw-icon-ink: #0052FF;
  --cw-primary-ink: #FFFFFF;
  --cw-shadow: 0 24px 80px rgba(0, 0, 0, 0.28);
  color-scheme: light;
}
.cw-root * { box-sizing: border-box; }
.cw-sheet-top {
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px 20px 8px;
}
.cw-brand {
  display: flex; align-items: center; gap: 8px;
  font-size: 13px; font-weight: 700; letter-spacing: -0.01em; color: var(--cw-ink);
}
.cw-brand-dot {
  width: 28px; height: 28px; border-radius: 999px;
  background: var(--cw-blue);
  display: flex; align-items: center; justify-content: center;
}
.cw-icon-btn {
  width: 36px; height: 36px; border-radius: 999px; border: none;
  background: var(--cw-chip); color: var(--cw-muted);
  display: flex; align-items: center; justify-content: center; cursor: pointer;
}
.cw-icon-btn:hover { background: var(--cw-line); color: var(--cw-ink); }
.cw-hero { padding: 8px 24px 4px; text-align: center; }
.cw-hero-label {
  font-size: 13px; font-weight: 500; color: var(--cw-muted);
}
.cw-hero-balance {
  margin-top: 6px;
  font-size: 44px; line-height: 1.05; font-weight: 700;
  letter-spacing: -0.03em; color: var(--cw-ink);
}
.cw-hero-unit {
  display: inline-block; margin-top: 8px;
  padding: 4px 10px; border-radius: 999px;
  background: var(--cw-blue-soft); color: var(--cw-blue);
  font-size: 12px; font-weight: 700; letter-spacing: 0.02em;
}
.cw-account {
  margin: 18px 16px 8px;
  display: flex; align-items: center; gap: 12px;
  padding: 12px 14px; border-radius: 16px;
  background: var(--cw-chip);
}
.cw-identicon {
  width: 40px; height: 40px; border-radius: 12px; flex-shrink: 0;
  background: linear-gradient(135deg, #0052FF 0%, #6B8CFF 55%, #A8C0FF 100%);
}
.cw-account-meta { min-width: 0; flex: 1; }
.cw-account-name {
  font-size: 14px; font-weight: 700; color: var(--cw-ink);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.cw-account-addr {
  margin-top: 2px; font-size: 12px; color: var(--cw-muted);
  font-variant-numeric: tabular-nums;
}
.cw-copy {
  border: none; cursor: pointer;
  padding: 8px 12px; border-radius: 10px;
  background: var(--cw-bg); color: var(--cw-blue);
  font-size: 12px; font-weight: 700;
  box-shadow: 0 0 0 1px var(--cw-line);
}
.cw-copy:hover { background: var(--cw-blue-soft); }
.cw-actions {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;
  padding: 12px 16px 8px;
}
.cw-action {
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  padding: 14px 8px 12px; border-radius: 16px;
  border: none; cursor: pointer; text-decoration: none;
  background: var(--cw-chip); color: var(--cw-ink);
  font-size: 12px; font-weight: 700;
}
.cw-action:hover { background: var(--cw-line); }
.cw-action:disabled { opacity: 0.45; cursor: not-allowed; }
.cw-action-primary {
  background: var(--cw-blue); color: #FFFFFF;
}
.cw-action-primary:hover { background: #0046DB; }
.cw-action-primary:disabled { background: var(--cw-blue-soft); color: var(--cw-blue); }
.cw-action-icon {
  width: 40px; height: 40px; border-radius: 999px;
  display: flex; align-items: center; justify-content: center;
  background: var(--cw-icon-bg); color: var(--cw-icon-ink);
}
.cw-action-primary .cw-action-icon {
  background: rgba(255, 255, 255, 0.22); color: var(--cw-primary-ink);
}
.cw-action-primary:disabled .cw-action-icon {
  background: var(--cw-icon-bg); color: var(--cw-icon-ink);
}
.cw-foot {
  margin: 8px 16px 18px; padding: 12px 14px;
  border-radius: 14px; background: var(--cw-chip);
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
}
.cw-foot-text {
  font-size: 12px; line-height: 1.45; color: var(--cw-muted);
}
.cw-pill {
  flex-shrink: 0; padding: 5px 10px; border-radius: 999px;
  font-size: 11px; font-weight: 700; letter-spacing: 0.02em;
  background: #E8F5E9; color: #1B5E20;
}
.cw-pill-idle { background: var(--cw-chip); color: var(--cw-muted); }
.cw-network {
  margin: 0 16px 16px; display: flex; align-items: center; gap: 8px;
  font-size: 12px; color: var(--cw-muted);
}
.cw-network-dot {
  width: 8px; height: 8px; border-radius: 999px; background: #0052FF;
}
.cw-warn {
  margin: 12px 16px 18px; padding: 12px 14px; border-radius: 12px;
  background: #FFF7E6; color: #8A5A00; font-size: 12px; line-height: 1.45;
}
.cw-warn code {
  font-weight: 700; background: rgba(138, 90, 0, 0.1); padding: 1px 6px; border-radius: 6px;
}
.cw-error {
  margin: 0 16px 16px; font-size: 12px; color: #B3261E;
}
`;

function IconRefresh() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M21 12a9 9 0 1 1-2.6-6.4" />
            <path d="M21 3v6h-6" />
        </svg>
    );
}

function IconClaim() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3v12" />
            <path d="m7 10 5 5 5-5" />
            <path d="M5 21h14" />
        </svg>
    );
}

function IconFeed() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M4 6h16M4 12h10M4 18h16" />
        </svg>
    );
}

function IconClose() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6 6 18" />
        </svg>
    );
}

/** In-game web3 wallet sheet (Coinbase Wallet language). Theme-proof via .cw-root. */
export function ChipsWalletPanel({ isOpen, onClose, claimablePoolIds, onFeed }: ChipsWalletPanelProps) {
    const bal = useChipsBalance();
    const { claimMany, isPending: claiming, error: claimError, configured: claimConfigured } =
        useClaimAll();
    const [copied, setCopied] = useState(false);
    const [note, setNote] = useState<string | null>(null);

    const copyAddress = useCallback(async () => {
        if (!bal.address) return;
        try {
            await navigator.clipboard.writeText(bal.address);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
        } catch {
            setNote("Clipboard blocked");
        }
    }, [bal.address]);

    const onClaimAll = useCallback(async () => {
        if (!claimablePoolIds?.length) {
            setNote("No settled prize in this session");
            return;
        }
        setNote(null);
        await claimMany(claimablePoolIds);
        await bal.refresh();
    }, [claimablePoolIds, claimMany, bal]);

    const claimReady = Boolean(claimablePoolIds?.length);

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    <style>{CW_CSS}</style>
                    <div
                        className="fixed inset-0 z-[400] flex items-end sm:items-center justify-center p-3 sm:p-6"
                        style={{ background: "rgba(10, 11, 13, 0.55)" }}
                        onClick={onClose}
                    >
                        <motion.div
                            initial={{ opacity: 0, y: 28, scale: 0.98 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 16, scale: 0.98 }}
                            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                            onClick={(e) => e.stopPropagation()}
                            className="cw-root"
                        >
                            <div className="cw-sheet-top">
                                <div className="cw-brand">
                                    <span className="cw-brand-dot" aria-hidden>
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                                            <circle cx="12" cy="12" r="8" fill="#fff" />
                                        </svg>
                                    </span>
                                    Wallet
                                </div>
                                <button type="button" className="cw-icon-btn" onClick={onClose} aria-label="Close">
                                    <IconClose />
                                </button>
                            </div>

                            <div className="cw-hero">
                                <div className="cw-hero-label">Total balance</div>
                                <div className="cw-hero-balance">
                                    {bal.configured ? bal.human : "—"}
                                </div>
                                <div className="cw-hero-unit">CHIPS</div>
                            </div>

                            <div className="cw-account">
                                <div className="cw-identicon" aria-hidden />
                                <div className="cw-account-meta">
                                    <div className="cw-account-name">
                                        {bal.address ? shortHex(bal.address) : "Not connected"}
                                    </div>
                                    <div className="cw-account-addr">
                                        {copied ? "Copied to clipboard" : "Tap copy for full address"}
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    className="cw-copy"
                                    onClick={copyAddress}
                                    disabled={!bal.address}
                                >
                                    Copy
                                </button>
                            </div>

                            <div className="cw-actions">
                                <button
                                    type="button"
                                    className="cw-action"
                                    onClick={() => void bal.refresh()}
                                    disabled={bal.refreshing}
                                >
                                    <span className="cw-action-icon"><IconRefresh /></span>
                                    {bal.refreshing ? "Sync" : "Refresh"}
                                </button>
                                <button
                                    type="button"
                                    className="cw-action cw-action-primary"
                                    onClick={() => void onClaimAll()}
                                    disabled={claiming || !claimConfigured || !claimReady}
                                >
                                    <span className="cw-action-icon"><IconClaim /></span>
                                    {claiming ? "Claiming" : "Claim"}
                                </button>
                                <button
                                    type="button"
                                    className="cw-action"
                                    onClick={() => {
                                        onClose();
                                        onFeed?.();
                                    }}
                                >
                                    <span className="cw-action-icon"><IconFeed /></span>
                                    Feed
                                </button>
                            </div>

                            <div className="cw-network">
                                <span className="cw-network-dot" />
                                Base Sepolia
                                {chipsAddress() ? ` · ${shortHex(chipsAddress() ?? "")}` : ""}
                            </div>

                            {bal.chainMismatch && (
                                <div className="cw-warn">
                                    Wallet is on the wrong network. CHIPS reads Base Sepolia.
                                    <button
                                        type="button"
                                        className="cw-copy"
                                        style={{ marginLeft: 8 }}
                                        onClick={() => bal.switchToChipsChain()}
                                        disabled={bal.switching}
                                    >
                                        {bal.switching ? "Switching" : "Switch to Base Sepolia"}
                                    </button>
                                </div>
                            )}

                            {!bal.configured ? (
                                <div className="cw-warn">
                                    Wallet env missing — restart <code>npm run dev</code> with
                                    NEXT_PUBLIC_CHIPS_ADDRESS and NEXT_PUBLIC_MATCH_POOL_ADDRESS.
                                </div>
                            ) : (
                                <div className="cw-foot">
                                    <div className="cw-foot-text">
                                        Prizes settle on-chain. Claim unlocks after the match
                                        dispute window.
                                    </div>
                                    <span className={`cw-pill ${claimReady ? "" : "cw-pill-idle"}`}>
                                        {claimReady ? "Prize ready" : "Idle"}
                                    </span>
                                </div>
                            )}

                            {(note || claimError || bal.error) && (
                                <div className="cw-error">{note || claimError || bal.error}</div>
                            )}
                        </motion.div>
                    </div>
                </>
            )}
        </AnimatePresence>
    );
}

export default ChipsWalletPanel;
