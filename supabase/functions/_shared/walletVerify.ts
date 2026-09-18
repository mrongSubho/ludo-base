/**
 * Deno edge shared 6492-aware signature verification (Base 8453 only).
 *
 * Deno runtime: esm.sh-compatible imports ONLY. No Node APIs, no new npm
 * deps. Mirrors lib/walletVerify.ts (Next routes) — keep the two in sync:
 *   1. Fast EOA path — local ecrecover + address compare (zero RPC).
 *   2. Smart-account path — universal-validator eth_call on Base 8453
 *      (deployed ERC-1271 + counterfactual ERC-6492 wrappers).
 *
 * Failure codes (`ecrecover-invalid` vs `signer-mismatch`) match the Next
 * helper so 401 bodies are observable across every auth surface.
 *
 * Chain gating: Base 8453 only (matches SIWE `Chain ID: 8453` and the
 * LudoMatchSession EIP-712 domain). Message formats are NOT changed here.
 */

import {
  createPublicClient,
  http,
  recoverMessageAddress,
  recoverTypedDataAddress,
} from "https://esm.sh/viem@2.37.0";

// Minimal Base chain inline (avoids a second esm.sh subpath import; the
// verifier only needs id + rpcUrls — no erc6492Verifier entry means the
// deployless validator path is used, which works on any EVM chain).
const baseChain = {
  id: 8453,
  name: "Base",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://mainnet.base.org"] } },
  // deno-lint-ignore no-explicit-any
} as any;

export type WalletVerifyResult =
  | { ok: true; via: "eoa" | "smart" }
  | { ok: false; code: "ecrecover-invalid" | "signer-mismatch"; recovered?: string };

// deno-lint-ignore no-explicit-any
let _client: any = null;
// deno-lint-ignore no-explicit-any
function baseClient(): any {
  if (_client) return _client;
  let rpc = "";
  try {
    rpc = (Deno.env.get("SIWE_VERIFY_RPC_URL") || "").trim();
  } catch {
    rpc = "";
  }
  _client = createPublicClient({
    chain: baseChain,
    transport: rpc ? http(rpc) : http(),
  });
  return _client;
}

// deno-lint-ignore no-explicit-any
function withTimeout(p: Promise<any>, ms: number): Promise<any> {
  let timer: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("verify timed out")), ms);
  });
  return Promise.race([p, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

function isHexSig(s: unknown): s is `0x${string}` {
  return typeof s === "string" && /^0x[0-9a-fA-F]+$/.test(s);
}

/** Verify a personal_sign message/signature against an address. Never throws. */
export async function verifyPersonalSign(params: {
  address: string;
  message: string;
  signature: unknown;
}): Promise<WalletVerifyResult> {
  const claimed = String(params.address || "").toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(claimed)) {
    return { ok: false, code: "signer-mismatch" };
  }
  if (typeof params.message !== "string" || !params.message) {
    return { ok: false, code: "ecrecover-invalid" };
  }
  if (!isHexSig(params.signature)) {
    return { ok: false, code: "ecrecover-invalid" };
  }
  const signature = params.signature;

  let recovered: string | null = null;
  let ecrecoverThrew = false;
  try {
    recovered = (
      await recoverMessageAddress({ message: params.message, signature })
    ).toLowerCase();
  } catch {
    ecrecoverThrew = true;
  }
  if (recovered === claimed) return { ok: true, via: "eoa" };

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const valid = await withTimeout(
        baseClient().verifyMessage({ address: claimed, message: params.message, signature }),
        8000,
      );
      if (valid) return { ok: true, via: "smart" };
      break;
    } catch {
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 400));
        continue;
      }
      break;
    }
  }

  if (ecrecoverThrew) return { ok: false, code: "ecrecover-invalid" };
  return { ok: false, code: "signer-mismatch", recovered: recovered ?? undefined };
}

export type TypedDataMessage = {
  wallet: `0x${string}`;
  matchId: string;
  roomCode: string;
  expiresAt: bigint;
  nonce: string;
};

/** Verify an EIP-712 LudoMatchSession grant. Never throws. */
export async function verifyTypedDataSign(params: {
  // deno-lint-ignore no-explicit-any
  domain: any;
  // deno-lint-ignore no-explicit-any
  types: any;
  primaryType: string;
  message: TypedDataMessage;
  claimedWallet: string;
  signature: unknown;
}): Promise<WalletVerifyResult> {
  const claimed = String(params.claimedWallet || "").toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(claimed)) {
    return { ok: false, code: "signer-mismatch" };
  }
  if (!isHexSig(params.signature)) {
    return { ok: false, code: "ecrecover-invalid" };
  }
  const signature = params.signature;

  let recovered: string | null = null;
  let ecrecoverThrew = false;
  try {
    recovered = (
      await recoverTypedDataAddress({
        domain: params.domain,
        types: params.types,
        primaryType: params.primaryType,
        message: params.message,
        signature,
      } as never)
    ).toLowerCase();
  } catch {
    ecrecoverThrew = true;
  }
  if (recovered === claimed) return { ok: true, via: "eoa" };

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const valid = await withTimeout(
        baseClient().verifyTypedData({
          address: claimed,
          domain: params.domain,
          types: params.types,
          primaryType: params.primaryType,
          message: params.message,
          signature,
        }),
        8000,
      );
      if (valid) return { ok: true, via: "smart" };
      break;
    } catch {
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 400));
        continue;
      }
      break;
    }
  }

  if (ecrecoverThrew) return { ok: false, code: "ecrecover-invalid" };
  return { ok: false, code: "signer-mismatch", recovered: recovered ?? undefined };
}
