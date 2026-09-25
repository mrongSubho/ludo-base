// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IB20} from "base-std/interfaces/IB20.sol";
import {B20Constants} from "base-std/lib/B20Constants.sol";

/**
 * Grant BURN_ROLE on real B20 CHIPS to the live MatchPool (required for settle burn leg).
 * base-forge script script/GrantBurnRole.s.sol --rpc-url ... --account mydeployer --sender 0xbcCa... --broadcast
 */
contract GrantBurnRole is Script {
    function run() external {
        IB20 chips = IB20(vm.envAddress("CHIPS_ADDRESS"));
        address pool = vm.envAddress("MATCH_POOL_ADDRESS");
        address marketplace = vm.envOr("MARKETPLACE_ADDRESS", pool);
        vm.startBroadcast();
        chips.grantRole(B20Constants.BURN_ROLE, pool);
        if (marketplace != pool) {
            chips.grantRole(B20Constants.BURN_ROLE, marketplace);
        }
        vm.stopBroadcast();
        console.log("BURN_ROLE -> pool", pool);
    }
}
