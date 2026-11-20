'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    BOOT_BUFFER_MAX_WAIT_MS,
    BOOT_DURATION_MS,
    BOOT_LOCKUP_MIN_MS,
    BOOT_MAX_TIMEOUT_MS,
    BOOT_POSTER_SRC,
    BOOT_STALL_TIMEOUT_MS,
    BOOT_SUBSYSTEM_NODES,
    BOOT_VIDEO_SRC,
    getBootTelemetryForTime,
} from '@/lib/boot/bootTimeline';
import { BootPhase1Synth } from '@/lib/boot/bootPhase1Audio';
import { useBootPreload } from '@/hooks/useBootPreload';
import { usePreferences } from '@/hooks/usePreferences';
import { prefersReducedMotion } from '@/lib/motion';
import { BrandMark3077Icon } from '@/app/components/icons';
import { HudCornerTicks } from '@/app/components/HudPrimitives';

export interface BootSequenceProps {
    isSessionChecking: boolean;
    onComplete: () => void;
}

type BootPhase = 'lockup' | 'video' | 'fallback';

const GRADUATION_TICKS = Array.from({ length: 32 }, (_, idx) => idx);
const DIAL_RIVETS = Array.from({ length: 8 }, (_, idx) => {
    const a = (idx / 8) * Math.PI * 2;
    return { cx: 110 + Math.cos(a) * 65, cy: 110 + Math.sin(a) * 65 };
});

export const BootSequence: React.FC<BootSequenceProps> = ({ isSessionChecking, onComplete }) => {
    const { preferences } = usePreferences();
    const preload = useBootPreload(isSessionChecking, true);

    const videoRef = useRef<HTMLVideoElement | null>(null);
    const synthRef = useRef<BootPhase1Synth | null>(null);
    const completedRef = useRef(false);
    const phaseRef = useRef<BootPhase>('lockup');
    const videoReadyRef = useRef(false);
    const videoEndedRef = useRef(false);
    const lastTimeRef = useRef(0);
    const lastProgressAtRef = useRef(0);
    const sessionCheckingRef = useRef(isSessionChecking);
    sessionCheckingRef.current = isSessionChecking;
    const onCompleteRef = useRef(onComplete);
    onCompleteRef.current = onComplete;
    const sfxPrefRef = useRef(preferences.sfx);
    sfxPrefRef.current = preferences.sfx;

    const [phase, setPhase] = useState<BootPhase>('lockup');
    const [lockupPct, setLockupPct] = useState(0);
    const [isMuted, setIsMuted] = useState(true);
    const [telemetry, setTelemetry] = useState('BOOT // KERNEL INIT');
    const [videoProgress, setVideoProgress] = useState(0);

    const updatePhase = useCallback((next: BootPhase) => {
        phaseRef.current = next;
        setPhase(next);
    }, []);

    const finishBoot = useCallback(() => {
        if (completedRef.current) return;
        completedRef.current = true;
        onCompleteRef.current();
    }, []);

    // Complete cleanly once session restore finishes after video or fallback ends
    useEffect(() => {
        if (!isSessionChecking && (videoEndedRef.current || phase === 'fallback')) {
            finishBoot();
        }
    }, [isSessionChecking, phase, finishBoot]);

    // Respect Settings SFX toggle across Phase 1 synth + Phase 2 video
    useEffect(() => {
        synthRef.current?.setEnabled(preferences.sfx);
        const video = videoRef.current;
        if (!video) return;
        if (!preferences.sfx) {
            video.muted = true;
            setIsMuted(true);
        }
    }, [preferences.sfx]);

    // Main Two-Phase Boot Engine:
    // Phase 1 ('lockup'): Pure-code Ludo 3077 orbital medallion + 5-node laser rail while <video> buffers cleanly.
    // Phase 2 ('video'): Auto-launches pre-buffered action video and plays smoothly straight into the lobby.
    useEffect(() => {
        if (prefersReducedMotion()) {
            if (!sessionCheckingRef.current) finishBoot();
            return;
        }

        const synth = new BootPhase1Synth(sfxPrefRef.current);
        synthRef.current = synth;
        synth.tryResume();

        const video = videoRef.current;
        if (video) {
            video.setAttribute('webkit-playsinline', 'true');
            video.muted = true;
            try {
                video.load();
            } catch {
                // ignore load errors; handled below
            }
        }

        const mountAt = performance.now();
        lastProgressAtRef.current = mountAt;
        let launchedVideo = false;
        let launchHoldTimer: number | null = null;
        let lastTickBucket = 0;

        const checkVideoBuffer = (): boolean => {
            if (!video) return false;
            if (video.readyState >= 3) return true;
            if (video.buffered && video.buffered.length > 0 && video.buffered.end(0) >= 2.0) {
                return true;
            }
            return false;
        };

        const launchVideoPhase = () => {
            if (launchedVideo || completedRef.current || phaseRef.current === 'fallback') return;
            launchedVideo = true;
            lastProgressAtRef.current = performance.now();
            updatePhase('video');

            if (!video) {
                updatePhase('fallback');
                if (!sessionCheckingRef.current) finishBoot();
                return;
            }

            try {
                video.currentTime = 0;
            } catch {
                // ignore seek on non-seekable streams
            }

            const ua =
                typeof navigator !== 'undefined'
                    ? (navigator as { userActivation?: { hasBeenActive?: boolean } }).userActivation
                    : undefined;

            const tryAutoUnmute = () => {
                if (!sfxPrefRef.current) return;
                if (ua?.hasBeenActive) {
                    video.muted = false;
                    video.volume = 1;
                    if (video.paused) {
                        video.muted = true;
                        setIsMuted(true);
                        void video.play().catch(() => undefined);
                    } else {
                        setIsMuted(false);
                    }
                }
            };

            video.muted = true;
            void video
                .play()
                .then(() => {
                    tryAutoUnmute();
                })
                .catch(() => {
                    // Watched by stall watchdog below
                });
        };

        // Silent gesture listener arms Phase 1 Web Audio and unmutes Phase 2 video naturally (no nag banner)
        const onUserGesture = () => {
            if (!sfxPrefRef.current || completedRef.current) return;
            synth.tryResume();
            if (video && phaseRef.current === 'video' && video.muted) {
                video.muted = false;
                video.volume = 1;
                setIsMuted(false);
                if (video.paused && !video.ended) {
                    void video.play().catch(() => {
                        video.muted = true;
                        setIsMuted(true);
                    });
                }
            }
        };
        document.addEventListener('pointerdown', onUserGesture, { passive: true, capture: true });
        document.addEventListener('keydown', onUserGesture, { passive: true, capture: true });

        // Phase 1 smooth progress ticker
        const lockupTimer = window.setInterval(() => {
            if (launchedVideo || completedRef.current || phaseRef.current !== 'lockup') return;
            if (!videoReadyRef.current && checkVideoBuffer()) {
                videoReadyRef.current = true;
            }

            const elapsed = performance.now() - mountAt;
            const timeFactor = Math.min(1, elapsed / BOOT_LOCKUP_MIN_MS);
            const bufferFactor = videoReadyRef.current
                ? 1
                : Math.min(0.92, elapsed / BOOT_BUFFER_MAX_WAIT_MS);
            const pct = Math.min(100, Math.round((timeFactor * 0.72 + bufferFactor * 0.28) * 100));

            const readyToLaunch =
                elapsed >= BOOT_LOCKUP_MIN_MS &&
                (videoReadyRef.current || elapsed >= BOOT_BUFFER_MAX_WAIT_MS);

            if (readyToLaunch) {
                setLockupPct(100);
                setTelemetry('SYS.READY // 100%');
                if (launchHoldTimer === null) {
                    synth.playReadyChime();
                    launchHoldTimer = window.setTimeout(launchVideoPhase, 160);
                }
                return;
            }

            const bucket = Math.floor(pct / 20);
            if (bucket > lastTickBucket && bucket <= 4) {
                lastTickBucket = bucket;
                synth.playStepTick(bucket);
            }
            setLockupPct(pct);
            setTelemetry(
                pct < 35
                    ? 'BOOT // KERNEL INIT'
                    : pct < 70
                      ? 'SYNC // CACHE & MEDIA'
                      : 'ARENA // STREAM ARMED',
            );
        }, 45);

        // Progress watchdog during Phase 2: never skips a playing video mid-way;
        // only falls back if playback & network freeze completely.
        const watchdog = window.setInterval(() => {
            if (phaseRef.current !== 'video' || videoEndedRef.current || completedRef.current) return;
            const stalledMs = performance.now() - lastProgressAtRef.current;
            const activelyLoading = video && video.networkState === HTMLMediaElement.NETWORK_LOADING;
            if (!activelyLoading && stalledMs >= BOOT_STALL_TIMEOUT_MS) {
                updatePhase('fallback');
                setTelemetry('SYS.LINK // FAST BOOT');
                if (!sessionCheckingRef.current) {
                    finishBoot();
                }
            }
        }, 1000);

        const maxFailSafe = window.setTimeout(() => {
            finishBoot();
        }, BOOT_MAX_TIMEOUT_MS);

        return () => {
            document.removeEventListener('pointerdown', onUserGesture, { capture: true });
            document.removeEventListener('keydown', onUserGesture, { capture: true });
            window.clearInterval(lockupTimer);
            window.clearInterval(watchdog);
            window.clearTimeout(maxFailSafe);
            if (launchHoldTimer !== null) window.clearTimeout(launchHoldTimer);
            synth.dispose();
            synthRef.current = null;
        };
    }, [finishBoot, updatePhase]);

    const markVideoEnded = useCallback(() => {
        if (videoEndedRef.current) return;
        videoEndedRef.current = true;
        setVideoProgress(100);
        setTelemetry('SYS.READY // 100%');
        if (!sessionCheckingRef.current) {
            finishBoot();
        }
    }, [finishBoot]);

    const handleCanPlay = useCallback(() => {
        videoReadyRef.current = true;
        lastProgressAtRef.current = performance.now();
    }, []);

    const handlePlaying = useCallback(() => {
        lastProgressAtRef.current = performance.now();
    }, []);

    const handleNetworkProgress = useCallback(() => {
        lastProgressAtRef.current = performance.now();
        if (videoRef.current && videoRef.current.readyState >= 3) {
            videoReadyRef.current = true;
        }
    }, []);

    const handleTimeUpdate = useCallback(() => {
        if (phaseRef.current !== 'video') return;
        const video = videoRef.current;
        if (!video) return;
        const cur = video.currentTime || 0;
        if (cur > lastTimeRef.current + 0.02) {
            lastTimeRef.current = cur;
            lastProgressAtRef.current = performance.now();
        }
        const hasValidDur = Number.isFinite(video.duration) && video.duration >= 1;
        const dur = hasValidDur ? video.duration : BOOT_DURATION_MS / 1000;
        const pct = Math.min(100, Math.round((cur / dur) * 100));
        setVideoProgress(pct);
        setTelemetry(getBootTelemetryForTime(cur));

        if (hasValidDur && cur >= dur - 0.08) {
            markVideoEnded();
        }
    }, [markVideoEnded]);

    const handleVideoError = useCallback(() => {
        updatePhase('fallback');
        setTelemetry('SYS.LINK // FAST BOOT');
        if (!sessionCheckingRef.current) {
            finishBoot();
        }
    }, [finishBoot, updatePhase]);

    const handleToggleMute = useCallback(
        (e: React.PointerEvent<HTMLButtonElement>) => {
            e.stopPropagation();
            if (!preferences.sfx || phase === 'fallback') return;
            const video = videoRef.current;
            if (!video) return;
            const nextMuted = !video.muted;
            video.muted = nextMuted;
            if (!nextMuted) {
                video.volume = 1;
                video.play().catch(() => {
                    video.muted = true;
                    setIsMuted(true);
                });
            }
            setIsMuted(nextMuted);
        },
        [preferences.sfx, phase],
    );

    const activePct =
        phase === 'lockup' ? lockupPct : phase === 'video' ? videoProgress : Math.max(20, preload.percent);
    const activeNodesCount = Math.min(
        BOOT_SUBSYSTEM_NODES.length,
        Math.max(preload.completedCount, Math.ceil((lockupPct / 100) * BOOT_SUBSYSTEM_NODES.length)),
    );

    return (
        <div
            className="ludo-splash-scope fixed inset-0 z-[9999] overflow-hidden select-none touch-manipulation flex flex-col items-center justify-center"
            style={{ backgroundColor: '#05070A', color: '#F1F5F9' }}
            role="status"
            aria-label="Loading Ludo 3077"
        >
            {/* Pre-buffered Video Layer (opacity-0 during Phase 1 lockup, fades sharp into Phase 2) */}
            {phase !== 'fallback' && (
                <video
                    ref={videoRef}
                    src={BOOT_VIDEO_SRC}
                    poster={BOOT_POSTER_SRC}
                    muted
                    playsInline
                    preload="auto"
                    onCanPlay={handleCanPlay}
                    onCanPlayThrough={handleCanPlay}
                    onPlaying={handlePlaying}
                    onProgress={handleNetworkProgress}
                    onTimeUpdate={handleTimeUpdate}
                    onEnded={markVideoEnded}
                    onError={handleVideoError}
                    className={`absolute inset-0 w-full h-full object-contain pointer-events-none transition-opacity duration-200 ${
                        phase === 'video' ? 'opacity-100' : 'opacity-0'
                    }`}
                />
            )}

            {/* PHASE 1: Pure-Code Screenshot Lockup + Modern 3077 Laser Filament Bar */}
            {phase === 'lockup' && (
                <div
                    className="relative z-10 w-full h-full flex flex-col items-center justify-center px-6"
                    style={{
                        backgroundColor: '#05070A',
                        backgroundImage:
                            'linear-gradient(rgba(0, 229, 255, 0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(0, 229, 255, 0.045) 1px, transparent 1px), radial-gradient(circle at 50% 42%, rgba(0, 229, 255, 0.14) 0%, transparent 58%)',
                        backgroundSize: '28px 28px, 28px 28px, 100% 100%',
                    }}
                >
                    <HudCornerTicks className="m-4" />

                    {/* Top-left / Top-right 01 & 02 Bracket Tags */}
                    <div
                        className="pointer-events-none fixed inset-x-0 top-0 px-6 flex items-center justify-between font-mono text-ludo-sm font-bold tracking-[0.2em]"
                        style={{
                            paddingTop: 'max(48px, calc(env(safe-area-inset-top) + 32px))',
                            color: '#00E5FF',
                        }}
                    >
                        <div className="relative px-2 py-0.5">
                            <span
                                className="absolute top-0 left-0 w-2 h-2 border-t border-l"
                                style={{ borderColor: 'rgba(0, 229, 255, 0.55)' }}
                            />
                            01
                        </div>
                        <div className="relative px-2 py-0.5">
                            <span
                                className="absolute top-0 right-0 w-2 h-2 border-t border-r"
                                style={{ borderColor: 'rgba(0, 229, 255, 0.55)' }}
                            />
                            02
                        </div>
                    </div>

                    {/* Central Rotating Orbital Rings + Riveted 3D-Styled Triad Dice Dial */}
                    <div className="relative w-56 h-56 mb-4 flex items-center justify-center">
                        {/* Outer Orbital Ring + Node Dots */}
                        <svg
                            viewBox="0 0 220 220"
                            className="absolute inset-0 w-full h-full animate-hud-reticle-spin"
                            fill="none"
                            aria-hidden="true"
                        >
                            <circle
                                cx="110"
                                cy="110"
                                r="102"
                                stroke="#00E5FF"
                                strokeWidth="1.2"
                                strokeOpacity="0.6"
                                strokeDasharray="180 44 120 40"
                            />
                            <circle cx="152" cy="17" r="3.6" fill="#00E5FF" />
                            <circle cx="52" cy="193" r="3.2" fill="#00E5FF" />
                        </svg>

                        {/* Inner Counter-Rotating Dashed Telemetry Ring */}
                        <svg
                            viewBox="0 0 220 220"
                            className="absolute inset-0 w-full h-full animate-hud-reticle-spin-rev"
                            fill="none"
                            aria-hidden="true"
                        >
                            <circle
                                cx="110"
                                cy="110"
                                r="86"
                                stroke="#00E5FF"
                                strokeWidth="1"
                                strokeOpacity="0.4"
                                strokeDasharray="34 14 8 14"
                            />
                        </svg>

                        {/* Matte Carbon Riveted Dial Housing + Diamond & 3 Glowing 5-Pip Dice Tiles */}
                        <svg
                            viewBox="0 0 220 220"
                            className="relative w-full h-full"
                            fill="none"
                            aria-hidden="true"
                        >
                            <defs>
                                <radialGradient id="boot-dial-bg" cx="42%" cy="34%" r="68%">
                                    <stop offset="0%" stopColor="#1E2530" />
                                    <stop offset="65%" stopColor="#0E131B" />
                                    <stop offset="100%" stopColor="#06080D" />
                                </radialGradient>
                                <filter id="boot-cyan-glow" x="-30%" y="-30%" width="160%" height="160%">
                                    <feGaussianBlur stdDeviation="2.4" result="blur" />
                                    <feMerge>
                                        <feMergeNode in="blur" />
                                        <feMergeNode in="SourceGraphic" />
                                    </feMerge>
                                </filter>
                            </defs>

                            {/* Outer Bezel + Latch */}
                            <circle cx="110" cy="110" r="71" fill="#171C24" stroke="#334155" strokeWidth="2" />
                            <rect x="35" y="101" width="7" height="18" rx="2" fill="#273140" stroke="#475569" strokeWidth="1" />
                            <circle cx="110" cy="110" r="58" fill="url(#boot-dial-bg)" stroke="#00E5FF" strokeOpacity="0.35" strokeWidth="1.2" />

                            {/* Subtle Carbon Rim Rivets */}
                            {DIAL_RIVETS.map((rivet, idx) => (
                                <circle
                                    key={idx}
                                    cx={rivet.cx}
                                    cy={rivet.cy}
                                    r="2"
                                    fill="#090D12"
                                    stroke="#475569"
                                    strokeWidth="0.7"
                                />
                            ))}

                            {/* Subtle Diagonal Interior Hatch */}
                            <g stroke="#00E5FF" strokeOpacity="0.06" strokeWidth="1">
                                <line x1="72" y1="74" x2="148" y2="146" />
                                <line x1="88" y1="62" x2="156" y2="130" />
                                <line x1="64" y1="90" x2="132" y2="158" />
                            </g>

                            {/* Top Hyper-Cyan Core Diamond */}
                            <polygon
                                points="110,68 121,79 110,90 99,79"
                                fill="#00E5FF"
                                filter="url(#boot-cyan-glow)"
                            />

                            {/* Three Glowing 5-Pip Dice Tiles */}
                            {[
                                { cx: 88, cy: 108 },
                                { cx: 132, cy: 108 },
                                { cx: 110, cy: 132 },
                            ].map((tile, idx) => (
                                <g
                                    key={idx}
                                    transform={`rotate(45 ${tile.cx} ${tile.cy})`}
                                    filter="url(#boot-cyan-glow)"
                                >
                                    <rect
                                        x={tile.cx - 12}
                                        y={tile.cy - 12}
                                        width="24"
                                        height="24"
                                        rx="4"
                                        fill="rgba(0, 229, 255, 0.14)"
                                        stroke="#00E5FF"
                                        strokeWidth="1.5"
                                    />
                                    <circle cx={tile.cx - 5.5} cy={tile.cy - 5.5} r="1.8" fill="#00E5FF" />
                                    <circle cx={tile.cx + 5.5} cy={tile.cy - 5.5} r="1.8" fill="#00E5FF" />
                                    <circle cx={tile.cx} cy={tile.cy} r="2.1" fill="#00E5FF" />
                                    <circle cx={tile.cx - 5.5} cy={tile.cy + 5.5} r="1.8" fill="#00E5FF" />
                                    <circle cx={tile.cx + 5.5} cy={tile.cy + 5.5} r="1.8" fill="#00E5FF" />
                                </g>
                            ))}
                        </svg>
                    </div>

                    {/* Wordmark Lockup: LUDO / 3077 / THE ONCHAIN ARENA */}
                    <div className="flex flex-col items-center leading-none mb-7">
                        <span
                            className="text-4xl font-extrabold uppercase tracking-[0.06em]"
                            style={{ color: '#F8FAFC' }}
                        >
                            LUDO
                        </span>
                        <span
                            className="text-5xl font-extrabold uppercase tracking-[0.04em] mt-0.5"
                            style={{
                                color: '#00E5FF',
                                textShadow: '0 0 22px rgba(0, 229, 255, 0.35)',
                            }}
                        >
                            3077
                        </span>
                        <span
                            className="font-mono text-ludo-xs font-bold uppercase tracking-[0.26em] mt-2.5"
                            style={{ color: '#CBD5E1' }}
                        >
                            {'// THE ONCHAIN ARENA //'}
                        </span>
                    </div>

                    {/* Modern Aerospace Laser Filament & 5-Node Subsystem Rail */}
                    <div className="w-full max-w-[304px] flex flex-col gap-2">
                        {/* 5-Node Matrix Row */}
                        <div className="flex items-center justify-between font-mono text-ludo-xs font-bold tracking-[0.12em] uppercase">
                            <div className="flex items-center gap-2">
                                {BOOT_SUBSYSTEM_NODES.map((node, idx) => {
                                    const active = idx < activeNodesCount;
                                    return (
                                        <span
                                            key={node}
                                            className="flex items-center gap-1 transition-opacity duration-150"
                                            style={{
                                                color: active ? '#00E5FF' : '#64748B',
                                                opacity: active ? 1 : 0.65,
                                            }}
                                        >
                                            <span
                                                className="inline-block w-1.5 h-1.5 rotate-45"
                                                style={{
                                                    backgroundColor: active ? '#00E5FF' : '#334155',
                                                    boxShadow: active ? '0 0 8px #00E5FF' : 'none',
                                                }}
                                            />
                                            {node}
                                        </span>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Laser Filament Track with Compositor-Only translateX Photon Tip */}
                        <div className="flex items-center gap-1.5">
                            <span className="font-mono text-ludo-xs font-bold" style={{ color: '#00E5FF' }}>
                                [
                            </span>
                            <div
                                className="relative flex-1 h-1 rounded-sm overflow-hidden"
                                style={{ backgroundColor: 'rgba(148, 163, 184, 0.16)' }}
                            >
                                <div
                                    className="w-full h-full flex items-center transition-transform duration-150 ease-out"
                                    style={{ transform: `translateX(${Math.max(4, activePct) - 100}%)` }}
                                >
                                    <div
                                        className="w-full h-full rounded-sm"
                                        style={{
                                            background: 'linear-gradient(90deg, rgba(0,229,255,0.25) 0%, #00E5FF 92%, #F8FAFC 100%)',
                                            boxShadow: '0 0 12px rgba(0, 229, 255, 0.85)',
                                        }}
                                    />
                                </div>
                            </div>
                            <span className="font-mono text-ludo-xs font-bold" style={{ color: '#00E5FF' }}>
                                ]
                            </span>
                        </div>

                        {/* Millimeter Graduation Scale */}
                        <svg viewBox="0 0 300 6" className="w-full h-1.5 opacity-45" fill="none" aria-hidden="true">
                            {GRADUATION_TICKS.map((tick) => {
                                const x = (tick / (GRADUATION_TICKS.length - 1)) * 298 + 1;
                                const major = tick % 8 === 0;
                                return (
                                    <line
                                        key={tick}
                                        x1={x}
                                        y1={0}
                                        x2={x}
                                        y2={major ? 6 : 3}
                                        stroke="#00E5FF"
                                        strokeWidth={major ? 1.2 : 0.7}
                                    />
                                );
                            })}
                        </svg>

                        {/* Status Telemetry Sub-row */}
                        <div className="flex items-center justify-between font-mono text-ludo-xs font-bold tracking-[0.14em] uppercase">
                            <span style={{ color: '#94A3B8' }}>{telemetry}</span>
                            <span className="tabular-nums" style={{ color: '#00E5FF' }}>
                                {lockupPct}% {lockupPct >= 100 ? 'READY' : 'SYNC'}
                            </span>
                        </div>
                    </div>
                </div>
            )}

            {/* Static Error/Stall Fallback View */}
            {phase === 'fallback' && (
                <div className="relative z-10 flex flex-col items-center justify-center w-full h-full px-6">
                    <HudCornerTicks className="m-4" />
                    <div
                        className="relative w-16 h-16 mb-5 flex items-center justify-center border border-line-strong bg-surface-panel shadow-[0_0_28px_color-mix(in_srgb,var(--accent)_25%,transparent)]"
                        style={{
                            clipPath:
                                'polygon(10px 0, calc(100% - 10px) 0, 100% 10px, 100% calc(100% - 10px), calc(100% - 10px) 100%, 10px 100%, 0 calc(100% - 10px), 0 10px)',
                        }}
                    >
                        <BrandMark3077Icon className="w-9 h-9 text-accent" active />
                    </div>
                    <h1 className="text-4xl font-extrabold tracking-wider mb-1 text-center uppercase">
                        <span className="text-ink-strong">LUDO </span>
                        <span className="text-accent">3077</span>
                    </h1>
                    <p className="font-mono text-accent font-bold tracking-[0.28em] uppercase text-ludo-xs text-center">
                        {'// THE ONCHAIN ARENA //'}
                    </p>
                </div>
            )}

            {/* Minimal Icon-Only Corner Speaker Toggle during Phase 2 Video */}
            {phase === 'video' && preferences.sfx && (
                <button
                    type="button"
                    onPointerDown={handleToggleMute}
                    aria-label={isMuted ? 'Unmute boot audio' : 'Mute boot audio'}
                    title={isMuted ? 'Unmute boot audio' : 'Mute boot audio'}
                    className="fixed right-3 z-20 w-8 h-8 flex items-center justify-center rounded-md border border-line-soft bg-surface-panel/60 text-ink-muted hover:text-accent cursor-pointer backdrop-blur-sm active:scale-95 transition-transform"
                    style={{ top: 'max(12px, env(safe-area-inset-top))' }}
                >
                    {isMuted ? (
                        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M11 5L6 9H2v6h4l5 4V5z" />
                            <line x1="23" y1="9" x2="17" y2="15" />
                            <line x1="17" y1="9" x2="23" y2="15" />
                        </svg>
                    ) : (
                        <svg viewBox="0 0 24 24" className="w-4 h-4 text-accent" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M11 5L6 9H2v6h4l5 4V5z" />
                            <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                            <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                        </svg>
                    )}
                </button>
            )}

            {/* Phase 2 Video Edge-Flush Laser Filament + Minimal Telemetry Line */}
            {phase !== 'lockup' && (
                <div
                    className="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex flex-col gap-1"
                    style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
                >
                    <div
                        className="px-3 flex items-center justify-between font-mono text-ludo-xs font-bold tracking-[0.14em] uppercase"
                        style={{ textShadow: '0 1px 4px rgba(0, 0, 0, 0.9)' }}
                    >
                        <span style={{ color: '#CBD5E1' }}>{telemetry}</span>
                        <span className="tabular-nums" style={{ color: '#00E5FF' }}>
                            {preload.completedCount}/{preload.totalStages} · {activePct}%
                        </span>
                    </div>
                    <div
                        className="relative w-full h-0.5 overflow-hidden"
                        style={{ backgroundColor: 'rgba(148, 163, 184, 0.2)' }}
                    >
                        <div
                            className="w-full h-full transition-transform duration-150 ease-out"
                            style={{ transform: `translateX(${Math.max(2, activePct) - 100}%)` }}
                        >
                            <div
                                className="w-full h-full"
                                style={{
                                    background: 'linear-gradient(90deg, rgba(0,229,255,0.3) 0%, #00E5FF 94%, #F8FAFC 100%)',
                                    boxShadow: '0 0 10px rgba(0, 229, 255, 0.9)',
                                }}
                            />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default BootSequence;
