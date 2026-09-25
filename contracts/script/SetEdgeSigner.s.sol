// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {MatchPool} from "../src/MatchPool.sol";

contract SetEdgeSigner is Script {
    function run() external {
        address pool = vm.envAddress("MATCH_POOL_ADDRESS");
        address newEdge = vm.envAddress("SMOKE_EDGE");
        vm.startBroadcast();
        MatchPool(pool).setEdgeSigner(newEdge);
        vm.stopBroadcast();
        console.log("edgeSigner ->", newEdge);
    }
}
