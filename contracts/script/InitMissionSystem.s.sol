// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {MissionSystem} from "../src/MissionSystem.sol";

/**
 * @notice Register every existing mission on-chain in MissionSystem.
 *
 * Ids are keccak256 of the catalog strings — exactly what the off-chain system
 * uses (missionIdBytes32: keccak256(toBytes(id)) in lib/missionCatalog.ts), so a
 * mission registered here is the same bytes32 the server reports progress against
 * via recordProgress. (For MissionClaim the same keccak is what the voucher carries.)
 *
 * Scheduling is derived from block.timestamp inside the contract:
 *     ONCE -> constant epoch, DAY -> UTC-day index, WEEK -> rolling 7-day index.
 * So there are NO period windows to open here (unlike MissionClaim, which needs
 * setPeriod calls). This script only calls setMission per mission.
 *
 * Reward = whole CHIPS x 1e18, mirroring the server's chipsToBaseUnits and the
 * catalog migration supabase/migrations/202609300003_mission_catalog.sql.
 *
 * Targets come straight from that migration. Onboarding tracks become ONCE
 * missions with target 1 (the oracle reports the track complete as delta 1).
 * Prerequisites are left unset (0) in this seed; the contract supports them
 * (see test_prerequisite_must_be_completed_first) and can be wired later by
 * re-calling setMission with a non-zero prerequisite bytes32.
 *
 * Usage
 * -----
 *   forge script script/InitMissionSystem.s.sol \
 *     --rpc-url $SEPOLIA_RPC --account mydeployer --broadcast \
 *     # env: MISSION_SYSTEM_ADDRESS (required)
 *     # NOTE: setMission is onlyOwner and the owner is mydeployer (0xbcCa).
 *     # The contract's owner was set to GAME_OWNER == 0xbcCa at deploy time, which
 *     # IS the mydeployer key — so this MUST broadcast as --account mydeployer.
 *     # Plain `forge` is fine here (setMission touches no CHIPS/B20 precompile).
 */
contract InitMissionSystem is Script {
    uint256 constant ONE = 1e18;

    function run() external {
        address sysAddr = vm.envAddress("MISSION_SYSTEM_ADDRESS");
        MissionSystem missions = MissionSystem(sysAddr);

        vm.startBroadcast();

        // ── Daily (catalog: 202609300003_mission_catalog.sql) ──────────────────
        _reg(missions, "daily_bonus",     MissionSystem.MissionKind.DAY,  0, 10);
        _reg(missions, "daily_play_3",    MissionSystem.MissionKind.DAY,  3,  8);
        _reg(missions, "daily_win_1",     MissionSystem.MissionKind.DAY,  1, 12);
        _reg(missions, "daily_poke_back", MissionSystem.MissionKind.DAY,  1,  6);
        _reg(missions, "daily_capture_2", MissionSystem.MissionKind.DAY,  2, 10);
        _reg(missions, "daily_predict_1", MissionSystem.MissionKind.DAY,  1, 12);

        // ── Weekly ────────────────────────────────────────────────────────────
        _reg(missions, "weekly_play_10",    MissionSystem.MissionKind.WEEK, 10, 20);
        _reg(missions, "weekly_win_3",      MissionSystem.MissionKind.WEEK,  3, 18);
        _reg(missions, "weekly_capture_10", MissionSystem.MissionKind.WEEK, 10, 15);
        _reg(missions, "weekly_pvp_2",      MissionSystem.MissionKind.WEEK,  2, 15);
        _reg(missions, "weekly_spectate_5", MissionSystem.MissionKind.WEEK,  5, 12);
        _reg(missions, "weekly_friend_dm_3", MissionSystem.MissionKind.WEEK,  3, 10);

        // ── Onboarding (ONCE; mirrors InitMissions.s.sol for MissionClaim) ─────
        _reg(missions, "tutorial",   MissionSystem.MissionKind.ONCE, 1, 100);
        _reg(missions, "ai_classic", MissionSystem.MissionKind.ONCE, 1, 100);
        _reg(missions, "ai_power",   MissionSystem.MissionKind.ONCE, 1, 100);
        _reg(missions, "ai_snakes",  MissionSystem.MissionKind.ONCE, 1, 100);
        _reg(missions, "pvp",        MissionSystem.MissionKind.ONCE, 1, 150);
        _reg(missions, "playtime",   MissionSystem.MissionKind.ONCE, 1, 150);
        _reg(missions, "social",     MissionSystem.MissionKind.ONCE, 1, 300);
        _reg(missions, "day2",       MissionSystem.MissionKind.ONCE, 1,  50);
        _reg(missions, "day3",       MissionSystem.MissionKind.ONCE, 1, 100);
        _reg(missions, "friend_dm",  MissionSystem.MissionKind.ONCE, 1, 100);
        _reg(missions, "clan",       MissionSystem.MissionKind.ONCE, 1, 100);

        vm.stopBroadcast();

        console.log("MissionSystem", sysAddr);
        console.log("registered missions: 6 daily + 6 weekly + 11 onboarding = 23");
    }

    function _reg(
        MissionSystem missions,
        string memory id,
        MissionSystem.MissionKind kind,
        uint256 target,
        uint256 rewardChips
    ) internal {
        missions.setMission(
            keccak256(bytes(id)), // missionId bytes32 — matches lib/missionCatalog.ts
            kind,
            rewardChips * ONE, // reward in 1e18 base units
            target, // progress threshold (0 = completes on first progress event)
            bytes32(0), // prerequisite — none in this seed
            true // active
        );
    }
}
