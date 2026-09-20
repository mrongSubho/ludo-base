/**
 * verify-6492-gate — CI assertion: no recover-only auth path ships.
 *
 * Every wallet-signature check in an auth surface must go through the
 * 6492-aware shared helper (lib/walletVerify.ts for Next routes,
 * supabase/functions/_shared/walletVerify.ts for Deno edge functions).
 * A bare `recoverMessageAddress(` / `recoverTypedDataAddress(` in an auth
 * file means smart wallets (ERC-6492 / ERC-1271) are rejected there — the
 * root cause of the signing storm — so the gate FAILS.
 *
 * USAGE: node scripts/verify-6492-gate.mjs
 * EXIT: 0 all green; 1 on any violation.
 */
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

function read(rel) {
    return fs.readFileSync(path.join(repoRoot, rel), "utf8");
}

let fail = 0;
function check(id, ok, detail) {
    console.log(`${ok ? "PASS" : "FAIL"} ${id}: ${detail}`);
    if (!ok) fail++;
}

// Auth surfaces that MUST verify via the shared helper.
const nextRoutes = [
    "app/api/siwe/verify/route.ts",
    "app/api/profile/ecdh/route.ts",
    "app/api/match/stream/route.ts",
    "app/api/match/record/route.ts",
];
const edgeEntries = [
    "supabase/functions/move-auth/index.ts",
    "supabase/functions/resolve-bet/index.ts",
];

const bareRecover = /recoverMessageAddress\s*\(|recoverTypedDataAddress\s*\(/;

for (const f of nextRoutes) {
    let src = "";
    try {
        src = read(f);
    } catch (e) {
        check(`exists:${f}`, false, `cannot read: ${e.message}`);
        continue;
    }
    const usesHelper =
        src.includes("lib/walletVerify") && src.includes("verifyPersonalSign(");
    const usesBare = bareRecover.test(src);
    check(
        `6492:${f}`,
        usesHelper && !usesBare,
        usesHelper && !usesBare
            ? "verifyPersonalSign via lib/walletVerify, no bare recover"
            : `helper=${usesHelper} bareRecover=${usesBare} (auth must not ecrecover-only)`,
    );
}

for (const f of edgeEntries) {
    let src = "";
    try {
        src = read(f);
    } catch (e) {
        check(`exists:${f}`, false, `cannot read: ${e.message}`);
        continue;
    }
    const usesHelper =
        src.includes("_shared/walletVerify") &&
        (src.includes("verifyPersonalSign(") || src.includes("verifyTypedDataSign("));
    // esm.sh viem imports are allowed for non-recover utilities only.
    const usesBare = bareRecover.test(src);
    check(
        `6492:${f}`,
        usesHelper && !usesBare,
        usesHelper && !usesBare
            ? "shared Deno helper, no bare recover"
            : `helper=${usesHelper} bareRecover=${usesBare} (edge auth must not ecrecover-only)`,
    );
}

// Helper parity: both runtimes export the personal-sign primitive with the
// same failure codes.
try {
    const next = read("lib/walletVerify.ts");
    const edge = read("supabase/functions/_shared/walletVerify.ts");
    check(
        "parity:verifyPersonalSign",
        next.includes("export async function verifyPersonalSign") &&
            edge.includes("export async function verifyPersonalSign"),
        "both helpers export verifyPersonalSign",
    );
    check(
        "parity:codes",
        next.includes("ecrecover-invalid") &&
            next.includes("signer-mismatch") &&
            edge.includes("ecrecover-invalid") &&
            edge.includes("signer-mismatch"),
        "both helpers return ecrecover-invalid vs signer-mismatch",
    );
    check(
        "parity:chain-gating",
        next.includes("84532") &&
            edge.includes("84532") &&
            next.includes("parseChainId") &&
            edge.includes("parseChainId"),
        "both helpers gate to the 84532/8453 allowlist via parseChainId",
    );
} catch (e) {
    check("parity:read", false, `cannot read helpers: ${e.message}`);
}

// Client funnel guards (defense in depth — the storm amplifier).
try {
    const hook = read("hooks/useAppSession.ts");
    const guard = read("lib/appSessionGuard.ts");
    check(
        "client:singleton-guard",
        hook.includes("AppSessionGuard") && guard.includes("inFlight"),
        "useAppSession binds a shared AppSessionGuard with in-flight dedup",
    );
    check(
        "client:backoff-terminal",
        /backoff/i.test(guard) && guard.includes("terminal") && guard.includes("verifyFailed"),
        "guard has verify-failure backoff + terminal non-retrying state",
    );
    check(
        "client:reject-cooldown",
        /cooldown/i.test(hook) || /cooldown/i.test(guard),
        "guard has user-rejection cooldown",
    );
    const da = read("hooks/useDataActions.ts");
    check(
        "client:ecdh-account",
        da.includes("account: walletAddress") || da.includes("account: lowerAddr"),
        "ECDH sign passes account explicitly",
    );
    const sendIdx = da.indexOf("const sendMessage");
    const sendBody = sendIdx >= 0 ? da.slice(sendIdx, sendIdx + 4000) : "";
    const ensuresFirst =
        sendBody.indexOf("await ensureAppSession()") >= 0 &&
        sendBody.indexOf("await ensureAppSession()") <
            sendBody.indexOf("await publishMyEcdhPubkey(");
    check(
        "client:ecdh-check-before-sign",
        ensuresFirst,
        "sendMessage ensures session + checks server key before any ECDH sign",
    );
} catch (e) {
    check("client:read", false, `cannot read client files: ${e.message}`);
}

console.log(fail === 0 ? "\nverify-6492-gate: ALL GREEN" : `\nverify-6492-gate: ${fail} FAILURE(S)`);
process.exit(fail === 0 ? 0 : 1);
