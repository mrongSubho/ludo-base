"use client";

import React, { useState } from 'react';
import { useDisconnect } from 'wagmi';
import {
    useDeletePasskey,
    useEnrollPasskey,
    useIsPasskeySupported,
    useListPasskeys,
    useSignOut,
} from '@coinbase/cdp-hooks';
import { usePreferences } from '@/hooks/usePreferences';
import { useSecurityPrefs } from '@/hooks/useSecurityPrefs';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAppSession } from '@/hooks/useAppSession';
import { exitGuest } from '@/lib/guest';
import { APP_VERSION, APP_BUILD_HASH } from '@/lib/version';
import { GamePanelShell } from './GamePanelShell';
import { PanelTabs } from './PanelTabs';
import {
    SlidersIcon,
    Theme3077Icon,
    ThemeDaybreakIcon,
    ThemeRetroIcon,
    TokenChessIcon,
    TokenOrbIcon,
} from './icons';
import { HudSectionLabel } from './HudPrimitives';
import { usePlayerSigner } from '@/hooks/usePlayerSigner';
import { useWalletMode } from '@/hooks/useWalletMode';
import { useBiometricGate } from '@/hooks/useBiometricGate';
import { Switch } from './Switch';
import { ListRow } from './ListRow';
import { Button } from './Button';
import {
    AboutContent,
    ArenaDocTab,
    ArenaDocTabs,
    PrivacyContent,
    TermsContent,
} from './ArenaDocContent';

// ─── Semantic contract (holds for 3077, Retro Night, and Daybreak) ──────────
// 1. All surfaces, borders, and inks derive from CSS semantic tokens inside
//    GamePanelShell (--panel-bg, --surface-*, --line-*, --ink-*, --accent-*).
// 2. No font-family override is set here; headings inherit theme typography.
// 3. `.ludo-settings-scope` spacing overrides live in panels.css.

const SoundIcon = () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
        <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
);

const MusicIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
    </svg>
);

const HapticIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
        <path d="M5 9h4l2 5h4l2-5h4" />
        <path d="M2 12h20" />
    </svg>
);

const HelpIcon = () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
);

const MessageIcon = () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
);

const InfoIcon = () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="16" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
);

const FileTextIcon = () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <polyline points="10 9 9 9 8 9" />
    </svg>
);

const ShieldIcon = () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
);

const LogOutIcon = () => (
    <svg className="w-4 h-4 text-negative" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <polyline points="16 17 21 12 16 7" />
        <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
);

const ChevronIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-ink-faint">
        <polyline points="9 18 15 12 9 6" />
    </svg>
);

const GearTile = () => (
    <div className="hud-chamfer-sm w-6 h-6 rounded-lg bg-accent-soft border border-accent/35 flex items-center justify-center">
        <SlidersIcon className="w-3.5 h-3.5 text-accent" />
    </div>
);

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
    <HudSectionLabel className="mb-2">{children}</HudSectionLabel>
);

const PrefRow = ({ icon, tint, label, hint, on, onToggle, last = false }: {
    icon: React.ReactNode; tint: string; label: string; hint: string;
    on: boolean; onToggle: () => void; last?: boolean;
}) => (
    <ListRow
        icon={icon}
        tint={tint}
        label={label}
        hint={hint}
        last={last}
        trailing={<Switch on={on} onToggle={onToggle} label={label} />}
    />
);

const LockIcon = () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="5" y="10" width="14" height="10" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
);

const WalletGlyph = () => (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="6" width="20" height="14" rx="3" />
        <path d="M2 10h20" />
        <circle cx="17" cy="15" r="1.2" fill="currentColor" stroke="none" />
    </svg>
);

const NavRow = ({ icon, tint, label, hint, last = false, onClick }: {
    icon: React.ReactNode; tint: string; label: string; hint?: string; last?: boolean; onClick?: () => void;
}) => (
    <ListRow
        icon={icon}
        tint={tint}
        label={label}
        hint={hint}
        last={last}
        onClick={onClick}
        trailing={<ChevronIcon />}
    />
);

function passkeyName(credentialId: string, index: number): string {
    try {
        const saved = localStorage.getItem(`ludo-passkey-name-${credentialId}`);
        if (saved) return saved;
    } catch {
        /* ignore */
    }
    if (index === 0) return 'This device';
    if (index === 1) return 'Backup device';
    return `Passkey ${index + 1}`;
}

const KeyIcon = () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="8" cy="12" r="3.5" />
        <path d="M11.5 12H21M18 12v3M15 12v2" />
    </svg>
);

// ─── Help Center (in-panel FAQ) ─────────────────────────────────────────────
const HELP_FAQ: { q: string; a: string }[] = [
    {
        q: 'How are dice rolled?',
        a: 'Every roll uses a provably-fair commit-reveal scheme: the result is locked in before you see it, so neither player nor host can rig a roll.',
    },
    {
        q: 'How do entry fees & payouts work?',
        a: 'Free tables cost nothing and pay nothing. Staked tables collect Coins up front and pay the winner automatically when the match settles.',
    },
    {
        q: 'What are Power mode tiles?',
        a: 'Five sealed tiles hide on the track. Land on one to collect a power (Nuke, Shield, Boost, Teleport) — one power per roll, each with its own expiry timer.',
    },
    {
        q: 'What if someone disconnects?',
        a: 'The match migrates to a new host automatically. Idle players are marked AFK and auto-play so the table never stalls.',
    },
    {
        q: 'What is a Guest pass?',
        a: 'A wallet-free trial stored on this device: practice vs AI, no account. Connect a wallet (Profile panel) to keep coins, wins, and rank.',
    },
];

function HelpView() {
    const [open, setOpen] = useState<number | null>(0);
    return (
        <section>
            <SectionLabel>Help Center</SectionLabel>
            <div className="rounded-2xl border border-line-soft bg-surface-panel overflow-hidden divide-y divide-line-soft">
                {HELP_FAQ.map((item, i) => {
                    const isOpen = open === i;
                    return (
                        <div key={item.q}>
                            <button
                                onClick={() => setOpen(isOpen ? null : i)}
                                aria-expanded={isOpen}
                                className="w-full flex items-center justify-between gap-3 p-3.5 text-left hover:bg-surface-hover active:bg-surface-active transition-colors"
                            >
                                <span className="text-ludo-md font-bold text-ink-strong">{item.q}</span>
                                <span className={`text-accent transition-transform ${isOpen ? 'rotate-180' : ''}`}>
                                    <ChevronIcon />
                                </span>
                            </button>
                            {isOpen && (
                                <p className="px-3.5 pb-3.5 text-ludo-md font-medium leading-relaxed text-ink-muted">
                                    {item.a}
                                </p>
                            )}
                        </div>
                    );
                })}
            </div>
        </section>
    );
}

// ─── Feedback (Supabase-backed form) ────────────────────────────────────────
const FEEDBACK_TOPICS = ['Bug report', 'Idea', 'Payout issue', 'Other'] as const;

function FeedbackView() {
    const { address } = useCurrentUser();
    const { ensureAppSession } = useAppSession();
    const [topic, setTopic] = useState<string>(FEEDBACK_TOPICS[0]);
    const [message, setMessage] = useState('');
    const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

    const send = async () => {
        const clean = message.trim();
        if (!clean || status === 'sending') return;
        setStatus('sending');
        try {
            // Best-effort attribution only — feedback is anonymous by contract
            // (guests and signed-out visitors can submit; never gate on session).
            const sessionId = await ensureAppSession().catch(() => null);
            const response = await fetch('/api/feedback', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ walletAddress: address ?? null, sessionId, topic, message: clean }),
            });
            if (!response.ok) throw new Error('Feedback submission failed');
            setStatus('sent');
            setMessage('');
        } catch {
            setStatus('error');
        }
    };

    return (
        <section className="flex flex-col gap-3">
            <SectionLabel>Feedback</SectionLabel>
            {status === 'sent' ? (
                <div className="rounded-2xl border border-positive/35 bg-positive/10 p-4 text-center">
                    <p className="text-sm font-extrabold text-positive uppercase tracking-widest">Received</p>
                    <p className="mt-1 text-ludo-md font-medium text-ink-muted">
                        Thanks — the crew reads every note. Send another any time.
                    </p>
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setStatus('idle')}
                        className="mt-3 rounded-full uppercase tracking-[0.15em]"
                    >
                        Write another
                    </Button>
                </div>
            ) : (
                <>
                    <div className="flex flex-wrap gap-1.5">
                        {FEEDBACK_TOPICS.map(t => (
                            <button
                                key={t}
                                onClick={() => setTopic(t)}
                                aria-pressed={topic === t}
                                className={`px-3 py-1.5 rounded-full text-ludo-sm font-extrabold uppercase tracking-wider border transition-all active:scale-95 ${topic === t ? 'bg-accent-soft border-accent/60 text-accent' : 'bg-surface-recessed border-line-soft text-ink-muted hover:text-ink-strong'}`}
                            >
                                {t}
                            </button>
                        ))}
                    </div>
                    <textarea
                        value={message}
                        onChange={e => setMessage(e.target.value)}
                        rows={5}
                        maxLength={2000}
                        placeholder="Tell us what to fix next…"
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck={false}
                        className="w-full rounded-2xl border border-line-soft bg-surface-recessed p-3.5 text-ludo-md font-medium text-ink-strong placeholder:text-ink-faint outline-none focus:border-accent/60 resize-none"
                    />
                    {status === 'error' && (
                        <p className="text-ludo-sm font-bold text-negative px-1">
                            Couldn&apos;t send — check your connection and try again.
                        </p>
                    )}
                    <Button
                        variant="primary"
                        size="lg"
                        fullWidth
                        loading={status === 'sending'}
                        disabled={!message.trim()}
                        onClick={send}
                        className="rounded-2xl uppercase tracking-[0.18em]"
                    >
                        {status === 'sending' ? 'Sending…' : 'Send feedback'}
                    </Button>
                </>
            )}
        </section>
    );
}

// ─── Settings Panel ─────────────────────────────────────────────────────────

export function SettingsPanel({
    onClose,
    onLeaveMatch,
    onOpenWallet,
}: {
    onClose: () => void;
    onLeaveMatch?: () => void;
    onOpenWallet?: () => void;
}) {
    const { preferences, updatePreference } = usePreferences();
    const security = useSecurityPrefs();
    const player = usePlayerSigner();
    const walletMode = useWalletMode();
    const isCdpWallet = walletMode === 'ingame';
    const passkeySupported = useIsPasskeySupported();
    const { enrollPasskey, status: enrollStatus } = useEnrollPasskey();
    const { data: passkeys, refetch: refetchPasskeys } = useListPasskeys();
    const { deletePasskeyAsync } = useDeletePasskey();
    const [passkeyBusy, setPasskeyBusy] = useState(false);
    const [passkeyMsg, setPasskeyMsg] = useState<string | null>(null);
    const [showPasskeys, setShowPasskeys] = useState(false);
    const passkeyCount = (passkeys || []).length;
    const bio = useBiometricGate();

    /** Security toggles: device unlock when a passkey is already enrolled. */
    const guardSecurityToggle = async (apply: () => void) => {
        if (passkeyCount > 0) {
            const ok = await bio.unlock();
            if (!ok) {
                setPasskeyMsg(bio.error || 'Device unlock required to change security settings');
                return;
            }
        }
        apply();
    };
    const { disconnect } = useDisconnect();
    const { signOut: cdpSignOut } = useSignOut();
    const { isGuest } = useCurrentUser();
    // In-game (Leave Match is offered) the panel is scoped: Preferences,
    // Appearance, Leave Match only. No Support/About, and no Sign Out —
    // signing out mid-match is forbidden; leave the match first.
    const inGame = !!onLeaveMatch;
    // Sub-views keep Help / Feedback / About / Terms / Privacy inside the
    // GamePanelShell so the user never leaves the app shell.
    const [view, setView] = useState<'main' | 'help' | 'feedback' | ArenaDocTab>('main');

    return (
        <GamePanelShell
            scopeClass="ludo-settings-scope"
            kicker="// SYSTEM CONFIGURATION"
            title={(
                <span className="inline-flex items-center gap-2">
                    {view !== 'main' && (
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setView('main')}
                            aria-label="Back to settings"
                            className="bg-surface-hover border border-line-soft"
                        >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="icon-md"><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></svg>
                        </Button>
                    )}
                    {view === 'main' && (
                        <>
                            <GearTile />
                            <span>Settings</span>
                        </>
                    )}
                    {view === 'help' && 'Help Center'}
                    {view === 'feedback' && 'Feedback'}
                    {view === 'about' && 'About Ludo 3077'}
                    {view === 'terms' && 'Terms of Service'}
                    {view === 'privacy' && 'Privacy Policy'}
                </span>
            )}
            subtitle={(
                <span className="inline-flex items-center gap-2 uppercase tracking-wide">
                    <span className="font-bold text-accent">Tuned per wallet</span>
                    {inGame && (
                        <>
                            <span className="w-1 h-1 rounded-full bg-line-strong" />
                            <span className="font-bold text-ink-muted">In match</span>
                        </>
                    )}
                </span>
            )}
            onClose={onClose}
            hideOrbs
        >
            {/* Scrollable Content */}
            <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar px-5 pt-3 pb-5 relative z-10 flex flex-col gap-4">
                {view === 'main' ? (
                    <>
                        {/* Preferences */}
                        <section>
                            <SectionLabel>Preferences</SectionLabel>
                            <div className="rounded-2xl border border-line-soft bg-surface-panel overflow-hidden divide-y divide-line-soft">
                                <PrefRow
                                    icon={<SoundIcon />} tint="bg-accent-soft text-accent"
                                    label="Sound Effects" hint="Rolls, captures, UI taps"
                                    on={preferences.sfx} onToggle={() => updatePreference('ludo-sfx', preferences.sfx ? 'off' : 'on')}
                                />
                                <PrefRow
                                    icon={<MusicIcon />} tint="bg-accent-soft text-accent"
                                    label="Game Music" hint="Lobby and arena ambience"
                                    on={preferences.music} onToggle={() => updatePreference('ludo-music', preferences.music ? 'off' : 'on')}
                                />
                                <PrefRow
                                    icon={<HapticIcon />} tint="bg-accent-soft text-accent"
                                    label="Haptics" hint="Vibration on key moments"
                                    on={preferences.haptics} onToggle={() => updatePreference('ludo-haptic', preferences.haptics ? 'off' : 'on')}
                                    last
                                />
                            </div>
                        </section>

                        {/* Appearance */}
                        <section>
                            {/* ── SINGLE THEME ENTRY POINT (UI_DESIGN_AUDIT 1.4.3) ──
                                This is the only user-reachable theme CONTROL. FirstRunSetup,
                                ThemeNudge and the Marketplace also WRITE `ludo-theme`
                                (updatePreference('ludo-theme', …)) — those are intentional
                                touchpoints, not competing UIs; do not add a fifth. The old
                                standalone ThemeSwitcher.tsx component was deleted in 1.4 for
                                being dead (0 importers); if a second theme UI is ever needed,
                                extract a shared control from here instead of forking one. */}
                            <SectionLabel>Appearance</SectionLabel>
                            <div className="rounded-2xl border border-line-soft bg-surface-panel overflow-hidden divide-y divide-line-soft">
                                <div className="p-3.5">
                                    <div className="text-ludo-xs font-extrabold uppercase tracking-widest text-ink-faint mb-2">Theme</div>
                                    <PanelTabs
                                        cols={3}
                                        value={preferences.theme}
                                        onPick={(v) => updatePreference('ludo-theme', v)}
                                        options={[
                                            { value: '3077', label: '3077', icon: <Theme3077Icon className="w-4 h-4" /> },
                                            { value: 'retro', label: 'Retro', icon: <ThemeRetroIcon className="w-4 h-4" /> },
                                            { value: 'light', label: 'Daybreak', icon: <ThemeDaybreakIcon className="w-4 h-4" /> },
                                        ]}
                                    />
                                </div>
                                <div className="p-3.5">
                                    <div className="text-ludo-xs font-extrabold uppercase tracking-widest text-ink-faint mb-2">Token style</div>
                                    <PanelTabs
                                        cols={2}
                                        value={preferences.tokenStyle}
                                        onPick={(v) => updatePreference('token-style', v)}
                                        options={[
                                            { value: 'pawn', label: 'Chess', icon: <TokenChessIcon className="w-4 h-4" /> },
                                            { value: 'orb', label: 'Orbs', icon: <TokenOrbIcon className="w-4 h-4" /> },
                                        ]}
                                    />
                                </div>
                            </div>
                            <p className="text-ludo-xs font-bold text-ink-faint mt-2 px-1">
                                Dice skins live in the Marketplace — anything you own can be equipped from your Loadout.
                            </p>
                        </section>

                        {/* Security — wallet + signing policy (CDP in-game wallet only for passkey/biometric) */}
                        {!inGame && !isGuest && (
                            <section>
                                <SectionLabel>Security</SectionLabel>
                                <div className="rounded-2xl border border-line-soft bg-surface-panel overflow-hidden divide-y divide-line-soft">
                                    <NavRow
                                        icon={<WalletGlyph />}
                                        tint="bg-accent-soft text-accent"
                                        label="Open wallet"
                                        hint="Assets · send / receive · activity"
                                        last={!isCdpWallet}
                                        onClick={() => {
                                            onOpenWallet?.();
                                        }}
                                    />
                                    {isCdpWallet && (
                                        <>
                                            {/* Passkey — parent row; list is nested children */}
                                            <div>
                                                <button
                                                    type="button"
                                                    className="w-full flex items-center gap-3 p-3.5 hover:bg-surface-hover transition-colors text-left"
                                                    onClick={() => setShowPasskeys((v) => !v)}
                                                    aria-expanded={showPasskeys}
                                                >
                                                    <div className="w-9 h-9 rounded-xl bg-accent-soft text-accent flex items-center justify-center shrink-0">
                                                        <KeyIcon />
                                                    </div>
                                                    <div className="flex-1 flex flex-col min-w-0">
                                                        <span className="text-ludo-md font-bold text-ink-strong truncate">Passkey</span>
                                                        <span className="text-ludo-xs font-bold text-ink-faint truncate">
                                                            {passkeyCount > 0
                                                                ? `Face ID / Touch ID · ${passkeyCount} active`
                                                                : 'Face ID / Touch ID · security key'}
                                                        </span>
                                                    </div>
                                                    <svg
                                                        viewBox="0 0 24 24"
                                                        className={`w-3.5 h-3.5 text-ink-muted transition-transform shrink-0 ${showPasskeys ? 'rotate-180' : ''}`}
                                                        fill="none"
                                                        stroke="currentColor"
                                                        strokeWidth="2.2"
                                                        strokeLinecap="round"
                                                    >
                                                        <path d="M6 9l6 6 6-6" />
                                                    </svg>
                                                </button>

                                                {showPasskeys && (
                                                    <div className="px-3.5 pb-2">
                                                        {(passkeys || []).map((pk: { credentialId: string }, i: number) => (
                                                            <div
                                                                key={pk.credentialId}
                                                                className="flex items-center gap-2.5 py-2 pl-1 pr-1 border-t border-line-soft first:border-t-0"
                                                            >
                                                                <div className="w-7 h-7 rounded-lg bg-accent-soft border border-accent/30 text-accent flex items-center justify-center shrink-0">
                                                                    <KeyIcon />
                                                                </div>
                                                                <div className="flex-1 min-w-0">
                                                                    <div className="text-ludo-md font-semibold text-ink-strong truncate">
                                                                        {passkeyName(pk.credentialId, i)}
                                                                    </div>
                                                                    <div className="text-ludo-xs text-ink-faint truncate">
                                                                        Device unlock
                                                                    </div>
                                                                </div>
                                                                <button
                                                                    type="button"
                                                                    className="shrink-0 text-ludo-xs font-bold uppercase text-negative px-1.5 py-1"
                                                                    disabled={passkeyBusy}
                                                                    onClick={async () => {
                                                                        setPasskeyBusy(true);
                                                                        try {
                                                                            await deletePasskeyAsync(pk.credentialId);
                                                                            await refetchPasskeys();
                                                                        } catch {
                                                                            /* ignore */
                                                                        } finally {
                                                                            setPasskeyBusy(false);
                                                                        }
                                                                    }}
                                                                >
                                                                    Remove
                                                                </button>
                                                            </div>
                                                        ))}

                                                        <button
                                                            type="button"
                                                            className="w-full flex items-center gap-2.5 py-2.5 border-t border-line-soft text-left disabled:opacity-40"
                                                            disabled={passkeyBusy || !passkeySupported.data || enrollStatus === 'pending'}
                                                            onClick={async () => {
                                                                setPasskeyBusy(true);
                                                                setPasskeyMsg(null);
                                                                try {
                                                                    await enrollPasskey();
                                                                    await refetchPasskeys();
                                                                    try {
                                                                        const list = (passkeys || []) as { credentialId: string }[];
                                                                        const last = list[list.length - 1];
                                                                        if (last?.credentialId) {
                                                                            localStorage.setItem(
                                                                                `ludo-passkey-name-${last.credentialId}`,
                                                                                list.length <= 1 ? 'This device' : `Passkey ${list.length}`,
                                                                            );
                                                                        }
                                                                    } catch {
                                                                        /* ignore */
                                                                    }
                                                                    setPasskeyMsg('Passkey added.');
                                                                } catch {
                                                                    setPasskeyMsg('Could not add passkey.');
                                                                } finally {
                                                                    setPasskeyBusy(false);
                                                                }
                                                            }}
                                                        >
                                                            <div className="w-7 h-7 rounded-lg border border-dashed border-line-strong text-ink-muted flex items-center justify-center shrink-0">
                                                                +
                                                            </div>
                                                            <span className="text-ludo-md font-bold text-ink-strong">
                                                                {enrollStatus === 'pending' ? 'Waiting…' : 'Add passkey'}
                                                            </span>
                                                        </button>

                                                        {!passkeySupported.data && (
                                                            <p className="pt-1 text-ludo-xs text-warn">Not available in this browser</p>
                                                        )}
                                                        {passkeyMsg && (
                                                            <p className="pt-1 text-ludo-xs text-ink-muted">{passkeyMsg}</p>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                            <PrefRow
                                                icon={<ShieldIcon />} tint="bg-accent-soft text-accent"
                                                label="App lock"
                                                hint="Face ID / passkey required when Ludo opens"
                                                on={security.bootLock}
                                                onToggle={() => void guardSecurityToggle(() => security.setBootLock(!security.bootLock))}
                                            />
                                            <PrefRow
                                                icon={<LockIcon />} tint="bg-accent-soft text-accent"
                                                label="Auto-approve messages"
                                                hint="Match & DM sign without extra prompts"
                                                on={security.autoSign}
                                                onToggle={() => void guardSecurityToggle(() => security.setAutoSign(!security.autoSign))}
                                            />
                                            <PrefRow
                                                icon={<LockIcon />} tint="bg-warn/15 text-warn"
                                                label="Transaction approval"
                                                hint={security.txStepUp === "strict"
                                                    ? "Face ID / fingerprint required for send & swap"
                                                    : "Confirm in Ludo only · no biometric"}
                                                on={security.txStepUp === "strict"}
                                                onToggle={() =>
                                                    void guardSecurityToggle(() =>
                                                        security.setTxStepUp(
                                                            security.txStepUp === "strict" ? "confirm" : "strict",
                                                        ),
                                                    )
                                                }
                                                last
                                            />
                                        </>
                                    )}
                                </div>
                            </section>
                        )}

                        {/* Support + About: lobby only — hidden mid-match */}
                        {!inGame && (
                            <>
                                {/* Support */}
                                <section>
                                    <SectionLabel>Support</SectionLabel>
                                    <div className="rounded-2xl border border-line-soft bg-surface-panel overflow-hidden divide-y divide-line-soft">
                                        <NavRow icon={<HelpIcon />} tint="bg-accent-soft text-accent" label="Help Center" hint="Rules, fairness, payouts" onClick={() => setView('help')} />
                                        <NavRow icon={<MessageIcon />} tint="bg-accent-soft text-accent" label="Feedback" hint="Tell us what to fix next" last onClick={() => setView('feedback')} />
                                    </div>
                                </section>

                                {/* About */}
                                <section>
                                    <SectionLabel>About</SectionLabel>
                                    <div className="rounded-2xl border border-line-soft bg-surface-panel overflow-hidden divide-y divide-line-soft">
                                        <NavRow icon={<InfoIcon />} tint="bg-accent-soft text-accent" label="About Ludo 3077" hint="Guide, logo & launch video" onClick={() => setView('about')} />
                                        <NavRow icon={<FileTextIcon />} tint="bg-accent-soft text-accent" label="Terms of Service" onClick={() => setView('terms')} />
                                        <NavRow icon={<ShieldIcon />} tint="bg-accent-soft text-accent" label="Privacy Policy" last onClick={() => setView('privacy')} />
                                    </div>
                                </section>
                            </>
                        )}

                        {/* Leave match (in-game only). */}
                        {onLeaveMatch && (
                            <Button
                                variant="secondary"
                                size="lg"
                                fullWidth
                                leftIcon={<LogOutIcon />}
                                className="rounded-2xl bg-warn/10 border-warn/25 text-warn hover:bg-warn/20 uppercase tracking-[0.18em]"
                                onClick={() => {
                                    onClose();
                                    onLeaveMatch();
                                }}
                            >
                                Leave Match
                            </Button>
                        )}

                        {/* Sign out: lobby only — mid-match exits go via Leave Match. */}
                        {!inGame && (
                            <button
                                className="w-full flex flex-col items-center justify-center gap-1 py-3.5 rounded-2xl bg-negative/10 border border-negative/25 hover:bg-negative/20 active:scale-[0.99] transition-all text-negative disabled:opacity-45 disabled:cursor-not-allowed"
                                onClick={() => {
                                    if (isGuest) exitGuest();
                                    void cdpSignOut().catch(() => undefined);
                                    try {
                                        disconnect();
                                    } catch {
                                        /* not connected */
                                    }
                                    onClose();
                                }}
                            >
                                <span className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-[0.18em]">
                                    <LogOutIcon />
                                    {isGuest ? 'Sign In' : 'Sign Out'}
                                </span>
                                {!isGuest && player.address && (
                                    <span className="settings-signout-addr max-w-full px-3 text-ludo-xs font-mono leading-tight break-all">
                                        {player.address}
                                    </span>
                                )}
                            </button>
                        )}

                        {/* Version footer: always last, lobby + in-match */}
                        <div className="flex flex-col items-center gap-0.5 pt-1 pb-1">
                            <p className="text-ludo-xs font-extrabold uppercase tracking-[0.2em] text-ink-faint">
                                Ludo 3077 · Onchain Arena
                            </p>
                            <p className="text-ludo-xs text-ink-faint font-mono">
                                {APP_VERSION} · build {APP_BUILD_HASH}
                            </p>
                        </div>
                    </>
                ) : view === 'help' ? (
                    <HelpView />
                ) : view === 'feedback' ? (
                    <FeedbackView />
                ) : (
                    <div className="flex flex-col gap-4">
                        <ArenaDocTabs activeTab={view} onSelectTab={setView} />
                        {view === 'about' && (
                            <AboutContent
                                layout="panel"
                                onSelectTab={setView}
                                onClose={onClose}
                            />
                        )}
                        {view === 'terms' && <TermsContent />}
                        {view === 'privacy' && <PrivacyContent />}
                    </div>
                )}
            </div>
        </GamePanelShell>
    );
}
