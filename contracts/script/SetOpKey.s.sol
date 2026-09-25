// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {MissionClaim} from "../src/MissionClaim.sol";

/// Rotate MissionClaim voucher op-key (owner only).
/// Env: MISSION_CLAIM_ADDRESS, MISSION_OP_KEY (new signer).
/// base-forge script script/SetOpKey.s.sol --rpc-url ... --account mydeployer --sender <owner> --broadcast
contract SetOpKey is Script {
    function run() external {
        MissionClaim mission = MissionClaim(vm.envAddress("MISSION_CLAIM_ADDRESS"));
        address newOp = vm.envAddress("MISSION_OP_KEY");
        vm.startBroadcast();
        mission.setOpKey(newOp);
        vm.stopBroadcast();
        console.log("MissionClaim.opKey ->", newOp);
    }
}
