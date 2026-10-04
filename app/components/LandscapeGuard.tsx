"use client";

import { useEffect, useState } from 'react';

// Landscape phones are wide but short (~360–450px tall): they miss the
// width-based mobile rules and get desktop board styles in a viewport the
// square board + top/bottom HUDs cannot fit. There is no true landscape
// board layout, so this guard is the failsafe: it covers the broken board,
// tells the player to rotate back, and — critically — never touches game
// state. Timers, netcode and spectators keep running underneath.
const LANDSCAPE_QUERY = '(orientation: landscape) and (max-height: 540px)';

function useIsLandscapeShort(): boolean {
    const [landscape, setLandscape] = useState(false);
    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia === 'undefined') return;
        const mq = window.matchMedia(LANDSCAPE_QUERY);
        const onChange = () => setLandscape(mq.matches);
        onChange();
        mq.addEventListener('change', onChange);
        return () => mq.removeEventListener('change', onChange);
    }, []);
    return landscape;
}

interface LandscapeGuardProps {
    onExitMatch?: () => void;
}

export default function LandscapeGuard({ onExitMatch }: LandscapeGuardProps) {
    const landscape = useIsLandscapeShort();
    const [dismissed, setDismissed] = useState(false);

    // Re-arm every time they come back to portrait: the next landscape
    // rotation shows the guard again instead of staying dismissed forever.
    useEffect(() => {
        if (!landscape) setDismissed(false);
    }, [landscape]);

    if (!landscape || dismissed) return null;

    return (
        <div className="landscape-guard" role="alertdialog" aria-label="Rotate your device to portrait">
            <div className="landscape-guard-card">
                <svg className="landscape-guard-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <rect x="8" y="3" width="8" height="18" rx="2" />
                    <line x1="11" y1="18" x2="13" y2="18" />
                    <path d="M2.5 12a9 9 0 0 1 2.6-6.4" />
                    <polyline points="2.5 3.5 2.5 6.5 5.5 6.5" />
                </svg>
                <h2 className="landscape-guard-title">Rotate your device</h2>
                <p className="landscape-guard-sub">
                    The arena is built for portrait. Your match keeps running while you rotate.
                </p>
                <div className="landscape-guard-actions">
                    <button type="button" className="landscape-guard-primary" onClick={() => setDismissed(true)}>
                        Continue anyway
                    </button>
                    {onExitMatch && (
                        <button type="button" className="landscape-guard-ghost" onClick={onExitMatch}>
                            Leave match
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
