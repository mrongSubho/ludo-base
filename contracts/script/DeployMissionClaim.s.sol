// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {MissionClaim} from "../src/MissionClaim.sol";
import {IChips} from "../src/interfaces/IChips.sol";

/**
 * @notice Deploy MissionClaim against the EXISTING CHIPS token — the minimal
 *         contract needed to make mission claiming operational.
 *
 * Why this script exists
 * ---------------------
 * DeployStack redeploys the whole economy (MatchPool, ClaimHub, MissionClaim,
 * SeasonClaim, LegacyClaim), which orphans live instances. MissionClaim has no
 * MatchPool dependency — it only needs the CHIPS token and the op key — so the
 * minimal correct deploy is exactly this one contract.
 *
 * What it does NOT do (deliberately): fund the reserve, register missions, or
 * open period windows. Those are runtime operations owned by ops, not deploy
 * artefacts — run `script/InitMissions.s.sol` and `script/FundMissionClaim.s.sol`
 * immediately afterwards. A deployment that stops here is a contract that can
 * never pay a claim.
 *
 * Usage
 * -----
 *   # 0. environment (see docs/ops/CONTRACT_DEPLOYMENT.md)
 *   cd contracts && source .env
 *
 *   # 1. dry run — no broadcast, prints the addresses it would create
 *   CHIPS_ADDRESS=0x... MISSION_OP_KEY=0x... GAME_OWNER=0x... \
 *     forge script script/DeployMissionClaim.s.sol:DeployMissionClaim \
 *       --rpc-url "$SEPOLIA_RPC" --account deployer
 *
 *   # 2. Base Sepolia (testnet) — deploy + verify in one shot
 *   forge script script/DeployMissionClaim.s.sol:DeployMissionClaim \
 *     --rpc-url "$SEPOLIA_RPC" --account deployer --broadcast --verify
 *
 *   # 3. Base mainnet — broadcast as the OWNER (not the deployer) when they differ
 *   forge script script/DeployMissionClaim.s.sol:DeployMissionClaim \
 *     --rpc-url "$BASE_RPC" --account deployer --broadcast --verify \
 *     --sender "$GAME_OWNER"
 *
 * Env: CHIPS_ADDRESS (mandatory — never MockChips), MISSION_OP_KEY (the address
 *      derived from MISSION_OP_PRIVATE_KEY, i.e. the voucher signer), GAME_OWNER
 *      (defaults to DEPLOYER_ADDRESS), DEPLOYER_ADDRESS (validated by
 *      startBroadcast so a stale value fails loudly).
 */
contract DeployMissionClaim is Script {
    function run() external {
        address chipsAddr = vm.envAddress("CHIPS_ADDRESS");
        if (chipsAddr == address(0)) {
            revert("CHIPS_ADDRESS is mandatory - never deploy MissionClaim against a mock token");
        }
        address opKey = vm.envAddress("MISSION_OP_KEY");
        if (opKey == address(0)) {
            revert("MISSION_OP_KEY is mandatory - set it to the voucher signer address");
        }
        address owner_ = vm.envOr("GAME_OWNER", address(0));
        address deployer = vm.envOr("DEPLOYER_ADDRESS", msg.sender);
        if (owner_ == address(0)) owner_ = deployer;

        // startBroadcast(deployer) makes a stale DEPLOYER_ADDRESS fail as an
        // unfunded sender instead of deploying from an unexpected account.
        vm.startBroadcast(deployer);

        MissionClaim missions = new MissionClaim(IChips(chipsAddr), opKey, owner_);

        vm.stopBroadcast();

        console.log("CHIPS (existing)", chipsAddr);
        console.log("opKey (voucher signer)", opKey);
        console.log("owner", owner_);
        console.log("MissionClaim", address(missions));

        if (owner_ != deployer) {
            console.log("NOTE: owner != deployer - transfer MISSION_CLAIM_ADDRESS ownership,");
            console.log("      then run InitMissions/FundMissionClaim as the owner (they are onlyOwner).");
        }
        console.log("NEXT: npm run claim:init && npm run claim:fund");
    }
}
