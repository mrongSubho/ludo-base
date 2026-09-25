// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IB20Asset} from "base-std/interfaces/IB20Asset.sol";
import {B20Constants} from "base-std/lib/B20Constants.sol";

/**
 * Bootstrap CHIPS B20 after createB20: mint 10B allocation, revoke MINT_ROLE.
 *
 * base-forge script script/BootstrapChips.s.sol \
 *   --rpc-url https://sepolia.base.org --account mydeployer \
 *   --sender 0xbcCa5DcBF293D98A627fD3814D5AE8249bB1DFaF --broadcast
 */
contract BootstrapChips is Script {
    function run() external {
        IB20Asset chips = IB20Asset(vm.envAddress("CHIPS_ADDRESS"));
        address deployer = vm.envAddress("DEPLOYER_ADDRESS");
        address play = vm.envOr("SEASON_DISTRIBUTOR", deployer);
        address treasury = vm.envOr("TREASURY_WALLET", deployer);
        address team = vm.envOr("TEAM_WALLET", deployer);
        address liq = vm.envOr("LIQUIDITY_WALLET", deployer);
        address partners = vm.envOr("PARTNER_WALLET", deployer);

        uint256 e18 = 1e18;
        address[] memory recipients = new address[](5);
        uint256[] memory amounts = new uint256[](5);
        recipients[0] = play;
        amounts[0] = 3_000_000_000 * e18; // 30%
        recipients[1] = treasury;
        amounts[1] = 2_000_000_000 * e18; // 20%
        recipients[2] = team;
        amounts[2] = 2_000_000_000 * e18; // 20%
        recipients[3] = liq;
        amounts[3] = 2_000_000_000 * e18; // 20%
        recipients[4] = partners;
        amounts[4] = 1_000_000_000 * e18; // 10%

        vm.startBroadcast();
        chips.batchMint(recipients, amounts);
        chips.revokeRole(B20Constants.MINT_ROLE, deployer);
        if (play != deployer) {
            chips.revokeRole(B20Constants.MINT_ROLE, play);
        }
        vm.stopBroadcast();

        console.log("totalSupply:");
        console.log(chips.totalSupply());
        console.log("MINT_ROLE deployer?");
        console.log(chips.hasRole(B20Constants.MINT_ROLE, deployer));
    }
}
