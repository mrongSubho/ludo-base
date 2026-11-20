'use client';

import React, { useEffect, useState } from 'react';
import { GamePanelShell } from './GamePanelShell';
import {
    AboutContent,
    ArenaDocTab,
    ArenaDocTabs,
    PrivacyContent,
    TermsContent,
} from './ArenaDocContent';
import { BrandMark3077Icon } from './icons';

const TAB_META: Record<ArenaDocTab, { kicker: string; title: string; subtitle: string }> = {
    about: {
        kicker: '// ARENA BRIEFING',
        title: 'About Ludo 3077',
        subtitle: 'Plain-English guide, brand emblem & launch video',
    },
    terms: {
        kicker: '// ARENA RULES & TERMS',
        title: 'Terms of Service',
        subtitle: 'Fair play, CHIPS tables & account rules',
    },
    privacy: {
        kicker: '// DATA & PRIVACY',
        title: 'Privacy Policy',
        subtitle: 'Your keys, encrypted DMs & device storage',
    },
};

/**
 * In-app GamePanelShell drawer for About, Terms of Service, and Privacy Policy.
 * Used inside `app/page.tsx` (Entrance card, Wallet modal, or Lobby).
 */
export function ArenaInfoPanel({
    isOpen,
    initialTab = 'about',
    overlay = false,
    onClose,
}: {
    isOpen: boolean;
    initialTab?: ArenaDocTab;
    overlay?: boolean;
    onClose: () => void;
}) {
    const [tab, setTab] = useState<ArenaDocTab>(initialTab);

    useEffect(() => {
        if (isOpen) setTab(initialTab);
    }, [isOpen, initialTab]);

    if (!isOpen) return null;

    const meta = TAB_META[tab];

    return (
        <GamePanelShell
            scopeClass="ludo-settings-scope"
            kicker={meta.kicker}
            title={(
                <span className="inline-flex items-center gap-2">
                    <span className="w-8 h-8 rounded-[10px] bg-accent-soft text-accent border border-line-soft flex items-center justify-center shrink-0">
                        <BrandMark3077Icon className="w-5 h-5" active />
                    </span>
                    <span>{meta.title}</span>
                </span>
            )}
            subtitle={(
                <span className="text-ludo-xs font-bold uppercase tracking-wide text-ink-muted">
                    {meta.subtitle}
                </span>
            )}
            maxWidthPx={560}
            overlay={overlay}
            hideOrbs
            onClose={onClose}
        >
            <ArenaDocTabs activeTab={tab} onSelectTab={setTab} />

            {tab === 'about' && <AboutContent layout="panel" onSelectTab={setTab} onClose={onClose} />}
            {tab === 'terms' && <TermsContent />}
            {tab === 'privacy' && <PrivacyContent />}
        </GamePanelShell>
    );
}

export default ArenaInfoPanel;
