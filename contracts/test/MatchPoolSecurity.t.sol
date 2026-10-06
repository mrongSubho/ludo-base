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

    /// @notice In Mode B, `msg.sender` is a RELAYER, not the authorization.
    ///
    /// SEC-04. The previous version of this test called `settlePool` from a
    /// random address and asserted the payout landed, with no comment about what
    /// that implied. It read as "anyone can settle a locked pool", which is both
    /// the wrong conclusion and a trap: the SEC-04 checklist item asked for a test
    /// asserting a non-authority CANNOT settle after `settleBy`, and this file
    /// appeared to pin the opposite.
    ///
    /// What is actually true, and is asserted here deliberately:
    ///
    ///   - `MatchPool.settlePool` has NO `msg.sender` check. Authorization is the
    ///     edge co-signature: `_recover(d, edgeSig) != edgeSigner` reverts.
    ///     Mode A additionally requires the host's own signature; Mode B (after
    ///     `settleBy`) exists precisely for a host that withholds it, so it
    ///     requires only the edge signature.
    ///   - The digest binds `poolId`, the payout plan, `deadline`, `nonce` and
    ///     `p.authority`, so a co-signature is single-use and plan-specific. The
    ///     sibling tests below pin each of those bindings.
    ///   - `msg.sender` being a free choice is safe only because the server
    ///     refuses to produce a co-signature for anyone but the on-chain
    ///     authority: `requireAuthority` in lib/poolAuthority.ts, asserted in
    ///     scripts/pool-authority.test.ts ("requireAuthority accepts only the
    ///     on-chain authority"). That server check is the authority gate; this
    ///     contract deliberately is not.
    function test_modeB_msg_sender_is_a_relayer_the_edge_signature_is_the_gate() public {
        _createAndLock();
        (,,,,,,,, uint128 hostBond, uint64 settleBy,) = pool.getPoolSummary(poolId);
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

        // Relay from an unrelated address: permitted, because authorization is
        // carried by edgeSig and not by msg.sender.
        vm.prank(address(0xBEEF));
        pool.settlePool(poolId, plan, deadline, 1, emptyHost, _sign(edgePk, d));

        vm.warp(block.timestamp + 6 minutes);
        uint256 beforeBal = chips.balanceOf(p1);
        vm.prank(p1);
        pool.claimMatch(poolId);
        // winner gets prize + slashed bond
        assertEq(chips.balanceOf(p1), beforeBal + prize + uint256(hostBond));
    }

    /// @dev The edge co-signature is required in BOTH modes. Without it nobody
    /// settles — not the host, not a relayer, not after `settleBy`.
    function test_modeB_still_requires_the_edge_signature() public {
        _createAndLock();
        (,,,,,,,,, uint64 settleBy,) = pool.getPoolSummary(poolId);
        vm.warp(uint256(settleBy) + 1);

        MatchPool.Payout[] memory plan = new MatchPool.Payout[](1);
        plan[0] = MatchPool.Payout({addr: p1, amount: 1860e18});
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes32 d = _settleDigest(plan, deadline, 1);

        // Authority relaying its own request, without the edge signature.
        vm.prank(host);
        vm.expectRevert(MatchPool.BadSignature.selector);
        pool.settlePool(poolId, plan, deadline, 1, hex"", hex"");

        // ...and with a signature from the wrong key.
        vm.prank(address(0xBEEF));
        vm.expectRevert(MatchPool.BadSignature.selector);
        pool.settlePool(poolId, plan, deadline, 1, hex"", _sign(0xDEAD, d));
    }

    /// @dev A co-signature obtained for one payout plan must not settle another.
    /// Without the plan in the digest an attacker could take a signed digest and
    /// redirect the whole prize fund to themselves.
    function test_edge_signature_is_bound_to_the_payout_plan() public {
        _createAndLock();
        (,,,,,,,,, uint64 settleBy,) = pool.getPoolSummary(poolId);
        vm.warp(uint256(settleBy) + 1);

        MatchPool.Payout[] memory signedPlan = new MatchPool.Payout[](1);
        signedPlan[0] = MatchPool.Payout({addr: p1, amount: 1860e18});
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes32 d = _settleDigest(signedPlan, deadline, 1);
        bytes memory sig = _sign(edgePk, d);

        // Same digest, different recipient.
        MatchPool.Payout[] memory stolen = new MatchPool.Payout[](1);
        stolen[0] = MatchPool.Payout({addr: address(0xBAD), amount: 1860e18});
        vm.expectRevert(MatchPool.BadSignature.selector);
        pool.settlePool(poolId, stolen, deadline, 1, hex"", sig);

        // Same digest, split across two winners.
        MatchPool.Payout[] memory split = new MatchPool.Payout[](2);
        split[0] = MatchPool.Payout({addr: p1, amount: 930e18});
        split[1] = MatchPool.Payout({addr: p2, amount: 930e18});
        vm.expectRevert(MatchPool.BadSignature.selector);
        pool.settlePool(poolId, split, deadline, 1, hex"", sig);

        // The intended plan still settles, proving the rejections above were the
        // binding and not some unrelated failure.
        vm.prank(address(0xBEEF));
        pool.settlePool(poolId, signedPlan, deadline, 1, hex"", sig);
    }

    /// @dev The digest names `p.authority`. A co-signature obtained for a
    /// different authority does not transfer to this pool.
    function test_edge_signature_is_bound_to_the_authority() public {
        _createAndLock();
        (,,,,,,,,, uint64 settleBy,) = pool.getPoolSummary(poolId);
        vm.warp(uint256(settleBy) + 1);

        MatchPool.Payout[] memory plan = new MatchPool.Payout[](1);
        plan[0] = MatchPool.Payout({addr: p1, amount: 1860e18});
        uint64 deadline = uint64(block.timestamp + 1 hours);

        bytes32 structHash = pool.settleStructHash(poolId, plan, deadline, 1, address(0xBEEF));
        bytes32 d = keccak256(abi.encodePacked("\x19\x01", _sep(), structHash));

        vm.expectRevert(MatchPool.BadSignature.selector);
        pool.settlePool(poolId, plan, deadline, 1, hex"", _sign(edgePk, d));
    }

    /// @dev A pool that has already settled refuses a replayed co-signature.
    ///
    /// Named for what it actually proves: the `status != Settled` gate. An earlier
    /// version of this test claimed to prove the nonce was single-use, but the
    /// status check fires first — verified by deleting `p.settleNonce += 1` and
    /// watching this test still pass. The nonce binding is pinned separately by
    /// `test_settle_requires_the_current_nonce`.
    function test_settled_pool_refuses_a_replayed_co_signature() public {
        _createAndLock();
        (,,,,,,,,, uint64 settleBy,) = pool.getPoolSummary(poolId);
        vm.warp(uint256(settleBy) + 1);

        MatchPool.Payout[] memory plan = new MatchPool.Payout[](1);
        plan[0] = MatchPool.Payout({addr: p1, amount: 1860e18});
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes32 d = _settleDigest(plan, deadline, 1);
        bytes memory sig = _sign(edgePk, d);

        pool.settlePool(poolId, plan, deadline, 1, hex"", sig);

        (uint8 statusAfter,,,,,,,,,,) = pool.getPoolSummary(poolId);
        assertEq(statusAfter, uint8(MatchPool.Status.Settled), "pool must be Settled");

        vm.expectRevert(MatchPool.BadStatus.selector);
        pool.settlePool(poolId, plan, deadline, 1, hex"", sig);
    }

    /// @dev The nonce is bound into the digest and checked against the pool's own
    /// counter, so a co-signature carrying a stale or invented nonce is refused
    /// even on the first (and only) settle.
    ///
    /// This is the test that actually pins the nonce. Deleting the
    /// `p.settleNonce += 1` bump leaves it passing — and that is not a gap in the
    /// test, it is a property of the contract: `settlePool` requires status
    /// Locked and `_applySettle` sets Settled, so a pool settles at most once and
    /// the bumped value is never read again. The bump is inert defence-in-depth
    /// for a hypothetical future path that re-opens settlement. What is NOT inert
    /// is the check on line 478, and removing that does fail this test.
    function test_settle_requires_the_current_nonce() public {
        _createAndLock();
        (,,,,,,,,, uint64 settleBy,) = pool.getPoolSummary(poolId);
        vm.warp(uint256(settleBy) + 1);

        MatchPool.Payout[] memory plan = new MatchPool.Payout[](1);
        plan[0] = MatchPool.Payout({addr: p1, amount: 1860e18});
        uint64 deadline = uint64(block.timestamp + 1 hours);

        // A signature the edge co-signed over a nonce that is not the pool's.
        bytes32 d = _settleDigest(plan, deadline, 7);
        vm.expectRevert(MatchPool.BadSignature.selector);
        pool.settlePool(poolId, plan, deadline, 7, hex"", _sign(edgePk, d));

        // ...and the nonce the pool expects still works.
        bytes32 ok_ = _settleDigest(plan, deadline, 1);
        pool.settlePool(poolId, plan, deadline, 1, hex"", _sign(edgePk, ok_));
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
            roomCode: roomCode,
            matchId: matchId,
            host: host,
            seatsHash: c.seatsHash,
            gameMode: 0,
            shape: 0,
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
        (,,,,,,,,, uint64 settleBy,) = pool.getPoolSummary(poolId);
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
