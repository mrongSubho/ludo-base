// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MatchPool} from "../src/MatchPool.sol";
import {MockChips} from "./MockChips.sol";

/// @notice Pause-delta extends effective settleBy (CHIPS_PLANNING 4.3).
contract PauseDeltaTest is Test {
    MockChips chips;
    MatchPool pool;

    address owner = address(0xA11CE);
    address edge;
    address host;
    address p1;

    uint256 edgePk = 0xEE01;
    uint256 hostPk = 0xBB01;
    uint256 p1Pk = 0xAA01;

    uint128 constant FEE = 1000e18;
    bytes32 poolId = keccak256("pause-pool");

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

    function _sign(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _sep() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256(bytes("LudoBase MatchPool")),
                keccak256(bytes("1")),
                block.chainid,
                address(pool)
            )
        );
    }

    function _lock() internal {
        address[] memory seats = new address[](2);
        seats[0] = host;
        seats[1] = p1;
        uint8[] memory colors = new uint8[](2);
        colors[0] = 1;
        colors[1] = 3;
        MatchPool.PoolConfig memory cfg = MatchPool.PoolConfig({
            poolId: poolId,
            roomCode: keccak256("P"),
            matchId: keccak256("M"),
            host: host,
            seatsHash: keccak256(abi.encode(seats, colors)),
            gameMode: 0,
            maxSeats: 2,
            poolKind: 0,
            entryFee: FEE,
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
        pool.createPool(cfg, seats, colors, _sign(edgePk, pool.lobbyTicketHash(t)));
        vm.startPrank(host);
        chips.approve(address(pool), 20_000e18);
        pool.joinPool(poolId);
        vm.stopPrank();
        vm.startPrank(p1);
        chips.approve(address(pool), FEE * 2);
        pool.joinPool(poolId);
        vm.stopPrank();
        vm.prank(host);
        pool.lockPool(poolId, 30 minutes);
    }

    function test_pause_delta_extends_settle_window() public {
        _lock();
        uint64 settleBy = pool.effectiveSettleBy(poolId);

        // Simulate 20m incident pause after original settleBy would have fired.
        vm.warp(uint256(settleBy) + 1);
        vm.prank(owner);
        pool.addPauseDelta(poolId, 20 minutes);

        MatchPool.Payout[] memory plan = new MatchPool.Payout[](1);
        plan[0] = MatchPool.Payout({addr: p1, amount: 1860e18});
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes32 structHash = pool.settleStructHash(poolId, plan, deadline, 1, host);
        bytes32 d = keccak256(abi.encodePacked("\x19\x01", _sep(), structHash));

        // Before extended deadline: Mode A settle still works (not Mode B).
        pool.settlePool(poolId, plan, deadline, 1, _sign(hostPk, d), _sign(edgePk, d));
        uint64 afterSettleBy = pool.effectiveSettleBy(poolId);
        assertEq(uint256(afterSettleBy), uint256(settleBy) + 20 minutes);
    }

    function test_timeout_refund_before_extended_deadline_reverts() public {
        _lock();
        uint64 settleBy = pool.effectiveSettleBy(poolId);
        vm.prank(owner);
        pool.addPauseDelta(poolId, 20 minutes);

        // Just after original settleBy + refundGrace but before pause-extended window.
        vm.warp(uint256(settleBy) + 5 minutes);
        bytes32 msgHash =
            keccak256(abi.encodePacked("Ludo unresolvable", poolId, block.chainid, address(pool)));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(edgePk, msgHash);
        bytes memory sig = abi.encodePacked(r, s, v);
        vm.expectRevert(MatchPool.TooEarly.selector);
        pool.timeoutRefund(poolId, true, sig);
    }
}
