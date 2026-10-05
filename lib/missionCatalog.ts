/**
 * Daily/weekly mission catalog reader — the only place those rewards come from.
 *
 * Replaces the three hardcoded daily/weekly reward tables (migration
 * 202609300003): `app/api/missions/claim` REWARDS, `app/api/missions/list`
 * DAILY_MISSIONS, and `lib/missionVoucher.ts` ONBOARDING_REWARDS' daily entries.
 *
 * SCOPE — daily + weekly only. Onboarding is deliberately NOT here: its rewards
 * predate the CHIPS cutover and stay at their original values (core package
 * 1000, expanded pack 350) in lib/onboardingShared.ts ONBOARDING_TRACKS, which
 * is browser-safe and already read by the onboarding UI and /api/onboarding/*.
 * Keeping a copy here too would recreate the drift this module removes.
 *
 * Rewards are whole CHIPS; the on-chain amount is `reward_chips * 1e18`. The
 * 5..20 band is enforced by a CHECK constraint on the table, not here, so a
 * direct psql write cannot introduce an out-of-band value either.
 */
import type { Hex } from "viem";
import { keccak256, toBytes } from "viem";
import { serviceDb } from "@/lib/serverAuth";
import { periodIdDay, periodIdWeek, isoWeekLabel } from "@/lib/missionVoucher";

export type MissionCategory = "onboarding" | "daily" | "weekly";
export type MissionPeriod = "once" | "day" | "week";

export interface MissionDef {
    missionId: string;
    category: MissionCategory;
    period: MissionPeriod;
    title: string;
    description: string;
    target: number;
    /** Whole CHIPS. */
    rewardChips: number;
    sortOrder: number;
}

/** Stable constant epoch for one-time (onboarding) missions. */
const ONBOARDING_PERIOD: Hex = keccak256(toBytes("ludo-onboarding-v1"));

const SELECT =
    "mission_id, category, period, title, description, target, reward_chips, active, sort_order";

function toDef(r: Record<string, unknown>): MissionDef {
    return {
        missionId: String(r.mission_id),
        category: r.category as MissionCategory,
        period: r.period as MissionPeriod,
        title: String(r.title ?? ""),
        description: String(r.description ?? ""),
        target: Number(r.target ?? 0),
        rewardChips: Number(r.reward_chips ?? 0),
        sortOrder: Number(r.sort_order ?? 0),
    };
}

/** All active missions, ordered for display. */
export async function loadMissionCatalog(): Promise<MissionDef[]> {
    const { data, error } = await serviceDb()
        .from("mission_catalog")
        .select(SELECT)
        .eq("active", true)
        .order("category", { ascending: true })
        .order("sort_order", { ascending: true });
    if (error) throw new Error(`mission_catalog read failed: ${error.message}`);
    return (data ?? []).map(toDef);
}

export async function loadMissionDef(missionId: string): Promise<MissionDef | null> {
    const { data, error } = await serviceDb()
        .from("mission_catalog")
        .select(SELECT)
        .eq("mission_id", missionId)
        .eq("active", true)
        .maybeSingle();
    if (error) throw new Error(`mission_catalog read failed: ${error.message}`);
    return data ? toDef(data as Record<string, unknown>) : null;
}

/**
 * On-chain `periodId` for a mission.
 *
 * One-time missions share a constant epoch so their single claim is never
 * windowed. Daily/weekly missions get a UTC-scoped id, which is what makes the
 * contract's `usedVoucher` key distinct per period and caps replays to one per
 * period per wallet.
 */
export function periodIdFor(def: MissionDef, now = new Date()): Hex {
    switch (def.period) {
        case "day":
            return periodIdDay(now);
        case "week":
            return periodIdWeek(now);
        case "once":
        default:
            return ONBOARDING_PERIOD;
    }
}

/**
 * DB-side bucket stored in `player_missions.period_id`.
 *
 * Deliberately a different representation from the on-chain `periodId`: the
 * bucket must be a readable, sortable string so progress rows can be grouped
 * and expired with plain SQL, whereas the on-chain id must be an opaque bytes32
 * the contract can compare cheaply. Both are derived from the same catalog
 * `period` via the same calendar maths, so they cannot disagree about when a
 * period rolls over.
 */
export function periodBucketFor(def: Pick<MissionDef, "period">, now = new Date()): string {
    switch (def.period) {
        case "day":
            return now.toISOString().slice(0, 10);
        case "week":
            return isoWeekLabel(now);
        case "once":
        default:
            return "legacy";
    }
}

/** ISO-8601 week-year label `YYYY-Www`, computed in UTC. */
export { isoWeekLabel };

/** Canonical `missionId` bytes32 for the voucher / on-chain accounting. */
export function missionIdBytes32(missionId: string): Hex {
    return keccak256(toBytes(missionId));
}

/** Whole-CHIPS reward -> on-chain base-unit amount. */
export function chipsToBaseUnits(rewardChips: number): bigint {
    if (!Number.isFinite(rewardChips) || rewardChips <= 0) {
        throw new Error(`invalid reward_chips: ${rewardChips}`);
    }
    // numeric(12,2) in Postgres -> scale by 1e18 after keeping 2 decimals.
    const scaled = Math.round(rewardChips * 100);
    return (BigInt(scaled) * BigInt(10) ** BigInt(16));
}

/**
 * Eligibility for claiming a daily/weekly mission.
 *
 * Onboarding missions are gated by their own `onboarding_progress` row and are
 * validated by lib/onboardingShared.checkTrackClaimable instead.
 */
export function checkMissionClaimable(
    def: MissionDef,
    progress: number | null | undefined,
    isClaimed: boolean,
): { ok: true } | { ok: false; error: string; status: number } {
    if (isClaimed) return { ok: false, error: "Already claimed", status: 400 };
    const p = progress ?? 0;
    if (p < def.target) {
        return {
            ok: false,
            error: `Mission not complete: ${p}/${def.target}`,
            status: 400,
        };
    }
    return { ok: true };
}
