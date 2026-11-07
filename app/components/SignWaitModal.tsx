'use client';

import React from 'react';
import { ThinkingOrb } from './ThinkingOrb';
import type { PromptMode } from '@/hooks/useAuthPrompt';
import type { PreflightTelemetry } from '@/lib/txSimulator';

export interface SignWaitModalProps {
    isOpen: boolean;
    mode?: PromptMode;
    title?: string;
    badgeText?: string;
    statusText?: string;
    networkText?: string;
    explanationText?: string;
    cancelLabel?: string;
    telemetry?: PreflightTelemetry;
    onCancel: () => void;
}

export const SignWaitModal: React.FC<SignWaitModalProps> = ({
    isOpen,
    mode = 'signature',
    title = 'WALLET SIGN-IN REQUIRED',
    badgeText = 'Awaiting Signature',
    statusText = 'Please approve the sign-in request in your wallet to proceed to online multiplayer.',
    networkText,
    explanationText,
    cancelLabel,
    telemetry,
    onCancel,
}) => {
    if (!isOpen) return null;

    const isTx = mode === 'transaction';
    const isConfirming = badgeText.toLowerCase().includes('confirming') || badgeText.toLowerCase().includes('mining');
    const isReverted = telemetry?.status === 'reverted';
    const isSimulating = telemetry?.status === 'simulating';
    const isPassed = telemetry?.status === 'passed';

    return (
        <div
            className="fixed inset-0 z-[350] bg-black/60 backdrop-blur-md flex items-center justify-center p-4 sm:p-5 animate-in fade-in duration-200"
            onClick={onCancel}
            role="dialog"
            aria-modal="true"
            aria-labelledby="sign-wait-modal-title"
        >
            <div
                className={`ludo-authwait-scope border border-white/10 rounded-[32px] shadow-2xl ${
                    isTx ? 'max-w-md' : 'max-w-sm'
                } w-full max-h-[92vh] overflow-y-auto p-5 sm:p-6 flex flex-col items-center text-center gap-3.5 sm:gap-4 animate-in zoom-in-95 duration-200`}
                style={{
                    background: 'var(--panel-bg-image, var(--ludo-bg-cosmic))',
                    backgroundColor: 'var(--panel-bg, rgba(13,13,13,0.95))',
                    backdropFilter: 'blur(32px)',
                }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Visual Radar / Signature Beacon */}
                <div className="relative w-14 h-14 sm:w-16 sm:h-16 flex items-center justify-center mt-1 shrink-0">
                    {/* Outer ring */}
                    <div
                        className={`w-14 h-14 sm:w-16 sm:h-16 rounded-full border-2 ${
                            isReverted
                                ? 'border-sig-danger/20 border-t-sig-danger'
                                : 'border-line-accent/20 border-t-accent'
                        } animate-spin`}
                    />
                    {/* Center icon / dynamic orb */}
                    <div className="absolute inset-0 flex items-center justify-center">
                        {isReverted ? (
                            <div className="text-sig-danger">
                                <svg
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    className="w-7 h-7"
                                >
                                    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                                    <line x1="12" y1="9" x2="12" y2="13" />
                                    <line x1="12" y1="17" x2="12.01" y2="17" />
                                </svg>
                            </div>
                        ) : isTx ? (
                            <ThinkingOrb state="solving" size={32} tone="accent" />
                        ) : (
                            <div className="text-accent">
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
                        )}
                    </div>
                </div>

                {/* Badge */}
                <div
                    className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-ludo-xs font-mono font-bold uppercase tracking-widest ${
                        isReverted
                            ? 'bg-sig-danger/10 border border-sig-danger/30 text-sig-danger'
                            : 'bg-accent/10 border border-line-accent text-accent'
                    }`}
                >
                    <span
                        className={`w-1.5 h-1.5 rounded-full ${
                            isReverted
                                ? 'bg-sig-danger'
                                : isConfirming
                                ? 'bg-sig-warn'
                                : 'bg-accent'
                        }`}
                    />
                    {isReverted ? 'Pre-Flight Warning' : badgeText}
                </div>

                {/* Title & Description */}
                <div className="flex flex-col gap-1 px-2">
                    <h2 id="sign-wait-modal-title" className="text-base font-bold text-white tracking-wide leading-tight">
                        {title}
                    </h2>
                    <p className="text-white/60 text-xs font-medium leading-relaxed">
                        {statusText}
                    </p>
                </div>

                {/* PRE-FLIGHT TELEMETRY HUD (Tactical Transaction Preview) */}
                {isTx && (
                    <div className="w-full flex flex-col gap-2.5 rounded-2xl bg-white/[0.03] border border-white/10 p-3 text-left">
                        {/* Telemetry Header */}
                        <div className="flex items-center justify-between pb-2 border-b border-white/5">
                            <div className="flex items-center gap-1.5 text-cyan-400 font-mono text-ludo-xs font-black uppercase tracking-widest">
                                <svg
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    className="w-3.5 h-3.5"
                                >
                                    <path d="M12 2a10 10 0 1 0 10 10" />
                                    <path d="M12 6a6 6 0 1 0 6 6" />
                                    <circle cx="12" cy="12" r="2" />
                                    <path d="M12 12 19 5" />
                                </svg>
                                <span>Pre-Flight Telemetry</span>
                            </div>

                            {/* Status Pill */}
                            <div className="text-ludo-xs font-mono font-bold uppercase tracking-wider">
                                {isReverted ? (
                                    <span className="inline-flex items-center gap-1 text-sig-danger bg-sig-danger/10 px-2 py-0.5 rounded border border-sig-danger/20">
                                        <span className="w-1 h-1 rounded-full bg-sig-danger" />
                                        Will Revert
                                    </span>
                                ) : isPassed ? (
                                    <span className="inline-flex items-center gap-1 text-sig-ok bg-sig-ok/10 px-2 py-0.5 rounded border border-sig-ok/20">
                                        <span className="w-1 h-1 rounded-full bg-sig-ok" />
                                        Simulation Passed
                                    </span>
                                ) : isSimulating ? (
                                    <span className="inline-flex items-center gap-1 text-sig-info bg-sig-info/10 px-2 py-0.5 rounded border border-sig-info/20">
                                        <span className="w-1 h-1 rounded-full bg-sig-info" />
                                        Simulating...
                                    </span>
                                ) : (
                                    <span className="text-ink-faint">Telemetry Ready</span>
                                )}
                            </div>
                        </div>

                        {/* Critical Revert Alert Box */}
                        {isReverted && (
                            <div className="w-full rounded-xl bg-rose-950/40 border border-rose-500/40 p-2.5 flex flex-col gap-1 text-left">
                                <div className="flex items-center gap-1.5 text-rose-400 font-mono text-ludo-sm font-bold uppercase tracking-wider">
                                    <svg
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        className="w-3.5 h-3.5 shrink-0"
                                    >
                                        <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                                        <line x1="12" y1="9" x2="12" y2="13" />
                                        <line x1="12" y1="17" x2="12.01" y2="17" />
                                    </svg>
                                    <span>Zero-Gas Protection Triggered</span>
                                </div>
                                <p className="text-rose-200 text-xs font-mono leading-relaxed">
                                    {telemetry.revertReason || 'Contract call reverted during dry-run simulation.'}
                                </p>
                                <span className="text-ludo-xs font-mono text-rose-400/80">
                                    Reject this request in your wallet to avoid paying wasted gas.
                                </span>
                            </div>
                        )}

                        {/* Contract Identity & Action Method */}
                        {telemetry && (
                            <div className="flex items-center justify-between px-2.5 py-1.5 rounded-xl bg-white/[0.02] border border-white/5 text-xs">
                                <div className="flex items-center gap-2 min-w-0">
                                    {telemetry.isVerifiedCore ? (
                                        <svg
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="2"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            className="w-4 h-4 text-emerald-400 shrink-0"
                                        >
                                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                                            <path d="m9 12 2 2 4-4" />
                                        </svg>
                                    ) : (
                                        <svg
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="2"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            className="w-4 h-4 text-white/40 shrink-0"
                                        >
                                            <rect width="18" height="18" x="3" y="3" rx="2" />
                                            <path d="m9 8 6 4-6 4Z" />
                                        </svg>
                                    )}
                                    <div className="flex flex-col min-w-0">
                                        <span className="font-semibold text-white/90 text-xs truncate">
                                            {telemetry.contractName}
                                        </span>
                                        <span className="font-mono text-ludo-xs text-white/40 truncate">
                                            {telemetry.contractAddress}
                                        </span>
                                    </div>
                                </div>
                                <div className="text-right flex flex-col items-end shrink-0 pl-2">
                                    <span className="font-mono text-ludo-xs text-cyan-400 uppercase font-bold tracking-wide">
                                        {telemetry.methodName}
                                    </span>
                                    {telemetry.isVerifiedCore && (
                                        <span className="text-ludo-xs font-mono text-emerald-400 uppercase font-bold tracking-widest">
                                            Verified Core
                                        </span>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Asset Flow Breakdown (You Send vs You Receive) */}
                        {telemetry?.assetFlow && (
                            <div className="grid grid-cols-2 gap-2 w-full text-left">
                                {/* OUTFLOW: You Send */}
                                <div className="flex flex-col gap-1 p-2 rounded-xl bg-white/[0.02] border border-white/5">
                                    <div className="flex items-center justify-between text-ludo-xs font-mono uppercase tracking-wider text-white/50">
                                        <span>You Send</span>
                                        <svg
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="2.5"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            className="w-2.5 h-2.5 text-rose-400"
                                        >
                                            <path d="M7 17L17 7" />
                                            <path d="M7 7h10v10" />
                                        </svg>
                                    </div>
                                    {telemetry.assetFlow.sending.length === 0 ? (
                                        <span className="text-ludo-sm font-mono text-white/30 pt-0.5">No Outflow</span>
                                    ) : (
                                        telemetry.assetFlow.sending.map((item, idx) => (
                                            <div key={idx} className="flex flex-col pt-0.5">
                                                <span className={`text-ludo-sm font-bold truncate ${item.isGas ? 'text-white/60' : 'text-white/90'}`}>
                                                    {item.amount}
                                                </span>
                                                <span className="text-ludo-xs font-mono text-white/40">{item.label}</span>
                                            </div>
                                        ))
                                    )}
                                </div>

                                {/* INFLOW: You Receive */}
                                <div className="flex flex-col gap-1 p-2 rounded-xl bg-white/[0.02] border border-white/5">
                                    <div className="flex items-center justify-between text-ludo-xs font-mono uppercase tracking-wider text-emerald-400/80">
                                        <span>You Receive</span>
                                        <svg
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="2.5"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            className="w-2.5 h-2.5 text-emerald-400"
                                        >
                                            <path d="M17 7L7 17" />
                                            <path d="M17 17H7V7" />
                                        </svg>
                                    </div>
                                    {telemetry.assetFlow.receiving.length === 0 ? (
                                        <span className="text-ludo-sm font-mono text-white/30 pt-0.5">State Change</span>
                                    ) : (
                                        telemetry.assetFlow.receiving.map((item, idx) => (
                                            <div key={idx} className="flex flex-col pt-0.5">
                                                <span className="text-ludo-sm font-bold text-emerald-400 truncate">
                                                    {item.amount}
                                                </span>
                                                <span className="text-ludo-xs font-mono text-white/40">{item.label}</span>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Unlimited Allowance Caution */}
                        {telemetry?.approvalSafety === 'warning' && (
                            <div className="w-full flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-ludo-xs font-mono">
                                <svg
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    className="w-3 h-3 text-amber-400 shrink-0"
                                >
                                    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                                    <line x1="12" y1="9" x2="12" y2="13" />
                                    <line x1="12" y1="17" x2="12.01" y2="17" />
                                </svg>
                                <span>Caution: Unlimited token allowance approval detected.</span>
                            </div>
                        )}
                    </div>
                )}

                {/* Informational Micro-card */}
                <div className="w-full flex flex-col gap-2 rounded-2xl bg-white/[0.04] border border-white/10 px-3.5 py-2.5 text-left text-xs">
                    <div className="flex items-start gap-2.5">
                        <span className="w-2 h-2 mt-1 rounded-full bg-cyan-400 shrink-0 shadow-[0_0_6px_rgba(0,229,255,0.8)]" />
                        <span className="text-ludo-xs font-medium text-white/75 leading-relaxed">
                            {explanationText ||
                                (isTx
                                    ? 'Standard network gas fee applies on Base. Transaction will be verified on-chain.'
                                    : 'Zero gas fee. Sign-in only proves wallet ownership.')}
                        </span>
                    </div>
                    {networkText && (
                        <div className="flex items-center justify-between pt-2 border-t border-white/5 text-ludo-xs font-mono text-white/50">
                            <span className="tracking-wider uppercase">Network</span>
                            <span className="text-cyan-400 font-semibold tracking-wide flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                {networkText}
                            </span>
                        </div>
                    )}
                </div>

                {/* Cancel / Reject Action */}
                <div className="w-full pt-1">
                    <button
                        type="button"
                        onClick={onCancel}
                        className={`w-full py-2.5 rounded-2xl text-xs font-black uppercase tracking-[0.2em] transition-all border shadow-sm active:scale-95 ${
                            isReverted
                                ? 'bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border-rose-500/40'
                                : 'bg-white/10 hover:bg-white/20 text-white border-white/10'
                        }`}
                    >
                        {isReverted ? 'Reject & Protect Gas' : cancelLabel || (isTx ? 'Dismiss / Reject' : 'Return to Lobby')}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default SignWaitModal;
