"use client";

import React from 'react';
import ErrorCard, { type ErrorCardAction } from './ErrorCard';
import { friendlyErrorFromMessage } from '@/lib/errorCopy';
import { captureException } from '@/lib/telemetry';

// ─── PanelErrorBoundary ──────────────────────────────────────────────────────
// Scoped firewall for overlay panels (TeamUp, …): a throwing panel shows an
// inline card with the REAL error message + retry/dismiss instead of
// unmounting the app. Diagnosis over silence.
//
// The card is the shared ErrorCard (image-1 design), centred in the panel's
// column. Buttons per case: RETRY (re-render the panel) plus DISMISS when the
// caller passed onClose (abandon the panel, keep the rest of the app).
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
        console.error(`[ludo-panel-error:${this.props.name}]`, error.message, info.componentStack);
        captureException(error, { where: `panel:${this.props.name}` });
        this.setState({ stack: info.componentStack || null });
    }

    private retry = () => this.setState({ error: null, stack: null });

    render() {
        const { error } = this.state;
        if (!error) return this.props.children;
        const friendly = friendlyErrorFromMessage(error.message);
        const actions: ErrorCardAction[] = [
            { label: friendly.cta || 'Retry', onClick: this.retry },
        ];
        if (this.props.onClose) {
            actions.push({ label: 'Dismiss', onClick: this.props.onClose, kind: 'ghost' });
        }
        return (
            <div className="fixed inset-0 z-[130] flex justify-center pointer-events-none">
                <div className="w-full max-w-[500px] h-full flex items-center justify-center px-2">
                    <ErrorCard
                        kicker={`${this.props.name} · ${friendly.title}`}
                        copy={friendly.copy}
                        raw={error.message || 'Unknown error'}
                        stack={this.state.stack}
                        actions={actions}
                    />
                </div>
            </div>
        );
    }
}
