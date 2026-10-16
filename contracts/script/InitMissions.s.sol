// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {MissionClaim} from "../src/MissionClaim.sol";
import {IChips} from "../src/interfaces/IChips.sol";

/**
 * Make claiming operational end-to-end on a freshly deployed MissionClaim:
 *   1. register every mission with its fixed reward + availability
 *   2. open the current daily and weekly claim windows
 *   3. set the issuance ceiling, the reserve floor, and (optionally) the
 *      ClaimHub relayer the app relays through
 *
 * Ids are keccak256 of the catalog strings — exactly what the server signs
 * (`missionIdBytes32`: keccak256(toBytes(id)) in lib/missionCatalog.ts), so a
 * mission registered here is the same bytes32 the voucher carries.
 *
 * Rewards are whole CHIPS x 1e18, mirroring the server's
 * `chipsToBaseUnits` (lib/missionCatalog.ts) and the catalog in
 * supabase/migrations/202609300003_mission_catalog.sql.
 *
 * Usage:
 *   forge script script/InitMissions.s.sol \
 *     --rpc-url $SEPOLIA_RPC --account deployer --broadcast \
 *     # env: MISSION_CLAIM_ADDRESS (required), MISSION_OP_KEY (info),
 *     #      PERIOD_CEILING, MIN_RESERVE, CLAIM_RELAYER
 */
contract InitMissions is Script {
    uint256 constant ONE = 1e18;

    function run() external {
        address claimAddr = vm.envAddress("MISSION_CLAIM_ADDRESS");
        MissionClaim missions = MissionClaim(claimAddr);

        uint256 ceiling = vm.envOr("PERIOD_CEILING", uint256(100_000 * ONE));
        uint256 reserve = vm.envOr("MIN_RESERVE", uint256(500 * ONE));
        address relayer = vm.envOr("CLAIM_RELAYER", address(0));

        vm.startBroadcast();

        // ── Daily missions (catalog: 202609300003_mission_catalog.sql) ────────
        _register(missions, "daily_bonus", 10);
        _register(missions, "daily_play_3", 8);
        _register(missions, "daily_win_1", 12);
        _register(missions, "daily_poke_back", 6);
        _register(missions, "daily_capture_2", 10);
        _register(missions, "daily_predict_1", 12);

        // ── Weekly missions ───────────────────────────────────────────────────
        _register(missions, "weekly_play_10", 20);
        _register(missions, "weekly_win_3", 18);
        _register(missions, "weekly_capture_10", 15);
        _register(missions, "weekly_pvp_2", 15);
        _register(missions, "weekly_spectate_5", 12);
        _register(missions, "weekly_friend_dm_3", 10);

        // ── Onboarding tracks (lib/onboardingShared.ts) ───────────────────────
        _register(missions, "tutorial", 100);
        _register(missions, "ai_classic", 100);
        _register(missions, "ai_power", 100);
        _register(missions, "ai_snakes", 100);
        _register(missions, "pvp", 150);
        _register(missions, "playtime", 150);
        _register(missions, "social", 300);
        _register(missions, "day2", 50);
        _register(missions, "day3", 100);
        _register(missions, "friend_dm", 100);
        _register(missions, "clan", 100);

        // ── Contract-level config ─────────────────────────────────────────────
        missions.setPerPeriodCeiling(ceiling);
        missions.setMinReserve(reserve);
        if (relayer != address(0)) {
            missions.setClaimRelayer(relayer, true);
            console.log("ClaimHub relayer", relayer);
        }

        // ── Open the current daily + weekly windows ───────────────────────────
        // Period ids must match the server: keccak of the UTC day string and of
        // the ISO-week label (lib/missionVoucher.ts periodIdDay / periodIdWeek).
        (bytes32 dayId, uint64 dayStart, uint64 dayEnd) = _utcDay(block.timestamp);
        (bytes32 weekId, uint64 weekStart, uint64 weekEnd) = _isoWeek(block.timestamp);
        missions.setPeriod(dayId, dayStart, dayEnd);
        missions.setPeriod(weekId, weekStart, weekEnd);

        vm.stopBroadcast();

        console.log("MissionClaim", claimAddr);
        console.log("ceiling (per period)", ceiling);
        console.log("minReserve", reserve);
        console.log("daily period id", vm.toString(dayId));
        console.log("  window", dayStart, "->", dayEnd);
        console.log("weekly period id", vm.toString(weekId));
        console.log("  window", weekStart, "->", weekEnd);
        console.log("registered missions: 6 daily + 6 weekly + 11 onboarding = 23");
    }

    function _register(MissionClaim missions, string memory id, uint256 reward) internal {
        missions.setMission(keccak256(bytes(id)), reward * ONE, true);
    }

    /// UTC day bucket containing `ts`.
    function _utcDay(uint256 ts) internal pure returns (bytes32 id, uint64 start, uint64 end) {
        start = uint64((ts / 1 days) * 1 days);
        end = start + uint64(1 days);
        id = keccak256(bytes(_isoDate(start)));
    }

    /// ISO-8601 week bucket containing `ts` (weeks start Monday 00:00 UTC).
    function _isoWeek(uint256 ts) internal pure returns (bytes32 id, uint64 start, uint64 end) {
        uint64 dayStart = uint64((ts / 1 days) * 1 days);
        // Days since Thursday of the current ISO week -> weekday index (Mon=0).
        uint256 weekday = (ts / 1 days + 4) % 7;
        start = dayStart - uint64(weekday * 1 days);
        end = start + uint64(7 days);
        // Label is YYYY-Www of the week containing `start` (its Thursday).
        id = keccak256(bytes(_isoWeekLabel(start)));
    }

    /// Minimal `YYYY-MM-DD` for a UTC-day-aligned timestamp (no leap-second maths:
    /// the civil-date algorithm is the standard Howard Hinnant days-from-civil).
    function _isoDate(uint256 dayStart) internal pure returns (string memory) {
        uint256 z = dayStart / 1 days + 719468;
        uint256 era = z / 146097;
        uint256 doe = z - era * 146097;
        uint256 yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
        uint256 y = yoe + era * 400;
        uint256 doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        uint256 mp = (5 * doy + 2) / 153;
        uint256 d = doy - (153 * mp + 2) / 5 + 1;
        uint256 m = mp < 10 ? mp + 3 : mp - 9;
        if (m <= 2) y += 1;
        return string.concat(vm.toString(y), "-", _pad2(m), "-", _pad2(d));
    }

    /// `YYYY-Www` where Www is the ISO week number of the week starting at `weekStart`.
    function _isoWeekLabel(uint256 weekStart) internal pure returns (string memory) {
        // The Thursday of this week identifies the ISO year.
        uint256 thursday = (weekStart / 1 days) + 3;
        uint256 z = thursday + 719468;
        uint256 era = z / 146097;
        uint256 doe = z - era * 146097;
        uint256 yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
        uint256 y = yoe + era * 400;
        uint256 doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        uint256 mp = (5 * doy + 2) / 153;
        uint256 m = mp < 10 ? mp + 3 : mp - 9;
        if (m <= 2) y += 1;
        // ISO week number = (thursday's ordinal - Jan 1's ordinal) / 7 + 1.
        uint256 yearStart = _daysFromCivil(y, 1, 1);
        uint256 week = (thursday - yearStart) / 7 + 1;
        return string.concat(vm.toString(y), "-W", week < 10 ? string.concat("0", vm.toString(week)) : vm.toString(week));
    }

    function _daysFromCivil(uint256 y, uint256 m, uint256 d) internal pure returns (uint256) {
        y -= m <= 2 ? 1 : 0;
        uint256 era = y / 400;
        uint256 yoe = y - era * 400;
        // March-based month index (Mar=0 … Feb=11) as unsigned arithmetic.
        uint256 mp = m > 2 ? m - 3 : m + 9;
        uint256 doy = (153 * mp + 2) / 5 + d - 1;
        uint256 doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        return era * 146097 + doe - 719468;
    }

    function _pad2(uint256 v) internal pure returns (string memory) {
        return v < 10 ? string.concat("0", vm.toString(v)) : vm.toString(v);
    }
}
