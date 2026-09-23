"use client";

import React, { useEffect, useState } from 'react';
import type { NoticeLevel, OpsNotice } from '@/lib/notices';
import { filterActiveNotices, parseNoticeBundle, defaultSeedNotices } from '@/lib/notices';

const LEVEL_CLASS: Record<NoticeLevel, string> = {
    info: 'border-cyan-400/30 bg-cyan-400/10 text-cyan-200',
    warn: 'border-amber-400/35 bg-amber-400/10 text-amber-200',
    critical: 'border-red-400/40 bg-red-500/15 text-red-200',
};

/**
 * G4 — live-ops notice strip. Signed server-driven copy; dismissable per session.
 */
export function NoticeStrip({ className = '' }: { className?: string }) {
    const [notices, setNotices] = useState<OpsNotice[]>([]);
    const [dismissed, setDismissed] = useState<Set<string>>(new Set());
    const [ready, setReady] = useState(false);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const res = await fetch('/api/notices', { cache: 'no-store' });
                const raw = await res.json();
                const bundle = parseNoticeBundle(raw);
                const list = bundle ? filterActiveNotices(bundle.notices) : defaultSeedNotices();
                if (!cancelled) {
                    setNotices(list);
                    setReady(true);
                }
            } catch {
                if (!cancelled) {
                    setNotices(filterActiveNotices(defaultSeedNotices()));
                    setReady(true);
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    const visible = notices.filter((n) => !dismissed.has(n.id));
    if (!ready || visible.length === 0) return null;

    return (
        <div className={`flex flex-col gap-1 ${className}`} role="region" aria-label="Live ops notices">
            {visible.map((n) => (
                <div
                    key={n.id}
                    className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-[11px] leading-snug ${LEVEL_CLASS[n.level]}`}
                    data-notice={n.id}
                >
                    <div className="flex-1 min-w-0">
                        <div className="font-black uppercase tracking-[0.12em] text-[10px]">{n.title}</div>
                        <div className="opacity-90 mt-0.5">{n.body}</div>
                        {n.href && (
                            <a
                                href={n.href}
                                className="underline opacity-80 hover:opacity-100 mt-1 inline-block"
                            >
                                Details
                            </a>
                        )}
                    </div>
                    <button
                        type="button"
                        aria-label={`Dismiss ${n.title}`}
                        className="shrink-0 opacity-70 hover:opacity-100 px-1"
                        onClick={() => setDismissed((s) => new Set(s).add(n.id))}
                    >
                        ×
                    </button>
                </div>
            ))}
        </div>
    );
}

export default NoticeStrip;
