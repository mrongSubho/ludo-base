// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {MissionClaim} from "../src/MissionClaim.sol";
import {IChips} from "../src/interfaces/IChips.sol";

/**
 * Fund the MissionClaim reward reserve (and report the funding picture).
 *
 * The contract mints nothing: rewards come from `fund()`, which pulls CHIPS from
 * the caller via transferFrom. The treasury must therefore hold CHIPS and approve
 * the claim contract first — this script does both and prints the resulting
 * reserve so ops can verify headroom against `minReserve` before announcing a
 * claimable mission.
 *
 * Usage:
 *   # fund 1,000 CHIPS on Sepolia
 *   FUND_AMOUNT=1000 forge script script/FundMissionClaim.s.sol \
 *     --rpc-url $SEPOLIA_RPC --account deployer --broadcast
 *
 * Env: MISSION_CLAIM_ADDRESS (required), CHIPS_ADDRESS (required),
 *      FUND_AMOUNT (whole CHIPS, default 500), MIN_RESERVE (optional — sets the floor)
 */
contract FundMissionClaim is Script {
    uint256 constant ONE = 1e18;

    function run() external {
        address claimAddr = vm.envAddress("MISSION_CLAIM_ADDRESS");
        address chipsAddr = vm.envAddress("CHIPS_ADDRESS");
        uint256 amount = vm.envOr("FUND_AMOUNT", uint256(500)) * ONE;

        MissionClaim missions = MissionClaim(claimAddr);
        IChips chips = IChips(chipsAddr);

        vm.startBroadcast();

        // Pull-based funding: approve then fund. The token never needs to know
        // the claim contract's address beyond this allowance.
        chips.approve(claimAddr, amount);
        missions.fund(amount);

        // Optionally move the floor at the same time (e.g. "keep two days of
        // daily bonuses in reserve").
        uint256 reserve = vm.envOr("MIN_RESERVE", uint256(0));
        if (reserve != 0) {
            missions.setMinReserve(reserve);
        }

        vm.stopBroadcast();

        console.log("MissionClaim", claimAddr);
        console.log("funded", amount / ONE, "CHIPS");
        console.log("totalDeposited", missions.totalDeposited() / ONE, "CHIPS");
        console.log("totalClaimed", missions.totalClaimed() / ONE, "CHIPS");
        console.log("totalWithdrawn", missions.totalWithdrawn() / ONE, "CHIPS");
        console.log("balance", chips.balanceOf(claimAddr) / ONE, "CHIPS");
        console.log("minReserve", missions.minReserve() / ONE, "CHIPS");
        console.log("availableReserves", missions.availableReserves() / ONE, "CHIPS");
        console.log("perPeriodCeiling", missions.perPeriodCeiling() / ONE, "CHIPS");
        console.log("opKey", missions.opKey());
        console.log("paused", missions.paused());
    }
}
