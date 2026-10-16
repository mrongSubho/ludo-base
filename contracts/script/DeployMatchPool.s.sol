// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {MatchPool} from "../src/MatchPool.sol";
import {IChips} from "../src/interfaces/IChips.sol";

/**
 * @notice Deploy MatchPool alone, against the EXISTING CHIPS token.
 *
 * Use this when only the pool is changing (see RedeployPool.s.sol for the
 * reasoning): DeployStack would also redeploy ClaimHub/MissionClaim/SeasonClaim/
 * LegacyClaim and orphan the live instances.
 *
 * MatchPool's constructor takes the CHIPS token, the Edge co-signer (the key that
 * authorises settle payloads) and the owner. Entry tiers 1,000e18 and 10,000e18 are
 * enabled by the constructor; anything else is an owner call afterwards.
 *
 * ClaimHub is NOT part of this deploy. If a hub already exists, pass
 * CLAIM_HUB_ADDRESS and the script wires `setClaimHub` when the broadcaster is the
 * owner; otherwise it prints the follow-up call.
 *
 * Usage (from contracts/, deployer account named `mydeployer`):
 *   source .env
 *   forge script script/DeployMatchPool.s.sol:DeployMatchPool \
 *     --rpc-url "$SEPOLIA_RPC" --account mydeployer                    # dry run
 *   forge script script/DeployMatchPool.s.sol:DeployMatchPool \
 *     --rpc-url "$SEPOLIA_RPC" --account mydeployer --broadcast --verify
 *
 * Env: CHIPS_ADDRESS (mandatory), EDGE_SIGNER (mandatory), GAME_OWNER
 *      (default DEPLOYER_ADDRESS), CLAIM_HUB_ADDRESS (optional wiring).
 */
contract DeployMatchPool is Script {
    function run() external {
        address chipsAddr = vm.envAddress("CHIPS_ADDRESS");
        if (chipsAddr == address(0)) revert("CHIPS_ADDRESS is mandatory");
        address edge = vm.envAddress("EDGE_SIGNER");
        if (edge == address(0)) revert("EDGE_SIGNER is mandatory - the settle co-signer");
        address owner_ = vm.envOr("GAME_OWNER", address(0));
        address deployer = vm.envOr("DEPLOYER_ADDRESS", msg.sender);
        if (owner_ == address(0)) owner_ = deployer;
        address hub = vm.envOr("CLAIM_HUB_ADDRESS", address(0));

        vm.startBroadcast(deployer);

        MatchPool pool = new MatchPool(IChips(chipsAddr), edge, owner_);

        // OnlyOwner — wire the hub only when this broadcast is the owner.
        if (hub != address(0) && owner_ == deployer) {
            pool.setClaimHub(hub);
            console.log("setClaimHub ->", hub);
        } else if (hub != address(0)) {
            console.log("NOTE: owner != deployer - call setClaimHub(", hub, ") as the owner");
        }

        vm.stopBroadcast();

        console.log("CHIPS (existing)", chipsAddr);
        console.log("edgeSigner", edge);
        console.log("owner", owner_);
        console.log("MatchPool", address(pool));
    }
}
