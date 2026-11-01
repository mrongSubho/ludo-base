// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ClanClaim} from "../src/ClanClaim.sol";
import {MockChips} from "./MockChips.sol";
import {EIP712} from "../src/lib/EIP712.sol";

contract ClanClaimTest is Test {
    MockChips chips;
    ClanClaim clanClaim;

    address owner = address(0x01);
    uint256 oracleKey = 0xABCD1234;
    address oracle;
    address protocolTreasury = address(0x09);

    address alice = address(0xA1);
    address bob = address(0xB1);
    address charlie = address(0xC1);

    bytes32 clanA = keccak256("CLAN_ALPHA");
    bytes32 clanB = keccak256("CLAN_BETA");
    bytes32 war1 = keccak256("WAR_1");

    function setUp() public {
        oracle = vm.addr(oracleKey);
        chips = new MockChips();

        vm.prank(owner);
        clanClaim = new ClanClaim(chips, owner, oracle, protocolTreasury);

        chips.mint(alice, 100_000e18);
        chips.mint(bob, 100_000e18);
        chips.mint(charlie, 100_000e18);

        vm.prank(alice);
        chips.approve(address(clanClaim), type(uint256).max);
        vm.prank(bob);
        chips.approve(address(clanClaim), type(uint256).max);
        vm.prank(charlie);
        chips.approve(address(clanClaim), type(uint256).max);
    }

    function _signVoucher(ClanClaim.ClaimVoucher memory voucher) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                clanClaim.CLAIM_TYPEHASH(),
                voucher.claimId,
                voucher.clanId,
                voucher.recipient,
                voucher.amount,
                voucher.claimType,
                voucher.nonce,
                voucher.deadline
            )
        );
        bytes32 domainSeparator = EIP712.domainHash("ClanClaim", address(clanClaim));
        bytes32 digest = EIP712.digest(domainSeparator, structHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(oracleKey, digest);
        return abi.encodePacked(r, s, v);
    }

    // ── 1. War Stake Escrow & Settlement ──────────────────────────────────────

    function test_WarStakeDepositAndSettlement() public {
        // Alice deposits 5,000 CHIPS for Clan A; Bob deposits 5,000 CHIPS for Clan B
        vm.prank(alice);
        clanClaim.depositWarStake(war1, clanA, 5_000e18);
        vm.prank(bob);
        clanClaim.depositWarStake(war1, clanB, 5_000e18);

        assertEq(clanClaim.warEscrowBalance(war1), 10_000e18);
        assertEq(chips.balanceOf(address(clanClaim)), 10_000e18);

        // Oracle settles war: 5% rake = 500 CHIPS, Clan A wins with 500 CHIPS to treasury cut
        vm.prank(oracle);
        clanClaim.settleWar(war1, clanA, 500e18, 500e18);

        assertTrue(clanClaim.warSettled(war1));
        assertEq(chips.balanceOf(protocolTreasury), 500e18);
        assertEq(clanClaim.clanTreasuryBalance(clanA), 500e18);

        // Cannot settle twice
        vm.prank(oracle);
        vm.expectRevert(ClanClaim.AlreadySettled.selector);
        clanClaim.settleWar(war1, clanA, 500e18, 500e18);
    }

    // ── 2. Pull-Based Claim Vouchers (D16) ────────────────────────────────────

    function test_PullClaimVoucherSuccess() public {
        // Deposit 10,000 CHIPS
        vm.prank(alice);
        clanClaim.depositWarStake(war1, clanA, 5_000e18);
        vm.prank(bob);
        clanClaim.depositWarStake(war1, clanB, 5_000e18);

        vm.prank(oracle);
        clanClaim.settleWar(war1, clanA, 500e18, 0);

        // Alice claims her principal return (5,000 CHIPS) + profit (4,000 CHIPS)
        ClanClaim.ClaimVoucher memory voucher = ClanClaim.ClaimVoucher({
            claimId: keccak256("CLAIM_ALICE_1"),
            clanId: clanA,
            recipient: alice,
            amount: 9_000e18,
            claimType: uint8(ClanClaim.ClaimType.WarProfitMerit),
            nonce: 1,
            deadline: uint64(block.timestamp + 1 hours)
        });

        bytes memory sig = _signVoucher(voucher);

        uint256 balBefore = chips.balanceOf(alice);
        vm.prank(alice);
        clanClaim.claimReward(voucher, sig);
        uint256 balAfter = chips.balanceOf(alice);

        assertEq(balAfter - balBefore, 9_000e18);
        assertTrue(clanClaim.claimExecuted(voucher.claimId));

        // Replay fails
        vm.prank(alice);
        vm.expectRevert(ClanClaim.AlreadyClaimed.selector);
        clanClaim.claimReward(voucher, sig);
    }

    function test_PullClaimUnauthorizedAndExpired() public {
        ClanClaim.ClaimVoucher memory voucher = ClanClaim.ClaimVoucher({
            claimId: keccak256("CLAIM_EXPIRED"),
            clanId: clanA,
            recipient: alice,
            amount: 1_000e18,
            claimType: uint8(ClanClaim.ClaimType.WarPrincipal),
            nonce: 1,
            deadline: uint64(block.timestamp + 10)
        });
        bytes memory sig = _signVoucher(voucher);

        // Bob cannot claim Alice's voucher
        vm.prank(bob);
        vm.expectRevert(ClanClaim.Unauthorized.selector);
        clanClaim.claimReward(voucher, sig);

        // Warp past deadline
        vm.warp(block.timestamp + 20);
        vm.prank(alice);
        vm.expectRevert(ClanClaim.Expired.selector);
        clanClaim.claimReward(voucher, sig);
    }

    // ── 3. Batch Claims ────────────────────────────────────────────────────────

    function test_ClaimBatchMultipleVouchers() public {
        chips.mint(address(clanClaim), 50_000e18);

        ClanClaim.ClaimVoucher[] memory vouchers = new ClanClaim.ClaimVoucher[](2);
        bytes[] memory sigs = new bytes[](2);

        vouchers[0] = ClanClaim.ClaimVoucher({
            claimId: keccak256("CLAIM_BATCH_1"),
            clanId: clanA,
            recipient: alice,
            amount: 1_000e18,
            claimType: uint8(ClanClaim.ClaimType.WarPrincipal),
            nonce: 1,
            deadline: uint64(block.timestamp + 1 hours)
        });
        sigs[0] = _signVoucher(vouchers[0]);

        vouchers[1] = ClanClaim.ClaimVoucher({
            claimId: keccak256("CLAIM_BATCH_2"),
            clanId: clanA,
            recipient: alice,
            amount: 2_500e18,
            claimType: uint8(ClanClaim.ClaimType.WarProfitMerit),
            nonce: 2,
            deadline: uint64(block.timestamp + 1 hours)
        });
        sigs[1] = _signVoucher(vouchers[1]);

        uint256 beforeBal = chips.balanceOf(alice);
        vm.prank(alice);
        clanClaim.claimBatch(vouchers, sigs);
        uint256 afterBal = chips.balanceOf(alice);

        assertEq(afterBal - beforeBal, 3_500e18);
        assertTrue(clanClaim.claimExecuted(vouchers[0].claimId));
        assertTrue(clanClaim.claimExecuted(vouchers[1].claimId));
    }

    // ── 4. Clan Treasury Vice-Versa Subsidies ──────────────────────────────────

    function test_ClanTreasuryFundingAndSubsidies() public {
        // Alice funds Clan A treasury with 20,000 CHIPS
        vm.prank(alice);
        clanClaim.fundTreasury(clanA, 20_000e18);
        assertEq(clanClaim.clanTreasuryBalance(clanA), 20_000e18);

        // Treasury subsidizes 10,000 CHIPS war stake
        vm.prank(oracle);
        clanClaim.depositWarStakeFromTreasury(war1, clanA, 10_000e18);
        assertEq(clanClaim.clanTreasuryBalance(clanA), 10_000e18);
        assertEq(clanClaim.warEscrowBalance(war1), 10_000e18);

        // Oracle debits treasury for member MVP grant
        vm.prank(oracle);
        clanClaim.debitTreasury(clanA, 2_000e18, charlie, keccak256("mvp_grant"));
        assertEq(clanClaim.clanTreasuryBalance(clanA), 8_000e18);
        assertEq(chips.balanceOf(charlie), 102_000e18);

        // Overdraft fails
        vm.prank(oracle);
        vm.expectRevert(ClanClaim.InsufficientTreasury.selector);
        clanClaim.debitTreasury(clanA, 9_000e18, charlie, keccak256("overdraft"));
    }
}
