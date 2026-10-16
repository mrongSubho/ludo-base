// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {LegacyClaim} from "../src/LegacyClaim.sol";
import {IChips} from "../src/interfaces/IChips.sol";

/**
 * @notice Deploy LegacyClaim alone, against the EXISTING CHIPS token.
 *
 * LegacyClaim pays a one-time snapshot of pre-migration balances: the constructor
 * fixes the token, the `snapshotSetter`, the owner and a hard `poolCap` (the most
 * the contract can ever pay in total — it is the funding ceiling, so it must match
 * what the treasury is actually willing to reserve).
 *
 * Nothing is claimable until a snapshot root is published, and the 90-day claim
 * window opens only after the 7-day off-chain challenge: run
 * `script/SetSeasonRoot.s.sol`-equivalent root publishing (`setSnapshotRoot`) once
 * the snapshot is final.
 *
 * `snapshotSetter` defaults to MISSION_OP_KEY so an existing .env needs no new
 * variables; override with SNAPSHOT_SETTER. POOL_CAP defaults to 50,000,000 CHIPS,
 * matching DeployStack.
 *
 * Usage (from contracts/, deployer account named `mydeployer`):
 *   source .env
 *   forge script script/DeployLegacyClaim.s.sol:DeployLegacyClaim \
 *     --rpc-url "$SEPOLIA_RPC" --account mydeployer                    # dry run
 *   forge script script/DeployLegacyClaim.s.sol:DeployLegacyClaim \
 *     --rpc-url "$SEPOLIA_RPC" --account mydeployer --broadcast --verify
 *
 * Env: CHIPS_ADDRESS (mandatory), GAME_OWNER (default DEPLOYER_ADDRESS),
 *      SNAPSHOT_SETTER (default MISSION_OP_KEY), POOL_CAP (whole CHIPS, default 50_000_000).
 */
contract DeployLegacyClaim is Script {
    function run() external {
        address chipsAddr = vm.envAddress("CHIPS_ADDRESS");
        if (chipsAddr == address(0)) revert("CHIPS_ADDRESS is mandatory");
        address owner_ = vm.envOr("GAME_OWNER", address(0));
        address deployer = vm.envOr("DEPLOYER_ADDRESS", msg.sender);
        if (owner_ == address(0)) owner_ = deployer;
        address snapshotSetter = vm.envOr("SNAPSHOT_SETTER", vm.envOr("MISSION_OP_KEY", address(0)));
        uint256 poolCap = vm.envOr("POOL_CAP", uint256(50_000_000)) * 1e18;
        if (poolCap == 0) revert("POOL_CAP must be non-zero - it is the payout ceiling");

        vm.startBroadcast(deployer);

        LegacyClaim legacy = new LegacyClaim(IChips(chipsAddr), snapshotSetter, owner_, poolCap);

        vm.stopBroadcast();

        console.log("CHIPS (existing)", chipsAddr);
        console.log("snapshotSetter", snapshotSetter);
        console.log("owner", owner_);
        console.log("poolCap (CHIPS)", poolCap / 1e18);
        console.log("LegacyClaim", address(legacy));
        console.log("NEXT: setSnapshotRoot(root) opens the 90-day window after the 7d challenge");
    }
}
