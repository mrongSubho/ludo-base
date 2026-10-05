// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {MatchPool} from "../src/MatchPool.sol";
import {ClaimHub} from "../src/ClaimHub.sol";
import {IChips} from "../src/interfaces/IChips.sol";

/**
 * @notice Redeploy MatchPool + ClaimHub against the EXISTING CHIPS token.
 *
 * Why this script exists
 * ---------------------
 * DeployStack/DeployGame also (re)deploy MissionClaim, SeasonClaim and
 * LegacyClaim. Those three have no MatchPool dependency, so redeploying them
 * orphans the live instances (MissionClaim is driven by MISSION_OP_KEY and
 * SeasonClaim carries a merkle root set via SetSeasonRoot). Unnecessarily
 * churning them is how a redeploy silently breaks claims.
 *
 * ClaimHub, by contrast, takes the pool address in its constructor:
 *
 *     constructor(IChips chips_, MatchPool matchPool_, address owner_)
 *
 * so a new MatchPool cannot reuse the old ClaimHub. It must be deployed in
 * the same transaction, and wired with setClaimHub.
 *
 * Therefore the minimal correct redeploy is exactly these two contracts.
 *
 * Usage
 * -----
 *   # dry run (no broadcast)
 *   CHIPS_ADDRESS=0x... EDGE_SIGNER=0x... GAME_OWNER=0x... \
 *     forge script script/RedeployPool.s.sol:RedeployPool \
 *       --rpc-url "$BASE_RPC" --account deployer
 *
 *   # Base Sepolia
 *   forge script script/RedeployPool.s.sol:RedeployPool \
 *     --rpc-url "$SEPOLIA_RPC" --account deployer --broadcast --verify
 *
 *   # Base mainnet
 *   forge script script/RedeployPool.s.sol:RedeployPool \
 *     --rpc-url "$BASE_RPC" --account deployer --broadcast --verify \
 *     --sender "$GAME_OWNER"
 *
 * Notes
 * -----
 * - Never deploy MockChips here. CHIPS_ADDRESS is mandatory and the script
 *   reverts without it, so a placeholder cannot be silently broadcast.
 * - If GAME_OWNER is a multisig that is NOT the broadcasting account, setClaimHub
 *   is skipped (it is onlyOwner) and the script prints the exact follow-up.
 *
 * - DEPLOYER_ADDRESS must be the address the deploy key actually controls. The
 *   script calls startBroadcast(deployer) so that a stale value fails loudly
 *   (unfunded sender) instead of quietly deploying from an unexpected account.
 *   A stale DEPLOYER_ADDRESS in contracts/.env also makes owner != deployer and
 *   silently skips the setClaimHub wiring, so verify the "setClaimHub: done"
 *   line in the output before walking away.
 */
contract RedeployPool is Script {
    function run() external {
        address chipsAddr = vm.envAddress("CHIPS_ADDRESS");
        address edgeSigner = _envAddr("EDGE_SIGNER", address(0));
        address owner_ = _envAddr("GAME_OWNER", _envAddr("GAME_OWNER_MULTISIG", address(0)));
        address deployer = _envAddr("DEPLOYER_ADDRESS", msg.sender);

        require(chipsAddr != address(0), "set CHIPS_ADDRESS to the real CHIPS token");
        require(edgeSigner != address(0), "set EDGE_SIGNER");
        require(owner_ != address(0), "set GAME_OWNER (or GAME_OWNER_MULTISIG)");
        require(deployer != address(0), "set DEPLOYER_ADDRESS or pass --sender");

        vm.startBroadcast(deployer);

        IChips chips = IChips(chipsAddr);
        MatchPool pool = new MatchPool(chips, edgeSigner, owner_);
        ClaimHub hub = new ClaimHub(chips, pool, owner_);

        bool wired = false;
        if (owner_ == deployer) {
            pool.setClaimHub(address(hub));
            wired = true;
        }

        vm.stopBroadcast();

        console.log("== Redeploy complete ==");
        console.log("Deployer", deployer);
        console.log("Owner", owner_);
        console.log("EdgeSigner", edgeSigner);
        console.log("CHIPS", chipsAddr);
        console.log("MatchPool", address(pool));
        console.log("ClaimHub", address(hub));
        if (wired) {
            console.log("setClaimHub: done in this transaction");
        } else {
            console.log("setClaimHub: SKIPPED (owner != deployer) - run from the owner:");
            console.log("  cast send <MatchPool> 'setClaimHub(address)' <ClaimHub> --from", owner_);
        }
        console.log("");
        console.log("== Paste into .env.local (old MatchPool/ClaimHub stay funded but orphaned) ==");
        console.log("NEXT_PUBLIC_MATCH_POOL_ADDRESS=", address(pool));
        console.log("NEXT_PUBLIC_CLAIM_HUB_ADDRESS=", address(hub));
        console.log("");
        console.log("== Then ==");
        console.log("1. Drain/cancel any in-flight pools on the OLD MatchPool first");
        console.log(
            "   (cast send <oldPool> cancelOpen/timeoutRefund per poolId) or accept them as stranded"
        );
        console.log("2. Update .env.local, rebuild, redeploy the frontend");
        console.log("3. Smoke: cast call", address(pool), "getPoolSummary(bytes32,address,address)");
    }

    /// Treat empty / zero env as unset so .env placeholders do not steal ownership.
    function _envAddr(string memory key, address defaultAddr) internal view returns (address) {
        try vm.envAddress(key) returns (address a) {
            if (a == address(0)) return defaultAddr;
            return a;
        } catch {
            return defaultAddr;
        }
    }
}
