'use client';

import React from 'react';

export interface SignWaitModalProps {
    isOpen: boolean;
    title?: string;
    badgeText?: string;
    statusText?: string;
    onCancel: () => void;
}

export const SignWaitModal: React.FC<SignWaitModalProps> = ({
    isOpen,
    title = 'WALLET SIGN-IN REQUIRED',
    badgeText = 'Awaiting Signature',
    statusText = 'Please approve the sign-in request in your wallet to proceed to online multiplayer.',
    onCancel,
}) => {
    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 z-[350] bg-black/60 backdrop-blur-md flex items-center justify-center p-5 animate-in fade-in duration-200"
            onClick={onCancel}
            role="dialog"
            aria-modal="true"
            aria-labelledby="sign-wait-modal-title"
        >
            <div
                className="ludo-authwait-scope border border-white/10 rounded-[32px] shadow-2xl max-w-sm w-full p-6 flex flex-col items-center text-center gap-4 animate-in zoom-in-95 duration-200"
                style={{
                    background: 'var(--panel-bg-image, var(--ludo-bg-cosmic))',
                    backgroundColor: 'var(--panel-bg, rgba(13,13,13,0.95))',
                    backdropFilter: 'blur(32px)',
                }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Visual Radar / Signature Beacon */}
                <div className="relative w-16 h-16 flex items-center justify-center mt-1 shrink-0">
                    {/* Glowing pulse ring */}
                    <div className="absolute inset-0 rounded-full border border-cyan-400/40 animate-ping opacity-30" />
                    {/* Spinning outer ring */}
                    <div className="w-16 h-16 rounded-full border-2 border-cyan-500/20 border-t-cyan-400 animate-spin" />
                    {/* Center icon */}
                    <div className="absolute inset-0 flex items-center justify-center text-cyan-400 drop-shadow-[0_0_8px_rgba(0,229,255,0.6)]">
                        <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="w-7 h-7"
                        >
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                            <path d="M9 12l2 2 4-4" />
                        </svg>
                    </div>
                </div>

                {/* Badge */}
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-ludo-xs font-black text-cyan-400 uppercase tracking-widest shadow-sm">
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                    {badgeText}
                </div>

                {/* Title & Description */}
                <div className="flex flex-col gap-1.5 px-2">
                    <h2 id="sign-wait-modal-title" className="text-base font-bold text-white tracking-wide leading-tight">
                        {title}
                    </h2>
                    <p className="text-white/60 text-xs font-medium leading-relaxed">
                        {statusText}
                    </p>
                </div>

                {/* Informational Micro-card */}
                <div className="w-full flex items-center gap-2.5 rounded-2xl bg-white/[0.04] border border-white/10 px-3.5 py-2.5 text-left">
                    <span className="w-2 h-2 rounded-full bg-cyan-400 shrink-0 shadow-[0_0_6px_rgba(0,229,255,0.8)]" />
                    <span className="text-ludo-xs font-medium text-white/70">
                        Zero gas fee. Sign-in only proves wallet ownership.
                    </span>
                </div>

                {/* Cancel Action */}
                <div className="w-full pt-1">
                    <button
                        type="button"
                        onClick={onCancel}
                        className="w-full py-2.5 rounded-2xl bg-white/10 hover:bg-white/20 text-white text-xs font-black uppercase tracking-[0.2em] transition-all border border-white/10 active:scale-95 shadow-sm"
                    >
                        Return to Lobby
                    </button>
                </div>
            </div>
        </div>
    );
};

export default SignWaitModal;
