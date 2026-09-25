// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {MatchPool} from "../src/MatchPool.sol";
import {ClaimHub} from "../src/ClaimHub.sol";
import {MissionClaim} from "../src/MissionClaim.sol";
import {SeasonClaim} from "../src/SeasonClaim.sol";
import {LegacyClaim} from "../src/LegacyClaim.sol";
import {MockChips} from "../test/MockChips.sol";
import {IChips} from "../src/interfaces/IChips.sol";

/**
 * Local anvil / Sepolia dry deploy of the game stack (MockChips stand-in for B20).
 *
 *   anvil --port 8545 &
 *   forge script script/DeployLocal.s.sol --rpc-url http://127.0.0.1:8545 \
 *     --private-key 0xac09… --broadcast
 */
contract DeployLocal is Script {
    function run() external {
        address edge = vm.addr(uint256(keccak256("edge")));
        address owner_ = msg.sender;
        address opKey = vm.addr(uint256(keccak256("op")));

        vm.startBroadcast();
        MockChips chips = new MockChips();
        MatchPool pool = new MatchPool(IChips(address(chips)), edge, owner_);
        ClaimHub hub = new ClaimHub(IChips(address(chips)), pool, owner_);
        MissionClaim missions = new MissionClaim(IChips(address(chips)), opKey, owner_);
        SeasonClaim season = new SeasonClaim(IChips(address(chips)), opKey, owner_);
        LegacyClaim legacy = new LegacyClaim(IChips(address(chips)), opKey, owner_, 50_000_000e18);

        chips.mint(owner_, 1_000_000e18);
        chips.mint(address(missions), 100_000e18);
        chips.mint(address(season), 1_000_000e18);
        chips.mint(address(legacy), 50_000_000e18);
        pool.setClaimHub(address(hub));
        vm.stopBroadcast();

        console.log("CHIPS (mock)", address(chips));
        console.log("MatchPool", address(pool));
        console.log("ClaimHub", address(hub));
        console.log("MissionClaim", address(missions));
        console.log("SeasonClaim", address(season));
        console.log("LegacyClaim", address(legacy));
    }
}
