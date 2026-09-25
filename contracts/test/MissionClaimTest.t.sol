// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MissionClaim} from "../src/MissionClaim.sol";
import {MockChips} from "./MockChips.sol";

contract MissionClaimTest is Test {
    MockChips chips;
    MissionClaim missions;

    address owner = address(0xA11CE);
    address op;
    address alice = address(0xA1);
    address mallory = address(0xBAD);
    uint256 opPk = 0x0F01;
    uint256 op2Pk = 0x0F02;

    function setUp() public {
        op = vm.addr(opPk);
        chips = new MockChips();
        vm.prank(owner);
        missions = new MissionClaim(chips, op, owner);
        chips.mint(address(missions), 100_000e18);
    }

    function _sign(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _claimArgs(uint256 amount, uint256 nonce)
        internal
        view
        returns (
            bytes32 missionId,
            bytes32 periodId,
            uint64 deadline,
            bytes32 d
        )
    {
        missionId = keccak256("daily_bonus");
        periodId = keccak256("2026-09-23");
        deadline = uint64(block.timestamp + 7 days);
        d = missions.voucherDigest(alice, missionId, amount, periodId, deadline, nonce);
    }

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

    function test_ceiling_reverts_until_period_roll() public {
        vm.prank(owner);
        missions.setPerPeriodCeiling(30e18);

        (bytes32 m1, bytes32 p1, uint64 dl1, bytes32 d1) = _claimArgs(20e18, 1);
        vm.prank(alice);
        missions.claim(alice, m1, 20e18, p1, dl1, 1, _sign(opPk, d1));
        assertEq(missions.periodIssued(), 20e18);

        // 20 + 20 > 30 ceiling
        (bytes32 m2, bytes32 p2, uint64 dl2, bytes32 d2) = _claimArgs(20e18, 2);
        vm.prank(alice);
        vm.expectRevert(MissionClaim.Ceiling.selector);
        missions.claim(alice, m2, 20e18, p2, dl2, 2, _sign(opPk, d2));

        vm.prank(owner);
        missions.rollPeriod();
        assertEq(missions.periodIssued(), 0);

        vm.prank(alice);
        missions.claim(alice, m2, 20e18, p2, dl2, 2, _sign(opPk, d2));
        assertEq(missions.periodIssued(), 20e18);
    }

    function test_rollPeriod_onlyOwner() public {
        vm.prank(mallory);
        vm.expectRevert(MissionClaim.OnlyOwner.selector);
        missions.rollPeriod();
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
}
