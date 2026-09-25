// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {MatchPool} from "../src/MatchPool.sol";
import {ClaimHub} from "../src/ClaimHub.sol";
import {MockChips} from "../test/MockChips.sol";

/// @notice Live Sepolia smoke: createPool -> join x2 -> lock -> settle -> claim.
/// Host + Edge + player1 share SMOKE_PK (must equal MatchPool.edgeSigner).
contract SmokeSepolia is Script {
    uint256 internal constant SMOKE_PK =
        0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    uint256 internal constant P2_PK =
        0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;

    function _sign(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _sep(address pool) internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256(bytes("LudoBase MatchPool")),
                keccak256(bytes("1")),
                block.chainid,
                pool
            )
        );
    }

    function run() external {
        address host = vm.addr(SMOKE_PK);
        address p2 = vm.addr(P2_PK);
        MockChips chips = MockChips(vm.envAddress("CHIPS_ADDRESS"));
        MatchPool pool = MatchPool(vm.envAddress("MATCH_POOL_ADDRESS"));
        ClaimHub hub = ClaimHub(vm.envAddress("CLAIM_HUB_ADDRESS"));

        require(pool.edgeSigner() == host, "setEdgeSigner(smoke) first");

        bytes32 poolId = keccak256(abi.encodePacked("smoke", block.timestamp, host));
        address[] memory seats = new address[](2);
        seats[0] = host;
        seats[1] = p2;
        uint8[] memory colors = new uint8[](2);
        colors[0] = 1;
        colors[1] = 3;
        bytes32 sHash = keccak256(abi.encode(seats, colors));

        MatchPool.LobbyTicket memory t = MatchPool.LobbyTicket({
            roomCode: keccak256("SMOKE-ROOM"),
            matchId: keccak256("SMOKE-MATCH"),
            host: host,
            seatsHash: sHash,
            gameMode: 0,
            maxSeats: 2,
            issuedAt: uint64(block.timestamp)
        });
        bytes memory ticketSig = _sign(SMOKE_PK, pool.lobbyTicketHash(t));

        MatchPool.PoolConfig memory cfg = MatchPool.PoolConfig({
            poolId: poolId,
            roomCode: keccak256("SMOKE-ROOM"),
            matchId: keccak256("SMOKE-MATCH"),
            host: host,
            seatsHash: sHash,
            gameMode: 0,
            maxSeats: 2,
            poolKind: 0,
            entryFee: 1000e18,
            protocolBps: 500,
            burnBps: 200,
            windowClosedAt: 0,
            parentPoolId: bytes32(0),
            ticketIssuedAt: t.issuedAt
        });

        vm.startBroadcast(SMOKE_PK);
        chips.mint(host, 5_000e18);
        chips.mint(p2, 5_000e18);
        pool.createPool(cfg, seats, colors, ticketSig);
        console.log("poolId");
        console.logBytes32(poolId);
        chips.approve(address(pool), 3_000e18);
        pool.joinPool(poolId);
        vm.stopBroadcast();

        vm.startBroadcast(P2_PK);
        chips.approve(address(pool), 2_000e18);
        pool.joinPool(poolId);
        vm.stopBroadcast();

        vm.startBroadcast(SMOKE_PK);
        pool.lockPool(poolId, 30 minutes);
        MatchPool.Payout[] memory plan = new MatchPool.Payout[](1);
        plan[0] = MatchPool.Payout({addr: p2, amount: 1860e18});
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes32 sh = pool.settleStructHash(poolId, plan, deadline, 1, host);
        bytes32 d = keccak256(abi.encodePacked("\x19\x01", _sep(address(pool)), sh));
        bytes memory sig = _sign(SMOKE_PK, d);
        pool.settlePool(poolId, plan, deadline, 1, sig, sig);
        vm.stopBroadcast();

        // Claim is pull-based after disputeWindow (5 min at 1000 tier).
        // Do NOT claim in the same script - forge simulates the full run and
        // vm.warp does not advance on-chain time for the broadcast tx.
        console.log("SETTLED - wait 5 min then run scripts/claim-sepolia.sh");
        console.log("poolId");
        console.logBytes32(poolId);
        console.log("p2 CHIPS (pre-claim)");
        console.log(chips.balanceOf(p2));
    }
}
