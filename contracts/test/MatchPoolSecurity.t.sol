// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MatchPool} from "../src/MatchPool.sol";
import {ClaimHub} from "../src/ClaimHub.sol";
import {MockChips} from "./MockChips.sol";

/// @notice Mode B settle, host bond slash, abandon paths, refunds (HIGH-1/2, M1, M9).
contract MatchPoolSecurityTest is Test {
    MockChips chips;
    MatchPool pool;
    ClaimHub hub;

    address owner = address(0xA11CE);
    address edge;
    address host;
    address p1;
    address p2;

    uint256 edgePk = 0xEEEE;
    uint256 hostPk = 0xBBBB;
    uint256 p1Pk = 0x1111;
    uint256 p2Pk = 0x2222;

    bytes32 poolId = keccak256("pool-sec");
    bytes32 roomCode = keccak256("ROOM");
    bytes32 matchId = keccak256("match-sec");

    uint128 constant FEE = 1000e18;

    function setUp() public {
        edge = vm.addr(edgePk);
        host = vm.addr(hostPk);
        p1 = vm.addr(p1Pk);
        p2 = vm.addr(p2Pk);

        chips = new MockChips();
        vm.prank(owner);
        pool = new MatchPool(chips, edge, owner);
        hub = new ClaimHub(chips, pool, owner);
        vm.prank(owner);
        pool.setClaimHub(address(hub));

        chips.mint(p1, 10_000e18);
        chips.mint(p2, 10_000e18);
        chips.mint(host, 50_000e18);
    }

    function _sign(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _createAndLock() internal {
        address[] memory seats = new address[](2);
        seats[0] = host;
        seats[1] = p1;
        uint8[] memory colors = new uint8[](2);
        colors[0] = 3;
        colors[1] = 4;
        MatchPool.PoolConfig memory c = MatchPool.PoolConfig({
            poolId: poolId,
            roomCode: roomCode,
            matchId: matchId,
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
            roomCode: c.roomCode,
            matchId: c.matchId,
            host: c.host,
            seatsHash: c.seatsHash,
            gameMode: c.gameMode,
            maxSeats: c.maxSeats,
            issuedAt: c.ticketIssuedAt
        });
        pool.createPool(c, seats, colors, _sign(edgePk, pool.lobbyTicketHash(t)));

        vm.startPrank(host);
        chips.approve(address(pool), 30_000e18);
        pool.joinPool(poolId);
        vm.stopPrank();

        vm.startPrank(p1);
        chips.approve(address(pool), FEE);
        pool.joinPool(poolId);
        vm.stopPrank();

        vm.prank(host);
        pool.lockPool(poolId, 30 minutes);
    }

    function _settleDigest(MatchPool.Payout[] memory plan, uint64 deadline, uint256 nonce)
        internal
        view
        returns (bytes32)
    {
        bytes32 structHash = pool.settleStructHash(poolId, plan, deadline, nonce, host);
        return keccak256(abi.encodePacked("\x19\x01", _sep(), structHash));
    }

    function _abandonDigest(address accused, uint64 seq, uint8 strikes, uint64 deadline)
        internal
        view
        returns (bytes32)
    {
        bytes32 structHash = keccak256(
            abi.encode(pool.ABANDON_TYPEHASH(), poolId, accused, seq, strikes, deadline)
        );
        return keccak256(abi.encodePacked("\x19\x01", _sep(), structHash));
    }

    function test_modeB_edge_only_settle_pays_winner_and_slashes_bond() public {
        _createAndLock();
        (,,,,,,, uint128 hostBond, uint64 settleBy,) = pool.getPoolSummary(poolId);
        assertGt(hostBond, 0);

        // Host withholds signature — wait past settleBy (Mode B).
        vm.warp(uint256(settleBy) + 1);

        MatchPool.Payout[] memory plan = new MatchPool.Payout[](1);
        // prize = 2000 - 100 fee - 40 burn = 1860; Mode B adds bond for single winner
        uint256 prize = 1860e18;
        plan[0] = MatchPool.Payout({addr: p1, amount: prize});

        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes32 d = _settleDigest(plan, deadline, 1);
        bytes memory emptyHost = hex"";

        vm.prank(address(0xBEEF));
        pool.settlePool(poolId, plan, deadline, 1, emptyHost, _sign(edgePk, d));

        vm.warp(block.timestamp + 6 minutes);
        uint256 beforeBal = chips.balanceOf(p1);
        vm.prank(p1);
        pool.claimMatch(poolId);
        // winner gets prize + slashed bond
        assertEq(chips.balanceOf(p1), beforeBal + prize + uint256(hostBond));
    }

    function test_modeA_requires_host_sig() public {
        _createAndLock();
        MatchPool.Payout[] memory plan = new MatchPool.Payout[](1);
        plan[0] = MatchPool.Payout({addr: p1, amount: 1860e18});
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes32 d = _settleDigest(plan, deadline, 1);
        vm.expectRevert(MatchPool.BadSignature.selector);
        pool.settlePool(poolId, plan, deadline, 1, hex"", _sign(edgePk, d));
    }

    function test_edge_only_abandon_full_refund_no_burn() public {
        _createAndLock();
        uint256 burnBefore;
        (burnBefore,) = pool.burnRatioInputs();

        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes32 d = _abandonDigest(p1, 1, 3, deadline);
        pool.submitAbandon(poolId, p1, 1, 3, deadline, _sign(edgePk, d));

        uint256 burnAfter;
        (burnAfter,) = pool.burnRatioInputs();
        assertEq(burnAfter, burnBefore, "no burn on edge-only abandon");

        // Balances after abandon (bond already returned to host in refund-all).
        uint256 hostBefore = chips.balanceOf(host);
        uint256 p1Before = chips.balanceOf(p1);

        vm.prank(host);
        pool.refundJoin(poolId);
        vm.prank(p1);
        pool.refundJoin(poolId);
        assertEq(chips.balanceOf(host), hostBefore + FEE);
        assertEq(chips.balanceOf(p1), p1Before + FEE);
    }

    function test_dual_abandon_burns_half_accused_stake() public {
        _createAndLock();
        uint256 burnBefore;
        (burnBefore,) = pool.burnRatioInputs();

        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes32 d = _abandonDigest(p1, 1, 3, deadline);
        pool.submitAbandonDual(poolId, p1, 1, 3, deadline, _sign(edgePk, d), _sign(hostPk, d));

        uint256 burnAfter;
        (burnAfter,) = pool.burnRatioInputs();
        assertEq(burnAfter - burnBefore, FEE / 2);
    }

    function test_cancel_open_then_refund_join() public {
        address[] memory seats = new address[](2);
        seats[0] = host;
        seats[1] = p1;
        uint8[] memory colors = new uint8[](2);
        colors[0] = 1;
        colors[1] = 2;
        MatchPool.PoolConfig memory c = MatchPool.PoolConfig({
            poolId: poolId,
            roomCode: roomCode,
            matchId: matchId,
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
            roomCode: roomCode,
            matchId: matchId,
            host: host,
            seatsHash: c.seatsHash,
            gameMode: 0,
            maxSeats: 2,
            issuedAt: c.ticketIssuedAt
        });
        pool.createPool(c, seats, colors, _sign(edgePk, pool.lobbyTicketHash(t)));

        vm.startPrank(host);
        chips.approve(address(pool), FEE);
        pool.joinPool(poolId);
        pool.cancelOpen(poolId);
        vm.stopPrank();

        uint256 beforeBal = chips.balanceOf(host);
        vm.prank(host);
        pool.refundJoin(poolId);
        assertEq(chips.balanceOf(host), beforeBal + FEE);
    }

    function test_timeout_refund_requires_edge_unresolvable() public {
        _createAndLock();
        (,,,,,,,, uint64 settleBy,) = pool.getPoolSummary(poolId);
        vm.warp(uint256(settleBy) + 3 minutes + 1);

        bytes32 msgHash =
            keccak256(abi.encodePacked("Ludo unresolvable", poolId, block.chainid, address(pool)));
        // wrong flag
        vm.expectRevert(MatchPool.BadSignature.selector);
        pool.timeoutRefund(poolId, false, _sign(edgePk, msgHash));

        // wrong signer
        vm.expectRevert(MatchPool.BadSignature.selector);
        pool.timeoutRefund(poolId, true, _sign(p1Pk, msgHash));

        pool.timeoutRefund(poolId, true, _sign(edgePk, msgHash));
        vm.prank(p1);
        pool.refundJoin(poolId);
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
}
