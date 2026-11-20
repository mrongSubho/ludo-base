import React from 'react';
import { ArenaDocShell } from '@/app/components/ArenaDocShell';
import { PrivacyContent } from '@/app/components/ArenaDocContent';

export const metadata = {
    title: 'Privacy Policy · Ludo 3077',
    description: 'Plain-language Privacy Policy for the Ludo 3077 onchain arena.',
};

export default function PrivacyPage() {
    return (
        <ArenaDocShell
            activePage="privacy"
            kicker="// DATA & PRIVACY"
            title="Privacy Policy"
            subtitle="What data Ludo 3077 uses, what stays on your device, and how we protect your keys and messages."
            metaBadge="Updated Nov 2026"
        >
            <PrivacyContent />
        </ArenaDocShell>
    );
}
