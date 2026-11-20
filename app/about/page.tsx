import React from 'react';
import Link from 'next/link';
import { ArenaDocShell } from '@/app/components/ArenaDocShell';
import { Ludo3077Emblem } from '@/app/components/Ludo3077Logo';
import { AboutMediaShowcase } from '@/app/components/AboutMediaShowcase';
import { HudSectionLabel } from '@/app/components/HudPrimitives';
import {
    ChipsHexIcon,
    ClassicGridIcon,
    OverdriveBoltIcon,
    SquadLinkIcon,
    VaultShieldIcon,
} from '@/app/components/icons';

export const metadata = {
    title: 'About · Ludo 3077',
    description:
        'Learn how Ludo 3077 works in plain English. Classic Ludo, fair dice, Power Tiles, and easy Base rewards.',
};

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

export default function AboutPage() {
    return (
        <ArenaDocShell
            activePage="about"
            kicker="// ABOUT LUDO 3077"
            title="Classic Ludo, built for a new arena"
            subtitle="Ludo 3077 is a fast board game you can play right in your browser. Roll the dice, race your four pieces home, and outsmart your rivals."
            metaBadge="Novice Guide"
            maxWidth="wide"
        >
            {/* Brand Emblem Hero Band */}
            <section className="rounded-2xl border border-line-soft bg-surface-recessed p-5 sm:p-7 flex flex-col sm:flex-row items-center gap-6">
                <div className="shrink-0 flex flex-col items-center gap-2">
                    <Ludo3077Emblem size="lg" showReticle />
                    <span className="text-ludo-xs font-mono font-bold uppercase tracking-[0.2em] text-ink-faint">
                        Official Emblem
                    </span>
                </div>

                <div className="flex-1 flex flex-col gap-3 text-center sm:text-left">
                    <span className="inline-flex self-center sm:self-start items-center gap-2 px-3 py-1 rounded-full bg-accent-soft border border-line-soft text-ludo-xs font-mono font-bold uppercase tracking-[0.18em] text-accent">
                        <span className="w-1.5 h-1.5 rounded-full bg-accent" />
                        Easy to learn · Free to start
                    </span>
                    <h2 className="text-xl sm:text-2xl font-extrabold text-ink-strong tracking-tight">
                        A familiar board game with a clean, futuristic feel.
                    </h2>
                    <p className="text-ludo-md font-medium leading-relaxed text-ink-muted">
                        If you have ever played Ludo, you already know how to play Ludo 3077. We kept the classic rules simple and added smooth animations, live chat, fair dice, and optional power-ups.
                    </p>
                    <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2.5 pt-1">
                        <Link
                            href="/"
                            className="inline-flex items-center justify-center px-4 py-2 rounded-[12px] bg-accent text-accent-ink text-ludo-sm font-extrabold uppercase tracking-[0.14em] hover:brightness-95 transition-all"
                        >
                            Play Free Now
                        </Link>
                        <Link
                            href="/terms"
                            className="inline-flex items-center justify-center px-4 py-2 rounded-[12px] bg-surface-panel border border-line-soft text-ink-strong text-ludo-sm font-bold uppercase tracking-[0.12em] hover:bg-surface-hover transition-colors"
                        >
                            Read Table Rules
                        </Link>
                    </div>
                </div>
            </section>

            {/* Video Preview + Simple 4-Step Guide */}
            <section className="flex flex-col gap-4">
                <HudSectionLabel>See the Arena in Action</HudSectionLabel>

                <div className="grid grid-cols-1 md:grid-cols-[270px_1fr] gap-6 items-start">
                    {/* Official 9:16 Boot / Launch Video */}
                    <div className="flex flex-col items-center">
                        <AboutMediaShowcase />
                    </div>

                    {/* Plain-Language How It Works */}
                    <div className="flex flex-col gap-3">
                        <p className="text-ludo-md font-medium leading-relaxed text-ink-muted">
                            Watch the short preview video to see how the arena boots up. Every match follows four simple steps:
                        </p>

                        <div className="flex flex-col gap-2.5">
                            {HOW_IT_WORKS.map((item) => {
                                const Icon = item.icon;
                                return (
                                    <div
                                        key={item.step}
                                        className="rounded-2xl border border-line-soft bg-surface-recessed p-4 flex items-start gap-3.5"
                                    >
                                        <div className="w-9 h-9 rounded-xl bg-accent-soft text-accent border border-line-soft flex items-center justify-center shrink-0">
                                            <Icon className="w-4 h-4" active />
                                        </div>
                                        <div className="flex flex-col gap-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className="text-ludo-xs font-mono font-bold text-accent">
                                                    {item.step}
                                                </span>
                                                <h3 className="text-sm font-extrabold text-ink-strong">
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
                </div>
            </section>

            {/* Play Your Way: Free vs Ranked */}
            <section className="flex flex-col gap-4">
                <HudSectionLabel>Two Ways to Play</HudSectionLabel>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div className="rounded-2xl border border-line-soft bg-surface-recessed p-4 flex flex-col gap-2">
                        <div className="flex items-center gap-2 text-ink-strong">
                            <span className="w-7 h-7 rounded-lg bg-accent-soft text-accent flex items-center justify-center">
                                <ClassicGridIcon className="w-4 h-4" active />
                            </span>
                            <h3 className="text-sm font-extrabold uppercase tracking-wide">
                                Free &amp; Practice Mode
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
                            <h3 className="text-sm font-extrabold uppercase tracking-wide">
                                Ranked CHIPS Tables
                            </h3>
                        </div>
                        <p className="text-ludo-md font-medium leading-relaxed text-ink-muted">
                            Join online tables using CHIPS game tokens. Everyone&apos;s entry goes into one clear match pool, and the winner claims it after the match ends.
                        </p>
                    </div>
                </div>
            </section>

            {/* Novice Questions */}
            <section className="flex flex-col gap-4">
                <HudSectionLabel>Common Questions</HudSectionLabel>

                <div className="rounded-2xl border border-line-soft bg-surface-recessed divide-y divide-line-soft overflow-hidden">
                    {NOVICE_FAQ.map((entry) => (
                        <div key={entry.q} className="p-4 flex flex-col gap-1">
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
        </ArenaDocShell>
    );
}
