'use client';

import React from 'react';
import Link from 'next/link';
import { Ludo3077Emblem } from './Ludo3077Logo';
import { AboutMediaShowcase } from './AboutMediaShowcase';
import { HudSectionLabel } from './HudPrimitives';
import {
    ChipsHexIcon,
    ClassicGridIcon,
    OverdriveBoltIcon,
    SquadLinkIcon,
    VaultShieldIcon,
} from './icons';

export type ArenaDocTab = 'about' | 'terms' | 'privacy';

const DOC_TABS: ReadonlyArray<{ id: ArenaDocTab; label: string }> = [
    { id: 'about', label: 'About' },
    { id: 'terms', label: 'Terms' },
    { id: 'privacy', label: 'Privacy' },
];

function DocTabIcon({ id }: { id: ArenaDocTab }) {
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

/** In-panel switcher between About, Terms of Service, and Privacy Policy. */
export function ArenaDocTabs({
    activeTab,
    onSelectTab,
}: {
    activeTab: ArenaDocTab;
    onSelectTab: (tab: ArenaDocTab) => void;
}) {
    return (
        <div
            role="tablist"
            aria-label="Arena documentation sections"
            className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-surface-recessed border border-line-soft"
        >
            {DOC_TABS.map((tab) => {
                const isActive = tab.id === activeTab;
                return (
                    <button
                        key={tab.id}
                        type="button"
                        role="tab"
                        aria-selected={isActive}
                        onClick={() => onSelectTab(tab.id)}
                        className={`inline-flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-[10px] text-ludo-sm font-bold uppercase tracking-[0.1em] transition-colors cursor-pointer ${
                            isActive
                                ? 'bg-accent-soft text-accent border border-line-strong'
                                : 'text-ink-muted hover:text-ink-strong hover:bg-surface-hover border border-transparent'
                        }`}
                    >
                        <DocTabIcon id={tab.id} />
                        <span>{tab.label}</span>
                    </button>
                );
            })}
        </div>
    );
}

const HOW_IT_WORKS = [
    {
        step: '01',
        title: 'Pick your table',
        text: 'Play free matches against smart bots, team up 2v2 with a friend, or join live players online.',
        icon: ClassicGridIcon,
    },
    {
        step: '02',
        title: 'Roll fair dice',
        text: 'Every dice roll is generated on our game server. Neither players nor hosts can change the outcome.',
        icon: VaultShieldIcon,
    },
    {
        step: '03',
        title: 'Use Power Tiles',
        text: 'Five hidden tiles sit on the track. Land on one to pick up a shield, speed boost, blast, or teleport.',
        icon: OverdriveBoltIcon,
    },
    {
        step: '04',
        title: 'Bring all four home',
        text: 'Race your four pieces around the board and into the center. The first player or team to finish wins.',
        icon: SquadLinkIcon,
    },
] as const;

const NOVICE_FAQ = [
    {
        q: 'Do I need a crypto wallet to play?',
        a: 'No. You can start right away as a Guest and play free matches against computer bots. No account or wallet is needed.',
    },
    {
        q: 'Why would I sign in or connect a wallet?',
        a: 'Signing in saves your username, rank, friends list, and match history. You can create a quick passkey account in the app or connect a wallet you already use.',
    },
    {
        q: 'What are CHIPS and Base?',
        a: 'CHIPS are the game tokens used at ranked prize tables. Base is the fast network that records match pools and rewards so anyone can verify them.',
    },
    {
        q: 'Are private messages safe?',
        a: 'Yes. Direct messages between friends are locked on your device before they are sent, so only you and your friend can read them.',
    },
] as const;

export function AboutContent({
    layout = 'panel',
    onSelectTab,
    onClose,
}: {
    layout?: 'panel' | 'wide';
    onSelectTab?: (tab: ArenaDocTab) => void;
    onClose?: () => void;
}) {
    const isWide = layout === 'wide';

    return (
        <div className="flex flex-col gap-5">
            {/* Brand Emblem Hero Band */}
            <section className="rounded-2xl border border-line-soft bg-surface-recessed p-4 sm:p-6 flex flex-col sm:flex-row items-center gap-5">
                <div className="shrink-0 flex flex-col items-center gap-1.5">
                    <Ludo3077Emblem size="lg" showReticle />
                    <span className="text-ludo-xs font-mono font-bold uppercase tracking-[0.2em] text-ink-faint">
                        Official Emblem
                    </span>
                </div>

                <div className="flex-1 flex flex-col gap-2.5 text-center sm:text-left">
                    <span className="inline-flex self-center sm:self-start items-center gap-2 px-3 py-1 rounded-full bg-accent-soft border border-line-soft text-ludo-xs font-mono font-bold uppercase tracking-[0.18em] text-accent">
                        <span className="w-1.5 h-1.5 rounded-full bg-accent" />
                        Easy to learn · Free to start
                    </span>
                    <h2 className="text-lg sm:text-xl font-extrabold text-ink-strong tracking-tight">
                        Classic Ludo, rebuilt for a futuristic arena.
                    </h2>
                    <p className="text-ludo-md font-medium leading-relaxed text-ink-muted">
                        If you have ever played Ludo, you already know how to play Ludo 3077. Roll the dice, race your four pieces home, and knock rivals back to the start.
                    </p>
                    <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 pt-1">
                        {onClose ? (
                            <button
                                type="button"
                                onClick={onClose}
                                className="inline-flex items-center justify-center px-4 py-2 rounded-[12px] bg-accent text-accent-ink text-ludo-sm font-extrabold uppercase tracking-[0.14em] hover:brightness-95 transition-all cursor-pointer"
                            >
                                Back to Arena
                            </button>
                        ) : (
                            <Link
                                href="/"
                                className="inline-flex items-center justify-center px-4 py-2 rounded-[12px] bg-accent text-accent-ink text-ludo-sm font-extrabold uppercase tracking-[0.14em] hover:brightness-95 transition-all"
                            >
                                Play Free Now
                            </Link>
                        )}
                        {onSelectTab ? (
                            <button
                                type="button"
                                onClick={() => onSelectTab('terms')}
                                className="inline-flex items-center justify-center px-4 py-2 rounded-[12px] bg-surface-panel border border-line-soft text-ink-strong text-ludo-sm font-bold uppercase tracking-[0.12em] hover:bg-surface-hover transition-colors cursor-pointer"
                            >
                                Read Table Rules
                            </button>
                        ) : (
                            <Link
                                href="/terms"
                                className="inline-flex items-center justify-center px-4 py-2 rounded-[12px] bg-surface-panel border border-line-soft text-ink-strong text-ludo-sm font-bold uppercase tracking-[0.12em] hover:bg-surface-hover transition-colors"
                            >
                                Read Table Rules
                            </Link>
                        )}
                    </div>
                </div>
            </section>

            {/* Video Preview + Simple 4-Step Guide */}
            <section className="flex flex-col gap-3.5">
                <HudSectionLabel>See the Arena in Action</HudSectionLabel>

                <div
                    className={
                        isWide
                            ? 'grid grid-cols-1 md:grid-cols-[270px_1fr] gap-6 items-start'
                            : 'flex flex-col gap-4'
                    }
                >
                    <div className="flex flex-col items-center">
                        <AboutMediaShowcase />
                    </div>

                    <div className="flex flex-col gap-2.5">
                        <p className="text-ludo-md font-medium leading-relaxed text-ink-muted">
                            Watch the short preview video to see how the arena boots up. Every match follows four simple steps:
                        </p>

                        {HOW_IT_WORKS.map((item) => {
                            const Icon = item.icon;
                            return (
                                <div
                                    key={item.step}
                                    className="rounded-2xl border border-line-soft bg-surface-recessed p-3.5 flex items-start gap-3"
                                >
                                    <div className="w-8 h-8 rounded-xl bg-accent-soft text-accent border border-line-soft flex items-center justify-center shrink-0">
                                        <Icon className="w-4 h-4" active />
                                    </div>
                                    <div className="flex flex-col gap-0.5 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className="text-ludo-xs font-mono font-bold text-accent">
                                                {item.step}
                                            </span>
                                            <h3 className="text-ludo-lg font-extrabold text-ink-strong">
                                                {item.title}
                                            </h3>
                                        </div>
                                        <p className="text-ludo-md font-medium leading-relaxed text-ink-muted">
                                            {item.text}
                                        </p>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </section>

            {/* Play Your Way: Free vs Ranked */}
            <section className="flex flex-col gap-3.5">
                <HudSectionLabel>Two Ways to Play</HudSectionLabel>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="rounded-2xl border border-line-soft bg-surface-recessed p-4 flex flex-col gap-2">
                        <div className="flex items-center gap-2 text-ink-strong">
                            <span className="w-7 h-7 rounded-lg bg-accent-soft text-accent flex items-center justify-center">
                                <ClassicGridIcon className="w-4 h-4" active />
                            </span>
                            <h3 className="text-ludo-lg font-extrabold uppercase tracking-wide">
                                Free &amp; Practice
                            </h3>
                        </div>
                        <p className="text-ludo-md font-medium leading-relaxed text-ink-muted">
                            Play anytime with no entry fee. Practice against computer bots or invite friends to a casual room. Nothing is at stake.
                        </p>
                    </div>

                    <div className="rounded-2xl border border-line-soft bg-surface-recessed p-4 flex flex-col gap-2">
                        <div className="flex items-center gap-2 text-ink-strong">
                            <span className="w-7 h-7 rounded-lg bg-accent-soft text-accent flex items-center justify-center">
                                <ChipsHexIcon className="w-4 h-4" active />
                            </span>
                            <h3 className="text-ludo-lg font-extrabold uppercase tracking-wide">
                                Ranked CHIPS
                            </h3>
                        </div>
                        <p className="text-ludo-md font-medium leading-relaxed text-ink-muted">
                            Join online tables using CHIPS game tokens. Everyone&apos;s entry goes into one clear match pool, and the winner claims it after the match ends.
                        </p>
                    </div>
                </div>
            </section>

            {/* Novice Questions */}
            <section className="flex flex-col gap-3.5">
                <HudSectionLabel>Common Questions</HudSectionLabel>

                <div className="rounded-2xl border border-line-soft bg-surface-recessed divide-y divide-line-soft overflow-hidden">
                    {NOVICE_FAQ.map((entry) => (
                        <div key={entry.q} className="p-3.5 flex flex-col gap-1">
                            <h3 className="text-ludo-lg font-extrabold text-ink-strong">
                                {entry.q}
                            </h3>
                            <p className="text-ludo-md font-medium leading-relaxed text-ink-muted">
                                {entry.a}
                            </p>
                        </div>
                    ))}
                </div>
            </section>
        </div>
    );
}

const TERMS_SECTIONS = [
    {
        num: '01',
        title: 'The game and CHIPS',
        paragraphs: [
            'Ludo 3077 is a board game of skill and chance. Dice rolls and game moves are verified by our match server so every table stays fair.',
            'Free, guest, and offline AI matches cost nothing and pay no prizes. Paid online tables use CHIPS — an in-game utility token on Base — locked into a visible match pool and claimed after the game settles.',
            'CHIPS are for gameplay only. They are not money, not an investment, and carry no promise of profit. Once an onchain match result is recorded on Base, it is final.',
        ],
    },
    {
        num: '02',
        title: 'Who can play',
        paragraphs: [
            'Anyone can play free practice matches, including guest games against bots.',
            'You must be at least 18 years old (or the legal age of majority where you live) to enter tables with CHIPS entry fees or prize pools, and you are responsible for following your local laws.',
        ],
    },
    {
        num: '03',
        title: 'Your account and wallet',
        paragraphs: [
            'Your connected wallet or in-game passkey account is your player identity. Keep your wallet, device, and recovery methods safe — anyone who controls your keys controls your profile, CHIPS, and collectibles.',
            'Guest accounts live locally in your browser until you connect a wallet or passkey.',
        ],
    },
    {
        num: '04',
        title: 'Fair play rules',
        paragraphs: [
            'Do not use bots, automated scripts, match-fixing, multiple accounts to farm rewards, or any exploit against dice, matchmaking, or payouts.',
            'If a player goes idle, the arena may auto-play their turn so the table keeps moving. Accounts that cheat may lose rewards and be suspended. Stakes from voided matches may be refunded at our discretion.',
        ],
    },
    {
        num: '05',
        title: 'Virtual items and balances',
        paragraphs: [
            'Ranks, avatars, badges, and collectible items have no guaranteed cash value unless an explicit feature states otherwise.',
            'We may adjust off-chain balances or leaderboards to fix software bugs, duplicate claims, or abuse.',
        ],
    },
    {
        num: '06',
        title: 'Service availability',
        paragraphs: [
            'Ludo 3077 is provided as-is. Live matches, streams, and claims rely on internet connections and third-party blockchain networks like Base, which can pause or slow down.',
            'We do our best to keep tables smooth and issue good-faith fixes when possible, but we are not liable for network outages or third-party wallet losses.',
        ],
    },
] as const;

export function TermsContent() {
    return (
        <div className="flex flex-col gap-3.5">
            <HudSectionLabel right={<span className="text-ludo-xs font-mono text-ink-faint">Updated Nov 2026</span>}>
                Agreement Overview
            </HudSectionLabel>

            {TERMS_SECTIONS.map((section) => (
                <section
                    key={section.num}
                    className="rounded-2xl border border-line-soft bg-surface-recessed p-4 flex flex-col gap-2"
                >
                    <div className="flex items-center gap-2.5">
                        <span className="px-2 py-0.5 rounded-md bg-accent-soft text-accent text-ludo-xs font-mono font-bold">
                            {section.num}
                        </span>
                        <h2 className="text-ludo-lg font-extrabold uppercase tracking-wide text-ink-strong">
                            {section.title}
                        </h2>
                    </div>
                    <div className="flex flex-col gap-2 text-ludo-md font-medium leading-relaxed text-ink-muted">
                        {section.paragraphs.map((text) => (
                            <p key={text}>{text}</p>
                        ))}
                    </div>
                </section>
            ))}
        </div>
    );
}

const PRIVACY_SECTIONS = [
    {
        num: '01',
        title: 'What we store',
        paragraphs: [
            'When you connect a wallet or passkey account, we store your public wallet address, chosen username, avatar, match history, rank, CHIPS records, and game preferences.',
            'When you play as a Guest, your progress stays on your own device in browser storage. No server account is created until you sign in.',
        ],
    },
    {
        num: '02',
        title: 'What we never touch',
        paragraphs: [
            'We never see, ask for, or store your private keys or secret recovery phrases.',
            'Every wallet sign-in, token approval, or transaction happens in your wallet or passkey prompt, and nothing moves without your confirmation.',
        ],
    },
    {
        num: '03',
        title: 'Messages and public info',
        paragraphs: [
            'Direct messages between players are encrypted on your device before they leave your browser, so only you and the recipient can read them.',
            'Your username, avatar, rank, live tables, and settled Base transactions are visible to other players and spectators. Please do not put personal details like your real name or phone number in your display name.',
        ],
    },
    {
        num: '04',
        title: 'Cookies and local storage',
        paragraphs: [
            'We use minimal cookies and local browser storage to remember your theme, sound effects, token style, and active login session.',
            'We do not run third-party advertising trackers inside the game client.',
        ],
    },
    {
        num: '05',
        title: 'Your choices and controls',
        paragraphs: [
            'You can disconnect your wallet at any time, or change who can view your profile and send friend requests inside your Profile settings.',
            'To remove your off-chain profile or feedback records, reach out via the Feedback panel in Settings. Public transactions already written to Base cannot be deleted by anyone.',
        ],
    },
] as const;

export function PrivacyContent() {
    return (
        <div className="flex flex-col gap-3.5">
            <HudSectionLabel right={<span className="text-ludo-xs font-mono text-ink-faint">Updated Nov 2026</span>}>
                Privacy Commitments
            </HudSectionLabel>

            {PRIVACY_SECTIONS.map((section) => (
                <section
                    key={section.num}
                    className="rounded-2xl border border-line-soft bg-surface-recessed p-4 flex flex-col gap-2"
                >
                    <div className="flex items-center gap-2.5">
                        <span className="px-2 py-0.5 rounded-md bg-accent-soft text-accent text-ludo-xs font-mono font-bold">
                            {section.num}
                        </span>
                        <h2 className="text-ludo-lg font-extrabold uppercase tracking-wide text-ink-strong">
                            {section.title}
                        </h2>
                    </div>
                    <div className="flex flex-col gap-2 text-ludo-md font-medium leading-relaxed text-ink-muted">
                        {section.paragraphs.map((text) => (
                            <p key={text}>{text}</p>
                        ))}
                    </div>
                </section>
            ))}
        </div>
    );
}
