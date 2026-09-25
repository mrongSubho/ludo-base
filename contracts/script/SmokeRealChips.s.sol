// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {MatchPool} from "../src/MatchPool.sol";
import {ClaimHub} from "../src/ClaimHub.sol";
import {IB20} from "base-std/interfaces/IB20.sol";

/**
 * Live smoke on REAL B20 CHIPS (not MockChips).
 * 1) deployer transfers CHIPS to smoke seats
 * 2) createPool -> join x2 -> lock -> settle (host+edge = smoke key)
 *
 * base-forge script script/SmokeRealChips.s.sol \
 *   --rpc-url https://sepolia.base.org --account mydeployer \
 *   --sender 0xbcCa5DcBF293D98A627fD3814D5AE8249bB1DFaF --broadcast
 *
 * Then after 5 min: bash scripts/claim-sepolia.sh <poolId>
 */
contract SmokeRealChips is Script {
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
        address deployer = vm.envAddress("DEPLOYER_ADDRESS");
        address chipsAddr = vm.envAddress("CHIPS_ADDRESS");
        address poolAddr = vm.envAddress("MATCH_POOL_ADDRESS");
        address hubAddr = vm.envAddress("CLAIM_HUB_ADDRESS");

        IB20 chips = IB20(chipsAddr);
        MatchPool pool = MatchPool(payable(poolAddr));
        // ClaimHub used after dispute window in claim-sepolia.sh

        address host = vm.addr(SMOKE_PK);
        address p2 = vm.addr(P2_PK);

        // --- Phase A: fund smoke seats with real CHIPS (deployer holds 10B) ---
        vm.startBroadcast();
        chips.transfer(host, 5_000e18);
        chips.transfer(p2, 5_000e18);
        vm.stopBroadcast();

        // --- Phase B: create + join + lock + settle (smoke keys) ---
        require(pool.edgeSigner() == host, "setEdgeSigner(smoke host) first");

        bytes32 poolId = keccak256(abi.encodePacked("b20-smoke", block.timestamp, host));
        address[] memory seats = new address[](2);
        seats[0] = host;
        seats[1] = p2;
        uint8[] memory colors = new uint8[](2);
        colors[0] = 1;
        colors[1] = 3;
        bytes32 sHash = keccak256(abi.encode(seats, colors));

        MatchPool.LobbyTicket memory t = MatchPool.LobbyTicket({
            roomCode: keccak256("B20-SMOKE"),
            matchId: keccak256("B20-MATCH"),
            host: host,
            seatsHash: sHash,
            gameMode: 0,
            maxSeats: 2,
            issuedAt: uint64(block.timestamp)
        });
        bytes memory ticketSig = _sign(SMOKE_PK, pool.lobbyTicketHash(t));

        MatchPool.PoolConfig memory cfg = MatchPool.PoolConfig({
            poolId: poolId,
            roomCode: keccak256("B20-SMOKE"),
            matchId: keccak256("B20-MATCH"),
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
        pool.createPool(cfg, seats, colors, ticketSig);
        console.log("poolId");
        console.logBytes32(poolId);
        chips.approve(poolAddr, 3_000e18);
        pool.joinPool(poolId);
        vm.stopBroadcast();

        vm.startBroadcast(P2_PK);
        chips.approve(poolAddr, 2_000e18);
        pool.joinPool(poolId);
        vm.stopBroadcast();

        vm.startBroadcast(SMOKE_PK);
        pool.lockPool(poolId, 30 minutes);
        MatchPool.Payout[] memory plan = new MatchPool.Payout[](1);
        plan[0] = MatchPool.Payout({addr: p2, amount: 1860e18});
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes32 sh = pool.settleStructHash(poolId, plan, deadline, 1, host);
        bytes32 d = keccak256(abi.encodePacked("\x19\x01", _sep(poolAddr), sh));
        bytes memory sig = _sign(SMOKE_PK, d);
        pool.settlePool(poolId, plan, deadline, 1, sig, sig);
        vm.stopBroadcast();

        console.log("SETTLED on real CHIPS - claim after 5 min:");
        console.logBytes32(poolId);
        console.log("p2 CHIPS (pre-claim)");
        console.log(chips.balanceOf(p2));

    }
}
