// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MatchPool} from "../src/MatchPool.sol";
import {ClaimHub} from "../src/ClaimHub.sol";
import {MockChips} from "./MockChips.sol";

contract MatchPoolTest is Test {
    MockChips chips;
    MatchPool pool;
    ClaimHub hub;

    address owner = address(0xA11CE);
    address edge;
    address host;
    address p1 = address(0x1111);

    uint256 edgePk = 0xED6E;
    uint256 hostPk = 0xB0B;

    bytes32 poolId = keccak256("pool-1");
    bytes32 roomCode = keccak256("ROOM");
    bytes32 matchId = keccak256("match-1");

    function setUp() public {
        edge = vm.addr(edgePk);
        host = vm.addr(hostPk);
        chips = new MockChips();
        vm.prank(owner);
        pool = new MatchPool(chips, edge, owner);
        hub = new ClaimHub(chips, pool, owner);
        vm.prank(owner);
        pool.setClaimHub(address(hub));
        vm.prank(owner);
        pool.setEntryTier(100e18, true);

        chips.mint(p1, 1_000_000e18);
        chips.mint(host, 1_000_000e18);
    }

    function _sign(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _seatsMem() internal view returns (address[] memory seats, uint8[] memory colors) {
        seats = new address[](2);
        seats[0] = host;
        seats[1] = p1;
        colors = new uint8[](2);
        colors[0] = 3;
        colors[1] = 4;
    }

    function _cfg(uint128 fee) internal view returns (MatchPool.PoolConfig memory) {
        (address[] memory seats, uint8[] memory colors) = _seatsMem();
        return MatchPool.PoolConfig({
            poolId: poolId,
            roomCode: roomCode,
            matchId: matchId,
            host: host,
            seatsHash: keccak256(abi.encode(seats, colors)),
            gameMode: 0,
            maxSeats: 2,
            poolKind: 0,
            entryFee: fee,
            protocolBps: 500,
            burnBps: 200,
            windowClosedAt: 0,
            parentPoolId: bytes32(0),
            ticketIssuedAt: uint64(block.timestamp)
        });
    }

    function _ticketSig(MatchPool.PoolConfig memory c) internal view returns (bytes memory) {
        MatchPool.LobbyTicket memory t = MatchPool.LobbyTicket({
            roomCode: c.roomCode,
            matchId: c.matchId,
            host: c.host,
            seatsHash: c.seatsHash,
            gameMode: c.gameMode,
            maxSeats: c.maxSeats,
            issuedAt: c.ticketIssuedAt
        });
        return _sign(edgePk, pool.lobbyTicketHash(t));
    }

    function _create(uint128 fee) internal {
        MatchPool.PoolConfig memory c = _cfg(fee);
        (address[] memory seats, uint8[] memory colors) = _seatsMem();
        pool.createPool(c, seats, colors, _ticketSig(c));
    }

    function test_create_reverts_without_edge_ticket() public {
        MatchPool.PoolConfig memory c = _cfg(1000e18);
        (address[] memory seats, uint8[] memory colors) = _seatsMem();
        vm.expectRevert();
        pool.createPool(c, seats, colors, hex"");
    }

    function test_create_reverts_bad_fee_tier() public {
        MatchPool.PoolConfig memory c = _cfg(55e18);
        vm.expectRevert(MatchPool.BadFeeTier.selector);
        pool.openPoolShell(c);
    }

    function test_join_squat_reverts() public {
        _create(1000e18);
        address rando = address(0x9999);
        chips.mint(rando, 1000e18);
        vm.startPrank(rando);
        chips.approve(address(pool), 1000e18);
        vm.expectRevert(MatchPool.SeatSquat.selector);
        pool.joinPool(poolId);
        vm.stopPrank();
    }

    function test_join_lock_settle_modeA_claim() public {
        _create(1000e18);

        vm.startPrank(host);
        chips.approve(address(pool), 20_000e18);
        pool.joinPool(poolId);
        vm.stopPrank();

        vm.startPrank(p1);
        chips.approve(address(pool), 1000e18);
        pool.joinPool(poolId);
        vm.stopPrank();

        vm.prank(host);
        pool.lockPool(poolId, 30 minutes);

        MatchPool.Payout[] memory plan = new MatchPool.Payout[](1);
        plan[0] = MatchPool.Payout({addr: p1, amount: 1860e18});

        uint64 deadline = uint64(block.timestamp + 1 hours);
        uint256 nonce = 1;
        bytes32 structHash = pool.settleStructHash(poolId, plan, deadline, nonce, host);
        bytes32 d = keccak256(abi.encodePacked("\x19\x01", _sep(), structHash));
        bytes memory hostSig = _sign(hostPk, d);
        bytes memory edgeSig = _sign(edgePk, d);

        vm.prank(address(0xBEEF));
        pool.settlePool(poolId, plan, deadline, nonce, hostSig, edgeSig);

        vm.warp(block.timestamp + 6 minutes);
        uint256 beforeBal = chips.balanceOf(p1);
        vm.prank(p1);
        hub.claimMatch(poolId);
        assertEq(chips.balanceOf(p1), beforeBal + 1860e18);

        vm.prank(p1);
        vm.expectRevert(MatchPool.AlreadyClaimed.selector);
        pool.claimMatch(poolId);
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
