// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {MissionSystem} from "../src/MissionSystem.sol";
import {IChips} from "../src/interfaces/IChips.sol";

/**
 * @notice Fund the MissionSystem reward reserve (pull-based, same model as
 *         FundMissionClaim).
 *
 * The contract mints nothing: rewards come from fund(), which pulls CHIPS from
 * the caller via transferFrom. The treasury must therefore hold CHIPS and approve
 * the system first — this script does both and prints the resulting reserve so
 * ops can verify headroom against minReserve before announcing a claimable mission.
 *
 * Usage
 * -----
 *   # CHIPS is the B20 token — use base-forge so approve/transferFrom reach the
 *   # Base precompiles vanilla forge lacks (vanilla forge reverts OpcodeNotFound).
 *   FUND_AMOUNT=1000 base-forge script script/FundMissionSystem.s.sol \
 *     --rpc-url $SEPOLIA_RPC --account mydeployer --broadcast
 *     # NOTE: the CHIPS treasury is held by 0xbcCa, which IS the mydeployer key,
 *     # so funding MUST broadcast as --account mydeployer. CHIPS is B20 -> base-forge.
 *
 * Env: MISSION_SYSTEM_ADDRESS (required), CHIPS_ADDRESS (required),
 *      FUND_AMOUNT (whole CHIPS, default 1000), MIN_RESERVE (optional floor).
 */
contract FundMissionSystem is Script {
    uint256 constant ONE = 1e18;

    function run() external {
        address sysAddr = vm.envAddress("MISSION_SYSTEM_ADDRESS");
        address chipsAddr = vm.envAddress("CHIPS_ADDRESS");
        uint256 amount = vm.envOr("FUND_AMOUNT", uint256(1000)) * ONE;

        MissionSystem missions = MissionSystem(sysAddr);
        IChips chips = IChips(chipsAddr);

        vm.startBroadcast();

        // Pull-based funding: approve then fund. The token never needs to know the
        // system's address beyond this allowance.
        chips.approve(sysAddr, amount);
        missions.fund(amount);

        // Optionally move the floor at the same time (e.g. "keep two days of daily
        // bonuses in reserve").
        uint256 reserve = vm.envOr("MIN_RESERVE", uint256(0));
        if (reserve != 0) {
            missions.setMinReserve(reserve);
        }

        vm.stopBroadcast();

        console.log("MissionSystem", sysAddr);
        console.log("funded", amount / ONE, "CHIPS");
        console.log("totalDeposited", missions.totalDeposited() / ONE, "CHIPS");
        console.log("totalClaimed", missions.totalClaimed() / ONE, "CHIPS");
        console.log("balance", chips.balanceOf(sysAddr) / ONE, "CHIPS");
        console.log("availableReserves", missions.availableReserves() / ONE, "CHIPS");
        console.log("minReserve", missions.minReserve() / ONE, "CHIPS");
        console.log("progressOracle", missions.progressOracle());
        console.log("paused", missions.paused());
    }
}
