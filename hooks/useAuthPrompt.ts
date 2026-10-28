"use client";

import { useSyncExternalStore } from "react";

export type AuthPromptContext =
    | "general"
    | "quick-match"
    | "teamup"
    | "messaging"
    | "social"
    | "marketplace"
    | "missions"
    | "betting"
    | "mission-claim"
    | "sync-matches"
    | "pool-join"
    | "pool-settle"
    | "pool-claim"
    | "token-send"
    | "merkle-claim"
    | "contract-call";

export type PromptMode = "signature" | "transaction";

export interface AuthPromptOptions {
    context?: AuthPromptContext;
    mode?: PromptMode;
    title?: string;
    badgeText?: string;
    statusText?: string;
    networkText?: string;
    explanationText?: string;
    cancelLabel?: string;
    onCancel?: () => void;
}

export interface AuthPromptState {
    isOpen: boolean;
    mode: PromptMode;
    title: string;
    badgeText: string;
    statusText: string;
    networkText?: string;
    explanationText?: string;
    cancelLabel?: string;
    onCancel?: () => void;
}

export const CONTEXT_PRESETS: Record<
    AuthPromptContext,
    {
        mode: PromptMode;
        title: string;
        badgeText: string;
        statusText: string;
        networkText?: string;
        explanationText?: string;
        cancelLabel?: string;
    }
> = {
    general: {
        mode: "signature",
        title: "WALLET SIGN-IN REQUIRED",
        badgeText: "Awaiting Signature",
        statusText:
            "Please approve the sign-in request in your wallet to proceed. No gas fee required.",
        explanationText: "Zero gas fee. Sign-in only proves wallet ownership.",
        cancelLabel: "Return to Lobby",
    },
    "quick-match": {
        mode: "signature",
        title: "MATCHMAKING SIGN-IN",
        badgeText: "Awaiting Signature",
        statusText:
            "Please approve the sign-in request in your wallet to search for online opponents.",
        explanationText: "Zero gas fee. Cryptographically establishes your match queue ticket.",
        cancelLabel: "Cancel Matchmaking",
    },
    teamup: {
        mode: "signature",
        title: "TEAM UP SIGN-IN",
        badgeText: "Awaiting Signature",
        statusText:
            "Please approve the sign-in request in your wallet to host or join multiplayer parties.",
        explanationText: "Zero gas fee. Validates party membership credentials.",
        cancelLabel: "Cancel",
    },
    messaging: {
        mode: "signature",
        title: "MESSAGING SIGN-IN",
        badgeText: "Awaiting Signature",
        statusText:
            "Please approve the sign-in request in your wallet to decrypt and send end-to-end encrypted messages.",
        explanationText: "Zero gas fee. Generates local ECDH session key.",
        cancelLabel: "Dismiss",
    },
    social: {
        mode: "signature",
        title: "SOCIAL ACTION SIGN-IN",
        badgeText: "Awaiting Signature",
        statusText:
            "Please approve the sign-in request in your wallet to update friends or send pokes.",
        explanationText: "Zero gas fee. Authenticates friendship updates.",
        cancelLabel: "Dismiss",
    },
    marketplace: {
        mode: "signature",
        title: "CUSTOMIZATION SIGN-IN",
        badgeText: "Awaiting Signature",
        statusText:
            "Please approve sign-in in your wallet to save your equipped board style and token skins.",
        explanationText: "Zero gas fee. Persists visual skin preferences to profile.",
        cancelLabel: "Dismiss",
    },
    missions: {
        mode: "signature",
        title: "CLAIM REWARD SIGN-IN",
        badgeText: "Awaiting Signature",
        statusText:
            "Please approve sign-in in your wallet to generate and verify your mission claim voucher.",
        explanationText: "Zero gas fee. Prepares voucher credentials.",
        cancelLabel: "Cancel",
    },
    betting: {
        mode: "signature",
        title: "SPECTATOR BETTING SIGN-IN",
        badgeText: "Awaiting Signature",
        statusText:
            "Please approve sign-in in your wallet to register your live match prediction.",
        explanationText: "Zero gas fee. Registers prediction slip.",
        cancelLabel: "Cancel",
    },
    "mission-claim": {
        mode: "transaction",
        title: "CLAIM MISSION REWARD",
        badgeText: "Awaiting Confirmation",
        statusText:
            "Approve the transaction in your wallet to claim your CHIPS reward directly on-chain.",
        networkText: "Base Sepolia (84532)",
        explanationText:
            "Calling claimMission on MissionSystem. CHIPS are sent straight to your wallet upon confirmation.",
        cancelLabel: "Cancel Claim",
    },
    "sync-matches": {
        mode: "transaction",
        title: "SYNC MATCHES ON-CHAIN",
        badgeText: "Awaiting Confirmation",
        statusText:
            "Approve the batch-sync transaction in your wallet to record your matches onto the blockchain.",
        networkText: "Base Sepolia (84532)",
        explanationText:
            "Batch writes signed match attestations to MissionSystem. Progress counts towards daily & weekly missions.",
        cancelLabel: "Cancel Sync",
    },
    "pool-join": {
        mode: "transaction",
        title: "ENTER RANKED POOL",
        badgeText: "Awaiting Confirmation",
        statusText:
            "Approve the entry fee transaction in your wallet to enter the ranked match pool.",
        networkText: "Base Sepolia (84532)",
        explanationText:
            "Tokens are deposited into the MatchPool contract and held until match resolution.",
        cancelLabel: "Cancel",
    },
    "pool-settle": {
        mode: "transaction",
        title: "SETTLE MATCH POOL",
        badgeText: "Awaiting Confirmation",
        statusText:
            "Approve the settlement transaction in your wallet to distribute winnings according to the verified match outcome.",
        networkText: "Base Sepolia (84532)",
        explanationText:
            "Payouts are cryptographically validated against signed server match proofs.",
        cancelLabel: "Cancel",
    },
    "pool-claim": {
        mode: "transaction",
        title: "CLAIM POOL WINNINGS",
        badgeText: "Awaiting Confirmation",
        statusText:
            "Approve the withdrawal transaction in your wallet to transfer your winnings into your personal wallet.",
        networkText: "Base Sepolia (84532)",
        explanationText:
            "Contract directly transfers accumulated pool rewards to your wallet.",
        cancelLabel: "Cancel",
    },
    "token-send": {
        mode: "transaction",
        title: "SEND CHIPS",
        badgeText: "Awaiting Confirmation",
        statusText:
            "Approve the token transfer in your wallet to send CHIPS to the recipient address.",
        networkText: "Base Sepolia (84532)",
        explanationText: "Standard ERC-20 transfer with memo on Base.",
        cancelLabel: "Cancel Send",
    },
    "merkle-claim": {
        mode: "transaction",
        title: "CLAIM SEASON REWARD",
        badgeText: "Awaiting Confirmation",
        statusText:
            "Approve the claim transaction in your wallet to verify your Merkle proof and claim season tokens.",
        networkText: "Base Sepolia (84532)",
        explanationText: "Verified against the season Merkle root.",
        cancelLabel: "Cancel",
    },
    "contract-call": {
        mode: "transaction",
        title: "ON-CHAIN TRANSACTION",
        badgeText: "Awaiting Confirmation",
        statusText: "Please approve the contract interaction in your wallet to proceed.",
        networkText: "Base Sepolia (84532)",
        explanationText: "Standard network gas fee applies on Base.",
        cancelLabel: "Cancel",
    },
};

let currentPromptId = 0;

let currentState: AuthPromptState = {
    isOpen: false,
    mode: "signature",
    title: CONTEXT_PRESETS.general.title,
    badgeText: CONTEXT_PRESETS.general.badgeText,
    statusText: CONTEXT_PRESETS.general.statusText,
    networkText: CONTEXT_PRESETS.general.networkText,
    explanationText: CONTEXT_PRESETS.general.explanationText,
    cancelLabel: CONTEXT_PRESETS.general.cancelLabel,
};

const listeners = new Set<() => void>();

function emit() {
    listeners.forEach((l) => l());
}

/**
 * Activates the system-wide SignWaitModal with contextual copy.
 * Returns a cleanup function that automatically closes the modal.
 */
export function showAuthPrompt(opts?: AuthPromptOptions): () => void {
    const id = ++currentPromptId;
    const preset = CONTEXT_PRESETS[opts?.context || "general"];
    const mode = opts?.mode || preset.mode || "signature";
    currentState = {
        isOpen: true,
        mode,
        title: opts?.title || preset.title,
        badgeText: opts?.badgeText || preset.badgeText,
        statusText: opts?.statusText || preset.statusText,
        networkText: opts?.networkText || preset.networkText,
        explanationText: opts?.explanationText || preset.explanationText,
        cancelLabel: opts?.cancelLabel || preset.cancelLabel,
        onCancel: opts?.onCancel,
    };
    emit();

    return () => {
        if (currentPromptId === id) {
            hideAuthPrompt();
        }
    };
}

/**
 * Activates the system-wide modal in transaction mode for on-chain contract interactions.
 * Returns a cleanup function that automatically closes the modal.
 */
export function showTxPrompt(opts: AuthPromptOptions): () => void {
    return showAuthPrompt({
        ...opts,
        mode: "transaction",
        badgeText: opts.badgeText || "Awaiting Confirmation",
        cancelLabel: opts.cancelLabel || "Cancel Transaction",
    });
}

/**
 * Dismisses the system-wide modal.
 */
export function hideAuthPrompt(): void {
    if (!currentState.isOpen) return;
    currentState = {
        ...currentState,
        isOpen: false,
        onCancel: undefined,
    };
    emit();
}

/**
 * Updates status text and badge on the active modal while in-flight.
 */
export function updateAuthPromptStatus(statusText: string, badgeText?: string): void {
    if (!currentState.isOpen) return;
    currentState = {
        ...currentState,
        statusText,
        badgeText: badgeText || currentState.badgeText,
    };
    emit();
}

/**
 * Called when the user clicks 'Return to Lobby' / 'Cancel' on the modal.
 */
export function cancelAuthPrompt(): void {
    if (!currentState.isOpen) return;
    const cancelFn = currentState.onCancel;
    hideAuthPrompt();
    cancelFn?.();
}

/**
 * React hook to subscribe to the global auth prompt state.
 */
export function useAuthPrompt(): AuthPromptState {
    return useSyncExternalStore(
        (fn) => {
            listeners.add(fn);
            return () => listeners.delete(fn);
        },
        () => currentState,
        () => currentState,
    );
}
