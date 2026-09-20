/**
 * Deno edge shared 6492-aware signature verification
 * (Base mainnet 8453 + Base Sepolia 84532).
 *
 * Deno runtime: esm.sh-compatible imports ONLY. No Node APIs, no new npm
 * deps. Mirrors lib/walletVerify.ts + lib/chains.ts (Next routes) — keep the
 * three in sync (the allowlist is duplicated here because Edge cannot import
 * the Next path alias):
 *   1. Fast EOA path — local ecrecover + address compare (zero RPC).
 *   2. Smart-account path — universal-validator eth_call on the signature's
 *      chain (deployed ERC-1271 + counterfactual ERC-6492 wrappers).
 *
 * Failure codes (`ecrecover-invalid` vs `signer-mismatch`) match the Next
 * helper so 401 bodies are observable across every auth surface.
 *
 * Chain gating: only 8453 / 84532. EIP-712 `domain.chainId` must be
 * allowlisted (fail closed); personal-sign messages carrying a
 * `Chain ID: N` line must be allowlisted and match the expected chain.
 * Message formats are NOT changed here.
 */

import {
  createPublicClient,
  http,
  recoverMessageAddress,
  recoverTypedDataAddress,
} from "https://esm.sh/viem@2.37.0";

// Minimal Base chains inline (avoids a second esm.sh subpath import; the
// verifier only needs id + rpcUrls — no erc6492Verifier entry means the
// deployless validator path is used, which works on any EVM chain).
// deno-lint-ignore no-explicit-any
const baseChain: any = {
  id: 8453,
  name: "Base",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://mainnet.base.org"] } },
};
// deno-lint-ignore no-explicit-any
const baseSepoliaChain: any = {
  id: 84532,
  name: "Base Sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://sepolia.base.org"] } },
};

export const SUPPORTED_CHAIN_IDS = [84532, 8453] as const;
export type SupportedChainId = (typeof SUPPORTED_CHAIN_IDS)[number];
export const DEFAULT_CHAIN_ID: SupportedChainId = 8453;

export function parseChainId(input: unknown): SupportedChainId | null {
  const n =
    typeof input === "number"
      ? input
      : typeof input === "string" && input.trim() !== ""
        ? Number(input.trim())
        : NaN;
  if (n === 84532 || n === 8453) return n;
  return null;
}

export function extractMessageChainId(message: string): number | null {
  const m = /Chain ID:\s*(\d+)/.exec(message);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isSafeInteger(n) ? n : null;
}

// deno-lint-ignore no-explicit-any
const _clients: Partial<Record<SupportedChainId, any>> = {};
// deno-lint-ignore no-explicit-any
function chainClient(chainId: SupportedChainId): any {
  const existing = _clients[chainId];
  if (existing) return existing;
  let rpc = "";
  try {
    rpc = (
      chainId === 84532
        ? Deno.env.get("SIWE_VERIFY_RPC_URL_SEPOLIA")
        : Deno.env.get("SIWE_VERIFY_RPC_URL") || ""
    ).trim();
  } catch {
    rpc = "";
  }
  const client = createPublicClient({
    chain: chainId === 84532 ? baseSepoliaChain : baseChain,
    transport: rpc ? http(rpc) : http(),
  });
  _clients[chainId] = client;
  return client;
}

export type WalletVerifyResult =
  | { ok: true; via: "eoa" | "smart" }
  | { ok: false; code: "ecrecover-invalid" | "signer-mismatch"; recovered?: string };

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

/**
 * Resolve the effective verification chain. Explicit expectation wins;
 * otherwise the message's own `Chain ID: N` line; otherwise mainnet.
 * Returns null when anything conflicts or is not allowlisted (fail closed).
 */
function resolveEffectiveChain(
  message: string,
  chainId: unknown,
): SupportedChainId | null {
  const expected = chainId === undefined ? null : parseChainId(chainId);
  if (chainId !== undefined && expected === null) return null;
  const msgChainRaw = extractMessageChainId(message);
  if (msgChainRaw !== null && parseChainId(msgChainRaw) === null) return null;
  if (expected !== null && msgChainRaw !== null && expected !== msgChainRaw) {
    return null;
  }
  return expected ?? parseChainId(msgChainRaw) ?? DEFAULT_CHAIN_ID;
}

/** Verify a personal_sign message/signature against an address. Never throws. */
export async function verifyPersonalSign(params: {
  address: string;
  message: string;
  signature: unknown;
  chainId?: unknown;
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
  const effective = resolveEffectiveChain(params.message, params.chainId);
  if (effective === null) {
    return { ok: false, code: "signer-mismatch" };
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
        chainClient(effective).verifyMessage({ address: claimed, message: params.message, signature }),
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
  chainId?: unknown;
}): Promise<WalletVerifyResult> {
  const claimed = String(params.claimedWallet || "").toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(claimed)) {
    return { ok: false, code: "signer-mismatch" };
  }
  if (!isHexSig(params.signature)) {
    return { ok: false, code: "ecrecover-invalid" };
  }
  // Dual-chain gate: the EIP-712 domain chain must be allowlisted, and when
  // the caller states an expected chain it must match the domain.
  const domainChain = parseChainId(params.domain?.chainId);
  if (domainChain === null) {
    return { ok: false, code: "signer-mismatch" };
  }
  if (params.chainId !== undefined && parseChainId(params.chainId) !== domainChain) {
    return { ok: false, code: "signer-mismatch" };
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
        chainClient(domainChain).verifyTypedData({
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
