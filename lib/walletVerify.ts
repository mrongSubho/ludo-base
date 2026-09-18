/**
 * 6492-aware personal-sign verification for Next.js auth routes (Base 8453 only).
 *
 * Background (signing-storm fix): the server previously verified wallet
 * signatures with bare `recoverMessageAddress` (plain ecrecover), which
 * rejects ERC-6492 smart-account signatures (counterfactual wrappers) and
 * ERC-1271 contract signatures (deployed smart wallets). With
 * `smartWalletOnly` forcing smart wallets, those users could NEVER obtain a
 * session, and timer pollers reprompted them every 2s/4s — the storm.
 *
 * This helper is the single 6492-aware primitive for personal_sign messages:
 *   1. Fast EOA path — local `recoverMessageAddress` + address compare
 *      (zero RPC; EOAs never pay for an eth_call and keep working when the
 *      RPC is down).
 *   2. Smart-account path — `publicClient.verifyMessage` on Base 8453, which
 *      handles deployed ERC-1271 contracts AND counterfactual ERC-6492
 *      wrapped signatures via the universal signature validator
 *      (deployless eth_call, no chain writes). Verified empirically against
 *      Base mainnet with a real Coinbase Smart Account wrapper
 *      (see scripts/siwe-matrix.ts case (c)).
 *
 * Distinct failure codes (`ecrecover-invalid` vs `signer-mismatch`) are
 * returned for observability — routes must surface `code` in 401 bodies.
 *
 * Chain gating: Base 8453 only, matching the `Chain ID: 8453` line in
 * `buildSiweMessage` (lib/sessionProof.ts). Message formats are NOT changed
 * here — this helper only changes how signatures are CHECKED.
 */

import { createPublicClient, http, recoverMessageAddress } from 'viem';
import { base } from 'viem/chains';

/** The only chain wallet signatures are verified against. */
export const VERIFY_CHAIN_ID = 8453;

export type WalletVerifyOk = { ok: true; via: 'eoa' | 'smart' };
export type WalletVerifyFail = {
    ok: false;
    /** `ecrecover-invalid`: undecodable as ECDSA and not valid via 6492/1271.
     *  `signer-mismatch`: decodable, but recovered !== claimed (and 6492 also false). */
    code: 'ecrecover-invalid' | 'signer-mismatch';
    recovered?: string;
};
export type WalletVerifyResult = WalletVerifyOk | WalletVerifyFail;

type VerifyMessageClient = {
    verifyMessage: (args: {
        address: `0x${string}`;
        message: string;
        signature: `0x${string}`;
    }) => Promise<boolean>;
};
let _client: VerifyMessageClient | null = null;

/** Singleton Base public client (one per serverless instance). */
function baseClient(): VerifyMessageClient {
    if (_client) return _client;
    const rpc = (process.env.SIWE_VERIFY_RPC_URL || '').trim();
    // Structural minimal typing: only verifyMessage is used, which keeps
    // this file immune to viem chain/transport generic drift.
    _client = createPublicClient({
        chain: base,
        transport: rpc ? http(rpc) : http(),
    });
    return _client;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('verify timed out')), ms);
    });
    return Promise.race([p, timeout]).finally(() => {
        if (timer) clearTimeout(timer);
    });
}

function isHexSig(s: unknown): s is `0x${string}` {
    return typeof s === 'string' && /^0x[0-9a-fA-F]+$/.test(s);
}

/**
 * Verify a personal_sign `message`/`signature` against `address`.
 * Never throws — all failures are encoded in the result.
 */
export async function verifyPersonalSign(params: {
    address: string;
    message: string;
    signature: unknown;
}): Promise<WalletVerifyResult> {
    const claimed = String(params.address || '').toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(claimed)) {
        return { ok: false, code: 'signer-mismatch' };
    }
    if (typeof params.message !== 'string' || !params.message) {
        return { ok: false, code: 'ecrecover-invalid' };
    }
    if (!isHexSig(params.signature)) {
        return { ok: false, code: 'ecrecover-invalid' };
    }
    const signature = params.signature;

    // Path 1 — EOA fast path (local ecrecover, no RPC).
    let recovered: string | null = null;
    let ecrecoverThrew = false;
    try {
        recovered = (await recoverMessageAddress({ message: params.message, signature })).toLowerCase();
    } catch {
        ecrecoverThrew = true;
    }
    if (recovered === claimed) {
        return { ok: true, via: 'eoa' };
    }

    // Path 2 — smart-account path (ERC-1271 deployed + ERC-6492
    // counterfactual via the universal validator). One retry on transport
    // failure: public RPCs rate-limit, and a flake must not 401 a valid
    // smart wallet (that 401 is what fed the reprompt storm).
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const valid = await withTimeout(
                baseClient().verifyMessage({ address: claimed as `0x${string}`, message: params.message, signature }),
                8_000,
            );
            if (valid) return { ok: true, via: 'smart' };
            break; // definitive false — no point retrying
        } catch {
            if (attempt === 0) {
                await new Promise((r) => setTimeout(r, 400));
                continue;
            }
            break;
        }
    }

    // Definitive failure — attribute with the ecrecover outcome so callers
    // can distinguish malformed sigs from wrong-signer sigs.
    if (ecrecoverThrew) {
        return { ok: false, code: 'ecrecover-invalid' };
    }
    return { ok: false, code: 'signer-mismatch', recovered: recovered ?? undefined };
}
