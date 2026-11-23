'use client';

import React, { useEffect, useState } from 'react';
import { TEAM_PAIRINGS } from '@/lib/constants';
import { seatedColorsFor } from '@/lib/engine/core';
import { getSoundEngine } from '@/lib/audio/SoundEngine';
import { type DeployModeId, useDeployTheme } from '@/lib/deployTheme';
import { onReducedMotionChange, prefersReducedMotion } from '@/lib/motion';
import { ClassicGridIcon, OverdriveBoltIcon } from './icons';
import type { LobbyGameMode, LobbyMatchType } from './LobbyCommandDeck';

export const DAYBREAK_MODE_ORDER: readonly LobbyGameMode[] = ['power', 'classic'] as const;
export const DAYBREAK_FORMATION_ORDER: readonly LobbyMatchType[] = ['1v1', '2v2', '4P'] as const;

export const DAYBREAK_PALETTES: Record<
    DeployModeId,
    { hex: string; rgb: string; deep: string; tint: string }
> = {
    quick: { hex: '#0D6D87', rgb: '13, 109, 135', deep: '#0A586D', tint: 'rgba(13, 109, 135, 0.10)' },
    team: { hex: '#B45309', rgb: '180, 83, 9', deep: '#92400E', tint: 'rgba(180, 83, 9, 0.10)' },
    offline: { hex: '#166534', rgb: '22, 101, 52', deep: '#14532D', tint: 'rgba(22, 101, 52, 0.10)' },
};

const FORMATION_META: Record<LobbyMatchType, string> = {
    '1v1': '2P Diagonal Duel',
    '2v2': '2v2 Squad Pairs',
    '4P': '4P Free-for-All',
};

const MINERAL_SEAT_HEX: Record<'green' | 'red' | 'blue' | 'yellow', string> = {
    green: '#16A34A',
    red: '#DC2626',
    blue: '#2563EB',
    yellow: '#D97706',
};

interface DaybreakStudioDeckProps {
    gameMode: LobbyGameMode;
    onChangeGameMode: (mode: LobbyGameMode) => void;
    matchType: LobbyMatchType;
    onChangeMatchType: (type: LobbyMatchType) => void;
    sfxEnabled: boolean;
    hapticsEnabled: boolean;
    feeDock: React.ReactNode;
}

/** Architectural miniature corner-board schematic driven by seatedColorsFor + TEAM_PAIRINGS. */
function DaybreakFormationGlyph({
    type,
    active,
}: {
    type: LobbyMatchType;
    active: boolean;
}) {
    const seated = new Set(seatedColorsFor(type));
    const pairAB = `${TEAM_PAIRINGS.green[0]}+${TEAM_PAIRINGS.green[1]}`;
    const pairCD = `${TEAM_PAIRINGS.red[0]}+${TEAM_PAIRINGS.red[1]}`;
    const isTeam = type === '2v2' && pairAB !== pairCD;

    const nodes: { color: 'green' | 'red' | 'yellow' | 'blue'; cx: number; cy: number }[] = [
        { color: 'red', cx: 6, cy: 6 },
        { color: 'yellow', cx: 18, cy: 6 },
        { color: 'green', cx: 6, cy: 18 },
        { color: 'blue', cx: 18, cy: 18 },
    ];

    return (
        <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" aria-hidden="true">
            <rect
                x="1.5"
                y="1.5"
                width="21"
                height="21"
                rx="4"
                fill="none"
                stroke={active ? 'rgba(28, 25, 23, 0.22)' : 'rgba(28, 25, 23, 0.12)'}
                strokeWidth="1.2"
            />
            {isTeam ? (
                <>
                    <line
                        x1="6"
                        y1="18"
                        x2="18"
                        y2="18"
                        stroke={active ? MINERAL_SEAT_HEX.green : 'rgba(28, 25, 23, 0.24)'}
                        strokeWidth="1.4"
                        strokeLinecap="round"
                    />
                    <line
                        x1="6"
                        y1="6"
                        x2="18"
                        y2="6"
                        stroke={active ? MINERAL_SEAT_HEX.red : 'rgba(28, 25, 23, 0.24)'}
                        strokeWidth="1.4"
                        strokeLinecap="round"
                    />
                </>
            ) : type === '1v1' ? (
                <line
                    x1="6"
                    y1="18"
                    x2="18"
                    y2="6"
                    stroke="rgba(28, 25, 23, 0.22)"
                    strokeWidth="1.2"
                    strokeDasharray="2 2"
                />
            ) : null}
            {nodes.map((n) => {
                const isSeated = seated.has(n.color);
                return (
                    <circle
                        key={n.color}
                        cx={n.cx}
                        cy={n.cy}
                        r={isSeated ? 2.5 : 1.3}
                        fill={
                            isSeated
                                ? active
                                    ? MINERAL_SEAT_HEX[n.color]
                                    : 'rgba(24, 24, 27, 0.56)'
                                : 'rgba(24, 24, 27, 0.16)'
                        }
                    />
                );
            })}
        </svg>
    );
}

/**
 * Daybreak Tactile Studio Porcelain Lobby Plinth.
 * Unifies Ruleset ceramic rocker (`POWER` first + default), machined Formation
 * keycaps (`1v1`, `2v2`, `4P`), and docked Entry Fee capsule on warm alabaster stone.
 */
export function DaybreakStudioDeck({
    gameMode,
    onChangeGameMode,
    matchType,
    onChangeMatchType,
    sfxEnabled,
    hapticsEnabled,
    feeDock,
}: DaybreakStudioDeckProps) {
    const { mode: deployMode } = useDeployTheme();
    const palette = DAYBREAK_PALETTES[deployMode] ?? DAYBREAK_PALETTES.quick;
    const [reducedMotion, setReducedMotion] = useState(false);

    useEffect(() => {
        const raf = window.requestAnimationFrame(() => setReducedMotion(prefersReducedMotion()));
        const unsubscribe = onReducedMotionChange(setReducedMotion);
        return () => {
            window.cancelAnimationFrame(raf);
            unsubscribe();
        };
    }, []);

    const selectMode = (next: LobbyGameMode) => {
        if (next === gameMode) return;
        if (sfxEnabled) {
            getSoundEngine().play('ui_knob_tick', { tierIndex: next === 'power' ? 6 : 3 });
        }
        if (hapticsEnabled) {
            getSoundEngine().triggerHaptic(6);
        }
        onChangeGameMode(next);
    };

    const selectFormation = (next: LobbyMatchType) => {
        if (next === matchType) return;
        if (sfxEnabled) {
            const tierIndex = next === '1v1' ? 2 : next === '2v2' ? 4 : 6;
            getSoundEngine().play('ui_knob_tick', { tierIndex });
        }
        if (hapticsEnabled) {
            getSoundEngine().triggerHaptic(6);
        }
        onChangeMatchType(next);
    };

    return (
        <div
            className="daybreak-studio-plate w-full rounded-2xl p-3 flex flex-col gap-2.5 border"
            style={{
                background: 'linear-gradient(180deg, #FFFFFF 0%, #FAF8F3 100%)',
                borderColor: 'rgba(28, 25, 23, 0.11)',
                boxShadow:
                    '0 16px 36px -14px rgba(28, 25, 23, 0.16), inset 0 1px 0 #FFFFFF',
            }}
        >
            {/* Section 1: Ruleset Ceramic Rocker (POWER first) */}
            <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between px-1 gap-2">
                    <span className="text-ludo-xs font-bold uppercase tracking-[0.18em] text-ink-faint">
                        Ruleset
                    </span>
                    <span
                        className="text-ludo-xs font-bold tracking-wide"
                        style={{ color: palette.deep }}
                    >
                        {gameMode === 'power' ? '6 Power Tiles · Boosts' : 'Pure Classic Rules'}
                    </span>
                </div>

                <div
                    role="radiogroup"
                    aria-label="Select Game Mode"
                    className="relative rounded-xl p-1 grid grid-cols-2"
                    style={{
                        background: '#EAE5DC',
                        boxShadow:
                            'inset 0 2px 5px rgba(28, 25, 23, 0.10), inset 0 -1px 0 rgba(255, 255, 255, 0.85)',
                    }}
                >
                    {/* Sliding raised matte-white ceramic keycap */}
                    <div
                        aria-hidden="true"
                        className="pointer-events-none absolute top-1 bottom-1 left-1 w-[calc(50%-4px)] rounded-lg border"
                        style={{
                            transform: `translateX(${gameMode === 'power' ? '0%' : '100%'})`,
                            transition: reducedMotion
                                ? 'none'
                                : 'transform 190ms cubic-bezier(0.22, 1, 0.36, 1)',
                            background: 'linear-gradient(180deg, #FFFFFF 0%, #FBF9F5 100%)',
                            borderColor: `rgba(${palette.rgb}, 0.36)`,
                            boxShadow:
                                '0 3px 8px rgba(28, 25, 23, 0.12), inset 0 1px 0 #FFFFFF',
                        }}
                    />

                    {DAYBREAK_MODE_ORDER.map((mode) => {
                        const selected = gameMode === mode;
                        return (
                            <button
                                key={mode}
                                type="button"
                                role="radio"
                                aria-checked={selected}
                                onClick={() => selectMode(mode)}
                                className="relative z-10 min-h-[38px] flex items-center justify-center gap-1.5 px-2 text-ludo-sm font-extrabold uppercase tracking-[0.14em] transition-colors cursor-pointer"
                                style={{
                                    color: selected ? palette.deep : 'var(--ink-muted)',
                                }}
                            >
                                {mode === 'power' ? (
                                    <OverdriveBoltIcon className="w-3.5 h-3.5 shrink-0" active={selected} />
                                ) : (
                                    <ClassicGridIcon className="w-3.5 h-3.5 shrink-0" active={selected} />
                                )}
                                <span>{mode}</span>
                                <span
                                    aria-hidden="true"
                                    className="w-1.5 h-1.5 rounded-full shrink-0"
                                    style={{
                                        backgroundColor: selected
                                            ? palette.hex
                                            : 'rgba(28, 25, 23, 0.20)',
                                    }}
                                />
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Section 2: Machined Formation Keycaps */}
            <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between px-1 gap-2">
                    <span className="text-ludo-xs font-bold uppercase tracking-[0.18em] text-ink-faint">
                        Formation
                    </span>
                    <span
                        className="text-ludo-xs font-bold tracking-wide"
                        style={{ color: palette.deep }}
                    >
                        {FORMATION_META[matchType]}
                    </span>
                </div>

                <div
                    role="radiogroup"
                    aria-label="Match Type"
                    className="rounded-xl p-1 grid grid-cols-3 gap-1.5"
                    style={{
                        background: '#EAE5DC',
                        boxShadow:
                            'inset 0 2px 5px rgba(28, 25, 23, 0.10), inset 0 -1px 0 rgba(255, 255, 255, 0.85)',
                    }}
                >
                    {DAYBREAK_FORMATION_ORDER.map((type) => {
                        const active = matchType === type;
                        return (
                            <button
                                key={type}
                                type="button"
                                role="radio"
                                aria-checked={active}
                                onClick={() => selectFormation(type)}
                                className="relative min-h-[52px] rounded-lg border flex flex-col items-center justify-center gap-1 cursor-pointer active:scale-[0.98] transition-[background-color,border-color,transform]"
                                style={{
                                    background: active
                                        ? 'linear-gradient(180deg, #FFFFFF 0%, #FBF9F5 100%)'
                                        : '#F6F3EC',
                                    borderColor: active
                                        ? `rgba(${palette.rgb}, 0.42)`
                                        : 'rgba(28, 25, 23, 0.08)',
                                    boxShadow: active
                                        ? '0 3px 8px rgba(28, 25, 23, 0.11), inset 0 1px 0 #FFFFFF'
                                        : 'inset 0 1px 0 rgba(255, 255, 255, 0.72)',
                                    color: active ? palette.deep : 'var(--ink-muted)',
                                }}
                            >
                                <span
                                    aria-hidden="true"
                                    className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full"
                                    style={{
                                        backgroundColor: active
                                            ? palette.hex
                                            : 'rgba(28, 25, 23, 0.16)',
                                    }}
                                />
                                <DaybreakFormationGlyph type={type} active={active} />
                                <span className="text-ludo-sm font-extrabold tracking-tight leading-none">
                                    {type}
                                </span>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Section 3: Docked Entry Fee Capsule */}
            {feeDock}
        </div>
    );
}
