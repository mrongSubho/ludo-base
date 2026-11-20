'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    BOOT_DURATION_MS,
    BOOT_EXIT_CLOSE_MS,
    BOOT_EXIT_OPEN_MS,
    BOOT_FETCH_TIMEOUT_MS,
    BOOT_LOCKUP_MIN_MS,
    BOOT_MAX_TIMEOUT_MS,
    BOOT_POSTER_SRC,
    BOOT_STALL_TIMEOUT_MS,
    BOOT_SUBSYSTEM_NODES,
    BOOT_VIDEO_BYTES,
    BOOT_VIDEO_SRC,
    getBootTelemetryForTime,
} from '@/lib/boot/bootTimeline';
import { BootPhase1Synth } from '@/lib/boot/bootPhase1Audio';
import { useBootPreload } from '@/hooks/useBootPreload';
import { usePreferences } from '@/hooks/usePreferences';
import { prefersReducedMotion } from '@/lib/motion';
import { Ludo3077Emblem } from '@/app/components/Ludo3077Logo';
import { HudCornerTicks } from '@/app/components/HudPrimitives';

export interface BootSequenceProps {
    isSessionChecking: boolean;
    onRevealLobby?: () => void;
    onComplete: () => void;
}

type BootPhase = 'lockup' | 'video' | 'fallback' | 'exit-close' | 'exit-open';

const GRADUATION_TICKS = Array.from({ length: 32 }, (_, idx) => idx);

export const BootSequence: React.FC<BootSequenceProps> = ({
    isSessionChecking,
    onRevealLobby,
    onComplete,
}) => {
    const { preferences } = usePreferences();

    const videoRef = useRef<HTMLVideoElement | null>(null);
    const synthRef = useRef<BootPhase1Synth | null>(null);
    const completedRef = useRef(false);
    const exitingRef = useRef(false);
    const phaseRef = useRef<BootPhase>('lockup');
    const downloadFracRef = useRef(0);
    const blobUrlRef = useRef<string | null>(null);
    const blobReadyRef = useRef(false);
    const videoEndedRef = useRef(false);
    const lastTimeRef = useRef(0);
    const lastProgressAtRef = useRef(0);
    const exitCloseTimerRef = useRef<number | null>(null);
    const exitOpenTimerRef = useRef<number | null>(null);
    const sessionCheckingRef = useRef(isSessionChecking);
    sessionCheckingRef.current = isSessionChecking;
    const onRevealLobbyRef = useRef(onRevealLobby);
    onRevealLobbyRef.current = onRevealLobby;
    const onCompleteRef = useRef(onComplete);
    onCompleteRef.current = onComplete;
    const sfxPrefRef = useRef(preferences.sfx);
    sfxPrefRef.current = preferences.sfx;

    const [canPreloadHeavy, setCanPreloadHeavy] = useState(false);
    const [phase, setPhase] = useState<BootPhase>('lockup');
    const [shutterClosed, setShutterClosed] = useState(false);
    const [lockupPct, setLockupPct] = useState(0);
    const [blobSrc, setBlobSrc] = useState<string | undefined>(undefined);
    const [isMuted, setIsMuted] = useState(true);
    const [telemetry, setTelemetry] = useState('BOOT // KERNEL INIT');
    const [videoProgress, setVideoProgress] = useState(0);

    // Defer heavy DB/chunk preload until the 1.24 MB boot video finishes streaming into RAM
    const preload = useBootPreload(isSessionChecking, canPreloadHeavy);

    const updatePhase = useCallback((next: BootPhase) => {
        phaseRef.current = next;
        setPhase(next);
    }, []);

    const finishBoot = useCallback(() => {
        if (completedRef.current) return;
        completedRef.current = true;
        onRevealLobbyRef.current?.();
        onCompleteRef.current();
    }, []);

    const beginLobbyTransition = useCallback(() => {
        if (exitingRef.current || completedRef.current) return;
        exitingRef.current = true;

        if (prefersReducedMotion()) {
            finishBoot();
            return;
        }

        // Step 1: Close twin cyber-tactical shutters over the final bright video frame
        setShutterClosed(false);
        updatePhase('exit-close');
        window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => {
                if (!completedRef.current) setShutterClosed(true);
            });
        });

        // Step 2: Reveal live lobby beneath closed shutters, then part them open smoothly
        exitCloseTimerRef.current = window.setTimeout(() => {
            if (completedRef.current) return;
            onRevealLobbyRef.current?.();
            synthRef.current?.playShutterReveal();
            updatePhase('exit-open');
            setShutterClosed(false);

            exitOpenTimerRef.current = window.setTimeout(() => {
                finishBoot();
            }, BOOT_EXIT_OPEN_MS);
        }, BOOT_EXIT_CLOSE_MS);
    }, [finishBoot, updatePhase]);

    // Complete cleanly via shutter sync once session restore finishes after video or fallback ends
    useEffect(() => {
        if (!isSessionChecking && (videoEndedRef.current || phase === 'fallback')) {
            beginLobbyTransition();
        }
    }, [isSessionChecking, phase, beginLobbyTransition]);

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

    // Main Two-Phase Boot Engine -> Phase 3 Shutter Sync Transition
    useEffect(() => {
        if (prefersReducedMotion()) {
            if (!sessionCheckingRef.current) finishBoot();
            return;
        }

        const synth = new BootPhase1Synth(sfxPrefRef.current);
        synthRef.current = synth;
        synth.tryResume();

        const mountAt = performance.now();
        lastProgressAtRef.current = mountAt;
        let launchedVideo = false;
        let launchHoldTimer: number | null = null;
        let lastTickBucket = 0;
        let active = true;

        const controller = new AbortController();
        const fetchTimeout = window.setTimeout(() => {
            controller.abort();
        }, BOOT_FETCH_TIMEOUT_MS);

        // Stream MP4 completely into a local Blob so Cloudflare 200 (no-206) & slow links never stutter
        void (async () => {
            try {
                const res = await fetch(BOOT_VIDEO_SRC, { signal: controller.signal });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const headerLen = Number(res.headers.get('content-length') || 0);
                const totalBytes = headerLen > 0 ? headerLen : BOOT_VIDEO_BYTES;

                let blob: Blob;
                if (res.body) {
                    const reader = res.body.getReader();
                    const chunks: Uint8Array[] = [];
                    let received = 0;
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        if (value) {
                            chunks.push(value);
                            received += value.byteLength;
                            downloadFracRef.current = Math.min(0.99, received / totalBytes);
                        }
                    }
                    const buffer = new ArrayBuffer(received);
                    const merged = new Uint8Array(buffer);
                    let offset = 0;
                    for (const c of chunks) {
                        merged.set(c, offset);
                        offset += c.byteLength;
                    }
                    blob = new Blob([buffer], { type: 'video/mp4' });
                } else {
                    blob = await res.blob();
                }

                window.clearTimeout(fetchTimeout);
                if (!active) return;

                const url = URL.createObjectURL(blob);
                blobUrlRef.current = url;
                downloadFracRef.current = 1;
                blobReadyRef.current = true;
                setBlobSrc(url);
                setCanPreloadHeavy(true);
            } catch {
                window.clearTimeout(fetchTimeout);
                if (!active) return;
                setCanPreloadHeavy(true);
                updatePhase('fallback');
                setTelemetry('SYS.LINK // FAST BOOT');
                if (!sessionCheckingRef.current) {
                    beginLobbyTransition();
                }
            }
        })();

        const launchVideoPhase = () => {
            if (
                launchedVideo ||
                completedRef.current ||
                exitingRef.current ||
                phaseRef.current === 'fallback'
            ) {
                return;
            }
            const video = videoRef.current;
            if (!video || !blobUrlRef.current) return;

            launchedVideo = true;
            lastProgressAtRef.current = performance.now();
            updatePhase('video');

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

            video.setAttribute('webkit-playsinline', 'true');
            video.muted = true;
            try {
                video.currentTime = 0;
            } catch {
                // ignore
            }
            void video
                .play()
                .then(() => {
                    tryAutoUnmute();
                })
                .catch(() => {
                    // Watched by stall watchdog below
                });
        };

        const onUserGesture = () => {
            if (!sfxPrefRef.current || completedRef.current) return;
            synth.tryResume();
            const video = videoRef.current;
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

        const lockupTimer = window.setInterval(() => {
            if (launchedVideo || completedRef.current || phaseRef.current !== 'lockup') return;
            const elapsed = performance.now() - mountAt;
            const timeFactor = Math.min(1, elapsed / BOOT_LOCKUP_MIN_MS);
            const netFactor = blobReadyRef.current ? 1 : downloadFracRef.current;
            const pct = Math.min(100, Math.round(Math.min(timeFactor, netFactor) * 100));

            if (blobReadyRef.current && elapsed >= BOOT_LOCKUP_MIN_MS) {
                setLockupPct(100);
                setTelemetry('SYS.READY // 100%');
                if (launchHoldTimer === null) {
                    synth.playReadyChime();
                    launchHoldTimer = window.setTimeout(launchVideoPhase, 150);
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
                    : pct < 75
                      ? 'SYNC // CACHE & MEDIA'
                      : 'ARENA // STREAM ARMED',
            );
        }, 45);

        const watchdog = window.setInterval(() => {
            if (
                phaseRef.current !== 'video' ||
                videoEndedRef.current ||
                exitingRef.current ||
                completedRef.current
            ) {
                return;
            }
            const stalledMs = performance.now() - lastProgressAtRef.current;
            if (stalledMs >= BOOT_STALL_TIMEOUT_MS) {
                updatePhase('fallback');
                setTelemetry('SYS.LINK // FAST BOOT');
                if (!sessionCheckingRef.current) {
                    beginLobbyTransition();
                }
            }
        }, 1000);

        const maxFailSafe = window.setTimeout(() => {
            setCanPreloadHeavy(true);
            beginLobbyTransition();
        }, BOOT_MAX_TIMEOUT_MS);

        return () => {
            active = false;
            controller.abort();
            window.clearTimeout(fetchTimeout);
            document.removeEventListener('pointerdown', onUserGesture, { capture: true });
            document.removeEventListener('keydown', onUserGesture, { capture: true });
            window.clearInterval(lockupTimer);
            window.clearInterval(watchdog);
            window.clearTimeout(maxFailSafe);
            if (launchHoldTimer !== null) window.clearTimeout(launchHoldTimer);
            if (exitCloseTimerRef.current !== null) window.clearTimeout(exitCloseTimerRef.current);
            if (exitOpenTimerRef.current !== null) window.clearTimeout(exitOpenTimerRef.current);
            synth.dispose();
            synthRef.current = null;
            if (blobUrlRef.current) {
                URL.revokeObjectURL(blobUrlRef.current);
                blobUrlRef.current = null;
            }
        };
    }, [beginLobbyTransition, finishBoot, updatePhase]);

    const markVideoEnded = useCallback(() => {
        if (videoEndedRef.current) return;
        videoEndedRef.current = true;
        setVideoProgress(100);
        setTelemetry('CLAIMS // ENTERING ARENA');
        if (!sessionCheckingRef.current) {
            beginLobbyTransition();
        }
    }, [beginLobbyTransition]);

    const handlePlaying = useCallback(() => {
        lastProgressAtRef.current = performance.now();
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
        setCanPreloadHeavy(true);
        updatePhase('fallback');
        setTelemetry('SYS.LINK // FAST BOOT');
        if (!sessionCheckingRef.current) {
            beginLobbyTransition();
        }
    }, [beginLobbyTransition, updatePhase]);

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

    const isOpeningExit = phase === 'exit-open';
    const isExiting = phase === 'exit-close' || phase === 'exit-open';
    const activePct =
        phase === 'lockup' ? lockupPct : phase === 'video' ? videoProgress : Math.max(20, preload.percent);
    const activeNodesCount = Math.min(
        BOOT_SUBSYSTEM_NODES.length,
        Math.max(preload.completedCount, Math.ceil((lockupPct / 100) * BOOT_SUBSYSTEM_NODES.length)),
    );

    return (
        <div
            className="ludo-splash-scope fixed inset-0 z-[9999] overflow-hidden select-none touch-manipulation flex items-center justify-center"
            style={{
                backgroundColor: isOpeningExit ? 'transparent' : '#05070A',
                color: '#F1F5F9',
                pointerEvents: isOpeningExit ? 'none' : 'auto',
            }}
            role="status"
            aria-label="Loading Ludo 3077"
        >
            {/* 9:16 Mobile Stage Container: full screen on portrait phones, centered 9:16 viewport on desktop */}
            <div
                className="relative w-full h-full overflow-hidden flex flex-col items-center justify-center"
                style={{
                    maxWidth: 'min(100vw, calc(100dvh * 9 / 16))',
                    backgroundColor: isOpeningExit ? 'transparent' : '#05070A',
                }}
            >
                {/* In-Memory Blob Video Layer (hidden once shutters close for clean lobby reveal) */}
                {phase !== 'fallback' && !isOpeningExit && blobSrc && (
                    <video
                        ref={videoRef}
                        src={blobSrc}
                        poster={BOOT_POSTER_SRC}
                        muted
                        playsInline
                        preload="auto"
                        onPlaying={handlePlaying}
                        onTimeUpdate={handleTimeUpdate}
                        onEnded={markVideoEnded}
                        onError={handleVideoError}
                        className={`absolute inset-0 w-full h-full object-cover pointer-events-none transition-opacity duration-200 ${
                            phase === 'video' || phase === 'exit-close' ? 'opacity-100' : 'opacity-0'
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

                        <div
                            className="pointer-events-none absolute inset-x-0 top-0 px-6 flex items-center justify-between font-mono text-ludo-sm font-bold tracking-[0.2em]"
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

                        <Ludo3077Emblem size="xl" showReticle className="mb-4" />

                        <div className="flex flex-col items-center leading-none mb-7">
                            <span className="text-4xl font-extrabold uppercase tracking-[0.06em]" style={{ color: '#F8FAFC' }}>
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

                        <div className="w-full max-w-[304px] flex flex-col gap-2">
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
                        <Ludo3077Emblem size="lg" showReticle className="mb-5" />
                        <h1 className="text-4xl font-extrabold tracking-wider mb-1 text-center uppercase">
                            <span className="text-ink-strong">LUDO </span>
                            <span className="text-accent">3077</span>
                        </h1>
                        <p className="font-mono text-accent font-bold tracking-[0.28em] uppercase text-ludo-xs text-center">
                            {'// THE ONCHAIN ARENA //'}
                        </p>
                    </div>
                )}

                {/* Minimal Icon-Only Corner Speaker Toggle scoped inside 9:16 stage */}
                {phase === 'video' && preferences.sfx && (
                    <button
                        type="button"
                        onPointerDown={handleToggleMute}
                        aria-label={isMuted ? 'Unmute boot audio' : 'Mute boot audio'}
                        title={isMuted ? 'Unmute boot audio' : 'Mute boot audio'}
                        className="absolute right-3 z-20 w-8 h-8 flex items-center justify-center rounded-md border border-line-soft bg-surface-panel/60 text-ink-muted hover:text-accent cursor-pointer backdrop-blur-sm active:scale-95 transition-transform"
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

                {/* Phase 2 Video Edge-Flush Laser Filament */}
                {(phase === 'video' || phase === 'fallback') && (
                    <div
                        className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col gap-1"
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

                {/* PHASE 3: Synchronized Cyber-Tactical Twin Shutter Transition into Lobby */}
                {isExiting && (
                    <>
                        {/* Top Armored Shutter Blade */}
                        <div
                            className="pointer-events-none absolute inset-x-0 top-0 h-1/2 z-30 flex flex-col justify-end transition-transform ease-[cubic-bezier(0.22,1,0.36,1)]"
                            style={{
                                backgroundColor: '#05070A',
                                backgroundImage:
                                    'linear-gradient(rgba(0, 229, 255, 0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(0, 229, 255, 0.04) 1px, transparent 1px)',
                                backgroundSize: '28px 28px',
                                transitionDuration: `${isOpeningExit ? BOOT_EXIT_OPEN_MS : BOOT_EXIT_CLOSE_MS}ms`,
                                transform: shutterClosed ? 'translateY(0%)' : 'translateY(-104%)',
                            }}
                        >
                            <div className="px-4 pb-2 flex items-center justify-between font-mono text-ludo-xs font-bold tracking-[0.2em] uppercase" style={{ color: '#00E5FF' }}>
                                <span>ARENA LINK // SYNCED</span>
                                <span>3077</span>
                            </div>
                            <div
                                className="w-full h-0.5"
                                style={{
                                    backgroundColor: '#00E5FF',
                                    boxShadow: '0 0 16px rgba(0, 229, 255, 0.9)',
                                }}
                            />
                        </div>

                        {/* Bottom Armored Shutter Blade */}
                        <div
                            className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 z-30 flex flex-col justify-start transition-transform ease-[cubic-bezier(0.22,1,0.36,1)]"
                            style={{
                                backgroundColor: '#05070A',
                                backgroundImage:
                                    'linear-gradient(rgba(0, 229, 255, 0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(0, 229, 255, 0.04) 1px, transparent 1px)',
                                backgroundSize: '28px 28px',
                                transitionDuration: `${isOpeningExit ? BOOT_EXIT_OPEN_MS : BOOT_EXIT_CLOSE_MS}ms`,
                                transform: shutterClosed ? 'translateY(0%)' : 'translateY(104%)',
                            }}
                        >
                            <div
                                className="w-full h-0.5"
                                style={{
                                    backgroundColor: '#00E5FF',
                                    boxShadow: '0 0 16px rgba(0, 229, 255, 0.9)',
                                }}
                            />
                            <div className="px-4 pt-2 flex items-center justify-between font-mono text-ludo-xs font-bold tracking-[0.2em] uppercase" style={{ color: '#94A3B8' }}>
                                <span>ENTERING LOBBY</span>
                                <span style={{ color: '#00E5FF' }}>SYS.OK</span>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default BootSequence;
