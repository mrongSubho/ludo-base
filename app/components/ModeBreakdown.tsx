"use client";

import React from "react";

export type ModeFormStats = {
    /** e.g. "0" or "3/10" */
    classic: string;
    power: string;
    ai: string;
    /** Last-N form, e.g. "3/3" */
    form: string;
};

/**
 * Profile mode strip — value over label (Classic · Power · vs AI · Form).
 * Values use "wins/games" when both are known, else a single count.
 */
export function ModeBreakdown({
    stats,
    labels = ["Classic", "Power", "vs AI", "Form"],
}: {
    stats: ModeFormStats;
    labels?: [string, string, string, string];
}) {
    const cells: Array<{ v: string; l: string }> = [
        { v: stats.classic, l: labels[0] },
        { v: stats.power, l: labels[1] },
        { v: stats.ai, l: labels[2] },
        { v: stats.form, l: labels[3] },
    ];
    return (
        <div className="w-full rounded-2xl border border-white/10 bg-white/[0.04] p-3">
            <div className="flex items-stretch justify-between">
                {cells.map((c, i) => (
                    <React.Fragment key={c.l}>
                        {i > 0 && <div className="w-px bg-white/10 mx-1 self-stretch" />}
                        <div className="flex-1 flex flex-col items-center justify-center gap-1 min-w-0 px-1">
                            <span className="text-[15px] font-black tabular-nums text-white leading-none truncate max-w-full">
                                {c.v}
                            </span>
                            <span className="text-[8px] uppercase tracking-widest text-white/35 font-bold">
                                {c.l}
                            </span>
                        </div>
                    </React.Fragment>
                ))}
            </div>
        </div>
    );
}

/** `wins/games` when games > 0, else single count. */
export function winGame(wins: number, games: number): string {
    if (games <= 0) return "0";
    return `${wins}/${games}`;
}

/** Last N matches: wins as `w/N` (sample "3/3"). */
export function lastNForm(
    matches: Array<{ winner_address: string | null }>,
    me: string | null | undefined,
    n = 3,
): string {
    const meLc = (me || "").toLowerCase();
    const slice = matches.slice(0, n);
    if (!slice.length) return `0/${n}`;
    let w = 0;
    for (const m of slice) {
        if ((m.winner_address || "").toLowerCase() === meLc) w++;
    }
    return `${w}/${n}`;
}

export default ModeBreakdown;
