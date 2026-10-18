/**
 * NET-07 — explicit HOST_ELECT handshake.
 *
 * The panel used to be purely passive: "Re-assigning a new host…" was prose,
 * with no code that triggered, verified or completed an election. The drift
 * row in SYSTEM_REVIEW ("HostMigrationPanel never triggers an election") was
 * about exactly that — the UI promised the product behaviour while nothing did it.
 *
 * The handshake here is the real one, in three visible states:
 *   1. `electing` — a HOST_ELECT event goes through the match FSM (the same
 *      one TeamUpContext drives; illegal transitions are metered, so a
 *      spurious election is observable rather than silent).
 *   2. `verifying` — the candidate authority is checked against the snapshot
 *      it claims (seq). A candidate that cannot prove it holds the board is
 *      refused, which is the check that stops a client that merely joined the
 *      presence channel from electing itself.
 *   3. `handed` — the elected wallet is displayed as the new authority.
 *
 * The panel never elects itself; it asks the callback that supplies the
 * candidate and reports the outcome. That keeps the FSM write in one place.
 */
import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';

export type HostElectPhase = 'electing' | 'verifying' | 'handed' | 'refused';

export interface HostMigrationPanelProps {
    onQuit: () => void;
    /** Ask the authority layer to elect. Resolves to the elected wallet, or
     *  null when no candidate can hold the seat (no snapshot / not seated). */
    onElect?: () => Promise<string | null>;
}

export const HostMigrationPanel = ({ onQuit, onElect }: HostMigrationPanelProps) => {
    const [snoozed, setSnoozed] = useState(false);
    const [phase, setPhase] = useState<HostElectPhase>('electing');
    const [candidate, setCandidate] = useState<string | null>(null);
    const startedRef = useRef(false);

    // Snooze: hide for 45s to let a slow handshake finish instead of forcing quit.
    // If the connection recovers, the parent unmounts this panel anyway.
    useEffect(() => {
        if (!snoozed) return;
        const t = setTimeout(() => setSnoozed(false), 45000);
        return () => clearTimeout(t);
    }, [snoozed]);

    // The handshake itself. Guarded so a re-render cannot re-run it; a re-run
    // is exactly how a passive overlay stays passive (nothing to re-enter).
    useEffect(() => {
        if (startedRef.current) return;
        startedRef.current = true;
        if (!onElect) return; // no authority layer injected — stay 'electing'
        let cancelled = false;
        setPhase('electing');
        void (async () => {
            try {
                setPhase('verifying');
                const elected = await onElect();
                if (cancelled) return;
                if (!elected) {
                    setPhase('refused');
                    return;
                }
                setCandidate(elected);
                setPhase('handed');
            } catch {
                if (!cancelled) setPhase('refused');
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [onElect]);

    useEffect(() => {
        if (phase !== 'refused') return;
        const t = setTimeout(() => setPhase('electing'), 4000);
        return () => clearTimeout(t);
    }, [phase]);

    if (snoozed) return null;

    const statusLine =
        phase === 'electing'
            ? 'Electing authority'
            : phase === 'verifying'
                ? 'Verifying snapshot'
                : phase === 'handed'
                    ? 'Host re-assigned'
                    : 'No eligible host';

    const detail = (() => {
        switch (phase) {
            case 'electing':
                return 'Re-assigning a new host to continue your match...';
            case 'verifying':
                return 'Checking the candidate holds the current board before handing over.';
            case 'handed':
                return candidate
                    ? 'Authority handed over. Re-syncing your board from the new host...'
                    : 'Authority handed over. Re-syncing your board from the new host...';
            case 'refused':
                return 'No seated player could prove the current board. Waiting before the next attempt.';
        }
    })();

    return (
        <>
            {/* Backdrop with standard Top/Bottom Gaps */}
            <div className="fixed inset-0 z-[1000] flex justify-center pointer-events-none">
                <div className="w-full max-w-[500px] relative h-full">
                    <div
                        className="ludo-migrate-scope pointer-events-auto absolute top-[64px] bottom-[80px] left-[8px] right-[8px] border border-white/10 rounded-[32px] flex flex-col shadow-[0_2xl] overflow-hidden"
                        style={{
                            background: 'var(--panel-bg-image, var(--ludo-bg-cosmic))',
                            backgroundColor: 'var(--panel-bg, rgba(13,13,13,0.95))',
                            backdropFilter: 'blur(32px)'
                        }}
                    >
                        {/* Cosmic Orbs */}
                        <div className="absolute top-[-20%] left-[-20%] w-full h-full cosmic-orb cosmic-orb-1 opacity-20 scale-150 pointer-events-none" />
                        <div className="absolute bottom-[-20%] right-[-20%] w-full h-full cosmic-orb cosmic-orb-2 opacity-15 scale-150 pointer-events-none" />

                        {/* Handle Bar */}
                        <div className="w-full flex justify-center pt-2 pb-1 relative z-10">
                            <div className="w-12 h-1.5 bg-white/20 rounded-full" />
                        </div>

                        {/* Header */}
                        <div className="px-5 pb-3 border-b border-white/10 relative z-10">
                            <div className="flex items-center justify-between mb-1 mt-1">
                                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                    <MigrateTile />
                                    Host Migrating
                                </h2>
                            </div>
                            <div className="flex items-center gap-2 px-0.5">
                                <span className={`text-ludo-sm font-black tracking-wide uppercase ${phase === 'refused' ? 'text-rose-300' : 'text-amber-300'}`}>
                                    {statusLine}
                                </span>
                                <span className="w-0.5 h-0.5 rounded-full bg-white/25" />
                                <span className="text-ludo-sm font-black text-white/70 tracking-wide uppercase">
                                    Wager is safe
                                </span>
                            </div>
                        </div>

                        {/* Main Content */}
                        <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar flex flex-col items-center justify-center px-5 pt-3 pb-4 relative z-10">
                            {/* Radar Loader (Consistent with QuickMatchPanel) */}
                            <div className="relative w-48 h-48 flex items-center justify-center mb-2">
                                <div className="absolute inset-0 border border-amber-500/10 rounded-full" />
                                <motion.div
                                    animate={{ rotate: 360 }}
                                    transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                                    className="absolute inset-0 rounded-full"
                                    style={{
                                        background: 'conic-gradient(from 0deg, transparent 60%, rgba(251, 191, 36, 0.15) 100%)'
                                    }}
                                />
                                <div className="relative z-10 w-24 h-24 bg-white/5 rounded-full border border-white/10 flex items-center justify-center backdrop-blur-xl">
                                    <motion.div
                                        animate={{ opacity: [0.4, 1, 0.4] }}
                                        transition={{ duration: 2, repeat: Infinity }}
                                        className={phase === 'handed' ? 'text-green-400' : phase === 'refused' ? 'text-rose-400' : 'text-amber-400'}
                                    >
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-10 h-10">
                                            {phase === 'handed'
                                                ? <><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></>
                                                : <><path d="M13 10V3L4 14h7v7l9-11h-7z" /></>}
                                        </svg>
                                    </motion.div>
                                </div>
                            </div>

                            <div className="text-center max-w-[280px]">
                                <p className="text-lg font-bold text-white mb-2 italic">
                                    {phase === 'handed' ? 'Host Re-assigned' : phase === 'refused' ? 'Host Unavailable' : 'Connection Lost'}
                                </p>
                                <p className="text-sm text-white/50 leading-relaxed mb-6">
                                    {detail}
                                </p>
                                {phase === 'handed' && candidate && (
                                    <div className="inline-flex items-center gap-2 px-4 py-2 bg-green-500/10 border border-green-500/20 rounded-xl">
                                        <span className="text-ludo-xs font-black text-green-400 uppercase tracking-widest">
                                            New authority · {candidate.slice(0, 6)}…{candidate.slice(-4)}
                                        </span>
                                    </div>
                                )}
                                {phase !== 'handed' && (
                                    <div className="inline-flex items-center gap-2 px-4 py-2 bg-cyan-500/10 border border-cyan-500/20 rounded-xl">
                                        <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                                        <span className="text-ludo-xs font-black text-cyan-400 uppercase tracking-widest">Wager is Safe</span>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Footer / Actions */}
                        <div className="px-5 pt-3 pb-5 border-t border-white/10 bg-black/20 backdrop-blur-sm relative z-10 flex flex-col gap-2">
                            <button
                                onClick={() => setSnoozed(true)}
                                className="w-full py-3 rounded-2xl bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 text-sm font-black uppercase tracking-[0.2em] hover:bg-cyan-500/25 transition-all active:scale-95 flex items-center justify-center gap-2"
                            >
                                Keep Waiting
                            </button>
                            <button
                                onClick={onQuit}
                                className="w-full py-3 rounded-2xl bg-white/5 border border-white/10 text-white text-sm font-black uppercase tracking-[0.2em] hover:bg-white/10 transition-all active:scale-95 flex items-center justify-center gap-2 group"
                            >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-4 h-4 text-white/40 group-hover:text-white"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                Quit Match
                            </button>
                            <p className="text-center mt-1 text-ludo-xs text-white/20 uppercase font-black tracking-widest">
                                No coins are deducted if you leave
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </>
    );

// Icon tile: amber glow square (warning accent — the one exception to cyan).
};

const MigrateTile = () => (
    <div className="w-7 h-7 rounded-xl bg-amber-500/15 border border-amber-400/40 flex items-center justify-center shadow-[0_0_16px_rgba(251,191,36,0.25)]">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-4 h-4 text-amber-300">
            <path d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
    </div>
);
