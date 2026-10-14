"use client";

/**
 * Light post-arena theme nudge — shown once after unlock.
 * Two chips (Retro / Daybreak) + dismiss. Never blocks play.
 *
 * The chips are the shared `Chip` filter type and the dismiss is a ghost
 * `Button` (UI_COMPONENT_AUDIT B.4): they used to be three bespoke
 * `theme-nudge-*` classes, which is how a one-off toast grows its own design
 * system. `active` replaces the old `.on` modifier.
 */

import { useEffect, useState } from "react";
import { usePreferences } from "@/hooks/usePreferences";
import { hasSeenThemeNudge, markThemeNudged } from "@/lib/walletOnboarding";
import { Chip } from "./Chip";
import { Button } from "./Button";

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
                <Chip type="filter" active={preferences.theme === "retro"} onClick={() => pick("retro")}>
                    Retro
                </Chip>
                <Chip type="filter" active={preferences.theme === "light"} onClick={() => pick("light")}>
                    Daybreak
                </Chip>
                <Button variant="ghost" size="sm" onClick={dismiss} aria-label="Dismiss theme hint">
                    Later
                </Button>
            </div>
        </div>
    );
}
