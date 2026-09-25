// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {B20FactoryLib} from "base-std/lib/B20FactoryLib.sol";
import {IB20Factory} from "base-std/interfaces/IB20Factory.sol";
import {StdPrecompiles} from "base-std/StdPrecompiles.sol";
import {B20Constants} from "base-std/lib/B20Constants.sol";

/**
 * Create CHIPS B20 Asset + bootstrap initCalls (plan section 8.1).
 *
 * base-forge script script/CreateChips.s.sol \
 *   --rpc-url https://sepolia.base.org --account mydeployer \
 *   --sender 0xbcCa5DcBF293D98A627fD3814D5AE8249bB1DFaF --broadcast
 */
contract CreateChips is Script {
    function run() external returns (address token) {
        address multisig = vm.envOr("CHIPS_ADMIN_MULTISIG", msg.sender);
        address distributor = vm.envOr("SEASON_DISTRIBUTOR", msg.sender);
        address matchPool = vm.envOr("MATCH_POOL_ADDRESS", address(0));
        address marketplace = vm.envOr("MARKETPLACE_ADDRESS", matchPool);
        address securityMsig = vm.envOr("SECURITY_MULTISIG", multisig);
        address opsMsig = vm.envOr("OPS_MULTISIG", multisig);
        uint256 supplyCap = vm.envOr("CHIPS_SUPPLY_CAP", uint256(10_000_000_000) * 1e18);

        require(matchPool != address(0), "set MATCH_POOL_ADDRESS");

        bytes32 salt = keccak256(abi.encode("ludo-base-chips-v1", block.chainid));
        bytes memory params = B20FactoryLib.encodeAssetCreateParams("Chips", "CHIPS", multisig, 18);

        bytes[] memory initCalls = new bytes[](10);
        initCalls[0] = B20FactoryLib.encodeUpdateSupplyCap(supplyCap);
        initCalls[1] = B20FactoryLib.encodeGrantRole(B20Constants.MINT_ROLE, distributor);
        initCalls[2] = B20FactoryLib.encodeGrantRole(B20Constants.BURN_ROLE, matchPool);
        initCalls[3] = B20FactoryLib.encodeGrantRole(B20Constants.BURN_ROLE, marketplace);
        initCalls[4] = B20FactoryLib.encodeGrantRole(B20Constants.PAUSE_ROLE, securityMsig);
        initCalls[5] = B20FactoryLib.encodeGrantRole(B20Constants.UNPAUSE_ROLE, securityMsig);
        initCalls[6] = B20FactoryLib.encodeGrantRole(B20Constants.METADATA_ROLE, opsMsig);
        initCalls[7] = B20FactoryLib.encodeGrantRole(B20Constants.OPERATOR_ROLE, securityMsig);
        initCalls[8] = B20FactoryLib.encodeUpdateContractURI("https://ludobase.xyz/token/chips.json");
        initCalls[9] = B20FactoryLib.encodeUpdateExtraMetadata("game", "ludo-base");

        vm.startBroadcast();
        token = StdPrecompiles.B20_FACTORY.createB20(
            IB20Factory.B20Variant.ASSET,
            salt,
            params,
            initCalls
        );
        vm.stopBroadcast();

        console.log("CHIPS B20", token);
        console.log("Next: mint 10B, allocate, revoke MINT_ROLE, set NEXT_PUBLIC_CHIPS_ADDRESS");
    }
}
