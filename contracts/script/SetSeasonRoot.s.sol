// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {SeasonClaim} from "../src/SeasonClaim.sol";

/// Propose a season Merkle root (48h challenge), then activate after the window.
/// Env: SEASON_CLAIM_ADDRESS, SEASON_EPOCH, SEASON_ROOT, SEASON_BUDGET (wei).
/// Modes: PROPOSE_ROOT=1 (default) | ACTIVATE_ROOT=1
/// base-forge script script/SetSeasonRoot.s.sol --rpc-url ... --account mydeployer --sender <rootSetter> --broadcast
contract SetSeasonRoot is Script {
    function run() external {
        SeasonClaim season = SeasonClaim(vm.envAddress("SEASON_CLAIM_ADDRESS"));
        uint256 epoch = vm.envUint("SEASON_EPOCH");
        bytes32 root = vm.envBytes32("SEASON_ROOT");
        uint256 budget = vm.envUint("SEASON_BUDGET");
        bool activate = vm.envOr("ACTIVATE_ROOT", false);
        vm.startBroadcast();
        if (activate) {
            season.activateRoot(epoch);
            console.log("activated epoch", epoch);
        } else {
            season.proposeRoot(epoch, root, budget);
            console.log("proposed epoch", epoch);
            console.logBytes32(root);
            console.log("budget", budget);
        }
        vm.stopBroadcast();
    }
}
