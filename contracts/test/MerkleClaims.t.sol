// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SeasonClaim} from "../src/SeasonClaim.sol";
import {LegacyClaim} from "../src/LegacyClaim.sol";
import {MockChips} from "./MockChips.sol";

contract MerkleClaimsTest is Test {
    MockChips chips;
    SeasonClaim season;
    LegacyClaim legacy;

    address owner = address(0xA11CE);
    address setter = address(0x5E77);
    address alice = address(0xA1);
    address bob = address(0xB0);

    function setUp() public {
        chips = new MockChips();
        vm.prank(owner);
        season = new SeasonClaim(chips, setter, owner);
        vm.prank(owner);
        legacy = new LegacyClaim(chips, setter, owner, 50_000_000e18);
        chips.mint(address(season), 1_000_000e18);
        chips.mint(address(legacy), 50_000_000e18);
    }

    function _sortedHash(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a <= b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }

    function test_season_merkle_claim() public {
        bytes32 la = season.leafHash(1, alice, 100e18);
        bytes32 lb = season.leafHash(1, bob, 200e18);
        bytes32 root = _sortedHash(la, lb);

        vm.prank(setter);
        season.proposeRoot(1, root, 500e18);
        vm.prank(setter);
        vm.expectRevert(SeasonClaim.NotReady.selector);
        season.activateRoot(1);

        vm.warp(block.timestamp + 49 hours);
        vm.prank(setter);
        season.activateRoot(1);

        bytes32[] memory proof = new bytes32[](1);
        proof[0] = lb;
        uint256 beforeBal = chips.balanceOf(alice);
        vm.prank(alice);
        season.claim(1, 100e18, proof);
        assertEq(chips.balanceOf(alice), beforeBal + 100e18);

        vm.prank(alice);
        vm.expectRevert(SeasonClaim.Used.selector);
        season.claim(1, 100e18, proof);
    }

    function test_legacy_two_leaf_and_window() public {
        bytes32 la = legacy.leafHash(alice, 500e18);
        bytes32 lb = legacy.leafHash(bob, 250e18);
        bytes32 root = _sortedHash(la, lb);

        vm.prank(setter);
        legacy.setSnapshotRoot(root);

        bytes32[] memory proof = new bytes32[](1);
        proof[0] = lb;
        vm.prank(alice);
        legacy.claim(500e18, proof);
        assertEq(chips.balanceOf(alice), 500e18);

        vm.warp(block.timestamp + 91 days);
        bytes32[] memory p2 = new bytes32[](1);
        p2[0] = la;
        vm.prank(bob);
        vm.expectRevert(LegacyClaim.WindowOver.selector);
        legacy.claim(250e18, p2);
    }
}
