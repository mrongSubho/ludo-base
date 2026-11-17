// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {ClanClaim} from "../src/ClanClaim.sol";
import {IChips} from "../src/interfaces/IChips.sol";

/**
 * @notice Deploy ClanClaim against the EXISTING CHIPS token — the contract
 *         responsible for non-custodial war escrow, Clan Treasury sub-ledger,
 *         and EIP-712 pull claims on Base Sepolia.
 *
 * Usage (from contracts/, deployer account named `mydeployer`):
 *   source .env
 *   forge script script/DeployClanClaim.s.sol:DeployClanClaim \
 *     --rpc-url "$SEPOLIA_RPC" --account mydeployer                    # dry run
 *   forge script script/DeployClanClaim.s.sol:DeployClanClaim \
 *     --rpc-url "$SEPOLIA_RPC" --account mydeployer --broadcast --verify
 *
 * Env: CHIPS_ADDRESS (mandatory), MISSION_OP_KEY or SETTLEMENT_OP_KEY (oracle signer),
 *      GAME_OWNER (default DEPLOYER_ADDRESS), PROTOCOL_TREASURY (default GAME_OWNER).
 */
contract DeployClanClaim is Script {
    function run() external {
        address chipsAddr = vm.envAddress("CHIPS_ADDRESS");
        if (chipsAddr == address(0)) revert("CHIPS_ADDRESS is mandatory");

        address oracle = vm.envOr("SETTLEMENT_OP_KEY", address(0));
        if (oracle == address(0)) {
            oracle = vm.envOr("MISSION_OP_KEY", address(0));
        }
        if (oracle == address(0)) revert("SETTLEMENT_OP_KEY or MISSION_OP_KEY is mandatory");

        address owner_ = vm.envOr("GAME_OWNER", address(0));
        address deployer = vm.envOr("DEPLOYER_ADDRESS", msg.sender);
        if (owner_ == address(0)) owner_ = deployer;

        address treasury = vm.envOr("PROTOCOL_TREASURY", address(0));
        if (treasury == address(0)) treasury = owner_;

        vm.startBroadcast();

        ClanClaim clanClaim = new ClanClaim(
            IChips(chipsAddr),
            owner_,
            oracle,
            treasury
        );

        vm.stopBroadcast();

        console.log("CHIPS (existing)  :", chipsAddr);
        console.log("settlementOracle  :", oracle);
        console.log("protocolTreasury  :", treasury);
        console.log("owner             :", owner_);
        console.log("ClanClaim deployed:", address(clanClaim));
    }
}
