'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    BOOT_DURATION_MS,
    BOOT_MAX_TIMEOUT_MS,
    BOOT_POSTER_SRC,
    BOOT_STALL_TIMEOUT_MS,
    BOOT_VIDEO_SRC,
    getBootTelemetryForTime,
} from '@/lib/boot/bootTimeline';
import { useBootPreload } from '@/hooks/useBootPreload';
import { usePreferences } from '@/hooks/usePreferences';
import { prefersReducedMotion } from '@/lib/motion';
import { BrandMark3077Icon } from '@/app/components/icons';
import { HudCornerTicks } from '@/app/components/HudPrimitives';

export interface BootSequenceProps {
    isSessionChecking: boolean;
    onComplete: () => void;
}

export const BootSequence: React.FC<BootSequenceProps> = ({ isSessionChecking, onComplete }) => {
    const { preferences } = usePreferences();

    const videoRef = useRef<HTMLVideoElement | null>(null);
    const completedRef = useRef(false);
    const videoEndedRef = useRef(false);
    const lastTimeRef = useRef(0);
    const lastProgressAtRef = useRef(0);
    const sessionCheckingRef = useRef(isSessionChecking);
    sessionCheckingRef.current = isSessionChecking;
    const onCompleteRef = useRef(onComplete);
    onCompleteRef.current = onComplete;
    const sfxPrefRef = useRef(preferences.sfx);
    sfxPrefRef.current = preferences.sfx;

    const [canPreloadHeavy, setCanPreloadHeavy] = useState(false);
    const [isMuted, setIsMuted] = useState(true);
    const [videoFailed, setVideoFailed] = useState(false);
    const [telemetry, setTelemetry] = useState('BOOT // KERNEL INIT');
    const [videoProgress, setVideoProgress] = useState(0);

    const preload = useBootPreload(isSessionChecking, canPreloadHeavy);

    const finishBoot = useCallback(() => {
        if (completedRef.current) return;
        completedRef.current = true;
        onCompleteRef.current();
    }, []);

    // Complete cleanly once session restore finishes after the boot sequence / fallback concludes
    useEffect(() => {
        if (!isSessionChecking && (videoEndedRef.current || videoFailed)) {
            finishBoot();
        }
    }, [isSessionChecking, videoFailed, finishBoot]);

    // Respect Settings SFX mute toggle
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        if (!preferences.sfx) {
            video.muted = true;
            setIsMuted(true);
        }
    }, [preferences.sfx]);

    // Playback lifecycle: mounts muted so mobile native autoplay decodes frame 1 immediately,
    // never steals mount bandwidth before playback starts, and uses a progress-based watchdog
    // so an actively playing video is NEVER skipped from the middle.
    useEffect(() => {
        if (prefersReducedMotion()) {
            if (!sessionCheckingRef.current) finishBoot();
            return;
        }

        lastProgressAtRef.current = performance.now();
        const video = videoRef.current;

        // Release heavy preload chunks even if playback is delayed past 1.5s
        const heavyUnlockTimer = window.setTimeout(() => {
            setCanPreloadHeavy(true);
        }, 1500);

        let removeGestureListeners = () => {};

        if (video) {
            video.setAttribute('webkit-playsinline', 'true');
            video.muted = true;

            const tryAutoUnmute = () => {
                if (!sfxPrefRef.current || video.muted === false) return;
                const ua =
                    typeof navigator !== 'undefined'
                        ? (navigator as { userActivation?: { hasBeenActive?: boolean } }).userActivation
                        : undefined;
                if (ua?.hasBeenActive) {
                    video.muted = false;
                    video.volume = 1;
                    // Guard against WebKit auto-pausing when unmuted without fresh gesture
                    if (video.paused) {
                        video.muted = true;
                        setIsMuted(true);
                        void video.play().catch(() => undefined);
                    } else {
                        setIsMuted(false);
                    }
                }
            };

            void video
                .play()
                .then(() => {
                    tryAutoUnmute();
                })
                .catch(() => {
                    // Watched by stall watchdog below
                });

            if (sfxPrefRef.current) {
                const unmuteOnGesture = () => {
                    removeGestureListeners();
                    if (!sfxPrefRef.current || completedRef.current) return;
                    video.muted = false;
                    video.volume = 1;
                    setIsMuted(false);
                    if (video.paused && !video.ended) {
                        void video.play().catch(() => {
                            video.muted = true;
                            setIsMuted(true);
                        });
                    }
                };
                document.addEventListener('pointerdown', unmuteOnGesture, { passive: true, capture: true });
                document.addEventListener('keydown', unmuteOnGesture, { passive: true, capture: true });
                removeGestureListeners = () => {
                    document.removeEventListener('pointerdown', unmuteOnGesture, { capture: true });
                    document.removeEventListener('keydown', unmuteOnGesture, { capture: true });
                };
            }
        }

        // Progress watchdog: only triggers fallback if BOTH time & buffering stall completely
        const watchdog = window.setInterval(() => {
            if (videoEndedRef.current || completedRef.current) return;
            const stalledMs = performance.now() - lastProgressAtRef.current;
            const activelyLoading = video && video.networkState === HTMLMediaElement.NETWORK_LOADING;
            if (!activelyLoading && stalledMs >= BOOT_STALL_TIMEOUT_MS) {
                setCanPreloadHeavy(true);
                setVideoFailed(true);
                setTelemetry('SYS.LINK // FAST BOOT');
                if (!sessionCheckingRef.current) {
                    finishBoot();
                }
            }
        }, 1000);

        const maxFailSafe = window.setTimeout(() => {
            setCanPreloadHeavy(true);
            finishBoot();
        }, BOOT_MAX_TIMEOUT_MS);

        return () => {
            removeGestureListeners();
            window.clearTimeout(heavyUnlockTimer);
            window.clearInterval(watchdog);
            window.clearTimeout(maxFailSafe);
        };
    }, [finishBoot]);

    const markVideoEnded = useCallback(() => {
        if (videoEndedRef.current) return;
        videoEndedRef.current = true;
        setCanPreloadHeavy(true);
        setVideoProgress(100);
        setTelemetry('SYS.READY // 100%');
        if (!sessionCheckingRef.current) {
            finishBoot();
        }
    }, [finishBoot]);

    const handlePlaying = useCallback(() => {
        lastProgressAtRef.current = performance.now();
        setCanPreloadHeavy(true);
    }, []);

    const handleNetworkProgress = useCallback(() => {
        lastProgressAtRef.current = performance.now();
    }, []);

    const handleTimeUpdate = useCallback(() => {
        const video = videoRef.current;
        if (!video) return;
        const cur = video.currentTime || 0;
        if (cur > lastTimeRef.current + 0.02) {
            lastTimeRef.current = cur;
            lastProgressAtRef.current = performance.now();
            setCanPreloadHeavy(true);
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
        setVideoFailed(true);
        setTelemetry('SYS.LINK // FAST BOOT');
        if (!sessionCheckingRef.current) {
            finishBoot();
        }
    }, [finishBoot]);

    const handleToggleMute = useCallback(
        (e: React.PointerEvent<HTMLButtonElement>) => {
            e.stopPropagation();
            if (!preferences.sfx || videoFailed) return;
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
        [preferences.sfx, videoFailed],
    );

    const railPercent = videoFailed
        ? Math.max(12, preload.percent)
        : Math.max(videoProgress, Math.min(99, preload.percent));

    return (
        <div
            className="ludo-splash-scope fixed inset-0 z-[9999] bg-surface-page text-ink-strong overflow-hidden select-none touch-manipulation flex flex-col items-center justify-center"
            role="status"
            aria-label="Loading Ludo 3077"
        >
            {!videoFailed ? (
                <video
                    ref={videoRef}
                    src={BOOT_VIDEO_SRC}
                    poster={BOOT_POSTER_SRC}
                    autoPlay
                    muted
                    playsInline
                    preload="auto"
                    onPlaying={handlePlaying}
                    onProgress={handleNetworkProgress}
                    onTimeUpdate={handleTimeUpdate}
                    onEnded={markVideoEnded}
                    onError={handleVideoError}
                    className="w-full h-full object-contain pointer-events-none"
                />
            ) : (
                <div className="relative flex flex-col items-center justify-center w-full h-full px-6">
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

            {/* Minimal Icon-Only Corner Speaker Toggle (zero text banner) */}
            {!videoFailed && preferences.sfx && (
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

            {/* Bottom Live Preload Micro-Rail (unobtrusive hairline, compositor-only scaleX) */}
            <div
                className="pointer-events-none fixed inset-x-0 bottom-0 z-20 px-4"
                style={{ paddingBottom: 'max(8px, env(safe-area-inset-bottom))' }}
            >
                <div className="mx-auto max-w-[360px] flex flex-col gap-1 bg-surface-panel/75 border border-line-soft rounded-md px-2.5 py-1.5 backdrop-blur-sm">
                    <div className="flex items-center justify-between font-mono text-ludo-xs font-bold tracking-[0.12em] uppercase">
                        <span className="text-ink-muted truncate pr-2">{telemetry}</span>
                        <span className="text-accent tabular-nums">
                            {preload.completedCount}/{preload.totalStages} · {railPercent}%
                        </span>
                    </div>
                    <div className="relative w-full h-1 bg-surface-recessed rounded-sm overflow-hidden">
                        <div
                            className="h-full w-full bg-accent origin-left transition-transform duration-150 ease-out"
                            style={{ transform: `scaleX(${Math.max(0.04, railPercent / 100)})` }}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};

export default BootSequence;
