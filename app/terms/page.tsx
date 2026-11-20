import React from 'react';
import { ArenaDocShell } from '@/app/components/ArenaDocShell';
import { TermsContent } from '@/app/components/ArenaDocContent';

export const metadata = {
    title: 'Terms of Service · Ludo 3077',
    description: 'Plain-language Terms of Service for the Ludo 3077 onchain arena.',
};

export default function TermsPage() {
    return (
        <ArenaDocShell
            activePage="terms"
            kicker="// ARENA RULES & TERMS"
            title="Terms of Service"
            subtitle="Clear rules for playing in Ludo 3077, using CHIPS tables, and keeping matches fair for everyone."
            metaBadge="Updated Nov 2026"
        >
            <TermsContent />
        </ArenaDocShell>
    );
}
