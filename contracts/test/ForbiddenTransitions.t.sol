// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MatchPool} from "../src/MatchPool.sol";
import {MockChips} from "./MockChips.sol";

/// @notice Exhaustive status-transition guards on MatchPool.
/// Status: Open(0) → Funded(1) → Locked(2) → Settled(3) | Cancelled(4) | Expired(5).
/// Happy path is the control; every illegal (status, action) edge must revert
/// with its custom error before any other check runs.
contract ForbiddenTransitions is Test {
    MockChips chips;
    MatchPool pool;

    address owner = address(0xA11CE);
    address edge;
    address host;
    address p1 = address(0x1111);

    uint256 edgePk = 0xED6E;
    uint256 hostPk = 0xB0B;

    uint128 constant FEE = 100e18;
    uint64 constant SETTLE_WINDOW = 30 minutes;
    uint64 constant LOBBY_TTL = 1 hours;

    // Status ids (MatchPool.Status)
    uint8 constant S_OPEN = 0;
    uint8 constant S_FUNDED = 1;
    uint8 constant S_LOCKED = 2;
    uint8 constant S_SETTLED = 3;
    uint8 constant S_CANCELLED = 4;
    uint8 constant S_EXPIRED = 5;
    uint8 constant S_SETTLED_CLAIMED = 6; // Settled after a successful claim

    // Action ids
    uint8 constant A_JOIN = 0;
    uint8 constant A_LOCK = 1;
    uint8 constant A_CANCEL = 2;
    uint8 constant A_EXPIRE = 3;
    uint8 constant A_SETTLE = 4;
    uint8 constant A_CLAIM = 5;
    uint8 constant A_REFUND = 6;
    uint8 constant A_TIMEOUT = 7;
    uint8 constant A_ABANDON = 8;
    uint8 constant A_PAUSE = 9;
    uint8 constant A_BIND = 10;

    function setUp() public {
        edge = vm.addr(edgePk);
        host = vm.addr(hostPk);
        chips = new MockChips();
        vm.prank(owner);
        pool = new MatchPool(chips, edge, owner);
        vm.prank(owner);
        pool.setEntryTier(FEE, true);

        chips.mint(p1, 1_000_000e18);
        chips.mint(host, 1_000_000e18);
    }

    // ---------------------------------------------------------------- helpers

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

    function _cfg(bytes32 poolId, uint128 fee) internal view returns (MatchPool.PoolConfig memory) {
        (address[] memory seats, uint8[] memory colors) = _seatsMem();
        return MatchPool.PoolConfig({
            poolId: poolId,
            roomCode: keccak256("ROOM"),
            matchId: keccak256(abi.encodePacked("match", poolId)),
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

    function _create(bytes32 poolId) internal {
        MatchPool.PoolConfig memory c = _cfg(poolId, FEE);
        (address[] memory seats, uint8[] memory colors) = _seatsMem();
        pool.createPool(c, seats, colors, _ticketSig(c));
    }

    function _joinBoth(bytes32 poolId) internal {
        vm.startPrank(host);
        chips.approve(address(pool), FEE);
        pool.joinPool(poolId);
        vm.stopPrank();

        vm.startPrank(p1);
        chips.approve(address(pool), FEE);
        pool.joinPool(poolId);
        vm.stopPrank();
    }

    function _settleValid(bytes32 poolId) internal {
        // gross 200e18 → protocol 10e18, burn 4e18, prizeFund 186e18
        MatchPool.Payout[] memory plan = new MatchPool.Payout[](1);
        plan[0] = MatchPool.Payout({addr: p1, amount: 186e18});

        uint64 deadline = uint64(block.timestamp + 1 hours);
        uint256 nonce = 1;
        bytes32 structHash = pool.settleStructHash(poolId, plan, deadline, nonce, host);
        bytes32 d = keccak256(abi.encodePacked("\x19\x01", _sep(), structHash));
        bytes memory hostSig = _sign(hostPk, d);
        bytes memory edgeSig = _sign(edgePk, d);
        pool.settlePool(poolId, plan, deadline, nonce, hostSig, edgeSig);
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

    /// Bring a fresh pool to the requested lifecycle point.
    function _drive(bytes32 pid, uint8 status) internal {
        if (status == S_OPEN) {
            _create(pid);
        } else if (status == S_FUNDED) {
            _create(pid);
            _joinBoth(pid);
        } else if (status == S_LOCKED) {
            _create(pid);
            _joinBoth(pid);
            vm.prank(host);
            pool.lockPool(pid, SETTLE_WINDOW);
        } else if (status == S_SETTLED) {
            _drive(pid, S_LOCKED);
            _settleValid(pid);
        } else if (status == S_SETTLED_CLAIMED) {
            _drive(pid, S_SETTLED);
            vm.warp(block.timestamp + 3 minutes);
            vm.prank(p1);
            pool.claimMatch(pid);
        } else if (status == S_CANCELLED) {
            _create(pid);
            _joinBoth(pid);
            vm.prank(host);
            pool.cancelOpen(pid);
        } else if (status == S_EXPIRED) {
            _create(pid);
            vm.warp(block.timestamp + 2 hours);
            pool.expirePool(pid, LOBBY_TTL);
        } else {
            revert("bad status id");
        }
    }

    /// Invoke an action. Calldata is intentionally dummy where status is checked first.
    function _invoke(uint8 action, bytes32 pid) internal {
        if (action == A_JOIN) {
            vm.prank(p1);
            pool.joinPool(pid);
        } else if (action == A_LOCK) {
            vm.prank(host);
            pool.lockPool(pid, SETTLE_WINDOW);
        } else if (action == A_CANCEL) {
            vm.prank(host);
            pool.cancelOpen(pid);
        } else if (action == A_EXPIRE) {
            pool.expirePool(pid, LOBBY_TTL);
        } else if (action == A_SETTLE) {
            MatchPool.Payout[] memory plan = new MatchPool.Payout[](1);
            plan[0] = MatchPool.Payout({addr: p1, amount: 1});
            pool.settlePool(pid, plan, uint64(block.timestamp + 1), 1, "", "");
        } else if (action == A_CLAIM) {
            vm.prank(p1);
            pool.claimMatch(pid);
        } else if (action == A_REFUND) {
            vm.prank(p1);
            pool.refundJoin(pid);
        } else if (action == A_TIMEOUT) {
            pool.timeoutRefund(pid, true, "");
        } else if (action == A_ABANDON) {
            pool.submitAbandon(pid, p1, 0, 0, uint64(block.timestamp + 1), "");
        } else if (action == A_PAUSE) {
            vm.prank(owner);
            pool.addPauseDelta(pid, 60);
        } else if (action == A_BIND) {
            MatchPool.PoolConfig memory c = _cfg(pid, FEE);
            (address[] memory seats, uint8[] memory colors) = _seatsMem();
            pool.bindPoolSeats(c, seats, colors, "");
        } else {
            revert("bad action id");
        }
    }

    /// True when the action is a legal status edge from `s` (skip in the forbidden table).
    function _isLegal(uint8 s, uint8 a) internal pure returns (bool) {
        if (a == A_JOIN) return s == S_OPEN;
        if (a == A_LOCK) return s == S_FUNDED;
        if (a == A_CANCEL) return s == S_OPEN || s == S_FUNDED;
        if (a == A_EXPIRE) return s == S_OPEN || s == S_FUNDED;
        if (a == A_SETTLE) return s == S_LOCKED;
        if (a == A_CLAIM) return s == S_SETTLED;
        if (a == A_REFUND) return s == S_SETTLED || s == S_CANCELLED || s == S_EXPIRED;
        if (a == A_TIMEOUT) return s == S_LOCKED;
        if (a == A_ABANDON) return s == S_LOCKED;
        if (a == A_PAUSE) return s == S_LOCKED;
        if (a == A_BIND) return false; // driver always binds via createPool
        return false;
    }

    /// Expected custom error for a forbidden (status, action) edge.
    function _expectedError(uint8 s, uint8 a) internal pure returns (bytes4) {
        // Post-claim Settled keeps status=Settled, so claim hits the claimed bit
        // and refund finds a zeroed credit before the claimed bit.
        if (s == S_SETTLED_CLAIMED && a == A_CLAIM) return MatchPool.AlreadyClaimed.selector;
        if (s == S_SETTLED_CLAIMED && a == A_REFUND) return MatchPool.NothingToClaim.selector;
        // claim is the only status-guarded entry point that uses NotSettled.
        if (a == A_CLAIM && s != S_SETTLED) return MatchPool.NotSettled.selector;
        return MatchPool.BadStatus.selector;
    }

    // --------------------------------------------------------------- controls

    function test_control_happy_path() public {
        bytes32 pid = keccak256("control");
        _create(pid);
        assertEq(uint8(_statusOf(pid)), S_OPEN);

        _joinBoth(pid);
        assertEq(uint8(_statusOf(pid)), S_FUNDED);

        vm.prank(host);
        pool.lockPool(pid, SETTLE_WINDOW);
        assertEq(uint8(_statusOf(pid)), S_LOCKED);

        _settleValid(pid);
        assertEq(uint8(_statusOf(pid)), S_SETTLED);

        vm.warp(block.timestamp + 3 minutes);
        uint256 beforeBal = chips.balanceOf(p1);
        vm.prank(p1);
        pool.claimMatch(pid);
        assertEq(chips.balanceOf(p1), beforeBal + 186e18);
    }

    function _statusOf(bytes32 pid) internal view returns (MatchPool.Status) {
        (uint8 status,,,,,,) = _summary(pid);
        return MatchPool.Status(status);
    }

    function _summary(bytes32 pid)
        internal
        view
        returns (
            uint8 status,
            uint8 maxSeats,
            uint8 filledSeats,
            address authority,
            uint128 entryFee,
            uint128 gross,
            uint128 prizeFund
        )
    {
        (
            status,
            maxSeats,
            filledSeats,
            authority,
            entryFee,
            gross,
            prizeFund,
            ,
            ,
        ) = pool.getPoolSummary(pid);
    }

    // ----------------------------------------------------------- the big table

    function test_forbidden_transition_table() public {
        // statuses 0..6, actions 0..10
        for (uint8 s = 0; s <= 6; s++) {
            for (uint8 a = 0; a <= 10; a++) {
                if (_isLegal(s, a)) continue;
                bytes4 expected = _expectedError(s, a);
                bytes32 pid = keccak256(abi.encodePacked("ft", s, a));
                _drive(pid, s);
                vm.expectRevert(expected);
                _invoke(a, pid);
            }
        }
    }

    // Named edges from the required list (already in the table; kept explicit).
    function test_claim_before_settle_reverts() public {
        bytes32 pid = keccak256("claim-before-settle");
        _drive(pid, S_LOCKED);
        vm.prank(p1);
        vm.expectRevert(MatchPool.NotSettled.selector);
        pool.claimMatch(pid);
    }

    function test_join_after_lock_reverts() public {
        bytes32 pid = keccak256("join-after-lock");
        _drive(pid, S_LOCKED);
        vm.prank(p1);
        vm.expectRevert(MatchPool.BadStatus.selector);
        pool.joinPool(pid);
    }

    function test_double_settle_reverts() public {
        bytes32 pid = keccak256("double-settle");
        _drive(pid, S_SETTLED);
        MatchPool.Payout[] memory plan = new MatchPool.Payout[](1);
        plan[0] = MatchPool.Payout({addr: p1, amount: 186e18});
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes32 structHash = pool.settleStructHash(pid, plan, deadline, 2, host);
        bytes32 d = keccak256(abi.encodePacked("\x19\x01", _sep(), structHash));
        vm.expectRevert(MatchPool.BadStatus.selector);
        pool.settlePool(
            pid, plan, deadline, 2, _sign(hostPk, d), _sign(edgePk, d)
        );
    }

    function test_settle_after_claim_reverts() public {
        bytes32 pid = keccak256("settle-after-claim");
        _drive(pid, S_SETTLED_CLAIMED);
        MatchPool.Payout[] memory plan = new MatchPool.Payout[](1);
        plan[0] = MatchPool.Payout({addr: p1, amount: 186e18});
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes32 structHash = pool.settleStructHash(pid, plan, deadline, 2, host);
        bytes32 d = keccak256(abi.encodePacked("\x19\x01", _sep(), structHash));
        vm.expectRevert(MatchPool.BadStatus.selector);
        pool.settlePool(
            pid, plan, deadline, 2, _sign(hostPk, d), _sign(edgePk, d)
        );
    }

    function test_cancel_post_lock_reverts() public {
        bytes32 pid = keccak256("cancel-post-lock");
        _drive(pid, S_LOCKED);
        vm.prank(host);
        vm.expectRevert(MatchPool.BadStatus.selector);
        pool.cancelOpen(pid);
    }

    function test_refund_while_active_reverts() public {
        bytes32 pidOpen = keccak256("refund-open");
        _drive(pidOpen, S_OPEN);
        vm.prank(p1);
        vm.expectRevert(MatchPool.BadStatus.selector);
        pool.refundJoin(pidOpen);

        bytes32 pidFunded = keccak256("refund-funded");
        _drive(pidFunded, S_FUNDED);
        vm.prank(p1);
        vm.expectRevert(MatchPool.BadStatus.selector);
        pool.refundJoin(pidFunded);

        bytes32 pidLocked = keccak256("refund-locked");
        _drive(pidLocked, S_LOCKED);
        vm.prank(p1);
        vm.expectRevert(MatchPool.BadStatus.selector);
        pool.refundJoin(pidLocked);
    }

    // ------------------------------------------- adjacent non-status guards

    function test_refund_during_dispute_lock_reverts() public {
        bytes32 pid = keccak256("refund-dispute");
        _drive(pid, S_SETTLED);
        // claimUnlockAt is settledAt + 2 minutes for FEE < 1000e18
        vm.prank(p1);
        vm.expectRevert(MatchPool.DisputeLocked.selector);
        pool.refundJoin(pid);

        vm.prank(p1);
        vm.expectRevert(MatchPool.DisputeLocked.selector);
        pool.claimMatch(pid);
    }

    function test_claim_twice_reverts() public {
        bytes32 pid = keccak256("claim-twice");
        _drive(pid, S_SETTLED_CLAIMED);
        vm.prank(p1);
        vm.expectRevert(MatchPool.AlreadyClaimed.selector);
        pool.claimMatch(pid);
    }

    function test_join_twice_reverts() public {
        bytes32 pid = keccak256("join-twice");
        _create(pid);
        vm.startPrank(p1);
        chips.approve(address(pool), FEE);
        pool.joinPool(pid);
        vm.expectRevert(MatchPool.AlreadyJoined.selector);
        pool.joinPool(pid);
        vm.stopPrank();
    }

    function test_create_twice_reverts() public {
        bytes32 pid = keccak256("create-twice");
        _create(pid);
        MatchPool.PoolConfig memory c = _cfg(pid, FEE);
        (address[] memory seats, uint8[] memory colors) = _seatsMem();
        bytes memory sig = _ticketSig(c);
        vm.expectRevert(MatchPool.BadStatus.selector);
        pool.createPool(c, seats, colors, sig);
    }

    function test_bind_twice_reverts() public {
        bytes32 pid = keccak256("bind-twice");
        _create(pid);
        MatchPool.PoolConfig memory c = _cfg(pid, FEE);
        (address[] memory seats, uint8[] memory colors) = _seatsMem();
        bytes memory sig = _ticketSig(c);
        vm.expectRevert(MatchPool.BadStatus.selector);
        pool.bindPoolSeats(c, seats, colors, sig);
    }

    function test_expire_too_early_reverts() public {
        bytes32 pid = keccak256("expire-early");
        _create(pid);
        vm.expectRevert(MatchPool.TooEarly.selector);
        pool.expirePool(pid, LOBBY_TTL);
    }

    function test_timeout_refund_too_early_reverts() public {
        bytes32 pid = keccak256("timeout-early");
        _drive(pid, S_LOCKED);
        vm.expectRevert(MatchPool.TooEarly.selector);
        pool.timeoutRefund(pid, true, "");
    }
}
