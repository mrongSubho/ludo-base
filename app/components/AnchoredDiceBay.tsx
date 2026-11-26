"use client";

import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { Corner, PlayerColor } from '@/lib/types';
import {
    DOT_POSITIONS,
    resolveDiceThemeId,
    type DiceFaceNumber,
    type DiceThemeId,
    type TurnRollEntry,
} from '@/lib/diceVisuals';
import { usePreferences } from '@/hooks/usePreferences';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import LudoDice from './LudoDice';

interface AnchoredDiceBayProps {
    color: PlayerColor;
    corner: Corner;
    side: 'left' | 'right';
    rowEdge: 'top' | 'bottom';
    canRoll: boolean;
    isRolling: boolean;
    diceValue: number | null;
    boostActive: boolean;
    boostPendingDice?: number | null;
    bustKey: number;
    turnRolls: TurnRollEntry[];
    dangerSixes: boolean;
    onRoll: () => void;
}

/**
 * Iconic Tethered Launch Dock coupling the player's avatar to a theme-sculpted
 * 3D dice well, with an exposed inner chamber during breakout rolls, a Dual-Core
 * `+6` overdrive wing when Boost is armed, and a turn-wide roll history strip.
 */
export function AnchoredDiceBay({
    color,
    corner,
    side,
    rowEdge,
    canRoll,
    isRolling,
    diceValue,
    boostActive,
    boostPendingDice = null,
    bustKey,
    turnRolls,
    dangerSixes,
    onRoll,
}: AnchoredDiceBayProps) {
    const { preferences } = usePreferences();
    const themeId = resolveDiceThemeId(preferences.theme);
    const [isAirborne, setIsAirborne] = useState(false);
    const reduced = useReducedMotion();
    const hasQueuedBoostFace =
        boostPendingDice !== null &&
        boostPendingDice !== undefined &&
        Number.isInteger(boostPendingDice) &&
        boostPendingDice >= 1 &&
        boostPendingDice <= 6;
    const showOverdriveWing = boostActive || hasQueuedBoostFace;
    const wingFace = (hasQueuedBoostFace ? boostPendingDice : 6) as DiceFaceNumber;

    return (
        <div
            className={`dice-bay-assembly dice-bay-side-${side} dice-bay-row-${rowEdge} ${canRoll ? 'is-ready' : ''} ${isRolling || isAirborne ? 'is-rolling' : ''} ${showOverdriveWing ? 'is-boosted' : ''}`}
            data-seat-color={color}
            data-dice-theme={themeId}
        >
            {/* Full Turn-Roll History Strip ([6][6][4]) aligned toward avatar edge */}
            {turnRolls.length > 0 && (
                <div
                    className={`dice-streak-strip ${dangerSixes ? 'is-danger' : ''}`}
                    aria-label={`Turn rolls: ${turnRolls.map((r) => r.value).join(', ')}`}
                    title={
                        dangerSixes
                            ? 'Two sixes rolled — a third consecutive six busts your turn!'
                            : 'Rolls rolled this turn'
                    }
                >
                    {turnRolls.map((entry) => (
                        <span
                            key={entry.id}
                            className={`dice-streak-pip ${entry.boosted ? 'is-boosted-pip' : ''}`}
                            aria-hidden="true"
                        >
                            <svg viewBox="0 0 100 100" className="w-full h-full">
                                {DOT_POSITIONS[entry.value].map(([cx, cy], idx) => (
                                    <circle key={idx} cx={cx} cy={cy} r="10.5" fill="currentColor" />
                                ))}
                            </svg>
                        </span>
                    ))}
                </div>
            )}

            {/* Physical Tether Bridge fusing bay housing smoothly onto the avatar edge */}
            <TetherBridge themeId={themeId} side={side} />

            {/* Sculpted Main Dice Bay & Recessed Empty Well */}
            <div className={`dice-bay ${isAirborne ? 'is-well-exposed' : ''}`}>
                <DiceBayWell themeId={themeId} active={canRoll || isAirborne} airborne={isAirborne} />
                <LudoDice
                    key={color}
                    onRoll={onRoll}
                    disabled={!canRoll}
                    currentValue={diceValue}
                    isRolling={isRolling}
                    activeColor={color}
                    corner={corner}
                    boostActive={boostActive}
                    bustKey={bustKey}
                    onAirborneChange={setIsAirborne}
                />
            </div>

            {/* Dual-Core +6 Overdrive Companion Core (mounted on outer bay flank when Boost armed or queued) */}
            <AnimatePresence>
                {showOverdriveWing && (
                    <motion.div
                        key="overdrive-wing"
                        className={`dice-bay-overdrive ${hasQueuedBoostFace ? 'is-queued' : ''}`}
                        initial={reduced ? { opacity: 1 } : { opacity: 0, scale: 0.72, x: side === 'left' ? -10 : 10 }}
                        animate={{ opacity: 1, scale: 1, x: 0 }}
                        exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.72, x: side === 'left' ? -8 : 8 }}
                        transition={{ duration: reduced ? 0.01 : 0.2, ease: 'easeOut' }}
                        aria-label={hasQueuedBoostFace ? `Queued roll ${wingFace} after Boost 6` : '+6 Boost Overdrive armed'}
                    >
                        <span className="dice-bay-overdrive-coupler" aria-hidden="true" />
                        <div className="dice-bay-overdrive-core">
                            <svg viewBox="0 0 100 100" className="dice-bay-overdrive-pips" aria-hidden="true">
                                {DOT_POSITIONS[wingFace].map(([cx, cy], idx) => (
                                    <circle key={idx} cx={cx} cy={cy} r="10" fill="currentColor" />
                                ))}
                            </svg>
                        </div>
                        <span className="dice-bay-overdrive-tag">{hasQueuedBoostFace ? 'NEXT' : '+6'}</span>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

function TetherBridge({ themeId, side }: { themeId: DiceThemeId; side: 'left' | 'right' }) {
    return (
        <span className={`dice-bay-tether side-${side}`} aria-hidden="true">
            {themeId === '3077' ? (
                <svg viewBox="0 0 18 28" className="w-full h-full" fill="none">
                    <path d="M1 4H17V24H1Z" className="dice-tether-body" />
                    <path d="M1 7H17M1 21H17" className="dice-tether-stroke" strokeWidth="1.6" />
                    <path d="M3 14H15" className="dice-tether-accent" strokeWidth="2.2" strokeLinecap="round" />
                </svg>
            ) : themeId === 'daybreak' ? (
                <svg viewBox="0 0 18 28" className="w-full h-full" fill="none">
                    <path d="M0 3C6 5 12 5 18 3V25C12 23 6 23 0 25Z" className="dice-tether-body" />
                    <line x1="3" y1="14" x2="15" y2="14" className="dice-tether-accent" strokeWidth="2" strokeLinecap="round" />
                </svg>
            ) : (
                <svg viewBox="0 0 18 28" className="w-full h-full" fill="none">
                    <path d="M0 4C6 7 12 7 18 4V24C12 21 6 21 0 24Z" className="dice-tether-body" />
                    <path d="M2 8C7 10 11 10 16 8M2 20C7 18 11 18 16 20" className="dice-tether-accent" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
            )}
        </span>
    );
}

function DiceBayWell({
    themeId,
    active,
    airborne,
}: {
    themeId: DiceThemeId;
    active: boolean;
    airborne: boolean;
}) {
    return (
        <span
            className={`dice-bay-well ${active ? 'is-active' : ''} ${airborne ? 'is-airborne' : ''}`}
            aria-hidden="true"
        >
            {themeId === '3077' ? (
                <svg viewBox="0 0 48 48" className="w-full h-full" fill="none">
                    <polygon
                        points="24,4 42,14 42,34 24,44 6,34 6,14"
                        className="dice-well-stroke dice-bay-well-spin"
                        strokeWidth="1.3"
                        strokeDasharray="6 4"
                    />
                    <circle cx="24" cy="24" r="9" className="dice-well-core" strokeWidth="1.4" />
                    <circle cx="24" cy="24" r="2.2" className="dice-well-pin" />
                </svg>
            ) : themeId === 'daybreak' ? (
                <svg viewBox="0 0 48 48" className="w-full h-full" fill="none">
                    <circle cx="24" cy="24" r="18" className="dice-well-dish" />
                    <circle cx="24" cy="24" r="14" className="dice-well-stroke" strokeWidth="1.2" strokeDasharray="3 3" />
                    <circle cx="24" cy="24" r="4" className="dice-well-core" strokeWidth="1.1" />
                </svg>
            ) : (
                <svg viewBox="0 0 48 48" className="w-full h-full" fill="none">
                    <circle
                        cx="24"
                        cy="24"
                        r="18"
                        className="dice-well-stroke dice-bay-well-spin"
                        strokeWidth="1.6"
                        strokeDasharray="4 4.5"
                    />
                    <circle cx="24" cy="24" r="11" className="dice-well-core" strokeWidth="1.2" />
                    <circle cx="24" cy="24" r="2.5" className="dice-well-pin" />
                </svg>
            )}
        </span>
    );
}
