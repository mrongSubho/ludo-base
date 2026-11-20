import React from 'react';
import Link from 'next/link';
import { Ludo3077Emblem } from './Ludo3077Logo';
import { HudCornerTicks } from './HudPrimitives';
import { APP_VERSION } from '@/lib/version';

export type ArenaDocSection = 'about' | 'terms' | 'privacy';

interface ArenaDocShellProps {
    activePage: ArenaDocSection;
    kicker: string;
    title: string;
    subtitle: string;
    metaBadge?: string;
    maxWidth?: 'narrow' | 'wide';
    children: React.ReactNode;
}

const DOC_TABS: ReadonlyArray<{
    id: ArenaDocSection;
    href: string;
    label: string;
}> = [
    { id: 'about', href: '/about', label: 'About' },
    { id: 'terms', href: '/terms', label: 'Terms' },
    { id: 'privacy', href: '/privacy', label: 'Privacy' },
];

function BackArrowIcon() {
    return (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.1"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-4 h-4"
            aria-hidden="true"
        >
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
        </svg>
    );
}

function TabIcon({ id }: { id: ArenaDocSection }) {
    if (id === 'about') {
        return (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <circle cx="12" cy="8.5" r="0.8" fill="currentColor" stroke="none" />
            </svg>
        );
    }
    if (id === 'terms') {
        return (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5" aria-hidden="true">
                <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7Z" />
                <polyline points="14 2 14 7 19 7" />
                <line x1="9" y1="13" x2="15" y2="13" />
                <line x1="9" y1="17" x2="13" y2="17" />
            </svg>
        );
    }
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5" aria-hidden="true">
            <path d="M12 2.5L19.5 5.5V12C19.5 16.8 16.2 20 12 21.5C7.8 20 4.5 16.8 4.5 12V5.5L12 2.5Z" />
            <polyline points="9.5 12.2 11.3 14 15 10.2" />
        </svg>
    );
}

/**
 * Shared Cyber-Tactical document shell for `/about`, `/terms`, and `/privacy`.
 * Reads semantic theme variables so Retro, Daybreak, and 3077 all render cleanly.
 */
export function ArenaDocShell({
    activePage,
    kicker,
    title,
    subtitle,
    metaBadge,
    maxWidth = 'narrow',
    children,
}: ArenaDocShellProps) {
    const containerMax = maxWidth === 'wide' ? 'max-w-[920px]' : 'max-w-[680px]';

    return (
        <main className="min-h-[100dvh] bg-surface-page text-ink-strong px-4 py-6 sm:px-6 sm:py-10 flex flex-col items-center">
            <div className={`w-full ${containerMax} flex flex-col gap-5`}>
                {/* Top HUD Navigation Bar */}
                <header className="flex flex-wrap items-center justify-between gap-3 px-1">
                    <Link
                        href="/"
                        className="inline-flex items-center gap-2.5 group focus-visible:outline-none"
                    >
                        <Ludo3077Emblem size="xs" showReticle={false} />
                        <span className="flex flex-col leading-none">
                            <span className="text-sm font-extrabold uppercase tracking-[0.12em] text-ink-strong group-hover:text-accent transition-colors">
                                LUDO <span className="text-accent">3077</span>
                            </span>
                            <span className="text-ludo-xs font-mono uppercase tracking-[0.18em] text-ink-faint mt-0.5">
                                Onchain Arena
                            </span>
                        </span>
                    </Link>

                    <nav
                        aria-label="Arena documentation"
                        className="inline-flex items-center gap-1 p-1 rounded-xl bg-surface-panel border border-line-soft"
                    >
                        {DOC_TABS.map((tab) => {
                            const isActive = tab.id === activePage;
                            return (
                                <Link
                                    key={tab.id}
                                    href={tab.href}
                                    aria-current={isActive ? 'page' : undefined}
                                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] text-ludo-sm font-bold uppercase tracking-[0.1em] transition-colors ${
                                        isActive
                                            ? 'bg-accent-soft text-accent border border-line-strong'
                                            : 'text-ink-muted hover:text-ink-strong hover:bg-surface-hover border border-transparent'
                                    }`}
                                >
                                    <TabIcon id={tab.id} />
                                    <span>{tab.label}</span>
                                </Link>
                            );
                        })}
                    </nav>
                </header>

                {/* Main Panel Card */}
                <article
                    className="panel-shell-3077 relative overflow-hidden rounded-[28px] px-5 py-6 sm:px-9 sm:py-8"
                    style={{
                        background: 'var(--panel-bg)',
                        border: '1px solid var(--panel-border)',
                        boxShadow: 'var(--panel-shadow)',
                        backdropFilter: 'blur(28px)',
                        WebkitBackdropFilter: 'blur(28px)',
                    }}
                >
                    <HudCornerTicks />

                    {/* Subtle top accent wash */}
                    <div
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-x-0 top-0 h-28 opacity-70"
                        style={{
                            background:
                                'radial-gradient(ellipse at 50% 0%, color-mix(in srgb, var(--accent) 16%, transparent), transparent 72%)',
                        }}
                    />

                    <div className="relative z-10 flex flex-col gap-6">
                        {/* Page Header */}
                        <div className="flex flex-col gap-2 pb-5 border-b border-line-soft">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="text-ludo-xs font-mono font-bold uppercase tracking-[0.24em] text-accent">
                                    {kicker}
                                </p>
                                {metaBadge && (
                                    <span className="inline-flex items-center px-2.5 py-1 rounded-md bg-surface-recessed border border-line-soft text-ludo-xs font-mono font-bold uppercase tracking-[0.14em] text-ink-muted">
                                        {metaBadge}
                                    </span>
                                )}
                            </div>
                            <h1 className="text-2xl sm:text-3xl font-extrabold uppercase tracking-tight text-ink-strong">
                                {title}
                            </h1>
                            <p className="text-ludo-lg font-medium leading-relaxed text-ink-muted max-w-[58ch]">
                                {subtitle}
                            </p>
                        </div>

                        {/* Page Content */}
                        {children}

                        {/* Bottom Action */}
                        <div className="pt-4 border-t border-line-soft flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                            <Link
                                href="/"
                                className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-[14px] bg-accent text-accent-ink text-ludo-md font-extrabold uppercase tracking-[0.16em] hover:brightness-95 active:scale-[0.99] transition-all"
                            >
                                <BackArrowIcon />
                                <span>Enter the Arena</span>
                            </Link>

                            <div className="flex items-center justify-center gap-4 text-ludo-sm font-bold text-ink-muted">
                                {DOC_TABS.filter((t) => t.id !== activePage).map((tab) => (
                                    <Link
                                        key={tab.id}
                                        href={tab.href}
                                        className="hover:text-accent transition-colors underline underline-offset-4 decoration-line-strong"
                                    >
                                        {tab.label === 'Terms'
                                            ? 'Terms of Service'
                                            : tab.label === 'Privacy'
                                              ? 'Privacy Policy'
                                              : 'About Ludo 3077'}
                                    </Link>
                                ))}
                            </div>
                        </div>
                    </div>
                </article>

                {/* Minimal Footer */}
                <footer className="flex flex-wrap items-center justify-between gap-2 px-2 pb-4 text-ludo-xs font-mono uppercase tracking-[0.16em] text-ink-faint">
                    <span>Ludo 3077 · Built on Base</span>
                    <span>{APP_VERSION}</span>
                </footer>
            </div>
        </main>
    );
}
