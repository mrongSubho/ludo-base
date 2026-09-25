// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MatchPool} from "../src/MatchPool.sol";
import {MockChips} from "./MockChips.sol";

/// @notice Gas snapshots for entrypoints (publish with `forge snapshot`).
contract GasBenchTest is Test {
    MockChips chips;
    MatchPool pool;

    address owner = address(0xA11CE);
    address edge;
    address host;
    address p1;
    uint256 edgePk = 0xEEEE;
    uint256 hostPk = 0xB0B;
    uint256 p1Pk = 0xA1;

    function setUp() public {
        edge = vm.addr(edgePk);
        host = vm.addr(hostPk);
        p1 = vm.addr(p1Pk);
        chips = new MockChips();
        vm.prank(owner);
        pool = new MatchPool(chips, edge, owner);
        chips.mint(p1, 10_000e18);
        chips.mint(host, 50_000e18);
    }

    function testGas_join() public {
        bytes32 poolId = keccak256("gas");
        // minimal setup omitted — join on empty reverts; measure create+join path
        address[] memory seats = new address[](2);
        seats[0] = host;
        seats[1] = p1;
        uint8[] memory colors = new uint8[](2);
        colors[0] = 1;
        colors[1] = 3;
        MatchPool.PoolConfig memory cfg = MatchPool.PoolConfig({
            poolId: poolId,
            roomCode: keccak256("G"),
            matchId: keccak256("M"),
            host: host,
            seatsHash: keccak256(abi.encode(seats, colors)),
            gameMode: 0,
            maxSeats: 2,
            poolKind: 0,
            entryFee: 1000e18,
            protocolBps: 500,
            burnBps: 200,
            windowClosedAt: 0,
            parentPoolId: bytes32(0),
            ticketIssuedAt: uint64(block.timestamp)
        });
        MatchPool.LobbyTicket memory t = MatchPool.LobbyTicket({
            roomCode: cfg.roomCode,
            matchId: cfg.matchId,
            host: host,
            seatsHash: cfg.seatsHash,
            gameMode: 0,
            maxSeats: 2,
            issuedAt: cfg.ticketIssuedAt
        });
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(edgePk, pool.lobbyTicketHash(t));
        pool.createPool(cfg, seats, colors, abi.encodePacked(r, s, v));
        vm.startPrank(p1);
        chips.approve(address(pool), 2000e18);
        uint256 g = gasleft();
        pool.joinPool(poolId);
        uint256 used = g - gasleft();
        vm.stopPrank();
        emit log_named_uint("gas_joinPool", used);
    }
}

/// @notice ERC-8021 trailing data must not break MockChips calls (M11 stand-in
/// until base-anvil B20 precompile assertion). Trailing bytes after ABI payload
/// are ignored by Solidity dispatch — assert transfer still works.
contract SuffixAttributionTest is Test {
    MockChips chips;

    function test_trailing_8021_data_ignored() public {
        chips = new MockChips();
        chips.mint(address(this), 100e18);
        bytes memory payload = abi.encodeWithSignature("transfer(address,uint256)", address(0x1), uint256(10e18));
        bytes memory suffix = hex"8021802180218021802180218021802180218021802180218021802180218021";
        bytes memory data = bytes.concat(payload, suffix);
        (bool ok, ) = address(chips).call(data);
        assertTrue(ok, "call with 8021 trailing data must not revert");
        assertEq(chips.balanceOf(address(0x1)), 10e18);
    }
}
