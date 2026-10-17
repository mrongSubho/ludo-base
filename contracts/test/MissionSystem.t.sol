// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MissionSystem} from "../src/MissionSystem.sol";
import {MockChips} from "./MockChips.sol";

/// @dev Mirror the events so vm.expectEmit can match them by signature.
interface MissionSystemEvents {
    event MissionCompleted(address indexed wallet, bytes32 indexed missionId, bytes32 period, uint256 reward);
    event PayoutPending(address indexed wallet, bytes32 indexed missionId, bytes32 period, uint256 reward);
    event ProgressRecorded(
        address indexed wallet, bytes32 indexed missionId, bytes32 period, uint256 progress, bool completed
    );
}

contract MissionSystemTest is Test {
    MockChips chips;
    MissionSystem missions;

    address owner = address(0xA11CE);
    address oracle = address(0x071CE); // progress oracle
    address alice = address(0xA1);
    address bob = address(0xB0);
    address mallory = address(0xBAD);
    address treasury = address(0x7EA5);

    bytes32 constant DAILY = keccak256("daily_play_3");
    bytes32 constant WEEKLY = keccak256("weekly_play_10");
    bytes32 constant ONCE = keccak256("onboarding_tutorial");
    bytes32 constant PREREQ = keccak256("core_prereq");

    function setUp() public {
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
        vm.expectRevert(MissionSystem.NotFound.selector);
        missions.recordProgress(alice, DAILY, 1);

        vm.prank(owner);
        missions.setMission(DAILY, MissionSystem.MissionKind.DAY, 10e18, 3, bytes32(0), false);

        vm.prank(oracle);
        vm.expectRevert(MissionSystem.NotActive.selector);
        missions.recordProgress(alice, DAILY, 1);
    }

    function test_recordProgress_zero_delta_reverts() public {
        vm.prank(owner);
        missions.setMission(DAILY, MissionSystem.MissionKind.DAY, 10e18, 3, bytes32(0), true);
        vm.prank(oracle);
        vm.expectRevert(MissionSystem.BadParam.selector);
        missions.recordProgress(alice, DAILY, 0);
    }

    // ── Progress accrual, completion, payout ─────────────────────────────────────

    function test_progress_accrues_and_pays_on_completion() public {
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
        assertEq(chips.balanceOf(alice), before + 10e18, "reward paid");
        assertEq(missions.totalClaimed(), 10e18);
        assertTrue(missions.isCompleted(alice, DAILY), "isCompleted(view) true in current period");
    }

    function test_already_completed_is_idempotent_no_double_pay() public {
        vm.prank(owner);
        missions.setMission(DAILY, MissionSystem.MissionKind.DAY, 10e18, 1, bytes32(0), true);
        bytes32 period = missions.currentPeriod(DAILY);

        vm.prank(oracle);
        missions.recordProgress(alice, DAILY, 1);
        assertTrue(missions.completed(alice, DAILY, period));

        uint256 before = chips.balanceOf(alice);
        // Oracle keeps reporting — must be a no-op, no second payout.
        vm.prank(oracle);
        missions.recordProgress(alice, DAILY, 1);
        vm.prank(oracle);
        missions.recordProgress(alice, DAILY, 99);
        assertEq(chips.balanceOf(alice), before, "no double pay");
        assertEq(missions.totalClaimed(), 10e18);
    }

    // ── Scheduling: DAY and WEEK rollover ────────────────────────────────────────

    function test_daily_mission_resets_each_day() public {
        vm.prank(owner);
        missions.setMission(DAILY, MissionSystem.MissionKind.DAY, 10e18, 1, bytes32(0), true);

        // Day 0: complete.
        vm.prank(oracle);
        missions.recordProgress(alice, DAILY, 1);
        bytes32 day0 = missions.currentPeriod(DAILY);
        assertTrue(missions.completed(alice, DAILY, day0));

        // Advance to next UTC day -> new period, fresh progress, payable again.
        uint256 dayStart = block.timestamp;
        vm.warp(dayStart + 1 days + 1);
        bytes32 day1 = missions.currentPeriod(DAILY);
        assertNotEq(day0, day1, "period rolled over");
        assertEq(missions.progress(alice, DAILY, day1), 0, "fresh progress next day");
        assertFalse(missions.completed(alice, DAILY, day1));

        uint256 before = chips.balanceOf(alice);
        vm.prank(oracle);
        missions.recordProgress(alice, DAILY, 1);
        assertEq(chips.balanceOf(alice), before + 10e18, "paid again next day");
        assertEq(missions.totalClaimed(), 20e18);
    }

    function test_weekly_mission_resets_each_week() public {
        vm.prank(owner);
        missions.setMission(WEEKLY, MissionSystem.MissionKind.WEEK, 20e18, 1, bytes32(0), true);

        vm.prank(oracle);
        missions.recordProgress(alice, WEEKLY, 1);
        bytes32 wk0 = missions.currentPeriod(WEEKLY);
        assertTrue(missions.completed(alice, WEEKLY, wk0));

        // Within the same 7-day bucket: still completed, no new payout.
        uint256 wkStart = block.timestamp;
        vm.warp(wkStart + 3 days);
        assertEq(missions.currentPeriod(WEEKLY), wk0, "same week bucket");
        uint256 mid = chips.balanceOf(alice);
        vm.prank(oracle);
        missions.recordProgress(alice, WEEKLY, 1);
        assertEq(chips.balanceOf(alice), mid, "no pay within same week");

        // Roll into the next 7-day bucket (t + 8 days).
        vm.warp(wkStart + 3 days + 5 days);
        bytes32 wk1 = missions.currentPeriod(WEEKLY);
        assertNotEq(wk0, wk1, "week rolled over");
        uint256 before = chips.balanceOf(alice);
        vm.prank(oracle);
        missions.recordProgress(alice, WEEKLY, 1);
        assertEq(chips.balanceOf(alice), before + 20e18, "paid in the new week");
    }

    function test_once_mission_completes_a_single_time() public {
        vm.prank(owner);
        missions.setMission(ONCE, MissionSystem.MissionKind.ONCE, 50e18, 1, bytes32(0), true);

        vm.prank(oracle);
        missions.recordProgress(alice, ONCE, 1);
        assertTrue(missions.isCompleted(alice, ONCE));

        // Never resets — same constant period forever.
        uint256 onceStart = block.timestamp;
        vm.warp(onceStart + 365 days);
        assertEq(missions.currentPeriod(ONCE), missions.currentPeriod(ONCE), "ONCE period is constant");
        uint256 before = chips.balanceOf(alice);
        vm.prank(oracle);
        missions.recordProgress(alice, ONCE, 1);
        assertEq(chips.balanceOf(alice), before, "no second payout, ever");
    }

    // ── Prerequisite gating ──────────────────────────────────────────────────────

    function test_prerequisite_must_be_completed_first() public {
        vm.prank(owner);
        missions.setMission(PREREQ, MissionSystem.MissionKind.ONCE, 5e18, 1, bytes32(0), true);
        vm.prank(owner);
        missions.setMission(ONCE, MissionSystem.MissionKind.ONCE, 50e18, 1, PREREQ, true); // depends on PREREQ

        bytes32 period = missions.currentPeriod(ONCE);

        // Completing the dependent first must fail the gate.
        vm.prank(oracle);
        vm.expectRevert(MissionSystem.PrerequisiteNotMet.selector);
        missions.recordProgress(alice, ONCE, 1);

        // Complete the prerequisite first (ONCE -> same constant period).
        vm.prank(oracle);
        missions.recordProgress(alice, PREREQ, 1);
        assertTrue(missions.completed(alice, PREREQ, period));

        // Now the dependent completes and pays.
        uint256 before = chips.balanceOf(alice);
        vm.prank(oracle);
        missions.recordProgress(alice, ONCE, 1);
        assertEq(chips.balanceOf(alice), before + 50e18, "dependent pays after prereq");
    }

    // ── Reserve shortfall -> pending payout ──────────────────────────────────────

    function test_short_reserve_queues_payout_then_claimable() public {
        // Drain the reserve to just below one reward.
        uint256 bal = chips.balanceOf(address(missions));
        vm.prank(owner);
        missions.setMinReserve(0);
        vm.prank(owner);
        missions.withdrawSurplus(bal - (10e18 - 1)); // leave 10e18 - 1
        assertEq(chips.balanceOf(address(missions)), 10e18 - 1);

        vm.prank(owner);
        missions.setMission(DAILY, MissionSystem.MissionKind.DAY, 10e18, 1, bytes32(0), true);
        bytes32 period = missions.currentPeriod(DAILY);

        // Completion is recorded on-chain even though the reserve can't pay yet.
        vm.expectEmit(true, true, true, true, address(missions));
        emit MissionSystemEvents.PayoutPending(alice, DAILY, period, 10e18);
        vm.prank(oracle);
        missions.recordProgress(alice, DAILY, 1);

        assertTrue(missions.completed(alice, DAILY, period), "completed despite short reserve");
        assertEq(missions.pendingPayout(periodKey(alice, DAILY, period)), 10e18, "payout queued");
        assertEq(chips.balanceOf(alice), 0, "nothing paid yet");

        // Fund the reserve, then anyone (here: wallet) can claim the queued payout.
        chips.mint(treasury, 100e18);
        vm.prank(treasury);
        chips.approve(address(missions), 100e18);
        vm.prank(treasury);
        missions.fund(100e18);

        uint256 before = chips.balanceOf(alice);
        vm.prank(alice); // wallet claims its own queued payout
        missions.claimPayout(alice, DAILY, period);
        assertEq(chips.balanceOf(alice), before + 10e18, "queued payout claimed");
        assertEq(missions.pendingPayout(periodKey(alice, DAILY, period)), 0, "queue cleared");
        assertEq(missions.totalClaimed(), 10e18);
    }

    function test_claimPayout_reverts_when_nothing_pending() public {
        vm.prank(owner);
        missions.setMission(DAILY, MissionSystem.MissionKind.DAY, 10e18, 1, bytes32(0), true);
        vm.prank(oracle);
        missions.recordProgress(alice, DAILY, 1); // pays immediately (reserve full)
        bytes32 period = missions.currentPeriod(DAILY);
        vm.prank(alice);
        vm.expectRevert(MissionSystem.BadParam.selector);
        missions.claimPayout(alice, DAILY, period); // nothing pending
    }

    // ── Pause ───────────────────────────────────────────────────────────────────

    function test_paused_blocks_progress() public {
        vm.prank(owner);
        missions.setMission(DAILY, MissionSystem.MissionKind.DAY, 10e18, 3, bytes32(0), true);
        vm.prank(owner);
        missions.setPaused(true);

        vm.prank(oracle);
        vm.expectRevert(MissionSystem.Paused.selector);
        missions.recordProgress(alice, DAILY, 1);

        vm.prank(owner);
        missions.setPaused(false);
        vm.prank(oracle);
        missions.recordProgress(alice, DAILY, 1);
        assertEq(missions.progress(alice, DAILY, missions.currentPeriod(DAILY)), 1);
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

    // ── Helpers ─────────────────────────────────────────────────────────────────

    function periodKey(address w, bytes32 m, bytes32 p) internal view returns (bytes32) {
        return missions.periodKey(w, m, p);
    }
}
