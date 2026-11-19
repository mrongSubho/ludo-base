'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    BOOT_DURATION_MS,
    BOOT_MAX_TIMEOUT_MS,
    BOOT_POSTER_SRC,
    BOOT_START_TIMEOUT_MS,
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
    const preload = useBootPreload(isSessionChecking);

    const videoRef = useRef<HTMLVideoElement | null>(null);
    const completedRef = useRef(false);
    const playbackStartedRef = useRef(false);
    const videoEndedRef = useRef(false);
    const sessionCheckingRef = useRef(isSessionChecking);
    sessionCheckingRef.current = isSessionChecking;

    const [isMuted, setIsMuted] = useState(true);
    const [videoFailed, setVideoFailed] = useState(false);
    const [telemetry, setTelemetry] = useState('BOOT // KERNEL INIT');
    const [videoProgress, setVideoProgress] = useState(0);

    const finishBoot = useCallback(() => {
        if (completedRef.current) return;
        completedRef.current = true;
        onComplete();
    }, [onComplete]);

    // Complete cleanly once session restore finishes after the boot sequence / fallback concludes
    useEffect(() => {
        if (!isSessionChecking && (videoEndedRef.current || videoFailed)) {
            finishBoot();
        }
    }, [isSessionChecking, videoFailed, finishBoot]);

    // Keep audio strictly muted if the user turned off SFX in Settings
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        if (!preferences.sfx) {
            video.muted = true;
            setIsMuted(true);
        }
    }, [preferences.sfx]);

    // Playback lifecycle + autoplay start timeout + hard fail-safe ceiling
    useEffect(() => {
        if (prefersReducedMotion()) {
            if (!sessionCheckingRef.current) finishBoot();
            return;
        }

        const video = videoRef.current;
        if (video) {
            video.setAttribute('webkit-playsinline', 'true');
            video.muted = true;
            video.play().catch(() => {
                // Handled cleanly by the startup timeout fallback below
            });
        }

        const startGuard = window.setTimeout(() => {
            if (playbackStartedRef.current) return;
            setVideoFailed(true);
            setTelemetry('SYS.LINK // FAST BOOT');
            if (!sessionCheckingRef.current) {
                finishBoot();
            }
        }, BOOT_START_TIMEOUT_MS);

        const maxFailSafe = window.setTimeout(() => {
            finishBoot();
        }, BOOT_MAX_TIMEOUT_MS);

        return () => {
            window.clearTimeout(startGuard);
            window.clearTimeout(maxFailSafe);
        };
    }, [finishBoot]);

    const markVideoEnded = useCallback(() => {
        if (videoEndedRef.current) return;
        videoEndedRef.current = true;
        setVideoProgress(100);
        setTelemetry('SYS.READY // 100%');
        if (!sessionCheckingRef.current) {
            finishBoot();
        }
    }, [finishBoot]);

    const handlePlaying = useCallback(() => {
        playbackStartedRef.current = true;
    }, []);

    const handleTimeUpdate = useCallback(() => {
        const video = videoRef.current;
        if (!video) return;
        const cur = video.currentTime || 0;
        if (cur > 0.05) {
            playbackStartedRef.current = true;
        }
        const dur = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : BOOT_DURATION_MS / 1000;
        const pct = Math.min(100, Math.round((cur / dur) * 100));
        setVideoProgress(pct);
        setTelemetry(getBootTelemetryForTime(cur));

        if (dur > 0 && cur >= dur - 0.08) {
            markVideoEnded();
        }
    }, [markVideoEnded]);

    const handleVideoError = useCallback(() => {
        setVideoFailed(true);
        setTelemetry('SYS.LINK // FAST BOOT');
        if (!sessionCheckingRef.current) {
            finishBoot();
        }
    }, [finishBoot]);

    // Tap anywhere unlocks audio if allowed by SFX preference (never skips or restarts)
    const handleUnlockAudio = useCallback(() => {
        if (!preferences.sfx || videoFailed) return;
        const video = videoRef.current;
        if (!video || !video.muted) return;
        video.muted = false;
        video.volume = 1;
        setIsMuted(false);
        video.play().catch(() => {
            video.muted = true;
            setIsMuted(true);
        });
    }, [preferences.sfx, videoFailed]);

    const handleToggleAudioBadge = useCallback(
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
            onPointerDown={handleUnlockAudio}
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

            {/* Mobile Autoplay Audio Unlock Pill (only while muted + SFX enabled) */}
            {!videoFailed && preferences.sfx && (
                <button
                    type="button"
                    onPointerDown={handleToggleAudioBadge}
                    aria-label={isMuted ? 'Unmute boot audio' : 'Mute boot audio'}
                    className="fixed right-3 z-20 px-2.5 py-1 rounded border border-line-strong bg-surface-panel/85 text-accent font-mono text-ludo-xs font-bold tracking-[0.14em] uppercase cursor-pointer backdrop-blur-sm active:scale-95 transition-transform"
                    style={{ top: 'max(12px, env(safe-area-inset-top))' }}
                >
                    {isMuted ? 'TAP FOR AUDIO' : 'AUDIO ON'}
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
