// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MatchPool} from "../src/MatchPool.sol";
import {MockChips} from "./MockChips.sol";
import {Mock1271Host} from "./Mock1271Host.sol";

/// Host settle accepts ERC-1271 smart-wallet signatures (deployed contracts).
contract Host1271Test is Test {
    MockChips chips;
    MatchPool pool;

    address owner = address(0xA11CE);
    address edge;
    address p1 = address(0x1111);
    address walletOwner;
    Mock1271Host hostWallet;

    uint256 edgePk = 0xED6E;
    uint256 walletOwnerPk = 0xB0B;

    bytes32 poolId = keccak256("pool-1271");
    bytes32 roomCode = keccak256("ROOM");
    bytes32 matchId = keccak256("match-1271");

    function setUp() public {
        edge = vm.addr(edgePk);
        walletOwner = vm.addr(walletOwnerPk);
        hostWallet = new Mock1271Host(walletOwner);
        chips = new MockChips();
        vm.prank(owner);
        pool = new MatchPool(chips, edge, owner);
        vm.prank(owner);
        pool.setEntryTier(1000e18, true);
        chips.mint(p1, 1_000_000e18);
        chips.mint(address(hostWallet), 1_000_000e18);
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

    function _createJoinLock() internal {
        address[] memory seats = new address[](2);
        seats[0] = address(hostWallet);
        seats[1] = p1;
        uint8[] memory colors = new uint8[](2);
        colors[0] = 3;
        colors[1] = 4;
        MatchPool.PoolConfig memory c = MatchPool.PoolConfig({
            poolId: poolId,
            roomCode: roomCode,
            matchId: matchId,
            host: address(hostWallet),
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
            roomCode: c.roomCode,
            matchId: c.matchId,
            host: c.host,
            seatsHash: c.seatsHash,
            gameMode: c.gameMode,
            maxSeats: c.maxSeats,
            issuedAt: c.ticketIssuedAt
        });
        bytes memory ticketSig = _sign(edgePk, pool.lobbyTicketHash(t));
        pool.createPool(c, seats, colors, ticketSig);

        // Fund + join via wallet contract (MockChips is EOA-style; prank as wallet)
        vm.startPrank(address(hostWallet));
        chips.approve(address(pool), 20_000e18);
        pool.joinPool(poolId);
        vm.stopPrank();

        vm.startPrank(p1);
        chips.approve(address(pool), 1000e18);
        pool.joinPool(poolId);
        vm.stopPrank();

        vm.prank(address(hostWallet));
        pool.lockPool(poolId, 30 minutes);
    }

    function test_settle_accepts_erc1271_host_sig() public {
        _createJoinLock();

        MatchPool.Payout[] memory plan = new MatchPool.Payout[](1);
        plan[0] = MatchPool.Payout({addr: p1, amount: 1860e18});
        uint64 deadline = uint64(block.timestamp + 1 hours);
        uint256 nonce = 1;
        bytes32 structHash = pool.settleStructHash(poolId, plan, deadline, nonce, address(hostWallet));
        bytes32 d = keccak256(abi.encodePacked("\x19\x01", _sep(), structHash));

        // Host is a contract wallet; signature is owner ECDSA, validated via ERC-1271.
        bytes memory hostSig = _sign(walletOwnerPk, d);
        bytes memory edgeSig = _sign(edgePk, d);

        vm.prank(address(0xBEEF));
        pool.settlePool(poolId, plan, deadline, nonce, hostSig, edgeSig);

        (uint8 status,,,,,, uint128 prizeFund,,,) = pool.getPoolSummary(poolId);
        assertEq(status, uint8(MatchPool.Status.Settled));
        assertEq(prizeFund, 1860e18);
    }

    function test_settle_rejects_wrong_owner_for_1271() public {
        _createJoinLock();
        MatchPool.Payout[] memory plan = new MatchPool.Payout[](1);
        plan[0] = MatchPool.Payout({addr: p1, amount: 1860e18});
        uint64 deadline = uint64(block.timestamp + 1 hours);
        uint256 nonce = 1;
        bytes32 structHash = pool.settleStructHash(poolId, plan, deadline, nonce, address(hostWallet));
        bytes32 d = keccak256(abi.encodePacked("\x19\x01", _sep(), structHash));
        uint256 roguePk = 0xDEAD;
        bytes memory hostSig = _sign(roguePk, d);
        bytes memory edgeSig = _sign(edgePk, d);
        vm.prank(address(0xBEEF));
        vm.expectRevert(MatchPool.BadSignature.selector);
        pool.settlePool(poolId, plan, deadline, nonce, hostSig, edgeSig);
    }
}
