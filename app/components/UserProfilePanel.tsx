'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useTotalChips } from '@/hooks/useTotalChips';
import { formatCompactChips } from '@/lib/chips';
import { getProgression, getRankProgress } from '@/lib/progression';
import { supabase } from '@/lib/supabase';
import { RANGES, FormChart, rangeCutoff } from './FormChart';
import { ModeBreakdown, winGame } from './ModeBreakdown';
import { getShowcased } from '@/lib/showcase';
import { exitGuest } from '@/lib/guest';
import { useGuestWall } from '@/hooks/GuestWallContext';
import { useAppSession } from '@/hooks/useAppSession';
import { useUnsyncedMatches } from '@/hooks/useUnsyncedMatches';
import { PanelTabs, TabCount } from './PanelTabs';
import { MatchHistoryTab } from './MatchHistoryTab';
import { GamePanelShell } from './GamePanelShell';
import { HudProgressGauge, HudSectionLabel } from './HudPrimitives';
import { PilotAvatar } from './PilotAvatar';
import { RankTierIcon } from './RankTierIcon';
import { Switch } from './Switch';
import { Button } from './Button';
import { CheckGlyphIcon, ChipsHexIcon, PilotAvatarFallbackIcon } from './icons';
import {
    AVATARS,
    PLAYER_AVATAR_SERIES,
    PlayerAvatarSeries,
    encodeAvatar,
    isUnlocked,
    resolveAvatarDef,
    validateName,
    NAME_RULES,
} from '@/lib/avatars';

type ProfileTab = 'overview' | 'performance' | 'history';

// Vault relic catalogue (mirrors MarketplacePanel showcase SKUs).
const RELICS: Record<string, { name: string; swatchClass: string; desc: string }> = {
    s1: { name: 'Crystal', swatchClass: 'bg-accent-soft border-accent/60', desc: 'Prismatic ice relic' },
    s2: { name: 'Magma', swatchClass: 'bg-warn/25 border-warn/60', desc: 'Volcanic fire relic' },
    s3: { name: 'Void', swatchClass: 'bg-surface-active border-line-strong', desc: 'Light-eating relic' },
    s4: { name: 'Neon-X', swatchClass: 'bg-accent/25 border-accent/70', desc: 'Electric skin' },
    s5: { name: 'Cyber-V', swatchClass: 'bg-positive/25 border-positive/60', desc: 'Matrix skin' },
    s6: { name: 'Steel-Z', swatchClass: 'bg-surface-hover border-line-strong', desc: 'Cold steel skin' },
};

const RelicGem = ({ swatchClass, px = 40 }: { swatchClass: string; px?: number }) => (
    <div className="relative flex items-center justify-center shrink-0" style={{ width: px, height: px }}>
        <div className={`absolute inset-[10%] rotate-45 rounded-lg border ${swatchClass}`} />
        <div className="w-2 h-2 rounded-full bg-accent/80 relative z-10" />
    </div>
);

interface RecentMatchRow {
    winner_address: string | null;
    created_at: string | null;
    game_mode?: string | null;
}

export default function UserProfilePanel({
    onClose,
    onOpenMarketplace,
    onOpenWallet,
    onOpenProfile,
}: {
    onClose: () => void;
    onOpenMarketplace?: () => void;
    onOpenWallet?: () => void;
    onOpenProfile?: (address: string) => void;
}) {
    const { profile, address, displayName: finalName, isGuest } = useCurrentUser();
    const totalChips = useTotalChips();
    const { guard } = useGuestWall();
    const { ensureAppSession } = useAppSession();
    const { count: unsyncedCount } = useUnsyncedMatches();
    const [activeTab, setActiveTab] = useState<ProfileTab>('overview');

    const finalAvatar = profile?.avatar_url || null;
    const avatarDef = resolveAvatarDef(finalAvatar);

    // Showcased vault relic: single SKU per wallet, set from Marketplace loadout.
    const [showcasedId, setShowcasedId] = useState<string | null>(null);
    useEffect(() => {
        setShowcasedId(getShowcased(address?.toLowerCase() ?? null));
        const onStorage = (e: StorageEvent) => {
            if (!e.key || e.key.startsWith('ludo-showcase-')) {
                setShowcasedId(getShowcased(address?.toLowerCase() ?? null));
            }
        };
        window.addEventListener('storage', onStorage);
        return () => window.removeEventListener('storage', onStorage);
    }, [address]);
    const showcased = showcasedId ? RELICS[showcasedId] : undefined;

    const progression = getProgression(profile?.lxp || 0, profile?.rxp || 0);
    const rank = getRankProgress(profile?.rxp || 0);

    const wins = profile?.total_wins || 0;
    const games = profile?.total_games || 0;
    const winRate = games > 0 ? Math.round((wins / games) * 100) : 0;
    const coins = profile?.coins || 0;
    const compactChips = formatCompactChips(totalChips.totalChips);

    // ── Identity editor (callsign + avatar customizer overlay) ────────────────
    const [editing, setEditing] = useState(false);
    const [avatarSeries, setAvatarSeries] = useState<PlayerAvatarSeries>('pilots');
    const [draftName, setDraftName] = useState('');
    const [draftAvatarId, setDraftAvatarId] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [savedFlash, setSavedFlash] = useState(false);
    const [copiedAddr, setCopiedAddr] = useState(false);

    const openEditor = () => {
        if (!guard('profile-edit')) return;
        setDraftName(profile?.username && !profile.username.startsWith('0x') ? profile.username : '');
        setDraftAvatarId(avatarDef?.id ?? null);
        setAvatarSeries(
            avatarDef && avatarDef.series !== 'legion' ? avatarDef.series : 'pilots',
        );
        setSaveError(null);
        setEditing(true);
    };

    const draftValidationErr = useMemo(() => {
        if (!draftName.trim()) return null;
        return validateName(draftName);
    }, [draftName]);

    const previewAvatarUrl = draftAvatarId ? encodeAvatar(draftAvatarId) : finalAvatar;
    const previewAvatarDef = resolveAvatarDef(previewAvatarUrl);
    const previewName = draftName.trim() || finalName;

    const saveIdentity = async () => {
        if (!address || saving) return;
        if (!guard('profile-edit')) return;
        const err = validateName(draftName);
        if (err) {
            setSaveError(err);
            return;
        }
        const clean = draftName.trim();
        setSaving(true);
        setSaveError(null);
        try {
            const response = await fetch('/api/profile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    walletAddress: address,
                    sessionId: await ensureAppSession(),
                    username: clean,
                    avatarUrl: draftAvatarId ? encodeAvatar(draftAvatarId) : profile?.avatar_url || null,
                }),
            });
            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                throw new Error(data.error || 'Couldn’t save profile');
            }
            window.dispatchEvent(new CustomEvent('ludo-profile-refresh'));
            setEditing(false);
            setSavedFlash(true);
            setTimeout(() => setSavedFlash(false), 2500);
        } catch (e: unknown) {
            setSaveError(e instanceof Error ? e.message : 'Couldn’t save — try again');
        } finally {
            setSaving(false);
        }
    };

    // ── Persisted privacy toggles ─────────────────────────────────────────────
    const [isPublic, setIsPublic] = useState<boolean>(profile?.is_public ?? true);
    const [allowRequests, setAllowRequests] = useState<boolean>(profile?.allow_requests ?? true);
    const [savingPrivacy, setSavingPrivacy] = useState<'public' | 'requests' | null>(null);
    const [privacyMsg, setPrivacyMsg] = useState<{ text: string; error?: boolean } | null>(null);

    useEffect(() => {
        if (typeof profile?.is_public === 'boolean') setIsPublic(profile.is_public);
        if (typeof profile?.allow_requests === 'boolean') setAllowRequests(profile.allow_requests);
    }, [profile?.is_public, profile?.allow_requests]);

    const updatePrivacy = async (field: 'public' | 'requests') => {
        if (!address || savingPrivacy) return;
        if (!guard('profile-edit')) return;

        const prevPublic = isPublic;
        const prevRequests = allowRequests;
        const nextPublic = field === 'public' ? !isPublic : isPublic;
        const nextRequests = field === 'requests' ? !allowRequests : allowRequests;

        setIsPublic(nextPublic);
        setAllowRequests(nextRequests);
        setSavingPrivacy(field);
        setPrivacyMsg(null);

        try {
            const sessionId = await ensureAppSession();
            if (!sessionId) throw new Error('Sign-in required to update privacy settings');
            const res = await fetch('/api/profile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    walletAddress: address,
                    sessionId,
                    ...(field === 'public' ? { isPublic: nextPublic } : { allowRequests: nextRequests }),
                }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error || 'Could not update privacy setting');
            }
            window.dispatchEvent(new CustomEvent('ludo-profile-refresh'));
            setPrivacyMsg({
                text:
                    field === 'public'
                        ? nextPublic
                            ? 'Dossier set to Public'
                            : 'Dossier set to Private'
                        : nextRequests
                          ? 'Friend requests enabled'
                          : 'Friend requests paused',
            });
            setTimeout(() => setPrivacyMsg(null), 2400);
        } catch (err: unknown) {
            setIsPublic(prevPublic);
            setAllowRequests(prevRequests);
            setPrivacyMsg({
                text: err instanceof Error ? err.message : 'Save failed — reverted',
                error: true,
            });
            setTimeout(() => setPrivacyMsg(null), 3000);
        } finally {
            setSavingPrivacy(null);
        }
    };

    // ── Matches & telemetry ───────────────────────────────────────────────────
    const [range, setRange] = useState<string>('All');
    const [recentMatches, setRecentMatches] = useState<RecentMatchRow[]>([]);

    useEffect(() => {
        if (!address) return;
        let cancelled = false;
        (async () => {
            try {
                const { data } = await supabase
                    .from('matches')
                    .select('winner_address, created_at, game_mode')
                    .overlaps('participants', [address.toLowerCase(), address])
                    .order('created_at', { ascending: false })
                    .limit(100);
                if (!cancelled) setRecentMatches(data || []);
            } catch {
                if (!cancelled) setRecentMatches([]);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [address]);

    const streak = useMemo(() => {
        const me = (address || '').toLowerCase();
        if (!me) return 0;
        let s = 0;
        for (const m of recentMatches) {
            if ((m.winner_address || '').toLowerCase() === me) s++;
            else break;
        }
        return s;
    }, [recentMatches, address]);

    const form = useMemo(() => {
        const me = (address || '').toLowerCase();
        const cutoff = rangeCutoff(range);
        const inRange = recentMatches
            .filter((m) => m.created_at && new Date(m.created_at).getTime() >= cutoff)
            .reverse();
        let score = 0;
        const pts: number[] = [];
        let w = 0;
        for (const m of inRange) {
            if (me && (m.winner_address || '').toLowerCase() === me) {
                score += 30;
                w++;
            } else {
                score -= 15;
            }
            pts.push(score);
        }
        return {
            pts,
            wins: w,
            played: inRange.length,
            net: score,
            rate: inRange.length ? Math.round((w / inRange.length) * 100) : 0,
            positive: score >= 0,
        };
    }, [recentMatches, range, address]);

    const meLc = (address || '').toLowerCase();
    const classicRows = recentMatches.filter((m) => (m.game_mode || 'classic') === 'classic');
    const powerRows = recentMatches.filter((m) => m.game_mode === 'power');
    const aiRows = recentMatches.filter((m) => m.game_mode === 'ai' || m.game_mode === 'offline');

    const modeForm = {
        classic: winGame(
            classicRows.filter((m) => (m.winner_address || '').toLowerCase() === meLc).length,
            Math.max(profile?.classic_played || 0, classicRows.length),
        ),
        power: winGame(
            powerRows.filter((m) => (m.winner_address || '').toLowerCase() === meLc).length,
            Math.max(profile?.power_played || 0, powerRows.length),
        ),
        ai: winGame(
            aiRows.filter((m) => (m.winner_address || '').toLowerCase() === meLc).length,
            profile?.ai_played || 0,
        ),
        form: winGame(wins, games),
    };

    const kpiTiles = [
        { v: wins.toLocaleString(), l: 'Wins', tone: 'text-ink-strong' },
        { v: `${winRate}%`, l: 'Win Rate', tone: 'text-accent' },
        { v: games.toLocaleString(), l: 'Matches', tone: 'text-ink-strong' },
        { v: `${streak}`, l: streak >= 2 ? 'Hot Streak' : 'Streak', tone: streak >= 2 ? 'text-warn' : 'text-ink-muted' },
    ];

    const seriesAvatars = AVATARS.filter((a) => a.series === avatarSeries);
    const featuredPilots = useMemo(
        () => seriesAvatars.filter((a) => a.featured),
        [seriesAvatars],
    );
    const helmetPilots = useMemo(
        () => seriesAvatars.filter((a) => !a.featured),
        [seriesAvatars],
    );

    const handleCopyAddress = async () => {
        if (!address || isGuest) return;
        try {
            await navigator.clipboard.writeText(address);
            setCopiedAddr(true);
            setTimeout(() => setCopiedAddr(false), 1800);
        } catch {
            /* ignore clipboard errors */
        }
    };

    return (
        <>
        <GamePanelShell
            scopeClass="ludo-profile-scope"
            kicker="// PILOT DOSSIER"
            hideOrbs
            onClose={onClose}
            title={
                <span className="flex items-center gap-2">
                    <span className="w-7 h-7 rounded-xl bg-accent-soft border border-accent/40 flex items-center justify-center text-accent shrink-0">
                        <PilotAvatarFallbackIcon className="w-4 h-4" active />
                    </span>
                    <span>Profile</span>
                </span>
            }
            subtitle={
                <span className="flex items-center gap-2 min-w-0 text-ludo-xs font-mono uppercase tracking-[0.16em]">
                    <span className="text-ink-muted font-bold truncate">{finalName}</span>
                    {profile?.clan_tag && (
                        <span className="px-1.5 py-0.5 rounded-sm bg-accent-soft border border-accent/35 text-accent font-bold shrink-0">
                            [{profile.clan_tag}]
                        </span>
                    )}
                    <span className="text-accent font-bold shrink-0">Lv. {progression.level}</span>
                </span>
            }
        >
            {/* Guest pass -> connect banner */}
            {isGuest && (
                <div className="guest-connect-banner flex items-center gap-2.5 pl-3 pr-1.5 py-2 rounded-2xl border border-warn/40 bg-warn/10">
                    <span className="w-2 h-2 rounded-full bg-warn animate-pulse shrink-0" />
                    <span className="guest-connect-text flex-1 min-w-0 text-ludo-xs font-bold text-ink-strong leading-tight">
                        Guest pass — connect a wallet to keep coins, wins &amp; rank.
                    </span>
                    <Button
                        size="sm"
                        variant="primary"
                        onClick={() => {
                            onClose();
                            exitGuest();
                        }}
                    >
                        Connect
                    </Button>
                </div>
            )}

            {/* 3-Tab Switcher: Overview | Performance | History */}
            <PanelTabs<ProfileTab>
                value={activeTab}
                onPick={setActiveTab}
                cols={3}
                options={[
                    { value: 'overview', label: 'Overview' },
                    { value: 'performance', label: 'Performance' },
                    {
                        value: 'history',
                        label: 'History',
                        badge:
                            unsyncedCount > 0 ? (
                                <TabCount active={activeTab === 'history'}>{unsyncedCount}</TabCount>
                            ) : undefined,
                    },
                ]}
            />

            {activeTab === 'history' && (
                <MatchHistoryTab
                    address={address}
                    isGuest={isGuest}
                    onOpenProfile={onOpenProfile}
                />
            )}

            {activeTab === 'overview' && (
                <div className="flex flex-col gap-3">
                    {/* Hero Dossier Card */}
                    <div className="rounded-2xl bg-surface-recessed border border-line-soft p-3.5 flex items-center gap-3">
                        <button
                            type="button"
                            onClick={openEditor}
                            aria-label="Change pilot avatar"
                            className="relative shrink-0 rounded-full group cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                            <PilotAvatar
                                avatarUrl={finalAvatar}
                                name={finalName}
                                size="lg"
                                tier={progression.tier}
                                className="transition-transform group-hover:scale-[1.03]"
                            />
                            <span
                                aria-hidden="true"
                                className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-surface-panel border border-line-strong text-accent flex items-center justify-center shadow"
                            >
                                <svg
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2.2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    className="w-2.5 h-2.5"
                                >
                                    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                                </svg>
                            </span>
                        </button>
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 min-w-0">
                                <h3 className="text-ludo-lg font-extrabold text-ink-strong truncate">
                                    {finalName}
                                </h3>
                                {profile?.clan_tag && (
                                    <span className="px-1.5 py-0.5 rounded-sm bg-accent-soft border border-accent/35 text-ludo-xs font-mono font-bold text-accent shrink-0">
                                        [{profile.clan_tag}]
                                    </span>
                                )}
                                <button
                                    type="button"
                                    onClick={openEditor}
                                    aria-label="Edit name and avatar"
                                    className="shrink-0 w-7 h-7 flex items-center justify-center rounded-full bg-surface-hover border border-line-soft text-ink-muted hover:text-ink-strong hover:border-line-strong transition-colors"
                                >
                                    <svg
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        className="w-3.5 h-3.5"
                                    >
                                        <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                                    </svg>
                                </button>
                            </div>
                            {savedFlash && (
                                <div className="text-ludo-xs font-bold text-positive uppercase tracking-[0.16em] mt-0.5">
                                    Callsign synced
                                </div>
                            )}
                            <div className="flex flex-wrap items-center gap-1.5 mt-1">
                                <span className="inline-flex items-center gap-1 text-ludo-xs font-bold uppercase tracking-wider text-accent">
                                    <RankTierIcon tier={progression.tier} className="w-3.5 h-3.5 shrink-0" />
                                    <span>
                                        {progression.tier} {progression.subRank}
                                    </span>
                                </span>
                                <span className="text-ink-faint" aria-hidden="true">·</span>
                                <span className="text-ludo-xs text-ink-muted font-mono font-bold">
                                    Lv. {progression.level}
                                </span>
                                {address && !isGuest && (
                                    <>
                                        <span className="text-ink-faint" aria-hidden="true">·</span>
                                        <button
                                            type="button"
                                            onClick={handleCopyAddress}
                                            className="text-ludo-xs font-mono text-ink-faint hover:text-ink-strong transition-colors"
                                            title="Copy wallet address"
                                        >
                                            {copiedAddr
                                                ? 'Copied'
                                                : `${address.slice(0, 6)}…${address.slice(-4)}`}
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>

                        {/* Unified CHIPS + Coins telemetry pills */}
                        <div className="flex flex-col items-end gap-1.5 shrink-0">
                            <button
                                type="button"
                                onClick={onOpenWallet}
                                title={onOpenWallet ? 'Open Wallet' : 'Total CHIPS across wallet & vaults'}
                                className={`flex items-center gap-1.5 bg-surface-panel px-2.5 py-1 rounded-full border border-accent/35 transition-colors ${
                                    onOpenWallet ? 'cursor-pointer hover:border-accent' : 'cursor-default'
                                }`}
                            >
                                <ChipsHexIcon className="w-3.5 h-3.5 text-accent" active />
                                <span className="text-ludo-sm font-extrabold text-ink-strong tabular-nums">
                                    {compactChips}
                                </span>
                                <span className="text-ludo-xs font-bold text-accent uppercase tracking-wider">
                                    CHIPS
                                </span>
                            </button>
                            <div className="flex items-center gap-1.5 bg-surface-panel px-2.5 py-0.5 rounded-full border border-line-soft">
                                <span className="w-1.5 h-1.5 rounded-full bg-warn" />
                                <span className="text-ludo-xs font-bold text-ink-muted tabular-nums">
                                    {coins.toLocaleString()} Coins
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* 4-Tile KPI Strip */}
                    <section className="flex flex-col gap-2">
                        <HudSectionLabel>Combat Record</HudSectionLabel>
                        <div className="grid grid-cols-4 gap-2">
                            {kpiTiles.map((s) => (
                                <div
                                    key={s.l}
                                    className="rounded-xl bg-surface-recessed border border-line-soft p-2.5 flex flex-col items-center justify-center"
                                >
                                    <span className={`text-ludo-xl font-extrabold tabular-nums leading-none ${s.tone}`}>
                                        {s.v}
                                    </span>
                                    <span className="text-ludo-xs font-bold uppercase tracking-widest text-ink-faint mt-1 text-center">
                                        {s.l}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </section>

                    {/* Clearance & Season Rank (compositor-only gauges) */}
                    <section className="flex flex-col gap-2">
                        <HudSectionLabel>Clearance &amp; Rank</HudSectionLabel>
                        <div className="rounded-2xl bg-surface-recessed border border-line-soft p-3.5 flex flex-col gap-3">
                            <div className="flex flex-col gap-1.5">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-ludo-xs font-bold uppercase tracking-[0.18em] text-accent">
                                        Level {progression.level}
                                    </span>
                                    <span className="text-ludo-xs font-mono font-bold text-ink-muted tabular-nums">
                                        {progression.currentLxp.toLocaleString()} /{' '}
                                        {progression.lxpToNextLevel.toLocaleString()} XP
                                    </span>
                                </div>
                                <HudProgressGauge percent={progression.progressPercentage} tone="accent" />
                                <div className="text-ludo-xs font-bold text-ink-faint uppercase tracking-wider">
                                    {(progression.lxpToNextLevel - progression.currentLxp).toLocaleString()} XP to Lv.{' '}
                                    {progression.level + 1} · {(profile?.lxp || 0).toLocaleString()} lifetime
                                </div>
                            </div>

                            <div className="h-px bg-line-soft" />

                            <div className="flex flex-col gap-1.5">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="inline-flex items-center gap-1.5 text-ludo-xs font-bold uppercase tracking-[0.18em] text-warn">
                                        <RankTierIcon tier={progression.tier} className="w-3.5 h-3.5 shrink-0" />
                                        <span>
                                            {progression.tier} {progression.subRank}
                                        </span>
                                    </span>
                                    <span className="text-ludo-xs font-mono font-bold text-ink-muted tabular-nums">
                                        {rank.target === null
                                            ? `${rank.current.toLocaleString()} RXP`
                                            : `${rank.current.toLocaleString()} / ${rank.target.toLocaleString()} RXP`}
                                    </span>
                                </div>
                                <HudProgressGauge percent={rank.pct} tone="warn" />
                                <div className="text-ludo-xs font-bold text-ink-faint uppercase tracking-wider">
                                    {rank.nextLabel === 'MAX'
                                        ? 'Apex Season Clearance'
                                        : `Next: ${rank.nextLabel} · resets quarterly`}
                                </div>
                            </div>
                        </div>
                    </section>

                    {/* Vault Relic Showcase */}
                    <section className="flex flex-col gap-2">
                        <HudSectionLabel
                            right={
                                showcased ? (
                                    <span className="px-2 py-0.5 rounded-full bg-accent-soft border border-accent/40 text-ludo-xs font-bold text-accent uppercase tracking-widest">
                                        Active
                                    </span>
                                ) : undefined
                            }
                        >
                            Showcase
                        </HudSectionLabel>
                        {showcased ? (
                            <div className="rounded-2xl bg-surface-recessed border border-line-soft p-3 flex items-center gap-3">
                                <RelicGem swatchClass={showcased.swatchClass} />
                                <div className="flex-1 min-w-0">
                                    <div className="text-ludo-md font-bold text-ink-strong truncate">
                                        {showcased.name}
                                    </div>
                                    <div className="text-ludo-xs font-bold text-ink-faint truncate">
                                        {showcased.desc}
                                    </div>
                                </div>
                                {onOpenMarketplace && (
                                    <Button variant="secondary" size="sm" onClick={onOpenMarketplace}>
                                        Change
                                    </Button>
                                )}
                            </div>
                        ) : (
                            <div className="rounded-2xl border border-dashed border-line-soft bg-surface-recessed/50 p-3 flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-surface-panel border border-line-soft flex items-center justify-center shrink-0 text-ink-faint">
                                    <svg
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        className="w-4 h-4"
                                    >
                                        <path d="M6 3h12l4 6-10 13L2 9z" />
                                    </svg>
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="text-ludo-md font-bold text-ink-muted">No relic showcased</div>
                                    <div className="text-ludo-xs font-bold text-ink-faint truncate">
                                        Equip a collectible from Marketplace loadout.
                                    </div>
                                </div>
                                {onOpenMarketplace && (
                                    <Button variant="secondary" size="sm" onClick={onOpenMarketplace}>
                                        Market
                                    </Button>
                                )}
                            </div>
                        )}
                    </section>

                    {/* Wired Privacy & Comms Controls */}
                    <section className="flex flex-col gap-2">
                        <HudSectionLabel
                            right={
                                privacyMsg ? (
                                    <span
                                        className={`text-ludo-xs font-bold uppercase tracking-wider ${
                                            privacyMsg.error ? 'text-negative' : 'text-positive'
                                        }`}
                                    >
                                        {privacyMsg.text}
                                    </span>
                                ) : undefined
                            }
                        >
                            Privacy &amp; Comms
                        </HudSectionLabel>

                        <div className="rounded-2xl bg-surface-recessed border border-line-soft overflow-hidden divide-y divide-line-soft">
                            <div className="flex items-center justify-between gap-3 p-3">
                                <div className="flex items-center gap-2.5 min-w-0">
                                    <div className="w-8 h-8 rounded-xl bg-accent-soft border border-accent/30 text-accent flex items-center justify-center shrink-0">
                                        <svg
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="2"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            className="w-4 h-4"
                                        >
                                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                                            <circle cx="12" cy="12" r="3" />
                                        </svg>
                                    </div>
                                    <div className="min-w-0">
                                        <div className="text-ludo-md font-bold text-ink-strong truncate">
                                            Public Profile
                                        </div>
                                        <div className="text-ludo-xs font-bold text-ink-faint truncate">
                                            {isPublic
                                                ? 'Scouts can view stats & form'
                                                : 'Redacted from non-friend scouts'}
                                        </div>
                                    </div>
                                </div>
                                <Switch
                                    on={isPublic}
                                    onToggle={() => void updatePrivacy('public')}
                                    label="Public Profile"
                                    disabled={isGuest || savingPrivacy !== null}
                                />
                            </div>

                            <div className="flex items-center justify-between gap-3 p-3">
                                <div className="flex items-center gap-2.5 min-w-0">
                                    <div className="w-8 h-8 rounded-xl bg-positive/15 border border-positive/30 text-positive flex items-center justify-center shrink-0">
                                        <svg
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="2"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            className="w-4 h-4"
                                        >
                                            <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                                            <circle cx="8.5" cy="7" r="4" />
                                            <line x1="20" y1="8" x2="20" y2="14" />
                                            <line x1="23" y1="11" x2="17" y2="11" />
                                        </svg>
                                    </div>
                                    <div className="min-w-0">
                                        <div className="text-ludo-md font-bold text-ink-strong truncate">
                                            Allow Requests
                                        </div>
                                        <div className="text-ludo-xs font-bold text-ink-faint truncate">
                                            {allowRequests
                                                ? 'Pilots can send friend requests'
                                                : 'Incoming friend requests paused'}
                                        </div>
                                    </div>
                                </div>
                                <Switch
                                    on={allowRequests}
                                    onToggle={() => void updatePrivacy('requests')}
                                    label="Allow Requests"
                                    disabled={isGuest || savingPrivacy !== null}
                                />
                            </div>
                        </div>
                    </section>
                </div>
            )}

            {activeTab === 'performance' && (
                <div className="flex flex-col gap-3.5">
                    {/* Form Sparkline Card */}
                    <section className="flex flex-col gap-2">
                        <HudSectionLabel>Form Telemetry</HudSectionLabel>
                        <div className="rounded-2xl bg-surface-recessed border border-line-soft p-3.5 flex flex-col gap-2.5">
                            <div className="flex items-end justify-between gap-2">
                                <div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-ludo-3xl font-extrabold text-ink-strong tabular-nums leading-none">
                                            {form.played ? `${form.rate}%` : '–'}
                                        </span>
                                        {form.played > 0 && (
                                            <span
                                                className={`px-2 py-0.5 rounded-full text-ludo-xs font-mono font-bold tabular-nums border ${
                                                    form.positive
                                                        ? 'bg-positive/15 text-positive border-positive/35'
                                                        : 'bg-negative/15 text-negative border-negative/35'
                                                }`}
                                            >
                                                {form.net > 0 ? `+${form.net}` : `${form.net}`} RXP
                                            </span>
                                        )}
                                    </div>
                                    <div className="text-ludo-xs font-bold text-ink-faint uppercase tracking-widest mt-1">
                                        {form.played} matches · {form.wins}W / {Math.max(0, form.played - form.wins)}L ·{' '}
                                        {range}
                                    </div>
                                </div>
                            </div>

                            {form.pts.length > 0 ? (
                                <FormChart points={form.pts} positive={form.positive} />
                            ) : (
                                <div className="h-[96px] flex items-center justify-center border border-dashed border-line-soft rounded-xl">
                                    <span className="text-ludo-xs font-bold text-ink-faint uppercase tracking-widest">
                                        {recentMatches.length
                                            ? 'No matches in this range'
                                            : 'Play matches to build form'}
                                    </span>
                                </div>
                            )}

                            <div className="flex items-center justify-between pt-1 gap-1">
                                {RANGES.map((r) => (
                                    <button
                                        key={r.id}
                                        type="button"
                                        onClick={() => setRange(r.id)}
                                        className={`flex-1 py-1 rounded-full text-ludo-xs font-bold uppercase tracking-wider transition-colors ${
                                            range === r.id
                                                ? 'bg-accent-soft text-accent border border-accent/40'
                                                : 'text-ink-faint hover:text-ink-strong'
                                        }`}
                                    >
                                        {r.id}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </section>

                    {/* Mode Breakdown */}
                    <section className="flex flex-col gap-2">
                        <HudSectionLabel>Mode Breakdown</HudSectionLabel>
                        <ModeBreakdown stats={modeForm} labels={['Classic', 'Power', 'vs AI', 'Overall']} />
                    </section>

                    {/* Detailed Split Telemetry */}
                    <section className="flex flex-col gap-2">
                        <HudSectionLabel>Arena Distribution</HudSectionLabel>
                        <div className="grid grid-cols-3 gap-2">
                            <div className="rounded-xl bg-surface-recessed border border-line-soft p-2.5 text-center">
                                <div className="text-ludo-lg font-extrabold text-ink-strong tabular-nums">
                                    {(profile?.classic_played ?? classicRows.length).toLocaleString()}
                                </div>
                                <div className="text-ludo-xs font-bold uppercase tracking-widest text-ink-faint mt-0.5">
                                    Classic Played
                                </div>
                            </div>
                            <div className="rounded-xl bg-surface-recessed border border-line-soft p-2.5 text-center">
                                <div className="text-ludo-lg font-extrabold text-accent tabular-nums">
                                    {(profile?.power_played ?? powerRows.length).toLocaleString()}
                                </div>
                                <div className="text-ludo-xs font-bold uppercase tracking-widest text-ink-faint mt-0.5">
                                    Power Played
                                </div>
                            </div>
                            <div className="rounded-xl bg-surface-recessed border border-line-soft p-2.5 text-center">
                                <div className="text-ludo-lg font-extrabold text-warn tabular-nums">
                                    {(profile?.ai_played ?? aiRows.length).toLocaleString()}
                                </div>
                                <div className="text-ludo-xs font-bold uppercase tracking-widest text-ink-faint mt-0.5">
                                    Bot Sims
                                </div>
                            </div>
                        </div>
                    </section>
                </div>
            )}
        </GamePanelShell>

        {/* Dedicated Edit Profile Overlay Page */}
        {editing && (
            <GamePanelShell
                overlay
                scopeClass="ludo-profile-scope"
                kicker="// PILOT IDENTITY"
                hideOrbs
                compactHeader
                bodyScroll={false}
                onClose={() => {
                    if (!saving) setEditing(false);
                }}
                title={
                    <span className="flex items-center gap-2">
                        <span className="w-7 h-7 rounded-xl bg-accent-soft border border-accent/40 flex items-center justify-center text-accent shrink-0">
                            <svg
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className="w-4 h-4"
                            >
                                <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                            </svg>
                        </span>
                        <span>Edit Profile</span>
                    </span>
                }
                subtitle={
                    <span className="text-ludo-xs font-mono uppercase tracking-[0.16em] text-ink-muted truncate">
                        Customize Callsign &amp; Pilot Emblem
                    </span>
                }
            >
                <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar px-4 sm:px-5 pt-3.5 pb-4 flex flex-col gap-4">
                    {/* Hero Live Badge Preview */}
                    <section className="rounded-2xl bg-surface-recessed border border-line-strong p-3.5 flex items-center gap-3.5">
                        <PilotAvatar
                            avatarUrl={previewAvatarUrl}
                            name={previewName}
                            size="xl"
                            tier={progression.tier}
                        />
                        <div className="flex-1 min-w-0 flex flex-col gap-1">
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-ludo-xs font-mono uppercase tracking-[0.18em] text-ink-faint">
                                    Live Badge Preview
                                </span>
                                <span className="px-2 py-0.5 rounded-full bg-surface-panel border border-line-soft text-ludo-xs font-mono font-bold text-accent shrink-0">
                                    Lv.{progression.level}
                                </span>
                            </div>
                            <div className="flex items-center gap-1.5 min-w-0">
                                <span className="text-ludo-lg font-extrabold text-ink-strong truncate">
                                    {previewName}
                                </span>
                                {profile?.clan_tag && (
                                    <span className="px-1.5 py-0.5 rounded-sm bg-accent-soft border border-accent/35 text-accent text-ludo-xs font-mono font-bold shrink-0">
                                        [{profile.clan_tag}]
                                    </span>
                                )}
                            </div>
                            <div className="flex items-center gap-1.5 flex-wrap text-ludo-xs font-bold">
                                <span className="inline-flex items-center gap-1 text-accent uppercase tracking-wider">
                                    <RankTierIcon tier={progression.tier} className="w-3.5 h-3.5 shrink-0" />
                                    <span>{progression.tier}</span>
                                </span>
                                {previewAvatarDef && (
                                    <>
                                        <span className="text-ink-faint" aria-hidden="true">·</span>
                                        <span className="text-ink-muted truncate">
                                            {previewAvatarDef.label}
                                            {previewAvatarDef.tagline ? ` · ${previewAvatarDef.tagline}` : ''}
                                        </span>
                                    </>
                                )}
                            </div>
                        </div>
                    </section>

                    {/* Callsign Field */}
                    <section className="flex flex-col gap-2">
                        <HudSectionLabel
                            right={
                                <span className="text-ludo-xs font-mono text-ink-faint tabular-nums">
                                    {draftName.trim().length}/{NAME_RULES.max}
                                </span>
                            }
                        >
                            Callsign
                        </HudSectionLabel>
                        <div className="rounded-2xl bg-surface-recessed border border-line-soft p-3 flex flex-col gap-1.5">
                            <input
                                value={draftName}
                                onChange={(e) => {
                                    setDraftName(e.target.value);
                                    if (saveError) setSaveError(null);
                                }}
                                maxLength={NAME_RULES.max}
                                placeholder={finalName}
                                autoComplete="off"
                                autoCorrect="off"
                                autoCapitalize="none"
                                spellCheck={false}
                                className="w-full bg-surface-panel border border-line-soft rounded-xl px-3.5 py-2.5 text-ludo-md font-bold text-ink-strong placeholder:text-ink-faint focus:outline-none focus:border-accent transition-colors"
                            />
                            <div className="flex items-center justify-between gap-2 px-0.5">
                                <span className="text-ludo-xs font-bold text-ink-faint">
                                    {NAME_RULES.help} · unique handle
                                </span>
                                {draftName.trim().length > 0 && !draftValidationErr && (
                                    <span className="text-ludo-xs font-bold text-positive shrink-0">
                                        Valid callsign
                                    </span>
                                )}
                            </div>
                            {(saveError || draftValidationErr) && (
                                <div className="text-ludo-sm font-bold text-negative px-0.5">
                                    {saveError || draftValidationErr}
                                </div>
                            )}
                        </div>
                    </section>

                    {/* Avatar Series & Picker */}
                    <section className="flex flex-col gap-2.5">
                        <div className="flex items-center justify-between gap-2">
                            <span className="text-ludo-xs font-bold uppercase tracking-[0.18em] text-ink-muted">
                                Avatar Series
                            </span>
                            <div className="flex items-center gap-1 bg-surface-recessed p-1 rounded-xl border border-line-soft">
                                {PLAYER_AVATAR_SERIES.map((series) => {
                                    const active = avatarSeries === series;
                                    return (
                                        <button
                                            key={series}
                                            type="button"
                                            onClick={() => setAvatarSeries(series)}
                                            className={`px-2.5 py-1 rounded-lg text-ludo-xs font-bold uppercase tracking-wider transition-colors capitalize cursor-pointer ${
                                                active
                                                    ? 'bg-accent-soft text-accent border border-accent/40'
                                                    : 'text-ink-faint hover:text-ink-strong border border-transparent'
                                            }`}
                                        >
                                            {series}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {avatarSeries === 'pilots' ? (
                            <div className="flex flex-col gap-3">
                                {/* Featured AAA Portraits */}
                                {featuredPilots.length > 0 && (
                                    <div className="flex flex-col gap-1.5">
                                        <span className="text-ludo-xs font-mono uppercase tracking-[0.16em] text-ink-faint px-0.5">
                                            Signature Portraits
                                        </span>
                                        <div className="grid grid-cols-2 gap-2">
                                            {featuredPilots.map((item) => {
                                                const selected = draftAvatarId === item.id;
                                                return (
                                                    <button
                                                        key={item.id}
                                                        type="button"
                                                        onClick={() => setDraftAvatarId(item.id)}
                                                        aria-label={item.label}
                                                        className={`relative rounded-2xl p-2.5 border transition-all flex items-center gap-2.5 text-left cursor-pointer ${
                                                            selected
                                                                ? 'bg-accent-soft/40 border-accent ring-2 ring-accent/40'
                                                                : 'bg-surface-recessed border-line-soft hover:border-line-strong'
                                                        }`}
                                                    >
                                                        <div className="w-14 h-14 rounded-full overflow-hidden border border-line-strong bg-surface-panel shrink-0">
                                                            {item.src && (
                                                                <img
                                                                    src={item.src}
                                                                    alt={item.label}
                                                                    className="w-full h-full object-cover"
                                                                    width={96}
                                                                    height={96}
                                                                />
                                                            )}
                                                        </div>
                                                        <div className="min-w-0 flex-1">
                                                            <div className="text-ludo-sm font-extrabold text-ink-strong uppercase tracking-wide truncate">
                                                                {item.label}
                                                            </div>
                                                            {item.tagline && (
                                                                <div className="text-ludo-xs font-bold text-ink-faint truncate mt-0.5">
                                                                    {item.tagline}
                                                                </div>
                                                            )}
                                                        </div>
                                                        {selected && (
                                                            <span className="absolute top-2 right-2 w-4 h-4 rounded-full bg-accent text-accent-ink flex items-center justify-center shadow">
                                                                <CheckGlyphIcon className="w-2.5 h-2.5" />
                                                            </span>
                                                        )}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}

                                {/* Custom 3077 Tactical Helmets Grid */}
                                <div className="flex flex-col gap-1.5">
                                    <span className="text-ludo-xs font-mono uppercase tracking-[0.16em] text-ink-faint px-0.5">
                                        3077 Pilot Helmets
                                    </span>
                                    <div className="grid grid-cols-4 gap-2">
                                        {helmetPilots.map((item) => {
                                            const { ok, hint } = isUnlocked(item, {
                                                wins,
                                                level: progression.level,
                                            });
                                            const selected = draftAvatarId === item.id;
                                            return (
                                                <button
                                                    key={item.id}
                                                    type="button"
                                                    disabled={!ok}
                                                    onClick={() => setDraftAvatarId(item.id)}
                                                    title={ok ? `${item.label}${item.tagline ? ` · ${item.tagline}` : ''}` : `${item.label} — ${hint}`}
                                                    aria-label={item.label}
                                                    className={`relative rounded-2xl p-1.5 border transition-all flex flex-col items-center gap-1.5 cursor-pointer ${
                                                        selected
                                                            ? 'bg-accent-soft/40 border-accent ring-2 ring-accent/45 scale-[1.02]'
                                                            : ok
                                                              ? 'bg-surface-recessed border-line-soft hover:border-line-strong'
                                                              : 'bg-surface-recessed border-line-soft opacity-45 cursor-not-allowed'
                                                    }`}
                                                >
                                                    <div className="w-full aspect-square rounded-xl overflow-hidden border border-line-soft bg-surface-panel">
                                                        {item.src && (
                                                            <img
                                                                src={item.src}
                                                                alt={item.label}
                                                                className="w-full h-full object-cover"
                                                                width={96}
                                                                height={96}
                                                            />
                                                        )}
                                                    </div>
                                                    <span className="text-ludo-xs font-extrabold uppercase tracking-wider text-ink-strong truncate w-full text-center leading-none pb-0.5">
                                                        {item.label}
                                                    </span>
                                                    {selected && (
                                                        <span className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-accent text-accent-ink flex items-center justify-center shadow">
                                                            <CheckGlyphIcon className="w-2.5 h-2.5" />
                                                        </span>
                                                    )}
                                                    {!ok && (
                                                        <span className="absolute inset-x-1 bottom-5 bg-surface-panel/90 text-ludo-xs font-bold text-warn text-center py-0.5 leading-none rounded border border-line-soft">
                                                            {hint}
                                                        </span>
                                                    )}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="grid grid-cols-3 gap-2">
                                {seriesAvatars.map((item) => {
                                    const { ok, hint } = isUnlocked(item, {
                                        wins,
                                        level: progression.level,
                                    });
                                    const selected = draftAvatarId === item.id;
                                    return (
                                        <button
                                            key={item.id}
                                            type="button"
                                            disabled={!ok}
                                            onClick={() => setDraftAvatarId(item.id)}
                                            title={ok ? item.label : `${item.label} — ${hint}`}
                                            aria-label={item.label}
                                            className={`relative rounded-2xl p-2.5 border transition-all flex flex-col items-center gap-2 cursor-pointer ${
                                                selected
                                                    ? 'bg-accent-soft/40 border-accent ring-2 ring-accent/45'
                                                    : ok
                                                      ? 'bg-surface-recessed border-line-soft hover:border-line-strong'
                                                      : 'bg-surface-recessed border-line-soft opacity-50 cursor-not-allowed'
                                            }`}
                                        >
                                            <span
                                                className={`w-12 h-12 rounded-full bg-gradient-to-tr ${item.bg} flex items-center justify-center font-extrabold text-ludo-xl border ${
                                                    item.series === 'trophy'
                                                        ? 'ring-2 ring-warn/80 border-warn/60'
                                                        : 'border-line-strong'
                                                }`}
                                                style={{ color: '#ffffff', textShadow: '0 1px 2px rgba(0, 0, 0, 0.45)' }}
                                            >
                                                {(previewName?.[0] || 'U').toUpperCase()}
                                            </span>
                                            <div className="w-full text-center min-w-0">
                                                <div className="text-ludo-xs font-extrabold text-ink-strong uppercase tracking-wider truncate">
                                                    {item.label}
                                                </div>
                                                <div className={`text-ludo-xs font-bold truncate mt-0.5 ${ok ? 'text-ink-faint' : 'text-warn'}`}>
                                                    {ok ? item.tagline || 'Unlocked' : hint}
                                                </div>
                                            </div>
                                            {selected && (
                                                <span className="absolute top-2 right-2 w-4 h-4 rounded-full bg-accent text-accent-ink flex items-center justify-center shadow">
                                                    <CheckGlyphIcon className="w-2.5 h-2.5" />
                                                </span>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </section>
                </div>

                {/* Pinned Save / Cancel Footer */}
                <div className="shrink-0 px-4 sm:px-5 py-3 border-t border-line-soft bg-surface-panel/90 flex gap-2.5">
                    <Button
                        variant="secondary"
                        size="md"
                        onClick={() => setEditing(false)}
                        disabled={saving}
                        className="flex-1"
                    >
                        Cancel
                    </Button>
                    <Button
                        variant="primary"
                        size="md"
                        onClick={saveIdentity}
                        loading={saving}
                        disabled={saving || !draftName.trim() || !!draftValidationErr}
                        className="flex-1"
                    >
                        {saving ? 'Saving…' : 'Save Identity'}
                    </Button>
                </div>
            </GamePanelShell>
        )}
        </>
    );
}
