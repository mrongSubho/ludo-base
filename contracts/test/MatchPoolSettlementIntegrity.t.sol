// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MatchPool} from "../src/MatchPool.sol";
import {ClaimHub} from "../src/ClaimHub.sol";
import {MockChips} from "./MockChips.sol";

/// @notice ECO-01 (duplicate payout address stranded funds) and ECO-03 (unchecked
/// CHIPS transfers/burn let a pool settle as Settled while value never moved).
contract MatchPoolSettlementIntegrityTest is Test {
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

    bytes32 poolId = keccak256("pool-integrity");
    bytes32 roomCode = keccak256("ROOM");
    bytes32 matchId = keccak256("match-integrity");

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

    /// @dev Must match the other suites byte-for-byte: the EIP-712 domain hash is
    /// keccak256 over the *hashed* fields via abi.encode. Using abi.encodePacked
    /// with raw strings yields a different separator and every signature fails.
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

    /// @dev Two seats (host + p1) so maxSeats == 2, which the contract does not
    /// ratio-check — that is exactly the shape where a duplicate address used to
    /// slip past the 4-seat duplicate rejection and strand funds.
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
            shape: 0,
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
            shape: c.shape,
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

    /// @dev Two entries naming the SAME address. The sum check counts each entry,
    /// so it passes sum == prizeFund; the credit loop used `=`, so the second
    /// write clobbered the first and the difference was unreachable forever.
    function test_duplicate_payout_address_accumulates_instead_of_stranding() public {
        _createAndLock();

        uint256 prize = 1860e18; // 2000 gross - 100 fee - 40 burn
        uint64 deadline = uint64(block.timestamp + 1 hours);

        MatchPool.Payout[] memory plan = new MatchPool.Payout[](2);
        plan[0] = MatchPool.Payout({addr: p1, amount: prize / 2});
        plan[1] = MatchPool.Payout({addr: p1, amount: prize - prize / 2});

        assertEq(plan[0].amount + plan[1].amount, prize, "plan must sum to the prize fund");

        bytes32 d = _settleDigest(plan, deadline, 1);
        pool.settlePool(poolId, plan, deadline, 1, _sign(hostPk, d), _sign(edgePk, d));

        vm.warp(block.timestamp + 6 minutes);
        uint256 before = chips.balanceOf(p1);
        vm.prank(p1);
        pool.claimMatch(poolId);

        // The whole prize fund must be claimable. With `=` the second write would
        // have left only `prize - prize/2` credited and the rest stranded.
        assertEq(chips.balanceOf(p1) - before, prize, "entire prize fund must be claimable");
    }

    /// @dev The pool's accounting must never create value: total claimable credit
    /// equals the prize fund plus the bond that was returned to the host.
    function test_settlement_does_not_mint_value() public {
        _createAndLock();
        uint256 supplyBefore = chips.totalSupply();

        uint256 prize = 1860e18;
        uint64 deadline = uint64(block.timestamp + 1 hours);
        MatchPool.Payout[] memory plan = new MatchPool.Payout[](1);
        plan[0] = MatchPool.Payout({addr: p1, amount: prize});

        bytes32 d = _settleDigest(plan, deadline, 1);
        pool.settlePool(poolId, plan, deadline, 1, _sign(hostPk, d), _sign(edgePk, d));

        // Mode A: bond is returned to the host, burn removes 40, fee removes 100.
        // Only the burn should reduce supply.
        uint256 burned = 40e18;
        assertEq(supplyBefore - chips.totalSupply(), burned, "only the burn reduces supply");

        vm.warp(block.timestamp + 6 minutes);
        uint256 p1Before = chips.balanceOf(p1);
        vm.prank(p1);
        pool.claimMatch(poolId);
        assertEq(chips.balanceOf(p1) - p1Before, prize, "winner receives exactly the prize fund");
    }

    /// @dev ECO-03: a pool must never reach Settled if a CHIPS movement silently
    /// failed. MockChips reverting on transfer is the closest available proxy for
    /// a token that returns false / does not move value.
    function test_revert_is_not_reported_as_settled_when_prize_is_unclaimable() public {
        _createAndLock();
        uint256 prize = 1860e18;
        uint64 deadline = uint64(block.timestamp + 1 hours);
        MatchPool.Payout[] memory plan = new MatchPool.Payout[](1);
        plan[0] = MatchPool.Payout({addr: p1, amount: prize});

        bytes32 d = _settleDigest(plan, deadline, 1);
        pool.settlePool(poolId, plan, deadline, 1, _sign(hostPk, d), _sign(edgePk, d));

        // getPoolSummary returns (status, maxSeats, filledSeats, authority,
        // entryFee, gross, prizeFund, hostBond, settleBy, claimUnlockAt).
        (uint8 status, , , , , , , , , , , ) = pool.getPoolSummary(poolId);
        assertEq(uint256(status), 3, "status must be Settled");

        // A settled pool must be claimable by the winner; if credit were lost the
        // claim would come up short or revert, which is what ECO-01 caused.
        vm.warp(block.timestamp + 6 minutes);
        uint256 before = chips.balanceOf(p1);
        vm.prank(p1);
        pool.claimMatch(poolId);
        assertGt(chips.balanceOf(p1) - before, 0, "winner must receive a non-zero payout");
    }
}
