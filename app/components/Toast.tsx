"use client";

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

/**
 * The app's own transient message surface — replaces the browser's native
 * alert()/confirm()/prompt() dialogs, which are styled by the browser, block
 * the main thread, and read as a web page rather than the game.
 *
 * One toast host lives at the top of the shell (below the header, above the
 * panel sandwich) and every surface speaks to it through `useToast()`:
 *
 *     const toast = useToast();
 *     toast('Voucher signing failed; retry shortly', 'error');
 *
 * Tones map to the semantic tokens, so the toast is correct in both themes
 * with no patch rules: `--negative` (error) · `--positive` (success) ·
 * `--accent` (info). Auto-dismisses after 4s; the stack is capped so a burst
 * of failures cannot cover the screen.
 *
 * A11y: the host is a polite live region — an error is announced without
 * interrupting whatever the user is doing, and nothing is conveyed by motion
 * alone (the text is the message; the entrance is opacity/transform only, so
 * MotionConfig reducedMotion="user" drops the transform and keeps the fade).
 */

export type ToastTone = 'error' | 'success' | 'info';

interface ToastItem {
    id: number;
    message: string;
    tone: ToastTone;
}

type ShowToast = (message: string, tone?: ToastTone) => void;

const ToastContext = createContext<ShowToast | null>(null);

const TONE_DOT: Record<ToastTone, string> = {
    error: 'bg-negative',
    success: 'bg-positive',
    info: 'bg-accent',
};

const MAX_VISIBLE = 3;
const DISMISS_MS = 4000;

export function ToastProvider({ children }: { children: React.ReactNode }) {
    const [toasts, setToasts] = useState<ToastItem[]>([]);
    const nextId = useRef(1);
    const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

    const dismiss = useCallback((id: number) => {
        setToasts((cur) => cur.filter((t) => t.id !== id));
        const timer = timers.current.get(id);
        if (timer) {
            clearTimeout(timer);
            timers.current.delete(id);
        }
    }, []);

    const show = useCallback<ShowToast>((message, tone = 'info') => {
        const id = nextId.current++;
        setToasts((cur) => [...cur, { id, message, tone }].slice(-MAX_VISIBLE));
        timers.current.set(
            id,
            setTimeout(() => dismiss(id), DISMISS_MS)
        );
    }, [dismiss]);

    // Never leave a timer behind on unmount.
    useEffect(() => () => { timers.current.forEach(clearTimeout); timers.current.clear(); }, []);

    return (
        <ToastContext.Provider value={show}>
            {children}
            <div
                role="status"
                aria-live="polite"
                aria-atomic="false"
                className="pointer-events-none fixed inset-x-0 top-[76px] z-[300] flex flex-col items-center gap-2 px-4"
            >
                <AnimatePresence initial={false}>
                    {toasts.map((t) => (
                        <motion.div
                            key={t.id}
                            layout
                            initial={{ opacity: 0, y: -8 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -8 }}
                            transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
                            onClick={() => dismiss(t.id)}
                            className="pointer-events-auto w-full max-w-[460px] flex items-start gap-2.5 rounded-2xl border border-line-soft bg-surface-panel px-3.5 py-2.5 shadow-2xl backdrop-blur-xl cursor-pointer"
                        >
                            <span className={`mt-[5px] h-2 w-2 flex-none rounded-full ${TONE_DOT[t.tone]}`} />
                            <span className="text-ludo-md font-bold leading-snug text-ink-strong">{t.message}</span>
                        </motion.div>
                    ))}
                </AnimatePresence>
            </div>
        </ToastContext.Provider>
    );
}

/** Transient in-app message. Safe to call from any client component. */
export function useToast(): ShowToast {
    const ctx = useContext(ToastContext);
    if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
    return ctx;
}

export default ToastProvider;
