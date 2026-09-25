"use client";

import { useLegacyClaim, useSeasonClaim } from "@/hooks/useMerkleClaim";
import { shortHex } from "@/lib/chips";

/**
 * Legacy coins → CHIPS and season merkle claims (pull-only).
 * Reads hosted /legacy-snapshot.json and /season-leaves-<epoch>.json.
 */
export default function MerkleClaimPanel({ epoch = "1" }: { epoch?: string }) {
    const legacy = useLegacyClaim();
    const season = useSeasonClaim(epoch);

    return (
        <div className="match-stats-claim ready" style={{ marginTop: 12 }}>
            <div className="match-stats-claim-head">
                <span className="match-stats-claim-tag">LEGACY</span>
                <span className="match-stats-claim-amount">{legacy.humanAmount}</span>
            </div>
            <p className="match-stats-claim-note">
                {legacy.claimed
                    ? "Legacy CHIPS already claimed"
                    : legacy.entry
                        ? `100:1 conversion · proof for ${shortHex(legacy.entry.wallet)} · challenge root ${
                              legacy.rootLive
                                  ? "set"
                                  : legacy.snapshot?.challengeEndsAt
                                    ? `ends ${legacy.snapshot.challengeEndsAt.slice(0, 10)}`
                                    : "pending"
                          }`
                        : "No legacy allocation for this wallet"}
            </p>
            {legacy.entry && (
                <button
                    type="button"
                    className={`match-stats-cta claim ${legacy.canClaim ? "" : "soon"}`}
                    onClick={() => {
                        if (legacy.canClaim) void legacy.claim();
                    }}
                    disabled={!legacy.canClaim || legacy.claiming}
                >
                    {legacy.claiming
                        ? "Claiming…"
                        : legacy.claimed
                            ? "Claimed"
                            : legacy.canClaim
                                ? "Claim Legacy CHIPS"
                                : "Legacy · locked"}
                </button>
            )}
            {legacy.error && (
                <p className="match-stats-claim-note" style={{ color: "#fca5a5" }}>
                    {legacy.error}
                </p>
            )}

            <div className="match-stats-claim-head" style={{ marginTop: 16 }}>
                <span className="match-stats-claim-tag">SEASON {epoch}</span>
                <span className="match-stats-claim-amount">{season.humanAmount}</span>
            </div>
            <p className="match-stats-claim-note">
                {season.claimed
                    ? `Season epoch ${epoch} already claimed`
                    : season.entry
                        ? `Merkle claim · ${shortHex(season.entry.wallet)}`
                        : "No season allocation for this wallet"}
            </p>
            {season.entry && (
                <button
                    type="button"
                    className={`match-stats-cta claim ${season.canClaim ? "" : "soon"}`}
                    onClick={() => {
                        if (season.canClaim) void season.claim();
                    }}
                    disabled={!season.canClaim || season.claiming}
                >
                    {season.claiming
                        ? "Claiming…"
                        : season.claimed
                            ? "Claimed"
                            : season.canClaim
                                ? "Claim Season CHIPS"
                                : "Season · locked"}
                </button>
            )}
            {season.error && (
                <p className="match-stats-claim-note" style={{ color: "#fca5a5" }}>
                    {season.error}
                </p>
            )}
        </div>
    );
}
