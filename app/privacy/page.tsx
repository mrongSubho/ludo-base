import React from 'react';
import { ArenaDocShell } from '@/app/components/ArenaDocShell';
import { HudSectionLabel } from '@/app/components/HudPrimitives';

export const metadata = {
    title: 'Privacy Policy · Ludo 3077',
    description: 'Plain-language Privacy Policy for the Ludo 3077 onchain arena.',
};

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

export default function PrivacyPage() {
    return (
        <ArenaDocShell
            activePage="privacy"
            kicker="// DATA & PRIVACY"
            title="Privacy Policy"
            subtitle="What data Ludo 3077 uses, what stays on your device, and how we protect your keys and messages."
            metaBadge="Updated Nov 2026"
        >
            <HudSectionLabel>Privacy Commitments</HudSectionLabel>

            <div className="flex flex-col gap-3.5">
                {PRIVACY_SECTIONS.map((section) => (
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
