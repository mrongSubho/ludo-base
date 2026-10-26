// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MissionSystem} from "../src/MissionSystem.sol";
import {MockChips} from "./MockChips.sol";
import {EIP712} from "../src/lib/EIP712.sol";

/// @dev Mirror the events so vm.expectEmit can match them by signature.
interface MissionSystemEvents {
    event MissionCompleted(address indexed wallet, bytes32 indexed missionId, bytes32 period, uint256 reward);
    event MissionClaimed(address indexed wallet, bytes32 indexed missionId, bytes32 period, uint256 reward);
    event ProgressRecorded(
        address indexed wallet, bytes32 indexed missionId, bytes32 period, uint256 progress, bool completed
    );
    event FreeMatchSynced(
        address indexed player, bytes32 indexed matchId, uint8 won, uint8 isPvp, uint16 captures, uint64 playedAt
    );
}

contract MissionSystemTest is Test {
    MockChips chips;
    MissionSystem missions;

    address owner = address(0xA11CE);
    uint256 oraclePk = 0x071CE;
    address oracle;
    address alice = address(0xA1);
    address bob = address(0xB0);
    address mallory = address(0xBAD);
    address treasury = address(0x7EA5);

    bytes32 constant DAILY = keccak256("daily_play_3");
    bytes32 constant DAILY_WIN = keccak256("daily_win_1");
    bytes32 constant DAILY_CAP = keccak256("daily_capture_2");
    bytes32 constant WEEKLY = keccak256("weekly_play_10");
    bytes32 constant WEEKLY_WIN = keccak256("weekly_win_3");
    bytes32 constant WEEKLY_CAP = keccak256("weekly_capture_10");
    bytes32 constant WEEKLY_PVP = keccak256("weekly_pvp_2");
    bytes32 constant ONCE = keccak256("onboarding_tutorial");
    bytes32 constant PREREQ = keccak256("core_prereq");

    function setUp() public {
        oracle = vm.addr(oraclePk);
        chips = new MockChips();
        vm.prank(owner);
        missions = new MissionSystem(chips, oracle, owner);
        // Fund the contract reserve.
        chips.mint(treasury, 1_000_000e18);
        vm.prank(treasury);
        chips.approve(address(missions), 1_000_000e18);
        vm.prank(treasury);
        missions.fund(1_000_000e18);
    }

    function _signFreeMatch(uint256 pk, MissionSystem.FreeMatchAttestation memory m) internal view returns (bytes memory) {
        bytes32 domainSep = EIP712.domainHash("LudoBase MissionSystem", address(missions));
        bytes32 structHash = keccak256(
            abi.encode(
                missions.FREE_MATCH_TYPEHASH(),
                m.matchId,
                m.player,
                m.won,
                m.isPvp,
                m.captures,
                m.playedAt,
                m.deadline
            )
        );
        bytes32 digest = EIP712.digest(domainSep, structHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    // ── Mission creation (owner) ───────────────────────────────────────────────

    function test_setMission_onlyOwner_and_valid() public {
        vm.prank(mallory);
        vm.expectRevert(MissionSystem.OnlyOwner.selector);
        missions.setMission(DAILY, MissionSystem.MissionKind.DAY, 10e18, 3, bytes32(0), true);

        vm.prank(owner);
        vm.expectRevert(MissionSystem.BadParam.selector);
        missions.setMission(bytes32(0), MissionSystem.MissionKind.DAY, 10e18, 3, bytes32(0), true);

        vm.prank(owner);
        missions.setMission(DAILY, MissionSystem.MissionKind.DAY, 10e18, 3, bytes32(0), true);
        // Re-configuration is allowed (update path).
        vm.prank(owner);
        missions.setMission(DAILY, MissionSystem.MissionKind.DAY, 8e18, 3, bytes32(0), true);
    }

    // ── Progress authority (oracle only) ─────────────────────────────────────────

    function test_recordProgress_requires_oracle() public {
        vm.prank(owner);
        missions.setMission(DAILY, MissionSystem.MissionKind.DAY, 10e18, 3, bytes32(0), true);

        vm.prank(mallory);
        vm.expectRevert(MissionSystem.OnlyOracle.selector);
        missions.recordProgress(alice, DAILY, 1);

        // Oracle (and owner) may record.
        vm.prank(oracle);
        missions.recordProgress(alice, DAILY, 1);
        assertEq(missions.progress(alice, DAILY, missions.currentPeriod(DAILY)), 1);
    }

    function test_recordProgress_on_unknown_or_inactive_mission() public {
        vm.prank(oracle);
        // Unconfigured mission does nothing (no revert on unknown so sync doesn't fail).
        missions.recordProgress(alice, DAILY, 1);

        vm.prank(owner);
        missions.setMission(DAILY, MissionSystem.MissionKind.DAY, 10e18, 3, bytes32(0), false);

        vm.prank(oracle);
        missions.recordProgress(alice, DAILY, 1);
        assertEq(missions.progress(alice, DAILY, missions.currentPeriod(DAILY)), 0);
    }

    function test_recordProgress_zero_delta_reverts() public {
        vm.prank(owner);
        missions.setMission(DAILY, MissionSystem.MissionKind.DAY, 10e18, 3, bytes32(0), true);
        vm.prank(oracle);
        vm.expectRevert(MissionSystem.BadParam.selector);
        missions.recordProgress(alice, DAILY, 0);
    }

    // ── Progress accrual, completion, pull payout ───────────────────────────────

    function test_progress_accrues_and_pulls_on_claim() public {
        vm.prank(owner);
        missions.setMission(DAILY, MissionSystem.MissionKind.DAY, 10e18, 3, bytes32(0), true);

        bytes32 period = missions.currentPeriod(DAILY);

        // Two partial updates, then the third completes it (capped at target).
        vm.prank(oracle);
        missions.recordProgress(alice, DAILY, 1);
        vm.prank(oracle);
        missions.recordProgress(alice, DAILY, 1);
        assertEq(missions.progress(alice, DAILY, period), 2);
        assertFalse(missions.completed(alice, DAILY, period));

        uint256 before = chips.balanceOf(alice);
        vm.expectEmit(true, true, true, true, address(missions));
        emit MissionSystemEvents.MissionCompleted(alice, DAILY, period, 10e18);
        vm.prank(oracle);
        missions.recordProgress(alice, DAILY, 5); // delta overshoots -> capped at 3

        assertEq(missions.progress(alice, DAILY, period), 3, "capped at target");
        assertTrue(missions.completed(alice, DAILY, period), "completed");
        // Pull model: no automatic transfer yet
        assertEq(chips.balanceOf(alice), before, "tokens not pushed automatically");
        assertTrue(missions.isCompleted(alice, DAILY), "isCompleted(view) true in current period");
        assertFalse(missions.isClaimed(alice, DAILY), "not claimed yet");

        // Alice pulls her reward
        vm.expectEmit(true, true, true, true, address(missions));
        emit MissionSystemEvents.MissionClaimed(alice, DAILY, period, 10e18);
        vm.prank(alice);
        missions.claimMission(DAILY);

        assertEq(chips.balanceOf(alice), before + 10e18, "reward received on claim");
        assertEq(missions.totalClaimed(), 10e18);
        assertTrue(missions.isClaimed(alice, DAILY), "claimed marked true");

        // Double claim reverts
        vm.prank(alice);
        vm.expectRevert(MissionSystem.AlreadyClaimed.selector);
        missions.claimMission(DAILY);
    }

    // ── Scheduling: DAY and WEEK rollover & forfeiture ──────────────────────────

    function test_daily_mission_forfeits_past_unclaimed_on_day_rollover() public {
        vm.prank(owner);
        missions.setMission(DAILY, MissionSystem.MissionKind.DAY, 10e18, 1, bytes32(0), true);

        // Day 0: complete but do NOT claim
        vm.prank(oracle);
        missions.recordProgress(alice, DAILY, 1);
        bytes32 day0 = missions.currentPeriod(DAILY);
        assertTrue(missions.completed(alice, DAILY, day0));

        // Advance to next UTC day (period rolls over)
        uint256 dayStart = block.timestamp;
        vm.warp(dayStart + 1 days + 1);
        bytes32 day1 = missions.currentPeriod(DAILY);
        assertNotEq(day0, day1, "period rolled over");

        // Claiming now looks at current period (day 1) which is not yet completed -> forfeits!
        vm.prank(alice);
        vm.expectRevert(MissionSystem.NotFound.selector);
        missions.claimMission(DAILY);

        // Complete for Day 1 and claim
        vm.prank(oracle);
        missions.recordProgress(alice, DAILY, 1);
        vm.prank(alice);
        missions.claimMission(DAILY);
        assertEq(chips.balanceOf(alice), 10e18, "only day 1 claimed");
    }

    function test_weekly_mission_resets_on_sunday_and_forfeits_unclaimed() public {
        vm.prank(owner);
        missions.setMission(WEEKLY, MissionSystem.MissionKind.WEEK, 20e18, 1, bytes32(0), true);

        vm.prank(oracle);
        missions.recordProgress(alice, WEEKLY, 1);
        bytes32 wk0 = missions.currentPeriod(WEEKLY);
        assertTrue(missions.completed(alice, WEEKLY, wk0));

        // Warp 8 days across Sunday UTC 00:00 boundary
        vm.warp(block.timestamp + 8 days);
        bytes32 wk1 = missions.currentPeriod(WEEKLY);
        assertNotEq(wk0, wk1, "week rolled over");

        // Unclaimed reward from wk0 is forfeited
        vm.prank(alice);
        vm.expectRevert(MissionSystem.NotFound.selector);
        missions.claimMission(WEEKLY);
    }

    function test_once_mission_completes_and_claims_a_single_time() public {
        vm.prank(owner);
        missions.setMission(ONCE, MissionSystem.MissionKind.ONCE, 50e18, 1, bytes32(0), true);

        vm.prank(oracle);
        missions.recordProgress(alice, ONCE, 1);
        assertTrue(missions.isCompleted(alice, ONCE));

        vm.prank(alice);
        missions.claimMission(ONCE);
        assertEq(chips.balanceOf(alice), 50e18);

        // Never resets — second claim reverts
        vm.warp(block.timestamp + 365 days);
        vm.prank(alice);
        vm.expectRevert(MissionSystem.AlreadyClaimed.selector);
        missions.claimMission(ONCE);
    }

    // ── Free Match Batch Sync ──────────────────────────────────────────────────

    function test_syncFreeMatches_happy_path() public {
        vm.prank(owner);
        missions.setMission(DAILY, MissionSystem.MissionKind.DAY, 10e18, 3, bytes32(0), true);
        vm.prank(owner);
        missions.setMission(DAILY_WIN, MissionSystem.MissionKind.DAY, 10e18, 1, bytes32(0), true);
        vm.prank(owner);
        missions.setMission(WEEKLY, MissionSystem.MissionKind.WEEK, 20e18, 10, bytes32(0), true);

        MissionSystem.FreeMatchAttestation[] memory batch = new MissionSystem.FreeMatchAttestation[](2);
        batch[0] = MissionSystem.FreeMatchAttestation({
            matchId: keccak256("match_1"),
            player: alice,
            won: 1,
            isPvp: 1,
            captures: 2,
            playedAt: uint64(block.timestamp),
            deadline: uint64(block.timestamp + 1 hours)
        });
        batch[1] = MissionSystem.FreeMatchAttestation({
            matchId: keccak256("match_2"),
            player: alice,
            won: 0,
            isPvp: 1,
            captures: 1,
            playedAt: uint64(block.timestamp),
            deadline: uint64(block.timestamp + 1 hours)
        });

        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _signFreeMatch(oraclePk, batch[0]);
        sigs[1] = _signFreeMatch(oraclePk, batch[1]);

        vm.prank(alice);
        missions.syncFreeMatches(batch, sigs);

        // Progress checked
        bytes32 dayPeriod = missions.currentPeriod(DAILY);
        (uint256 playProg, ) = missions.getProgress(alice, DAILY, dayPeriod);
        assertEq(playProg, 2, "2 matches played");

        (uint256 winProg, bool winDone) = missions.getProgress(alice, DAILY_WIN, dayPeriod);
        assertEq(winProg, 1, "1 win recorded");
        assertTrue(winDone, "daily win completed");

        // Alice claims her daily win
        vm.prank(alice);
        missions.claimMission(DAILY_WIN);
        assertEq(chips.balanceOf(alice), 10e18, "daily win reward claimed");

        // Replay of same match reverts
        vm.prank(alice);
        vm.expectRevert(MissionSystem.AlreadyCompleted.selector);
        missions.syncFreeMatches(batch, sigs);
    }

    function test_syncFreeMatches_late_sync_daily_forfeits_but_weekly_credits() public {
        vm.prank(owner);
        missions.setMission(DAILY, MissionSystem.MissionKind.DAY, 10e18, 3, bytes32(0), true);
        vm.prank(owner);
        missions.setMission(WEEKLY, MissionSystem.MissionKind.WEEK, 20e18, 10, bytes32(0), true);

        uint64 playedYesterday = 100;
        vm.warp(100 + 1 days + 1); // advance to tomorrow

        MissionSystem.FreeMatchAttestation[] memory batch = new MissionSystem.FreeMatchAttestation[](1);
        batch[0] = MissionSystem.FreeMatchAttestation({
            matchId: keccak256("match_yesterday"),
            player: alice,
            won: 1,
            isPvp: 1,
            captures: 0,
            playedAt: playedYesterday,
            deadline: uint64(block.timestamp + 1 hours)
        });

        bytes[] memory sigs = new bytes[](1);
        sigs[0] = _signFreeMatch(oraclePk, batch[0]);

        vm.prank(alice);
        missions.syncFreeMatches(batch, sigs);

        // Today's daily play is NOT incremented because match was played yesterday (forfeited daily)
        bytes32 todayPeriod = missions.currentPeriod(DAILY);
        (uint256 dailyProg, ) = missions.getProgress(alice, DAILY, todayPeriod);
        assertEq(dailyProg, 0, "yesterday match does not count for today's daily");

        // But weekly play IS incremented if within the same Sunday-aligned week
        bytes32 weekPeriod = missions.currentPeriod(WEEKLY);
        (uint256 weeklyProg, ) = missions.getProgress(alice, WEEKLY, weekPeriod);
        assertEq(weeklyProg, 1, "yesterday match counts for weekly if in same week");
    }

    // ── Prerequisite gating ──────────────────────────────────────────────────────

    function test_prerequisite_must_be_completed_first() public {
        vm.prank(owner);
        missions.setMission(PREREQ, MissionSystem.MissionKind.ONCE, 5e18, 1, bytes32(0), true);
        vm.prank(owner);
        missions.setMission(ONCE, MissionSystem.MissionKind.ONCE, 50e18, 1, PREREQ, true);

        bytes32 period = missions.currentPeriod(ONCE);

        vm.prank(oracle);
        vm.expectRevert(MissionSystem.PrerequisiteNotMet.selector);
        missions.recordProgress(alice, ONCE, 1);

        vm.prank(oracle);
        missions.recordProgress(alice, PREREQ, 1);
        assertTrue(missions.completed(alice, PREREQ, period));

        // Now dependent completes
        vm.prank(oracle);
        missions.recordProgress(alice, ONCE, 1);
        assertTrue(missions.completed(alice, ONCE, period));

        // Alice claims both
        vm.prank(alice);
        missions.claimMission(PREREQ);
        vm.prank(alice);
        missions.claimMission(ONCE);
        assertEq(chips.balanceOf(alice), 55e18);
    }

    // ── Pause ───────────────────────────────────────────────────────────────────

    function test_paused_blocks_progress_and_claim() public {
        vm.prank(owner);
        missions.setMission(DAILY, MissionSystem.MissionKind.DAY, 10e18, 1, bytes32(0), true);
        vm.prank(oracle);
        missions.recordProgress(alice, DAILY, 1);

        vm.prank(owner);
        missions.setPaused(true);

        vm.prank(alice);
        vm.expectRevert(MissionSystem.Paused.selector);
        missions.claimMission(DAILY);

        vm.prank(owner);
        missions.setPaused(false);
        vm.prank(alice);
        missions.claimMission(DAILY);
        assertEq(chips.balanceOf(alice), 10e18);
    }

    function test_setPaused_and_setOracle_onlyOwner() public {
        vm.prank(mallory);
        vm.expectRevert(MissionSystem.OnlyOwner.selector);
        missions.setPaused(true);
        vm.prank(mallory);
        vm.expectRevert(MissionSystem.OnlyOwner.selector);
        missions.setProgressOracle(oracle);
    }

    // ── Funding / reserve bookkeeping ────────────────────────────────────────────

    function test_fund_and_reserve_accounting() public {
        assertEq(chips.balanceOf(address(missions)), 1_000_000e18);
        assertEq(missions.totalDeposited(), 1_000_000e18);
        assertEq(missions.availableReserves(), 1_000_000e18, "no floor -> whole balance");

        vm.prank(owner);
        missions.setMinReserve(100_000e18);
        assertEq(missions.availableReserves(), 900_000e18, "headroom shrinks by floor");
    }

    function test_fund_zero_reverts() public {
        vm.prank(treasury);
        vm.expectRevert(MissionSystem.BadParam.selector);
        missions.fund(0);
    }

    function test_withdraw_surplus_respects_floor() public {
        vm.prank(owner);
        missions.setMinReserve(100_000e18);
        uint256 bal = chips.balanceOf(address(missions));
        vm.prank(owner);
        vm.expectRevert(MissionSystem.ReserveFloor.selector);
        missions.withdrawSurplus(bal); // would breach floor

        uint256 before = chips.balanceOf(owner);
        vm.prank(owner);
        missions.withdrawSurplus(bal - 100_000e18);
        assertEq(chips.balanceOf(owner), before + bal - 100_000e18);
        assertEq(chips.balanceOf(address(missions)), 100_000e18, "floor intact");
        assertEq(missions.totalWithdrawn(), bal - 100_000e18);
    }

    function test_withdraw_surplus_onlyOwner() public {
        vm.prank(mallory);
        vm.expectRevert(MissionSystem.OnlyOwner.selector);
        missions.withdrawSurplus(1);
    }
}
