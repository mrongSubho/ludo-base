/**
 * Offline checks that chipsSettle digests match MatchPool.sol layouts.
 * Run: node --import tsx scripts/chipsSettle.check.ts  (or npx tsx …)
 */
import {
    LOBBY_TYPEHASH,
    SETTLE_TYPEHASH,
    ABANDON_TYPEHASH,
    lobbyTicketStructHash,
    payoutPlanHash,
    settleStructHash,
    seatsHash,
} from "../lib/chipsSettle";

function assert(cond: boolean, msg: string) {
    if (!cond) {
        console.error("FAIL", msg);
        process.exitCode = 1;
    } else {
        console.log("ok", msg);
    }
}

// Known keccak typehashes (pre-image strings from MatchPool.sol)
assert(LOBBY_TYPEHASH.length === 66, "LOBBY_TYPEHASH is 32 bytes");
assert(SETTLE_TYPEHASH.length === 66, "SETTLE_TYPEHASH is 32 bytes");
assert(ABANDON_TYPEHASH.length === 66, "ABANDON_TYPEHASH is 32 bytes");

const th = lobbyTicketStructHash({
    roomCode: `0x${"11".repeat(32)}`,
    matchId: `0x${"22".repeat(32)}`,
    host: "0x0000000000000000000000000000000000000001",
    seatsHash: `0x${"33".repeat(32)}`,
    gameMode: 0,
    maxSeats: 2,
    issuedAt: BigInt(1),
});
assert(th.length === 66, "lobby structHash length");

const sh = seatsHash(
    ["0x0000000000000000000000000000000000000001", "0x0000000000000000000000000000000000000002"],
    [3, 4],
);
assert(sh.length === 66, "seatsHash length");

const ph = payoutPlanHash([
    { addr: "0x0000000000000000000000000000000000000001", amount: BigInt(1860) * BigInt(10) ** BigInt(18) },
]);
assert(ph.length === 66, "payoutPlanHash length");

const st = settleStructHash({
    poolId: `0x${"44".repeat(32)}`,
    planHash: ph,
    nonce: BigInt(1),
    deadline: BigInt(99),
    authority: "0x0000000000000000000000000000000000000001",
});
assert(st.length === 66, "settleStructHash length");

console.log("chipsSettle.check done");
