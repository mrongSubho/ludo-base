"use client";

import React from 'react';

// ─── PanelErrorBoundary ──────────────────────────────────────────────────────
// Scoped firewall for overlay panels (TeamUp, …): a throwing panel shows an
// inline card with the REAL error message + retry/dismiss instead of
// unmounting the app. Diagnosis over silence.
interface Props {
    name: string;
    onClose?: () => void;
    children: React.ReactNode;
}

interface State {
    error: Error | null;
    stack: string | null;
}

export class PanelErrorBoundary extends React.Component<Props, State> {
    state: State = { error: null, stack: null };

    static getDerivedStateFromError(error: Error): State {
        return { error, stack: null };
    }

    componentDidCatch(error: Error, info: React.ErrorInfo) {
        // eslint-disable-next-line no-console
        console.error(`[ludo-panel-error:${this.props.name}]`, error.message, info.componentStack);
        this.setState({ stack: info.componentStack || null });
    }

    private retry = () => this.setState({ error: null, stack: null });

    render() {
        const { error } = this.state;
        if (!error) return this.props.children;
        return (
            <div className="fixed inset-0 z-[130] flex justify-center pointer-events-none">
                <div className="w-full max-w-[500px] relative h-full">
                    <div className="pointer-events-auto absolute top-[64px] left-[8px] right-[8px] border border-red-500/30 rounded-[28px] p-5 flex flex-col items-center gap-2.5 text-center shadow-2xl"
                        style={{ background: 'rgba(20,8,10,0.96)', backdropFilter: 'blur(32px)' }}
                    >
                        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-red-400">
                            {this.props.name} crashed
                        </p>
                        <p className="text-[11px] font-mono text-white/50 break-words max-w-full">
                            {error.message || 'Unknown error'}
                        </p>
                        {this.state.stack && (
                            <pre className="w-full max-h-28 overflow-auto text-left text-[9px] font-mono text-white/35 bg-black/40 rounded-xl p-2 whitespace-pre-wrap break-words">
                                {this.state.stack}
                            </pre>
                        )}
                        <div className="flex gap-2 w-full mt-1">
                            <button
                                onClick={this.retry}
                                className="flex-1 py-3 rounded-2xl bg-white text-black text-xs font-black uppercase tracking-[0.18em] hover:bg-white/90 active:scale-95 transition-all"
                            >
                                Retry
                            </button>
                            {this.props.onClose && (
                                <button
                                    onClick={this.props.onClose}
                                    className="flex-1 py-3 rounded-2xl bg-white/10 text-white text-xs font-black uppercase tracking-[0.18em] hover:bg-white/20 active:scale-95 transition-all"
                                >
                                    Dismiss
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}
