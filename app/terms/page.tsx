import React from 'react';
import { ArenaDocShell } from '@/app/components/ArenaDocShell';
import { HudSectionLabel } from '@/app/components/HudPrimitives';

export const metadata = {
    title: 'Terms of Service · Ludo 3077',
    description: 'Plain-language Terms of Service for the Ludo 3077 onchain arena.',
};

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

export default function TermsPage() {
    return (
        <ArenaDocShell
            activePage="terms"
            kicker="// ARENA RULES & TERMS"
            title="Terms of Service"
            subtitle="Clear rules for playing in Ludo 3077, using CHIPS tables, and keeping matches fair for everyone."
            metaBadge="Updated Nov 2026"
        >
            <HudSectionLabel>Agreement Overview</HudSectionLabel>

            <div className="flex flex-col gap-3.5">
                {TERMS_SECTIONS.map((section) => (
                    <section
                        key={section.num}
                        className="rounded-2xl border border-line-soft bg-surface-recessed p-4 sm:p-5 flex flex-col gap-2"
                    >
                        <div className="flex items-center gap-2.5">
                            <span className="px-2 py-0.5 rounded-md bg-accent-soft text-accent text-ludo-xs font-mono font-bold">
                                {section.num}
                            </span>
                            <h2 className="text-sm sm:text-base font-extrabold uppercase tracking-wide text-ink-strong">
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
        </ArenaDocShell>
    );
}
