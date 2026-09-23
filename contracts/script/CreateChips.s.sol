// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// CreateChips.s.sol — B20 factory bootstrap (requires base-forge + base-std).
// Mirrors CHIPS_PLANNING section 8.1. After createB20: mint 10B, allocate 2B + 8B locker,
// revoke ALL MINT_ROLEs (assert holders == ∅). Never grant SEIZE / BURN_BLOCKED.

/*
import {Script, console} from "forge-std/Script.sol";
import {B20Constants} from "base-std/lib/B20Constants.sol";
import {B20FactoryLib} from "base-std/lib/B20FactoryLib.sol";
import {IB20Factory} from "base-std/interfaces/IB20Factory.sol";
import {StdPrecompiles} from "base-std/StdPrecompiles.sol";

contract CreateChips is Script {
    function run() external returns (address token) {
        address multisig = vm.envAddress("CHIPS_ADMIN_MULTISIG");
        address distributor = vm.envAddress("SEASON_DISTRIBUTOR");
        address matchPool = vm.envAddress("MATCH_POOL");
        address marketplace = vm.envAddress("MARKETPLACE");
        address securityMsig = vm.envAddress("SECURITY_MULTISIG");
        address opsMsig = vm.envAddress("OPS_MULTISIG");

        bytes32 salt = keccak256(abi.encode("ludo-base-chips-v1", block.chainid));
        bytes memory params =
            B20FactoryLib.encodeAssetCreateParams("Chips", "CHIPS", multisig, 18);

        bytes[] memory initCalls = new bytes[](10);
        initCalls[0] = B20FactoryLib.encodeUpdateSupplyCap(10_000_000_000e18);
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
            IB20Factory.B20Variant.ASSET, salt, params, initCalls
        );
        // BootstrapFollowUp (separate script or same run):
        // 1) mint 10B to deployer
        // 2) transfer allocation + 8B to SupplyLocker
        // 3) revoke MINT_ROLE from everyone including distributor
        // 4) asserts per TOKEN_PARAMS section 1
        vm.stopBroadcast();
        console.log("CHIPS B20:", token);
    }
}
*/

// Placeholder so the file is valid without base-std. Uncomment when lib/base-std is installed.
contract CreateChipsPlaceholder {
    function name() external pure returns (string memory) {
        return "CreateChips - enable after base-std install";
    }
}
