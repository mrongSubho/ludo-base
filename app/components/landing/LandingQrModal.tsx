"use client";

import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';

interface LandingQrModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const APP_URL = 'https://ludo-base.vercel.app';
const BASE_APP_ID = '699c46f96a71d5dab092bfb0';

export default function LandingQrModal({ isOpen, onClose }: LandingQrModalProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    QRCode.toDataURL(APP_URL, {
      margin: 1,
      width: 240,
    })
      .then(setQrDataUrl)
      .catch(() => {});
  }, [isOpen]);

  if (!isOpen) return null;

  const handleCopyLink = () => {
    navigator.clipboard.writeText(APP_URL);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Scan to play on mobile"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className="landing-card w-full max-w-sm p-6 flex flex-col items-center gap-4 text-center shadow-2xl relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 text-ink-muted hover:text-ink-strong text-ludo-lg"
          aria-label="Close dialog"
        >
          ✕
        </button>

        <div className="flex flex-col items-center gap-1">
          <span className="text-ludo-xs uppercase tracking-widest text-accent font-semibold">
            Mobile & Mini-App Handoff
          </span>
          <h3 className="text-xl font-bold text-ink-strong">Scan to Launch</h3>
          <p className="text-ludo-xs text-ink-muted max-w-xs">
            Open with your phone camera, Warpcast, or Base App to boot the instant onchain arena.
          </p>
        </div>

        {/* QR Code */}
        <div className="p-3 rounded-2xl bg-surface-recessed border border-line-soft">
          {qrDataUrl ? (
            <img
              src={qrDataUrl}
              alt="QR code to play Ludo 3077 on mobile"
              width={220}
              height={220}
              className="rounded-xl"
            />
          ) : (
            <div className="w-[220px] h-[220px] flex items-center justify-center text-ink-faint text-ludo-xs">
              Generating tactical QR…
            </div>
          )}
        </div>

        {/* Base App ID Tag */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface-recessed border border-line-soft text-ludo-xs font-mono text-ink-muted">
          <span>Base App ID:</span>
          <span className="text-accent">{BASE_APP_ID.slice(0, 8)}…</span>
        </div>

        {/* Action Button */}
        <button
          type="button"
          onClick={handleCopyLink}
          className="w-full py-2.5 px-4 rounded-xl text-ludo-sm uppercase font-black tracking-wider bg-accent text-surface-page hover:brightness-110 active:scale-95 transition-all"
        >
          {copied ? '✓ Link Copied to Clipboard' : 'Copy Arena URL'}
        </button>
      </div>
    </div>
  );
}
