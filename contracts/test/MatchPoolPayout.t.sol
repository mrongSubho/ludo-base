// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MatchPool} from "../src/MatchPool.sol";
import {MockChips} from "./MockChips.sol";

/// @notice 2v2 50/50 + 4P top-2 75/25 prize splits.
contract MatchPoolPayoutTest is Test {
    MockChips chips;
    MatchPool pool;

    address owner = address(0xA11CE);
    address edge;
    address host;
    address a;
    address b;
    address c;
    address d;

    uint256 edgePk = 0xE1;
    uint256 hostPk = 0xB1;
    uint256 aPk = 0xA1;
    uint256 bPk = 0xB2;
    uint256 cPk = 0xC1;
    uint256 dPk = 0xD1;

    uint128 constant FEE = 1000e18;

    function setUp() public {
        edge = vm.addr(edgePk);
        host = vm.addr(hostPk);
        a = vm.addr(aPk);
        b = vm.addr(bPk);
        c = vm.addr(cPk);
        d = vm.addr(dPk);
        chips = new MockChips();
        vm.prank(owner);
        pool = new MatchPool(chips, edge, owner);
        chips.mint(a, 50_000e18);
        chips.mint(b, 50_000e18);
        chips.mint(c, 50_000e18);
        chips.mint(d, 50_000e18);
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

    /// @param shape MatchPool.PoolShape — ECO-08: the payout branch now follows
    /// the declared shape, not seat colours.
    function _open4(
        bytes32 poolId,
        address[4] memory seats_,
        uint8[4] memory colors,
        MatchPool.PoolShape shape
    ) internal {
        address[] memory seats = new address[](4);
        uint8[] memory cols = new uint8[](4);
        for (uint256 i = 0; i < 4; i++) {
            seats[i] = seats_[i];
            cols[i] = colors[i];
        }
        MatchPool.PoolConfig memory cfg = MatchPool.PoolConfig({
            poolId: poolId,
            roomCode: keccak256("R"),
            matchId: keccak256("M"),
            host: host,
            seatsHash: keccak256(abi.encode(seats, cols)),
            gameMode: 0,
            shape: uint8(shape),
            maxSeats: 4,
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
            shape: uint8(shape),
            maxSeats: 4,
            issuedAt: cfg.ticketIssuedAt
        });
        pool.createPool(cfg, seats, cols, _sign(edgePk, pool.lobbyTicketHash(t)));

        for (uint256 i = 0; i < 4; i++) {
            vm.startPrank(seats[i]);
            chips.approve(address(pool), FEE * 2);
            pool.joinPool(poolId);
            vm.stopPrank();
        }
        vm.startPrank(host);
        chips.approve(address(pool), 100_000e18);
        pool.lockPool(poolId, 30 minutes);
        vm.stopPrank();
    }

    function _sigs(bytes32 poolId, MatchPool.Payout[] memory plan)
        internal
        view
        returns (uint64 deadline, uint256 nonce, bytes memory hostSig, bytes memory edgeSig)
    {
        deadline = uint64(block.timestamp + 1 hours);
        nonce = 1;
        bytes32 structHash = pool.settleStructHash(poolId, plan, deadline, nonce, host);
        bytes32 d = keccak256(abi.encodePacked("\x19\x01", _sep(), structHash));
        hostSig = _sign(hostPk, d);
        edgeSig = _sign(edgePk, d);
    }

    function _prize() internal pure returns (uint256) {
        // gross 4000e18 - 5% - 2% = 3720e18
        return 3720e18;
    }

    function test_2v2_equal_split_50_50() public {
        bytes32 poolId = keccak256("2v2");
        // G+B (a,b) is a TEAM_PAIRINGS pair (colors 1=G, 4=B)
        _open4(poolId, [a, b, c, d], [1, 4, 3, 2], MatchPool.PoolShape.TwoVsTwo);

        uint256 prize = _prize();
        uint256 half = prize / 2;
        uint256 dust = prize % 2;
        MatchPool.Payout[] memory plan = new MatchPool.Payout[](2);
        plan[0] = MatchPool.Payout({addr: a, amount: half + dust});
        plan[1] = MatchPool.Payout({addr: b, amount: half});
        (uint64 dl, uint256 n, bytes memory hs, bytes memory es) = _sigs(poolId, plan);
        pool.settlePool(poolId, plan, dl, n, hs, es);

        // Unequal "50/50" must revert (separate pool).
        bytes32 pool2 = keccak256("2v2-bad");
        _open4(pool2, [a, b, c, d], [1, 4, 3, 2], MatchPool.PoolShape.TwoVsTwo);
        MatchPool.Payout[] memory bad = new MatchPool.Payout[](2);
        bad[0] = MatchPool.Payout({addr: a, amount: half + dust + 1});
        bad[1] = MatchPool.Payout({addr: b, amount: half - 1});
        (dl, n, hs, es) = _sigs(pool2, bad);
        vm.expectRevert(MatchPool.SumMismatch.selector);
        pool.settlePool(pool2, bad, dl, n, hs, es);
    }

    function test_2v2_rejects_non_team_pair_as_equal_split() public {
        bytes32 poolId = keccak256("2v2-np");
        _open4(poolId, [a, b, c, d], [1, 2, 3, 4], MatchPool.PoolShape.FourPlayer);
        uint256 prize = _prize();
        MatchPool.Payout[] memory plan = new MatchPool.Payout[](2);
        // a=Green, c=Red — not a team pair → 4P rules; 50/50 must fail
        plan[0] = MatchPool.Payout({addr: a, amount: prize / 2 + prize % 2});
        plan[1] = MatchPool.Payout({addr: c, amount: prize / 2});
        (uint64 dl, uint256 n, bytes memory hs, bytes memory es) = _sigs(poolId, plan);
        vm.expectRevert(MatchPool.SumMismatch.selector);
        pool.settlePool(poolId, plan, dl, n, hs, es);
    }

    function test_4p_top2_split_75_25() public {
        bytes32 poolId = keccak256("4p");
        // a=Green, c=Red — not TEAM_PAIRINGS → 4P podium
        _open4(poolId, [a, b, c, d], [1, 2, 3, 4], MatchPool.PoolShape.FourPlayer);

        uint256 prize = _prize();
        uint256 first = (prize * 75) / 100;
        uint256 second = prize - first;
        MatchPool.Payout[] memory plan = new MatchPool.Payout[](2);
        plan[0] = MatchPool.Payout({addr: a, amount: first});
        plan[1] = MatchPool.Payout({addr: c, amount: second});
        (uint64 dl, uint256 n, bytes memory hs, bytes memory es) = _sigs(poolId, plan);
        pool.settlePool(poolId, plan, dl, n, hs, es);

        vm.warp(block.timestamp + 6 minutes);
        uint256 aBefore = chips.balanceOf(a);
        uint256 cBefore = chips.balanceOf(c);
        vm.prank(a);
        pool.claimMatch(poolId);
        vm.prank(c);
        pool.claimMatch(poolId);
        assertEq(chips.balanceOf(a), aBefore + first);
        assertEq(chips.balanceOf(c), cBefore + second);
    }

    /// @dev ECO-08 regression. In 4P the lobby seats players green,red,yellow,blue
    /// (lib/gameLogic.ts LOBBY_COLORS), i.e. colours 1,2,3,4. The old code inferred
    /// "2v2" from _isTeamPair, which calls colours {1,4} teammates — so any 4P game
    /// whose top two were green and blue was paid 50/50 instead of the 75/25 podium.
    /// No revert fired; the payout was simply wrong.
    function test_4p_green_blue_top2_pays_podium_not_50_50() public {
        bytes32 poolId = keccak256("4p-gb");
        // a=Green(1), b=Blue(4) — exactly the pair the old inference misread as teammates.
        _open4(poolId, [a, b, c, d], [1, 4, 3, 2], MatchPool.PoolShape.FourPlayer);

        uint256 prize = _prize();
        uint256 first = (prize * 75) / 100;
        uint256 second = prize - first;
        MatchPool.Payout[] memory plan = new MatchPool.Payout[](2);
        plan[0] = MatchPool.Payout({addr: a, amount: first});
        plan[1] = MatchPool.Payout({addr: b, amount: second});

        uint256 aBefore = chips.balanceOf(a);
        uint256 bBefore = chips.balanceOf(b);
        (uint64 dl, uint256 n, bytes memory hs, bytes memory es) = _sigs(poolId, plan);
        pool.settlePool(poolId, plan, dl, n, hs, es);

        vm.warp(block.timestamp + 6 minutes);
        vm.prank(a);
        pool.claimMatch(poolId);
        vm.prank(b);
        pool.claimMatch(poolId);

        assertEq(chips.balanceOf(a) - aBefore, first, "1st must take 75%");
        assertEq(chips.balanceOf(b) - bBefore, second, "2nd must take 25%");
        // The old behaviour would have paid half each.
        assertTrue(chips.balanceOf(a) - aBefore != prize / 2, "must not pay 50/50 in 4P");
    }

    /// @dev The declared shape is signed: a host cannot claim FourPlayer on a pool
    /// whose edge-signed ticket said TwoVsTwo, because shape is inside the
    /// LOBBY_TYPEHASH preimage and bindPoolSeats recomputes the digest.
    function test_shape_tamper_in_config_fails_ticket() public {
        bytes32 poolId = keccak256("shape-tamper");
        address[] memory seats = new address[](4);
        uint8[] memory cols = new uint8[](4);
        address[4] memory s = [a, b, c, d];
        uint8[4] memory cs = [1, 4, 3, 2];
        for (uint256 i = 0; i < 4; i++) {
            seats[i] = s[i];
            cols[i] = cs[i];
        }
        // Ticket was signed for TwoVsTwo...
        MatchPool.PoolConfig memory cfg = MatchPool.PoolConfig({
            poolId: poolId,
            roomCode: keccak256("R"),
            matchId: keccak256("M"),
            host: host,
            seatsHash: keccak256(abi.encode(seats, cols)),
            gameMode: 0,
            shape: uint8(MatchPool.PoolShape.TwoVsTwo),
            maxSeats: 4,
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
            host: cfg.host,
            seatsHash: cfg.seatsHash,
            gameMode: cfg.gameMode,
            shape: cfg.shape,
            maxSeats: cfg.maxSeats,
            issuedAt: cfg.ticketIssuedAt
        });
        bytes memory sig = _sign(edgePk, pool.lobbyTicketHash(t));

        // ...but the host submits FourPlayer to unlock the 75/25 branch.
        cfg.shape = uint8(MatchPool.PoolShape.FourPlayer);
        vm.expectRevert(MatchPool.BadTicket.selector);
        pool.createPool(cfg, seats, cols, sig);
    }

    /// @dev A 2v2 pool whose two winners are not the teammate pair must revert
    /// rather than silently paying an arbitrary split.
    function test_2v2_non_teammate_winners_revert() public {
        bytes32 poolId = keccak256("2v2-nonteam");
        _open4(poolId, [a, b, c, d], [1, 4, 3, 2], MatchPool.PoolShape.TwoVsTwo);

        uint256 prize = _prize();
        MatchPool.Payout[] memory plan = new MatchPool.Payout[](2);
        // a=Green(1) and c=Red(3) are opponents, not the declared teammate pair.
        // (c+d *is* the other team and would legitimately settle, so pick a+c.)
        plan[0] = MatchPool.Payout({addr: a, amount: prize / 2 + prize % 2});
        plan[1] = MatchPool.Payout({addr: c, amount: prize / 2});
        (uint64 dl, uint256 n, bytes memory hs, bytes memory es) = _sigs(poolId, plan);
        vm.expectRevert(MatchPool.NotTeammates.selector);
        pool.settlePool(poolId, plan, dl, n, hs, es);
    }

    /// @dev shape must agree with maxSeats, or a 4-seat pool could declare OneVsOne
    /// and skip the podium check entirely.
    function test_shape_seat_mismatch_reverts() public {
        bytes32 poolId = keccak256("shape-mismatch");
        address[] memory seats = new address[](2);
        uint8[] memory cols = new uint8[](2);
        seats[0] = a;
        seats[1] = b;
        cols[0] = 1;
        cols[1] = 2;
        MatchPool.PoolConfig memory cfg = MatchPool.PoolConfig({
            poolId: poolId,
            roomCode: keccak256("R"),
            matchId: keccak256("M"),
            host: host,
            seatsHash: keccak256(abi.encode(seats, cols)),
            gameMode: 0,
            shape: uint8(MatchPool.PoolShape.FourPlayer), // 4P shape on a 2-seat pool
            maxSeats: 2,
            poolKind: 0,
            entryFee: FEE,
            protocolBps: 500,
            burnBps: 200,
            windowClosedAt: 0,
            parentPoolId: bytes32(0),
            ticketIssuedAt: uint64(block.timestamp)
        });
        vm.expectRevert(MatchPool.InvalidParam.selector);
        pool.openPoolShell(cfg);
    }

    function test_4p_wrong_ratio_reverts() public {
        bytes32 poolId = keccak256("4p-bad");
        _open4(poolId, [a, b, c, d], [1, 2, 3, 4], MatchPool.PoolShape.FourPlayer);
        uint256 prize = _prize();
        MatchPool.Payout[] memory plan = new MatchPool.Payout[](2);
        plan[0] = MatchPool.Payout({addr: a, amount: prize / 2 + prize % 2});
        plan[1] = MatchPool.Payout({addr: c, amount: prize / 2});
        (uint64 dl, uint256 n, bytes memory hs, bytes memory es) = _sigs(poolId, plan);
        vm.expectRevert(MatchPool.SumMismatch.selector);
        pool.settlePool(poolId, plan, dl, n, hs, es);
    }
}
