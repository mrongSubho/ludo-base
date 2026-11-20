"use client";

import React, { useState } from 'react';
import type { BotDifficulty } from '@/lib/types';
import { GamePanelShell } from './GamePanelShell';
import { Button } from './Button';
import { Chip } from './Chip';
import { HudSectionLabel } from './HudPrimitives';
import { SimBotIcon } from './icons';

// ─── Semantic contract (holds for 3077, Retro Night, and Daybreak) ──────────
// Surfaces, borders, and inks derive from CSS semantic tokens inside GamePanelShell.

const OfflineTile = () => (
    <div className="hud-chamfer-sm w-6 h-6 rounded-lg bg-accent-soft border border-accent/35 flex items-center justify-center">
        <SimBotIcon className="w-3.5 h-3.5 text-accent" />
    </div>
);

const DIFFICULTY_THREAT: Record<BotDifficulty, number> = {
    rookie: 1,
    pro: 2,
    master: 3,
};

interface OfflineMatchPanelProps {
    gameMode: 'classic' | 'power';
    matchType: '1v1' | '2v2' | '4P';
    onClose: () => void;
    onStartOfflineGame: (difficulty: BotDifficulty) => void;
    /** G2 — one-device hot-seat (all humans, no AI). */
    onStartPassAndPlay?: () => void;
}

const DIFFICULTY_BLURB: Record<BotDifficulty, string> = {
    rookie: 'Relaxed · learns with you',
    pro: 'Sharp · the classic duel',
    master: 'Ruthless · hunts captures',
};

export const OfflineMatchPanel = ({
    gameMode,
    matchType,
    onClose,
    onStartOfflineGame,
    onStartPassAndPlay,
}: OfflineMatchPanelProps) => {
    const [difficulty, setDifficulty] = useState<BotDifficulty>('pro');
    const [mode, setMode] = useState<'ai' | 'pass'>('ai');
    const aiCount = (matchType === '1v1' ? 2 : 4) - 1;
    const seatTotal = matchType === '1v1' ? 2 : 4;

    return (
        <GamePanelShell
            scopeClass="ludo-offline-scope"
            kicker="// PRACTICE & LOCAL"
            title={(
                <span className="inline-flex items-center gap-2">
                    <OfflineTile />
                    <span>Offline Play</span>
                </span>
            )}
            subtitle={(
                <span className="inline-flex items-center gap-2 uppercase tracking-wide">
                    <span className="font-bold text-ink-muted">
                        {gameMode} • {matchType}
                    </span>
                    <span className="w-1 h-1 rounded-full bg-line-strong" />
                    <span className="font-bold text-accent">
                        {mode === 'pass' ? `${seatTotal} × Human` : `${aiCount} × AI`}
                    </span>
                </span>
            )}
            onClose={onClose}
            hideOrbs
        >
            {/* Content Area */}
            <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar px-5 pt-3 pb-4 relative z-10 flex flex-col gap-2">
                <HudSectionLabel className="mt-1 mb-1">Mode</HudSectionLabel>
                <div className="grid grid-cols-2 gap-1.5">
                    <Chip
                        type="filter"
                        size="sm"
                        active={mode === 'ai'}
                        onClick={() => setMode('ai')}
                        className="min-h-[52px] flex-1 justify-center rounded-xl uppercase tracking-[0.12em]"
                    >
                        vs AI
                    </Chip>
                    <Chip
                        type="filter"
                        size="sm"
                        active={mode === 'pass'}
                        disabled={!onStartPassAndPlay}
                        onClick={() => setMode('pass')}
                        className="min-h-[52px] flex-1 justify-center rounded-xl uppercase tracking-[0.12em]"
                    >
                        Pass &amp; Play
                    </Chip>
                </div>
                <p className="text-ludo-xs text-ink-muted px-0.5 -mt-0.5">
                    {mode === 'pass'
                        ? 'Same device · take turns · no bots · free'
                        : `Fill ${aiCount} seat${aiCount > 1 ? 's' : ''} with AI · Free`}
                </p>

                {mode === 'ai' && (
                    <>
                        <HudSectionLabel className="mt-1 mb-1">Setup</HudSectionLabel>
                        <div className="p-4 rounded-2xl bg-surface-panel border border-line-soft flex flex-col gap-3">
                            <div className="flex justify-between items-center text-xs font-extrabold uppercase tracking-[0.2em] text-ink-faint">
                                <span>Opponents</span>
                                <span className="text-accent">{aiCount} × AI • Free</span>
                            </div>
                            <div className="flex gap-1.5">
                                {(['rookie', 'pro', 'master'] as const).map(d => {
                                    const threat = DIFFICULTY_THREAT[d];
                                    const active = difficulty === d;
                                    return (
                                        <Chip
                                            key={d}
                                            type="filter"
                                            size="sm"
                                            active={active}
                                            onClick={() => setDifficulty(d)}
                                            className="min-h-[44px] flex-1 justify-center rounded-xl uppercase tracking-[0.12em] lowercase first-letter:uppercase gap-1.5"
                                        >
                                            <span>{d}</span>
                                            <span className="inline-flex items-end gap-[2px]" aria-hidden="true">
                                                {[1, 2, 3].map((lvl) => (
                                                    <span
                                                        key={lvl}
                                                        className={`w-[2.5px] rounded-[1px] ${
                                                            lvl === 1 ? 'h-1.5' : lvl === 2 ? 'h-2.5' : 'h-3'
                                                        } ${
                                                            lvl <= threat
                                                                ? d === 'master'
                                                                    ? 'bg-warn'
                                                                    : active
                                                                      ? 'bg-accent'
                                                                      : 'bg-accent/70'
                                                                : 'bg-line-strong'
                                                        }`}
                                                    />
                                                ))}
                                            </span>
                                        </Chip>
                                    );
                                })}
                            </div>
                            <p className="text-ludo-xs font-bold text-ink-faint text-center tracking-wide">
                                {DIFFICULTY_BLURB[difficulty]}
                            </p>
                        </div>

                        <div className="flex flex-col gap-4 text-center px-4 py-10">
                            <p className="text-ink-muted text-sm font-bold leading-relaxed">
                                Practice your strategy or play casually against AI opponents. Offline matches do not require a network connection or entry fee.
                            </p>
                        </div>
                    </>
                )}

                {mode === 'pass' && (
                    <div className="flex flex-col gap-4 text-center px-4 py-10">
                        <p className="text-ink-muted text-sm font-bold leading-relaxed">
                            Pass &amp; Play — {seatTotal} humans share this device. Hand off after each turn. No bots, no network, no entry fee.
                        </p>
                        <p className="text-ludo-xs text-ink-faint">
                            Want a remote table? Use an invite link instead.
                        </p>
                    </div>
                )}
            </div>

            {/* Footer Action */}
            <div className="px-5 pt-3 pb-5 border-t border-line-soft relative z-10 shrink-0">
                <Button
                    variant="primary"
                    size="lg"
                    fullWidth
                    onClick={() => {
                        if (mode === 'pass') onStartPassAndPlay?.();
                        else onStartOfflineGame(difficulty);
                    }}
                    className="uppercase tracking-[0.2em]"
                >
                    {mode === 'pass' ? 'Start Pass & Play' : 'Start Offline Match'}
                </Button>
            </div>
        </GamePanelShell>
    );
};
