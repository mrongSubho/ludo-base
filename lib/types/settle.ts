import type { Address, Hex } from "viem";

export interface PayoutEntryWire {
    addr: Address;
    amount: string; // Wei value serialized as decimal string
}

export interface SettleProposalRequest {
    walletAddress: Address;
    sessionId: string;
    chainId?: number;
    poolId: Hex;
    authority?: Address;
    winners?: Address[];
    winnerAddresses?: Address[];
    participants?: Address[];
    payoutPlan?: PayoutEntryWire[];
    split?: "standard" | "even" | "custom" | "auto" | "podium" | "team";
    nonce?: string;
    deadline?: string;
    mode?: "dual" | "edge-only";
}

export interface SettleProposalResponse {
    poolId: Hex;
    planHash: Hex;
    nonce: string;
    deadline: string;
    authority: Address;
    digest: Hex;
    edgeSig: Hex;
    hostSignsDigest: Hex;
    chainId: number;
    matchPool: Address;
    plan: PayoutEntryWire[];
    modeB: boolean;
}
