'use client';

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { LuMinus, LuPlus } from 'react-icons/lu';
import {
    DIAL_MIN_DEG,
    DIAL_SWEEP_DEG,
    DIAL_TICK_COUNT,
    ENTRY_FEE_TIERS,
    HIGH_ROLLER_MIN_WAGER,
    angleToTierIndex,
    formatDialTierLabel,
    getEntryFeeTierName,
    pointerToDialAngle,
    stepTier,
    tierIndexToAngle,
    wagerToAngle,
} from '@/lib/entryFeeDial';
import { onReducedMotionChange, prefersReducedMotion } from '@/lib/motion';

interface EntryFeeKnobProps {
    wager: number;
    playableChips: number;
    gameMode?: 'classic' | 'power';
    onChange: (nextWager: number) => void;
    sfxEnabled: boolean;
    formatBalance: (val: number) => string;
}

const CX = 140;
const CY = 118;
const R_TICK_IN_MINOR = 81;
const R_TICK_OUT_MINOR = 88;
const R_TICK_IN_MAJOR = 78.5;
const R_TICK_OUT_MAJOR = 90.5;
const R_LABEL = 104;
const MAX_CUSTOM_WAGER = ENTRY_FEE_TIERS[ENTRY_FEE_TIERS.length - 1];

let sharedAudioCtx: AudioContext | null = null;

function playDetentClick(tierIndex: number, sfxEnabled: boolean): void {
    if (!sfxEnabled || typeof window === 'undefined') return;
    try {
        const Ctor =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        if (!sharedAudioCtx) sharedAudioCtx = new Ctor();
        const ctx = sharedAudioCtx;
        if (ctx.state === 'suspended') {
            void ctx.resume().catch(() => undefined);
        }

        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const freq = 420 + tierIndex * 60;
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now);
        osc.frequency.exponentialRampToValueAtTime(freq * 0.65, now + 0.018);

        gain.gain.setValueAtTime(0.065, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.02);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.022);
    } catch {
        /* ignore audio failures under browser autoplay policy */
    }
}

function triggerDetentHaptic(): void {
    try {
        if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
            navigator.vibrate(5);
        }
    } catch {
        /* vibration unsupported */
    }
}

function polarPoint(radius: number, angleDeg: number): { x: number; y: number } {
    const rad = (angleDeg * Math.PI) / 180;
    return {
        x: Number((CX + Math.sin(rad) * radius).toFixed(2)),
        y: Number((CY - Math.cos(rad) * radius).toFixed(2)),
    };
}

/**
 * Futuristic Ludo 3077 rotary volume-control dial for Entry Fee selection.
 * Lets players spin freely across all 10 named tiers (`SCOUT` -> `APEX`),
 * turning the dial and selected amount blinking red when over `playableChips`.
 */
export function EntryFeeKnob({
    wager,
    playableChips,
    gameMode = 'classic',
    onChange,
    sfxEnabled,
    formatBalance,
}: EntryFeeKnobProps) {
    const uid = useId().replace(/:/g, '');
    const svgRef = useRef<SVGSVGElement | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);

    const [reducedMotion, setReducedMotion] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [draftValue, setDraftValue] = useState(String(wager));

    const currentAngle = wagerToAngle(wager);
    const lastAngleRef = useRef(currentAngle);
    lastAngleRef.current = currentAngle;
    const lastWagerRef = useRef(wager);
    lastWagerRef.current = wager;

    useEffect(() => {
        setReducedMotion(prefersReducedMotion());
        return onReducedMotionChange(setReducedMotion);
    }, []);

    useEffect(() => {
        if (!isEditing) setDraftValue(String(wager));
    }, [wager, isEditing]);

    useEffect(() => {
        if (isEditing && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [isEditing]);

    const isUnaffordable = wager > 0 && wager > playableChips;
    const isHighRoller = wager >= HIGH_ROLLER_MIN_WAGER;
    const isPaid = wager > 0;

    const isPowerMode = gameMode === 'power';
    const activeHex = isUnaffordable
        ? '#f43f5e'
        : isHighRoller || (isPaid && isPowerMode)
          ? '#f59e0b'
          : isPaid
            ? '#00e5ff'
            : isPowerMode
              ? '#d97706'
              : '#94a3b8';

    const activeToneColor = isUnaffordable
        ? 'var(--negative)'
        : isHighRoller || (isPaid && isPowerMode)
          ? 'var(--warn)'
          : isPaid
            ? 'var(--accent)'
            : 'var(--ink-muted)';

    const emitTierChange = useCallback(
        (nextWager: number, tierIndexForAudio?: number) => {
            if (nextWager === lastWagerRef.current) return;
            lastWagerRef.current = nextWager;
            const resolvedIdx =
                tierIndexForAudio ??
                Math.max(
                    0,
                    ENTRY_FEE_TIERS.findIndex((t) => t >= nextWager),
                );
            playDetentClick(resolvedIdx, sfxEnabled);
            triggerDetentHaptic();
            onChange(nextWager);
        },
        [onChange, sfxEnabled],
    );

    const selectFromPointer = useCallback(
        (clientX: number, clientY: number) => {
            const svg = svgRef.current;
            if (!svg) return;
            const rect = svg.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return;

            const svgX = ((clientX - rect.left) / rect.width) * 280;
            const svgY = ((clientY - rect.top) / rect.height) * 216;
            const dx = svgX - CX;
            const dy = svgY - CY;

            const nextAngle = pointerToDialAngle(dx, dy, lastAngleRef.current);
            lastAngleRef.current = nextAngle;
            const idx = angleToTierIndex(nextAngle);
            emitTierChange(ENTRY_FEE_TIERS[idx], idx);
        },
        [emitTierChange],
    );

    const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
        if (isEditing) return;
        if ((e.target as Element).closest('[data-dial-tier]')) return;
        e.preventDefault();
        try {
            e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
            /* ignore if pointer capture unavailable */
        }
        setIsDragging(true);
        selectFromPointer(e.clientX, e.clientY);
    };

    const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
        if (!isDragging) return;
        selectFromPointer(e.clientX, e.clientY);
    };

    const handlePointerEnd = (e: React.PointerEvent<SVGSVGElement>) => {
        if (!isDragging) return;
        setIsDragging(false);
        try {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                e.currentTarget.releasePointerCapture(e.pointerId);
            }
        } catch {
            /* ignore */
        }
    };

    const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
        if (isEditing) return;
        e.preventDefault();
        const dir: -1 | 1 = e.deltaY < 0 || e.deltaX > 0 ? 1 : -1;
        emitTierChange(stepTier(wager, dir));
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (isEditing) return;
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
            e.preventDefault();
            emitTierChange(stepTier(wager, 1));
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
            e.preventDefault();
            emitTierChange(stepTier(wager, -1));
        } else if (e.key === 'Home') {
            e.preventDefault();
            emitTierChange(0, 0);
        } else if (e.key === 'End') {
            e.preventDefault();
            emitTierChange(MAX_CUSTOM_WAGER, ENTRY_FEE_TIERS.length - 1);
        } else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setIsEditing(true);
        }
    };

    const commitDraft = () => {
        const digits = draftValue.replace(/\D/g, '');
        const parsed = Math.max(0, parseInt(digits || '0', 10) || 0);
        const clamped = Math.min(parsed, MAX_CUSTOM_WAGER);
        setIsEditing(false);
        if (clamped !== wager) {
            emitTierChange(clamped);
        } else {
            setDraftValue(String(wager));
        }
    };

    const canStepDown = wager > 0;
    const canStepUp = wager < MAX_CUSTOM_WAGER;

    const isStandardTier = (ENTRY_FEE_TIERS as readonly number[]).includes(wager);
    const displayValue = isStandardTier
        ? formatDialTierLabel(wager)
        : wager.toLocaleString();
    const displaySizeClass =
        displayValue.length > 7
            ? 'text-ludo-sm'
            : displayValue.length > 5
              ? 'text-ludo-md'
              : 'text-xl';

    const tierName = getEntryFeeTierName(wager);

    return (
        <div
            className="knob-console-3077 w-full max-w-[336px] flex flex-col items-center"
            onWheel={handleWheel}
        >
            <div className="relative w-full flex items-center justify-center">
                {/* Left Stepper (-) */}
                <button
                    type="button"
                    disabled={!canStepDown}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => emitTierChange(stepTier(wager, -1))}
                    aria-label="Decrease entry fee"
                    className="fee-preset-3077 absolute left-0 top-1/2 -translate-y-1/2 z-20 w-11 h-11 bg-surface-recessed border border-line-soft flex items-center justify-center text-ink-strong hover:bg-surface-hover active:scale-95 transition-transform disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                >
                    <LuMinus className="w-4 h-4 stroke-[2.75px]" />
                </button>

                {/* Rotary Dial SVG + Stationary Center OLED Readout */}
                <div
                    role="slider"
                    tabIndex={0}
                    aria-label="Entry fee"
                    aria-valuemin={0}
                    aria-valuemax={MAX_CUSTOM_WAGER}
                    aria-valuenow={wager}
                    aria-valuetext={
                        wager === 0
                            ? `${tierName}, Free`
                            : `${tierName}, ${formatBalance(wager)} CHIPS`
                    }
                    onKeyDown={handleKeyDown}
                    className="relative w-full max-w-[224px] select-none rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                    <svg
                        ref={svgRef}
                        viewBox="0 0 280 216"
                        onPointerDown={handlePointerDown}
                        onPointerMove={handlePointerMove}
                        onPointerUp={handlePointerEnd}
                        onPointerCancel={handlePointerEnd}
                        style={{ touchAction: 'none' }}
                        className="w-full h-auto block cursor-grab active:cursor-grabbing"
                    >
                        <defs>
                            <linearGradient id={`knob-bezel-${uid}`} x1="0%" y1="0%" x2="100%" y2="100%">
                                <stop offset="0%" stopColor={isUnaffordable ? '#3b1520' : '#1e293b'} />
                                <stop offset="50%" stopColor={isUnaffordable ? '#210c14' : '#0e1520'} />
                                <stop offset="100%" stopColor="#06090f" />
                            </linearGradient>
                            <radialGradient id={`knob-face-${uid}`} cx="38%" cy="32%" r="72%">
                                <stop offset="0%" stopColor={isUnaffordable ? '#2f111b' : '#1c2533'} />
                                <stop offset="65%" stopColor={isUnaffordable ? '#190a10' : '#0c121b'} />
                                <stop offset="100%" stopColor="#070a10" />
                            </radialGradient>
                            <radialGradient id={`knob-dimple-${uid}`} cx="60%" cy="62%" r="65%">
                                <stop offset="0%" stopColor="#04060a" />
                                <stop offset="70%" stopColor="#0d141f" />
                                <stop offset="100%" stopColor="#263347" />
                            </radialGradient>
                            <radialGradient id={`knob-oled-${uid}`} cx="50%" cy="35%" r="70%">
                                <stop offset="0%" stopColor={isUnaffordable ? '#260b14' : '#0d1624'} />
                                <stop offset="100%" stopColor="#05080e" />
                            </radialGradient>
                        </defs>

                        {/* 1. Outer Radial Tick Arc (46 ticks over 270 deg) */}
                        <g aria-hidden="true">
                            {Array.from({ length: DIAL_TICK_COUNT }, (_, i) => {
                                const angle =
                                    DIAL_MIN_DEG + (i / (DIAL_TICK_COUNT - 1)) * DIAL_SWEEP_DEG;
                                const isMajor = i % 5 === 0;
                                const p1 = polarPoint(
                                    isMajor ? R_TICK_IN_MAJOR : R_TICK_IN_MINOR,
                                    angle,
                                );
                                const p2 = polarPoint(
                                    isMajor ? R_TICK_OUT_MAJOR : R_TICK_OUT_MINOR,
                                    angle,
                                );
                                const isLit = angle <= currentAngle + 0.5 && isPaid;
                                const isHighZone = angle >= tierIndexToAngle(6) - 0.5;

                                let stroke = 'rgba(241, 245, 249, 0.22)';
                                let opacity = isMajor ? 0.55 : 0.35;
                                if (isLit) {
                                    stroke = isUnaffordable
                                        ? '#f43f5e'
                                        : isHighZone
                                          ? '#f59e0b'
                                          : '#00e5ff';
                                    opacity = isMajor ? 1 : 0.85;
                                }

                                return (
                                    <line
                                        key={i}
                                        x1={p1.x}
                                        y1={p1.y}
                                        x2={p2.x}
                                        y2={p2.y}
                                        stroke={stroke}
                                        strokeWidth={isMajor ? 2 : 1.25}
                                        strokeLinecap="round"
                                        opacity={opacity}
                                    />
                                );
                            })}
                        </g>

                        {/* 2. Clickable Tier Labels Along Outer Arc (All 10 selectable) */}
                        <g>
                            {ENTRY_FEE_TIERS.map((tierVal, idx) => {
                                const angle = tierIndexToAngle(idx);
                                const pt = polarPoint(R_LABEL, angle);
                                const isSelected = wager === tierVal;
                                const isHighTier = tierVal >= HIGH_ROLLER_MIN_WAGER;
                                const overBalance = tierVal > 0 && tierVal > playableChips;

                                let fill = overBalance ? 'rgba(244, 63, 94, 0.52)' : '#94a3b8';
                                if (isSelected) {
                                    fill = overBalance
                                        ? '#fb7185'
                                        : isHighTier
                                          ? '#fbbf24'
                                          : '#00e5ff';
                                } else if (!overBalance && isHighTier) {
                                    fill = 'rgba(245, 158, 11, 0.78)';
                                }

                                return (
                                    <g
                                        key={tierVal}
                                        data-dial-tier={tierVal}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            emitTierChange(tierVal, idx);
                                        }}
                                        style={{ cursor: 'pointer' }}
                                    >
                                        <circle cx={pt.x} cy={pt.y} r="13" fill="transparent" pointerEvents="all" />
                                        <text
                                            x={pt.x}
                                            y={pt.y + 3}
                                            textAnchor="middle"
                                            fill={fill}
                                            fontSize="9.5"
                                            fontFamily="var(--font-mono)"
                                            fontWeight={isSelected ? '800' : '700'}
                                            letterSpacing="0.04em"
                                        >
                                            {formatDialTierLabel(tierVal)}
                                        </text>
                                    </g>
                                );
                            })}
                        </g>

                        {/* 3. Static Subtle Recessed Well Shadow */}
                        <circle
                            cx={CX}
                            cy={CY}
                            r="74"
                            fill="#04070c"
                            stroke={isUnaffordable ? 'rgba(244, 63, 94, 0.35)' : 'rgba(255, 255, 255, 0.08)'}
                            strokeWidth="1"
                        />

                        {/* 4. Rotating Titanium Knob Cap (strictly compositor transform: rotate) */}
                        <g
                            className="knob-rotor-3077"
                            style={{
                                transform: `rotate(${currentAngle}deg)`,
                                transformOrigin: `${CX}px ${CY}px`,
                                transition:
                                    isDragging || reducedMotion
                                        ? 'none'
                                        : 'transform 140ms cubic-bezier(0.2, 0, 0, 1)',
                            }}
                        >
                            {/* Outer chamfered bezel */}
                            <circle
                                cx={CX}
                                cy={CY}
                                r="71"
                                fill={`url(#knob-bezel-${uid})`}
                                stroke={
                                    isUnaffordable
                                        ? 'rgba(244, 63, 94, 0.78)'
                                        : isHighRoller
                                          ? 'rgba(245, 158, 11, 0.45)'
                                          : isPaid
                                            ? 'rgba(0, 229, 255, 0.38)'
                                            : 'rgba(255, 255, 255, 0.14)'
                                }
                                strokeWidth={isUnaffordable ? '1.6' : '1.25'}
                            />
                            {/* Knurled micro-serration track */}
                            <circle
                                cx={CX}
                                cy={CY}
                                r="67.5"
                                fill="none"
                                stroke={isUnaffordable ? 'rgba(244, 63, 94, 0.28)' : 'rgba(255, 255, 255, 0.16)'}
                                strokeWidth="2.2"
                                strokeDasharray="1.4 3.1"
                            />
                            {/* Inner machined disc */}
                            <circle
                                cx={CX}
                                cy={CY}
                                r="64"
                                fill={`url(#knob-face-${uid})`}
                                stroke="rgba(255, 255, 255, 0.06)"
                                strokeWidth="1"
                            />

                            {/* Laser index tick pointing out at 12 o'clock before rotation */}
                            <line
                                x1={CX}
                                y1={CY - 70}
                                x2={CX}
                                y2={CY - 63.5}
                                stroke={activeHex}
                                strokeWidth="2.4"
                                strokeLinecap="round"
                            />

                            {/* Recessed Tactile Thumb Dimple + Glowing Laser Pip */}
                            <circle
                                cx={CX}
                                cy={CY - 55}
                                r="5.6"
                                fill={`url(#knob-dimple-${uid})`}
                                stroke="rgba(255, 255, 255, 0.12)"
                                strokeWidth="0.75"
                            />
                            <circle
                                cx={CX}
                                cy={CY - 55}
                                r={isDragging ? 2.4 : 1.9}
                                fill={activeHex}
                            />
                        </g>

                        {/* 5. Stationary Center OLED Well Frame */}
                        <circle
                            cx={CX}
                            cy={CY}
                            r="45"
                            fill={`url(#knob-oled-${uid})`}
                            stroke={
                                isUnaffordable
                                    ? 'rgba(244, 63, 94, 0.65)'
                                    : isHighRoller
                                      ? 'rgba(245, 158, 11, 0.36)'
                                      : isPaid
                                        ? 'rgba(0, 229, 255, 0.3)'
                                        : 'rgba(255, 255, 255, 0.12)'
                            }
                            strokeWidth="1.25"
                        />
                    </svg>

                    {/* Stationary Center Interactive OLED Readout (pinned to SVG circle center 140,118) */}
                    <div
                        className="pointer-events-none absolute flex items-center justify-center"
                        style={{
                            top: '54.63%',
                            left: '50%',
                            transform: 'translate(-50%, -50%)',
                        }}
                    >
                        {isEditing ? (
                            <div
                                onPointerDown={(e) => e.stopPropagation()}
                                className={`pointer-events-auto w-[72px] h-[72px] rounded-full flex flex-col items-center justify-center px-1.5 bg-surface-page/90 border ${
                                    isUnaffordable ? 'border-negative' : 'border-accent'
                                }`}
                            >
                                <input
                                    ref={inputRef}
                                    type="text"
                                    inputMode="numeric"
                                    autoComplete="off"
                                    autoCorrect="off"
                                    autoCapitalize="none"
                                    spellCheck={false}
                                    aria-label="Custom entry fee in CHIPS"
                                    value={draftValue}
                                    onChange={(e) => setDraftValue(e.target.value.replace(/\D/g, ''))}
                                    onBlur={commitDraft}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            e.preventDefault();
                                            commitDraft();
                                        } else if (e.key === 'Escape') {
                                            e.preventDefault();
                                            setDraftValue(String(wager));
                                            setIsEditing(false);
                                        }
                                    }}
                                    className="w-full bg-transparent text-center text-ludo-md font-mono font-bold tabular-nums text-ink-strong focus:outline-none"
                                />
                                <span className="text-ludo-xs font-mono uppercase tracking-wider text-accent">
                                    ENTER
                                </span>
                            </div>
                        ) : (
                            <button
                                type="button"
                                onPointerDown={(e) => e.stopPropagation()}
                                onClick={() => setIsEditing(true)}
                                title="Tap to type exact CHIPS"
                                className="pointer-events-auto w-[72px] h-[72px] rounded-full flex flex-col items-center justify-center gap-0.5 px-1 hover:bg-surface-hover/50 transition-colors cursor-pointer focus-visible:outline-none"
                            >
                                <span
                                    className={`${displaySizeClass} font-mono font-extrabold tabular-nums leading-none tracking-tight ${
                                        isUnaffordable ? 'animate-knob-alert-blink' : ''
                                    }`}
                                    style={{ color: activeToneColor }}
                                >
                                    {displayValue}
                                </span>
                                <span
                                    className="text-ludo-xs font-mono font-bold uppercase tracking-[0.16em]"
                                    style={{
                                        color: isUnaffordable
                                            ? 'var(--negative)'
                                            : isHighRoller
                                              ? 'var(--warn)'
                                              : 'var(--ink-faint)',
                                    }}
                                >
                                    {tierName}
                                </span>
                            </button>
                        )}
                    </div>
                </div>

                {/* Right Stepper (+) */}
                <button
                    type="button"
                    disabled={!canStepUp}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => emitTierChange(stepTier(wager, 1))}
                    aria-label="Increase entry fee"
                    className="fee-preset-3077 absolute right-0 top-1/2 -translate-y-1/2 z-20 w-11 h-11 bg-surface-recessed border border-line-soft flex items-center justify-center text-ink-strong hover:bg-surface-hover active:scale-95 transition-transform disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                >
                    <LuPlus className="w-4 h-4 stroke-[2.75px]" />
                </button>
            </div>
        </div>
    );
}

export default EntryFeeKnob;
