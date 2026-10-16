// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {SeasonClaim} from "../src/SeasonClaim.sol";
import {IChips} from "../src/interfaces/IChips.sol";

/**
 * @notice Deploy SeasonClaim alone, against the EXISTING CHIPS token.
 *
 * SeasonClaim is merkle-driven: the constructor only fixes the token, the
 * `rootSetter` (the account allowed to publish a season root) and the owner.
 * A freshly deployed instance claims nothing until a root is published —
 * run `script/SetSeasonRoot.s.sol` afterwards.
 *
 * `rootSetter` defaults to MISSION_OP_KEY (the op key DeployStack already uses
 * for this role) so an existing .env needs no new variables; override with
 * ROOT_SETTER. Passing address(0) leaves root publishing to the owner only.
 *
 * Usage (from contracts/, deployer account named `mydeployer`):
 *   source .env
 *   forge script script/DeploySeasonClaim.s.sol:DeploySeasonClaim \
 *     --rpc-url "$SEPOLIA_RPC" --account mydeployer                    # dry run
 *   forge script script/DeploySeasonClaim.s.sol:DeploySeasonClaim \
 *     --rpc-url "$SEPOLIA_RPC" --account mydeployer --broadcast --verify
 *
 * Env: CHIPS_ADDRESS (mandatory), GAME_OWNER (default DEPLOYER_ADDRESS),
 *      ROOT_SETTER (default MISSION_OP_KEY).
 */
contract DeploySeasonClaim is Script {
    function run() external {
        address chipsAddr = vm.envAddress("CHIPS_ADDRESS");
        if (chipsAddr == address(0)) revert("CHIPS_ADDRESS is mandatory");
        address owner_ = vm.envOr("GAME_OWNER", address(0));
        address deployer = vm.envOr("DEPLOYER_ADDRESS", msg.sender);
        if (owner_ == address(0)) owner_ = deployer;
        address rootSetter = vm.envOr("ROOT_SETTER", vm.envOr("MISSION_OP_KEY", address(0)));

        vm.startBroadcast(deployer);

        SeasonClaim season = new SeasonClaim(IChips(chipsAddr), rootSetter, owner_);

        vm.stopBroadcast();

        console.log("CHIPS (existing)", chipsAddr);
        console.log("rootSetter", rootSetter);
        console.log("owner", owner_);
        console.log("SeasonClaim", address(season));
        console.log("NEXT: publish a season root with script/SetSeasonRoot.s.sol");
    }
}
