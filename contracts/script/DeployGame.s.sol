// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {MatchPool} from "../src/MatchPool.sol";
import {ClaimHub} from "../src/ClaimHub.sol";
import {MissionClaim} from "../src/MissionClaim.sol";
import {IChips} from "../src/interfaces/IChips.sol";

/// @notice Deploy MatchPool + ClaimHub + MissionClaim against an existing CHIPS token.
/// @dev Set CHIPS_ADDRESS after CreateChips (B20). Keys via `cast wallet import` only.
///
/// forge script script/DeployGame.s.sol \
///   --rpc-url $SEPOLIA_RPC --account deployer --broadcast --verify
contract DeployGame is Script {
    function run() external returns (address matchPool, address claimHub, address missionClaim) {
        address chipsAddr = vm.envAddress("CHIPS_ADDRESS");
        address edgeSigner = vm.envAddress("EDGE_SIGNER");
        address opKey = vm.envAddress("MISSION_OP_KEY");
        address owner_ = vm.envAddress("GAME_OWNER_MULTISIG");

        vm.startBroadcast();
        MatchPool pool = new MatchPool(IChips(chipsAddr), edgeSigner, owner_);
        ClaimHub hub = new ClaimHub(IChips(chipsAddr), pool, owner_);
        MissionClaim missions = new MissionClaim(IChips(chipsAddr), opKey, owner_);

        // Wire claim hub router (owner is multisig — run setClaimHub as owner after if not broadcast).
        // During this broadcast, msg.sender is the deployer EOA; transfer ownership after.
        vm.stopBroadcast();

        console.log("MatchPool", address(pool));
        console.log("ClaimHub", address(hub));
        console.log("MissionClaim", address(missions));
        console.log("CHIPS", chipsAddr);
        console.log("Next: transfer ownership + pool.setClaimHub(hub) from GAME_OWNER_MULTISIG");
        console.log("Fill docs/tokenomics/TOKEN_PARAMS.md deploy table");

        matchPool = address(pool);
        claimHub = address(hub);
        missionClaim = address(missions);
    }
}
