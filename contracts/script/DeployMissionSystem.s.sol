// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {MissionSystem} from "../src/MissionSystem.sol";
import {IChips} from "../src/interfaces/IChips.sol";

/**
 * @notice Deploy MissionSystem — the fully on-chain mission authority.
 *
 * Unlike MissionClaim (a pull-based, op-key-signed voucher layer), MissionSystem
 * owns the entire mission lifecycle on-chain:
 *   - mission definitions (setMission, onlyOwner)
 *   - day/week/once scheduling derived from block.timestamp (currentPeriod)
 *   - oracle-reported progress (recordProgress, oracle/owner only)
 *   - contract-decided completion + CHIPS payout (or a pending-payout queue when
 *     the reserve is short at completion time)
 *
 * Constructor: (IChips chips_, address progressOracle_, address owner_).
 *   - chips_          : the EXISTING B20 CHIPS token (never a mock).
 *   - progressOracle_ : trusted server key that reports gameplay progress via
 *                       recordProgress. If 0x00 is passed the contract falls back
 *                       to owner as the oracle — fine for a first bring-up, but a
 *                       dedicated key should replace it via setProgressOracle before
 *                       go-live (you do NOT want the owner key emitting player
 *                       progress events).
 *   - owner_          : GAME_OWNER (defaults to DEPLOYER_ADDRESS).
 *
 * This script deploys only. Immediately after:
 *   - run InitMissionSystem.s.sol to register the daily/weekly/onboarding missions,
 *   - run FundMissionSystem.s.sol to give it a paying reserve.
 * A deployment that stops here is a contract that can never pay a reward.
 *
 * Usage
 * -----
 *   cd contracts && source .env
 *
 *   # dry run — prints the address it would create
 *   CHIPS_ADDRESS=0x... MISSION_ORACLE=0x... GAME_OWNER=0x... \
 *     forge script script/DeployMissionSystem.s.sol:DeployMissionSystem \
 *       --rpc-url "$SEPOLIA_RPC" --account mydeployer
 *
 *   # Base Sepolia (testnet) — deploy + verify in one shot
 *   forge script script/DeployMissionSystem.s.sol:DeployMissionSystem \
 *     --rpc-url "$SEPOLIA_RPC" --account mydeployer --broadcast --verify
 *
 * Env: CHIPS_ADDRESS (mandatory), MISSION_ORACLE (optional; defaults to GAME_OWNER
 *      as oracle), GAME_OWNER (defaults to DEPLOYER_ADDRESS), DEPLOYER_ADDRESS
 *      (validated by startBroadcast so a stale value fails loudly).
 */
contract DeployMissionSystem is Script {
    function run() external {
        address chipsAddr = vm.envAddress("CHIPS_ADDRESS");
        if (chipsAddr == address(0)) {
            revert("CHIPS_ADDRESS is mandatory - never deploy MissionSystem against a mock token");
        }
        address oracle = vm.envOr("MISSION_ORACLE", address(0));
        address owner_ = vm.envOr("GAME_OWNER", address(0));
        // Owner fallback only: if GAME_OWNER is unset, fall back to DEPLOYER_ADDRESS,
        // then to the script's msg.sender. Prefer the explicit GAME_OWNER.
        if (owner_ == address(0)) {
            owner_ = vm.envOr("DEPLOYER_ADDRESS", msg.sender);
        }

        // Broadcast from the configured --account (mydeployer). We deliberately do
        // NOT pin vm.startBroadcast(DEPLOYER_ADDRESS): that would force the broadcast
        // sender to equal DEPLOYER_ADDRESS, which must then match the keystore or the
        // node rejects it as a wrong sender. Broadcasting from the configured account
        // keeps the signing key and the sender in lock-step. See also contracts/.env.
        vm.startBroadcast();

        MissionSystem missions = new MissionSystem(IChips(chipsAddr), oracle, owner_);

        vm.stopBroadcast();

        console.log("CHIPS (existing)", chipsAddr);
        console.log("progressOracle", oracle == address(0) ? owner_ : oracle);
        console.log("owner", owner_);
        console.log("MissionSystem", address(missions));

        if (oracle == address(0)) {
            console.log("NOTE: MISSION_ORACLE unset - contract fell back to owner as oracle.");
            console.log("      Run SetMissionOracle (setProgressOracle) with a dedicated key before go-live.");
        }
        console.log("NEXT: set MISSION_SYSTEM_ADDRESS, then run mission:init && mission:fund");
    }
}
