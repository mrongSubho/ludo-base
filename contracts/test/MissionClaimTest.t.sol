// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MissionClaim} from "../src/MissionClaim.sol";
import {MockChips} from "./MockChips.sol";

/// @dev Mirrors the contract event so vm.expectEmit can match it by signature.
interface MissionClaimEvents {
    event ReservesLow(uint256 balance, uint256 minReserve);
}

contract MissionClaimTest is Test {
    MockChips chips;
    MissionClaim missions;

    address owner = address(0xA11CE);
    address op;
    address alice = address(0xA1);
    address mallory = address(0xBAD);
    address treasury = address(0x7EA5);
    uint256 opPk = 0x0F01;
    uint256 op2Pk = 0x0F02;

    bytes32 constant MISSION = keccak256("daily_bonus");
    bytes32 constant PERIOD = keccak256("2026-09-23");
    bytes32 constant PERIOD_NEXT = keccak256("2026-09-24");

    function setUp() public {
        op = vm.addr(opPk);
        chips = new MockChips();
        vm.prank(owner);
        missions = new MissionClaim(chips, op, owner);
        chips.mint(address(missions), 100_000e18);
        chips.mint(treasury, 10_000e18);
    }

    function _sign(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _claimArgs(uint256 amount, uint256 nonce)
        internal
        view
        returns (bytes32 missionId, bytes32 periodId, uint64 deadline, bytes32 d)
    {
        missionId = MISSION;
        periodId = PERIOD;
        deadline = uint64(block.timestamp + 7 days);
        d = missions.voucherDigest(alice, missionId, amount, periodId, deadline, nonce);
    }

    // ── Voucher claim + replay ────────────────────────────────────────────────

    function test_voucher_claim_and_replay() public {
        bytes32 missionId = keccak256("daily_bonus");
        bytes32 periodId = keccak256("2026-09-23");
        uint256 amount = 20e18;
        uint64 deadline = uint64(block.timestamp + 7 days);
        uint256 nonce = 42;

        bytes32 d = missions.voucherDigest(alice, missionId, amount, periodId, deadline, nonce);
        bytes memory sig = _sign(opPk, d);

        uint256 before = chips.balanceOf(alice);
        vm.prank(alice);
        missions.claim(alice, missionId, amount, periodId, deadline, nonce, sig);
        assertEq(chips.balanceOf(alice), before + amount);

        vm.prank(alice);
        vm.expectRevert(MissionClaim.Used.selector);
        missions.claim(alice, missionId, amount, periodId, deadline, nonce, sig);
    }

    function test_bad_op_key_reverts() public {
        bytes32 missionId = keccak256("daily_bonus");
        bytes32 periodId = keccak256("2026-09-23");
        uint64 deadline = uint64(block.timestamp + 7 days);
        bytes32 d = missions.voucherDigest(alice, missionId, 20e18, periodId, deadline, 1);
        bytes memory bad = _sign(0xDEAD, d);
        vm.prank(alice);
        vm.expectRevert(MissionClaim.BadSig.selector);
        missions.claim(alice, missionId, 20e18, periodId, deadline, 1, bad);
    }

    /// Op-key rotate: old key is effectively revoked; only the new key signs valid vouchers.
    function test_setOpKey_rotate_revokes_old_sig() public {
        (bytes32 missionId, bytes32 periodId, uint64 deadline, bytes32 d) = _claimArgs(20e18, 7);
        bytes memory oldSig = _sign(opPk, d);

        address op2 = vm.addr(op2Pk);
        vm.prank(owner);
        missions.setOpKey(op2);
        assertEq(missions.opKey(), op2);

        vm.prank(alice);
        vm.expectRevert(MissionClaim.BadSig.selector);
        missions.claim(alice, missionId, 20e18, periodId, deadline, 7, oldSig);

        bytes memory newSig = _sign(op2Pk, d);
        uint256 before = chips.balanceOf(alice);
        vm.prank(alice);
        missions.claim(alice, missionId, 20e18, periodId, deadline, 7, newSig);
        assertEq(chips.balanceOf(alice), before + 20e18);
    }

    function test_setOpKey_onlyOwner_and_nonzero() public {
        vm.prank(mallory);
        vm.expectRevert(MissionClaim.OnlyOwner.selector);
        missions.setOpKey(mallory);

        vm.prank(owner);
        vm.expectRevert(MissionClaim.BadParam.selector);
        missions.setOpKey(address(0));
    }

    function test_zero_amount_reverts() public {
        (bytes32 missionId, bytes32 periodId, uint64 deadline, bytes32 d) = _claimArgs(0, 21);
        bytes memory sig = _sign(opPk, d);
        vm.prank(alice);
        vm.expectRevert(MissionClaim.BadParam.selector);
        missions.claim(alice, missionId, 0, periodId, deadline, 21, sig);
    }

    // ── One claim per wallet per mission per period ───────────────────────────

    function test_one_claim_per_period_even_with_a_fresh_nonce() public {
        (bytes32 m, bytes32 p, uint64 dl, bytes32 d1) = _claimArgs(20e18, 101);
        vm.prank(alice);
        missions.claim(alice, m, 20e18, p, dl, 101, _sign(opPk, d1));
        assertTrue(missions.hasClaimed(alice, m, p), "claim recorded");

        // A second, independently signed voucher for the SAME period must not pay
        // again even though the nonce differs — this is the on-chain mirror of the
        // server's mission_vouchers uniqueness constraint.
        (,,, bytes32 d2) = _claimArgs(20e18, 102);
        vm.prank(alice);
        vm.expectRevert(MissionClaim.AlreadyClaimed.selector);
        missions.claim(alice, m, 20e18, p, dl, 102, _sign(opPk, d2));
    }

    function test_same_mission_claimable_in_the_next_period() public {
        (bytes32 m, bytes32 p, uint64 dl, bytes32 d1) = _claimArgs(20e18, 201);
        vm.prank(alice);
        missions.claim(alice, m, 20e18, p, dl, 201, _sign(opPk, d1));

        bytes32 nextPeriod = PERIOD_NEXT;
        uint64 dl2 = uint64(block.timestamp + 7 days);
        bytes32 d2 = missions.voucherDigest(alice, m, 20e18, nextPeriod, dl2, 202);
        uint256 before = chips.balanceOf(alice);
        vm.prank(alice);
        missions.claim(alice, m, 20e18, nextPeriod, dl2, 202, _sign(opPk, d2));
        assertEq(chips.balanceOf(alice), before + 20e18, "next period is a fresh budget");
        assertTrue(missions.hasClaimed(alice, m, nextPeriod));
        assertFalse(missions.hasClaimed(alice, m, p) == false, "previous period still recorded");
    }

    // ── Period windows (time-based restriction) ───────────────────────────────

    function test_period_window_blocks_before_start_and_after_end() public {
        bytes32 period = keccak256("2026-09-23");
        vm.prank(owner);
        // Window: [now + 1 day, now + 3 days]
        missions.setPeriod(period, uint64(block.timestamp + 1 days), uint64(block.timestamp + 3 days));

        (bytes32 m, bytes32 p, uint64 dl, bytes32 d) = _claimArgs(20e18, 301);
        p = period;

        // Too early.
        vm.prank(alice);
        vm.expectRevert(MissionClaim.OutsideWindow.selector);
        missions.claim(alice, m, 20e18, p, dl, 301, _sign(opPk, d));

        // Inside.
        vm.warp(block.timestamp + 2 days);
        vm.prank(alice);
        missions.claim(alice, m, 20e18, p, dl, 301, _sign(opPk, d));

        // Too late for a different wallet (alice is already claimed anyway).
        vm.warp(block.timestamp + 5 days);
        bytes32 d3 = missions.voucherDigest(treasury, m, 20e18, p, dl, 302);
        vm.prank(treasury);
        vm.expectRevert(MissionClaim.OutsideWindow.selector);
        missions.claim(treasury, m, 20e18, p, dl, 302, _sign(opPk, d3));
    }

    function test_setPeriod_onlyOwner_and_sane() public {
        bytes32 period = keccak256("p");
        vm.prank(mallory);
        vm.expectRevert(MissionClaim.OnlyOwner.selector);
        missions.setPeriod(period, 1, 2);

        vm.prank(owner);
        vm.expectRevert(MissionClaim.BadParam.selector); // end <= start
        missions.setPeriod(period, 100, 100);
    }

    // ── Mission registry: amount rules + kill switch ──────────────────────────

    function test_fixed_reward_must_match_the_voucher() public {
        vm.prank(owner);
        missions.setMission(MISSION, 15e18, true);

        // Voucher for the wrong amount is refused even though the signature is valid.
        (bytes32 m, bytes32 p, uint64 dl, bytes32 d) = _claimArgs(20e18, 401);
        vm.prank(alice);
        vm.expectRevert(MissionClaim.AmountOutOfRange.selector);
        missions.claim(alice, m, 20e18, p, dl, 401, _sign(opPk, d));

        // The configured amount pays.
        (,,, bytes32 d2) = _claimArgs(15e18, 402);
        uint256 before = chips.balanceOf(alice);
        vm.prank(alice);
        missions.claim(alice, m, 15e18, p, dl, 402, _sign(opPk, d2));
        assertEq(chips.balanceOf(alice), before + 15e18);
    }

    function test_inactive_mission_refuses_valid_vouchers() public {
        vm.prank(owner);
        missions.setMission(MISSION, 20e18, false);

        (bytes32 m, bytes32 p, uint64 dl, bytes32 d) = _claimArgs(20e18, 501);
        vm.prank(alice);
        vm.expectRevert(MissionClaim.MissionInactive.selector);
        missions.claim(alice, m, 20e18, p, dl, 501, _sign(opPk, d));
    }

    function test_free_form_bounds_apply_to_unregistered_missions() public {
        vm.prank(owner);
        missions.setClaimBounds(10e18, 100e18);

        // Under the floor.
        (bytes32 m, bytes32 p, uint64 dl, bytes32 d) = _claimArgs(5e18, 601);
        vm.prank(alice);
        vm.expectRevert(MissionClaim.AmountOutOfRange.selector);
        missions.claim(alice, m, 5e18, p, dl, 601, _sign(opPk, d));

        // Inside the band.
        (,,, bytes32 d2) = _claimArgs(50e18, 602);
        vm.prank(alice);
        missions.claim(alice, m, 50e18, p, dl, 602, _sign(opPk, d2));
        assertEq(chips.balanceOf(alice), 50e18);
    }

    // ── Issuance ceiling, per period ──────────────────────────────────────────

    function test_ceiling_is_per_period() public {
        vm.prank(owner);
        missions.setPerPeriodCeiling(30e18);

        (bytes32 m1, bytes32 p1, uint64 dl1, bytes32 d1) = _claimArgs(20e18, 1);
        vm.prank(alice);
        missions.claim(alice, m1, 20e18, p1, dl1, 1, _sign(opPk, d1));
        assertEq(missions.periodIssued(p1), 20e18);

        // 20 + 20 > 30 ceiling, same period
        (,,, bytes32 d2) = _claimArgs(20e18, 2);
        vm.prank(alice);
        vm.expectRevert(MissionClaim.Ceiling.selector);
        missions.claim(alice, m1, 20e18, p1, dl1, 2, _sign(opPk, d2));

        // A different period keeps its own full budget.
        bytes32 p2 = PERIOD_NEXT;
        uint64 dl2 = uint64(block.timestamp + 7 days);
        bytes32 d3 = missions.voucherDigest(alice, m1, 20e18, p2, dl2, 3);
        vm.prank(alice);
        missions.claim(alice, m1, 20e18, p2, dl2, 3, _sign(opPk, d3));
        assertEq(missions.periodIssued(p2), 20e18, "second period unaffected by the first");
    }

    function test_rollPeriod_reopens_one_budget_only() public {
        vm.prank(owner);
        missions.setPerPeriodCeiling(30e18);

        (bytes32 m1, bytes32 p1, uint64 dl1, bytes32 d1) = _claimArgs(20e18, 1);
        vm.prank(alice);
        missions.claim(alice, m1, 20e18, p1, dl1, 1, _sign(opPk, d1));

        bytes32 p2 = PERIOD_NEXT;
        uint64 dl2 = uint64(block.timestamp + 7 days);
        bytes32 d2 = missions.voucherDigest(alice, m1, 20e18, p2, dl2, 2);
        vm.prank(alice);
        missions.claim(alice, m1, 20e18, p2, dl2, 2, _sign(opPk, d2));
        assertEq(missions.periodIssued(p2), 20e18);

        // Rolling the first period frees its budget only.
        vm.prank(owner);
        missions.rollPeriod(p1);
        assertEq(missions.periodIssued(p1), 0);
        assertEq(missions.periodIssued(p2), 20e18, "other period untouched");
        assertEq(missions.totalIssued(), 40e18, "lifetime counter is monotonic");
    }

    function test_rollPeriod_onlyOwner() public {
        vm.prank(mallory);
        vm.expectRevert(MissionClaim.OnlyOwner.selector);
        missions.rollPeriod(PERIOD);
    }

    function test_expired_deadline_reverts() public {
        bytes32 missionId = keccak256("daily_bonus");
        bytes32 periodId = keccak256("2026-09-23");
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes32 d = missions.voucherDigest(alice, missionId, 20e18, periodId, deadline, 9);
        bytes memory sig = _sign(opPk, d);

        vm.warp(block.timestamp + 2 hours);
        vm.prank(alice);
        vm.expectRevert(MissionClaim.Expired.selector);
        missions.claim(alice, missionId, 20e18, periodId, deadline, 9, sig);
    }

    function test_paused_reverts() public {
        vm.prank(owner);
        missions.setPaused(true);

        (bytes32 missionId, bytes32 periodId, uint64 deadline, bytes32 d) = _claimArgs(20e18, 3);
        vm.prank(alice);
        vm.expectRevert(MissionClaim.IsPaused.selector);
        missions.claim(alice, missionId, 20e18, periodId, deadline, 3, _sign(opPk, d));
    }

    function test_setPaused_onlyOwner() public {
        vm.prank(mallory);
        vm.expectRevert(MissionClaim.OnlyOwner.selector);
        missions.setPaused(true);
    }

    function test_claim_requires_wallet_sender() public {
        (bytes32 missionId, bytes32 periodId, uint64 deadline, bytes32 d) = _claimArgs(20e18, 4);
        bytes memory sig = _sign(opPk, d);
        vm.prank(mallory);
        vm.expectRevert(MissionClaim.BadParam.selector);
        missions.claim(alice, missionId, 20e18, periodId, deadline, 4, sig);
    }

    function test_setCeiling_onlyOwner() public {
        vm.prank(mallory);
        vm.expectRevert(MissionClaim.OnlyOwner.selector);
        missions.setPerPeriodCeiling(1);
    }

    // ── Funding / reserve ─────────────────────────────────────────────────────

    function test_fund_pulls_tokens_and_accounts() public {
        vm.prank(treasury);
        chips.approve(address(missions), 1_000e18);

        vm.prank(treasury);
        missions.fund(1_000e18);

        assertEq(chips.balanceOf(address(missions)), 101_000e18);
        assertEq(missions.totalDeposited(), 1_000e18);
        assertEq(missions.availableReserves(), 1_000e18);
    }

    function test_fund_zero_reverts() public {
        vm.prank(treasury);
        vm.expectRevert(MissionClaim.BadParam.selector);
        missions.fund(0);
    }

    function test_claim_reverts_when_the_reserve_cannot_pay() public {
        // Drain the reserve down to the floor: the contract can no longer pay a claim.
        uint256 bal = chips.balanceOf(address(missions));
        vm.prank(owner);
        missions.setMinReserve(10e18);
        vm.prank(owner);
        missions.withdrawSurplus(bal - 10e18);
        assertEq(chips.balanceOf(address(missions)), 10e18);

        (bytes32 m, bytes32 p, uint64 dl, bytes32 d) = _claimArgs(20e18, 701);
        vm.prank(alice);
        vm.expectRevert(MissionClaim.InsufficientReserves.selector);
        missions.claim(alice, m, 20e18, p, dl, 701, _sign(opPk, d));

        // A claim the reserve can still cover goes through and warns.
        vm.prank(owner);
        missions.setMinReserve(5e18);
        (,,, bytes32 d2) = _claimArgs(10e18, 702);
        vm.prank(alice);
        missions.claim(alice, m, 10e18, p, dl, 702, _sign(opPk, d2));
        assertEq(missions.totalClaimed(), 10e18);
        assertEq(chips.balanceOf(address(missions)), 0, "reserve fully paid out");
    }

    function test_reserves_low_event_after_a_claim() public {
        // Floor sits above what a 20e18 claim leaves behind.
        uint256 startBal = chips.balanceOf(address(missions));
        vm.prank(owner);
        missions.setMinReserve(startBal - 20e18 + 1);

        (bytes32 m, bytes32 p, uint64 dl, bytes32 d) = _claimArgs(20e18, 801);

        vm.expectEmit(true, false, false, true, address(missions));
        emit MissionClaimEvents.ReservesLow(startBal - 20e18, startBal - 20e18 + 1);
        vm.prank(alice);
        missions.claim(alice, m, 20e18, p, dl, 801, _sign(opPk, d));
    }

    function test_withdraw_surplus_respects_the_floor() public {
        uint256 bal = chips.balanceOf(address(missions));
        vm.prank(owner);
        missions.setMinReserve(1_000e18);

        // Would breach the floor.
        vm.prank(owner);
        vm.expectRevert(MissionClaim.ReserveFloor.selector);
        missions.withdrawSurplus(bal); // leaves 0 < 1_000e18

        uint256 before = chips.balanceOf(owner);
        vm.prank(owner);
        missions.withdrawSurplus(bal - 1_000e18);
        assertEq(chips.balanceOf(owner), before + bal - 1_000e18);
        assertEq(missions.totalWithdrawn(), bal - 1_000e18);
        assertEq(chips.balanceOf(address(missions)), 1_000e18, "floor kept intact");
    }

    function test_withdraw_surplus_onlyOwner() public {
        vm.prank(mallory);
        vm.expectRevert(MissionClaim.OnlyOwner.selector);
        missions.withdrawSurplus(1);
    }

    function test_setMinReserve_onlyOwner() public {
        vm.prank(mallory);
        vm.expectRevert(MissionClaim.OnlyOwner.selector);
        missions.setMinReserve(1);
    }

    function test_available_reserves_saturates_at_zero() public {
        vm.prank(owner);
        missions.setMinReserve(1_000e18);
        assertEq(missions.availableReserves(), 99_000e18);

        vm.prank(owner);
        missions.setMinReserve(200_000e18); // above the balance
        assertEq(missions.availableReserves(), 0);
    }

    // ── ECO-05: relaying is an explicit allowlisted role, tx.origin is gone ──

    function test_allowlisted_relayer_may_submit_another_wallets_voucher() public {
        (bytes32 missionId, bytes32 periodId, uint64 deadline, bytes32 d) = _claimArgs(20e18, 11);

        vm.prank(owner);
        missions.setClaimRelayer(address(this), true);
        // The relayer is not the wallet and is not alice's tx.origin either.
        bytes memory sig = _sign(opPk, d);
        uint256 before = chips.balanceOf(alice);
        missions.claim(alice, missionId, 20e18, periodId, deadline, 11, sig);
        assertEq(chips.balanceOf(alice), before + 20e18, "allowlisted relayer pays the wallet");
    }

    function test_unallowlisted_relayer_is_refused() public {
        (bytes32 missionId, bytes32 periodId, uint64 deadline, bytes32 d) = _claimArgs(20e18, 12);
        bytes memory sig = _sign(opPk, d);
        vm.prank(mallory);
        vm.expectRevert(MissionClaim.BadParam.selector);
        missions.claim(alice, missionId, 20e18, periodId, deadline, 12, sig);
    }

    function test_revoked_relayer_loses_access() public {
        (bytes32 missionId, bytes32 periodId, uint64 deadline, bytes32 d) = _claimArgs(20e18, 13);
        vm.prank(owner);
        missions.setClaimRelayer(mallory, true);
        vm.prank(owner);
        missions.setClaimRelayer(mallory, false);

        vm.prank(mallory);
        vm.expectRevert(MissionClaim.BadParam.selector);
        missions.claim(alice, missionId, 20e18, periodId, deadline, 13, _sign(opPk, d));
    }

    function test_setClaimRelayer_onlyOwner_and_nonzero() public {
        vm.prank(mallory);
        vm.expectRevert(MissionClaim.OnlyOwner.selector);
        missions.setClaimRelayer(mallory, true);

        vm.prank(owner);
        vm.expectRevert(MissionClaim.BadParam.selector);
        missions.setClaimRelayer(address(0), true);
    }
}
