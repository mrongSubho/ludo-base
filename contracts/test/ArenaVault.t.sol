// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ArenaVault} from "../src/ArenaVault.sol";
import {MockChips} from "./MockChips.sol";
import {EIP712} from "../src/lib/EIP712.sol";

contract ArenaVaultTest is Test {
    MockChips chips;
    ArenaVault vault;

    address owner = address(0x01);
    uint256 oracleKey = 0xABCD1234;
    address oracle;
    address treasury = address(0x09);

    address alice = address(0xA1);
    address bob = address(0xB1);

    function setUp() public {
        oracle = vm.addr(oracleKey);
        chips = new MockChips();

        vm.prank(owner);
        vault = new ArenaVault(chips, owner, oracle, treasury);

        chips.mint(alice, 100_000e18);
        chips.mint(bob, 100_000e18);

        vm.prank(alice);
        chips.approve(address(vault), type(uint256).max);
        vm.prank(bob);
        chips.approve(address(vault), type(uint256).max);
    }

    function _signVoucher(ArenaVault.VaultVoucher memory voucher) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                vault.VAULT_CLAIM_TYPEHASH(),
                voucher.claimId,
                voucher.recipient,
                voucher.amount,
                voucher.claimType,
                voucher.nonce,
                voucher.deadline
            )
        );
        bytes32 domainSeparator = EIP712.domainHash("ArenaVault", address(vault));
        bytes32 digest = EIP712.digest(domainSeparator, structHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(oracleKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function test_DepositAndPullClaimMatchPrize() public {
        vm.prank(alice);
        vault.depositVault(10_000e18);
        vm.prank(bob);
        vault.depositVault(10_000e18);

        assertEq(vault.totalDeposited(alice), 10_000e18);
        assertEq(chips.balanceOf(address(vault)), 20_000e18);

        // Alice wins 19,000 CHIPS (95% net pot), treasury receives 1,000 CHIPS rake
        ArenaVault.VaultVoucher memory prize = ArenaVault.VaultVoucher({
            claimId: keccak256("claim-prize-1"),
            recipient: alice,
            amount: 19_000e18,
            claimType: uint8(ArenaVault.ClaimType.MatchPrize),
            nonce: 1,
            deadline: uint64(block.timestamp + 1 days)
        });
        bytes memory sig = _signVoucher(prize);

        uint256 beforeBal = chips.balanceOf(alice);
        vm.prank(alice);
        vault.claimReward(prize, sig);

        assertEq(chips.balanceOf(alice), beforeBal + 19_000e18);
        assertTrue(vault.claimExecuted(prize.claimId));

        // Oracle sweeps 1,000 CHIPS protocol rake
        vm.prank(oracle);
        vault.withdrawRake(1_000e18);
        assertEq(chips.balanceOf(treasury), 1_000e18);
    }

    function test_BatchClaimWithdrawAndPrize() public {
        vm.prank(alice);
        vault.depositVault(25_000e18);

        ArenaVault.VaultVoucher[] memory vouchers = new ArenaVault.VaultVoucher[](2);
        vouchers[0] = ArenaVault.VaultVoucher({
            claimId: keccak256("claim-1"),
            recipient: alice,
            amount: 10_000e18,
            claimType: uint8(ArenaVault.ClaimType.MatchPrize),
            nonce: 1,
            deadline: uint64(block.timestamp + 1 days)
        });
        vouchers[1] = ArenaVault.VaultVoucher({
            claimId: keccak256("claim-2"),
            recipient: alice,
            amount: 15_000e18,
            claimType: uint8(ArenaVault.ClaimType.VaultWithdraw),
            nonce: 2,
            deadline: uint64(block.timestamp + 1 days)
        });

        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _signVoucher(vouchers[0]);
        sigs[1] = _signVoucher(vouchers[1]);

        uint256 beforeBal = chips.balanceOf(alice);
        vm.prank(alice);
        vault.claimBatch(vouchers, sigs);

        assertEq(chips.balanceOf(alice), beforeBal + 25_000e18);
        assertEq(chips.balanceOf(address(vault)), 0);
    }

    function test_RevertReplayAndWrongRecipient() public {
        vm.prank(alice);
        vault.depositVault(5_000e18);

        ArenaVault.VaultVoucher memory withdrawVoucher = ArenaVault.VaultVoucher({
            claimId: keccak256("claim-replay"),
            recipient: alice,
            amount: 5_000e18,
            claimType: uint8(ArenaVault.ClaimType.VaultWithdraw),
            nonce: 1,
            deadline: uint64(block.timestamp + 1 days)
        });
        bytes memory sig = _signVoucher(withdrawVoucher);

        vm.prank(bob);
        vm.expectRevert(ArenaVault.Unauthorized.selector);
        vault.claimReward(withdrawVoucher, sig);

        vm.prank(alice);
        vault.claimReward(withdrawVoucher, sig);

        vm.prank(alice);
        vm.expectRevert(ArenaVault.AlreadyClaimed.selector);
        vault.claimReward(withdrawVoucher, sig);
    }
}
