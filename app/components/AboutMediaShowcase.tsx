'use client';

import React, { useEffect, useRef, useState } from 'react';
import { BOOT_POSTER_SRC, BOOT_VIDEO_SRC } from '@/lib/boot/bootTimeline';
import { onReducedMotionChange, prefersReducedMotion } from '@/lib/motion';
import { HudCornerTicks } from './HudPrimitives';

function PlayIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4" aria-hidden="true">
            <polygon points="7,5 19,12 7,19" />
        </svg>
    );
}

function PauseIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4" aria-hidden="true">
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
        </svg>
    );
}

function VolumeIcon({ muted }: { muted: boolean }) {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4" aria-hidden="true">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" fillOpacity="0.16" />
            {muted ? (
                <>
                    <line x1="22" y1="9" x2="16" y2="15" />
                    <line x1="16" y1="9" x2="22" y2="15" />
                </>
            ) : (
                <>
                    <path d="M15.5 8.5a5 5 0 0 1 0 7" />
                    <path d="M18.5 5.5a9 9 0 0 1 0 13" />
                </>
            )}
        </svg>
    );
}

/**
 * Interactive 9:16 portrait video frame for the About page.
 * Plays the official Ludo 3077 launch trailer (`ludo-3077-boot-v4.mp4`)
 * with poster fallback and reduced-motion awareness.
 */
export function AboutMediaShowcase() {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const [reducedMotion, setReducedMotion] = useState(false);
    const [isPlaying, setIsPlaying] = useState(false);
    const [isMuted, setIsMuted] = useState(true);

    useEffect(() => {
        const reduced = prefersReducedMotion();
        setReducedMotion(reduced);
        const unsub = onReducedMotionChange(setReducedMotion);

        if (!reduced && videoRef.current) {
            videoRef.current.muted = true;
            void videoRef.current.play().catch(() => {
                setIsPlaying(false);
            });
        }
        return unsub;
    }, []);

    const togglePlay = () => {
        const el = videoRef.current;
        if (!el) return;
        if (el.paused) {
            void el.play().catch(() => undefined);
        } else {
            el.pause();
        }
    };

    const toggleMute = () => {
        const el = videoRef.current;
        if (!el) return;
        const nextMuted = !el.muted;
        el.muted = nextMuted;
        setIsMuted(nextMuted);
    };

    return (
        <div className="flex flex-col items-center gap-3 w-full">
            <div
                className="relative w-full max-w-[270px] rounded-2xl overflow-hidden border border-line-strong bg-surface-recessed shadow-lg"
                style={{ aspectRatio: '9 / 16' }}
            >
                <HudCornerTicks />

                {/* Top HUD Feed Strip */}
                <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between px-3 py-2 bg-surface-panel/80 backdrop-blur-sm border-b border-line-soft">
                    <span className="inline-flex items-center gap-1.5 text-ludo-xs font-mono font-bold uppercase tracking-[0.16em] text-ink-strong">
                        <span
                            className={`w-1.5 h-1.5 rounded-full ${
                                isPlaying ? 'bg-positive animate-pulse' : 'bg-accent'
                            }`}
                        />
                        Arena Feed
                    </span>
                    <span className="text-ludo-xs font-mono uppercase tracking-[0.14em] text-ink-muted">
                        00:07
                    </span>
                </div>

                <video
                    ref={videoRef}
                    src={BOOT_VIDEO_SRC}
                    poster={BOOT_POSTER_SRC}
                    width={720}
                    height={1280}
                    playsInline
                    muted={isMuted}
                    loop
                    controls
                    preload="metadata"
                    autoPlay={!reducedMotion}
                    onPlay={() => setIsPlaying(true)}
                    onPause={() => setIsPlaying(false)}
                    onEnded={() => setIsPlaying(false)}
                    aria-label="Ludo 3077 arena preview video"
                    className="w-full h-full object-cover block"
                />
            </div>

            {/* Quick Accessible Controls */}
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    onClick={togglePlay}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] bg-surface-recessed border border-line-soft hover:bg-surface-hover text-ludo-sm font-bold text-ink-strong transition-colors cursor-pointer"
                >
                    {isPlaying ? <PauseIcon /> : <PlayIcon />}
                    <span>{isPlaying ? 'Pause' : 'Play Video'}</span>
                </button>
                <button
                    type="button"
                    onClick={toggleMute}
                    aria-label={isMuted ? 'Unmute video' : 'Mute video'}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] bg-surface-recessed border border-line-soft hover:bg-surface-hover text-ludo-sm font-bold text-ink-muted hover:text-ink-strong transition-colors cursor-pointer"
                >
                    <VolumeIcon muted={isMuted} />
                    <span>{isMuted ? 'Sound Off' : 'Sound On'}</span>
                </button>
            </div>
        </div>
    );
}
