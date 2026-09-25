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
 * Local / Sepolia dry deploy of the game economy stack.
 *
 * Local anvil (default key 0):
 *   anvil &
 *   forge script script/DeployStack.s.sol --rpc-url http://127.0.0.1:8545 \
 *     --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 --broadcast
 *
 * Sepolia (funded keystore):
 *   forge script script/DeployStack.s.sol --rpc-url $SEPOLIA_RPC --account deployer --broadcast
 *
 * Uses MockChips when CHIPS_ADDRESS is unset (local). On Sepolia with real B20
 * set CHIPS_ADDRESS to the token and USE_MOCK=0.
 */
contract DeployStack is Script {
    function run() external {
        bool useMock = vm.envOr("USE_MOCK", true);
        address existing = vm.envOr("CHIPS_ADDRESS", address(0));

        // Foundry forbids msg.sender inside startBroadcast. Resolve deployer first
        // from DEPLOYER_ADDRESS or --sender (msg.sender before broadcast).
        address deployer = _envAddr("DEPLOYER_ADDRESS", msg.sender);
        require(deployer != address(0), "set DEPLOYER_ADDRESS or --sender");
        address edge = _envAddr("EDGE_SIGNER", deployer);
        address owner_ = _envAddr("GAME_OWNER", deployer);
        address opKey = _envAddr("MISSION_OP_KEY", deployer);

        vm.startBroadcast();

        IChips chips;
        if (useMock || existing == address(0)) {
            MockChips mock = new MockChips();
            chips = IChips(address(mock));
            mock.mint(owner_, 1_000_000e18);
            console.log("MockChips", address(mock));
        } else {
            chips = IChips(existing);
            console.log("Chips (B20)", existing);
        }

        MatchPool pool = new MatchPool(chips, edge, owner_);
        ClaimHub hub = new ClaimHub(chips, pool, owner_);
        MissionClaim missions = new MissionClaim(chips, opKey, owner_);
        SeasonClaim season = new SeasonClaim(chips, opKey, owner_);
        LegacyClaim legacy = new LegacyClaim(chips, opKey, owner_, 50_000_000e18);

        // OnlyOwner - succeeds when owner_ == deployer (default).
        if (owner_ == deployer) {
            pool.setClaimHub(address(hub));
        } else {
            console.log("NOTE: setClaimHub skipped - run as GAME_OWNER later");
        }

        vm.stopBroadcast();

        console.log("Deployer", deployer);
        console.log("Owner", owner_);
        console.log("MatchPool", address(pool));
        console.log("ClaimHub", address(hub));
        console.log("MissionClaim", address(missions));
        console.log("SeasonClaim", address(season));
        console.log("LegacyClaim", address(legacy));
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
