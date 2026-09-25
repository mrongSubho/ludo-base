// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MatchPool} from "../src/MatchPool.sol";
import {MockChips} from "./MockChips.sol";

/// @notice ERC-8021 trailing calldata must not break selectors (Strix M11).
/// On base-anvil/base-forge, B20 precompiles accept trailing data; MockChips
/// mirrors that (Solidity dispatch ignores trailing calldata on success).
contract SuffixAttributionTest is Test {
    MockChips chips;
    MatchPool pool;

    address owner = address(0xA11CE);
    address edge = address(0xED6E);
    address host = address(0xB0B);
    address p1 = address(0x1111);

    function setUp() public {
        chips = new MockChips();
        vm.prank(owner);
        pool = new MatchPool(chips, edge, owner);
        chips.mint(p1, 10_000e18);
    }

    function test_trailing_8021_suffix_on_transfer() public {
        bytes memory data = abi.encodeWithSignature("transfer(address,uint256)", p1, uint256(1e18));
        bytes memory suffix = hex"80218021802180218021802180218021"; // 16-byte builder tag
        bytes memory call = bytes.concat(data, suffix);
        chips.mint(address(this), 1e18);
        (bool ok,) = address(chips).call(call);
        assertTrue(ok, "transfer with trailing ERC-8021 suffix must succeed");
        assertEq(chips.balanceOf(p1), 10_000e18 + 1e18);
    }

    function test_trailing_8021_on_join_selector() public {
        // joinPool(bytes32) + suffix must still hit joinPool (not fallback).
        bytes memory data = abi.encodeWithSignature("joinPool(bytes32)", keccak256("x"));
        bytes memory suffix = hex"80218021802180218021802180218021";
        bytes memory call = bytes.concat(data, suffix);
        // Not a seat / not open — expect custom revert, NOT empty success.
        (bool ok, bytes memory ret) = address(pool).call(call);
        assertFalse(ok, "must not succeed as empty call");
        assertGt(ret.length, 0, "selector must match joinPool and revert with error");
    }
}
