"use client";

/**
 * Light post-arena theme nudge — shown once after unlock.
 * Two chips (Retro / Daybreak) + dismiss. Never blocks play.
 */

import { useEffect, useState } from "react";
import { usePreferences } from "@/hooks/usePreferences";
import { hasSeenThemeNudge, markThemeNudged } from "@/lib/walletOnboarding";

export default function ThemeNudge() {
    const { preferences, updatePreference } = usePreferences();
    const [open, setOpen] = useState(false);

    useEffect(() => {
        if (hasSeenThemeNudge()) return;
        // Slight delay so it lands after the lobby paints.
        const t = window.setTimeout(() => setOpen(true), 1200);
        return () => window.clearTimeout(t);
    }, []);

    const dismiss = () => {
        markThemeNudged();
        setOpen(false);
    };

    const pick = (v: "retro" | "light") => {
        updatePreference("ludo-theme", v);
        markThemeNudged();
        setOpen(false);
    };

    if (!open) return null;

    return (
        <div className="theme-nudge" role="status" aria-label="Choose a theme">
            <div className="theme-nudge-copy">
                <strong>Make it yours</strong>
                <span>Pick a look — anytime in Settings.</span>
            </div>
            <div className="theme-nudge-actions">
                <button
                    type="button"
                    className={`theme-nudge-chip ${preferences.theme === "retro" ? "on" : ""}`}
                    onClick={() => pick("retro")}
                >
                    Retro
                </button>
                <button
                    type="button"
                    className={`theme-nudge-chip ${preferences.theme === "light" ? "on" : ""}`}
                    onClick={() => pick("light")}
                >
                    Daybreak
                </button>
                <button type="button" className="theme-nudge-close" onClick={dismiss} aria-label="Dismiss theme hint">
                    Later
                </button>
            </div>
        </div>
    );
}
