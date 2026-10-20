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
    | "betting";

export interface AuthPromptOptions {
    context?: AuthPromptContext;
    title?: string;
    badgeText?: string;
    statusText?: string;
    onCancel?: () => void;
}

export interface AuthPromptState {
    isOpen: boolean;
    title: string;
    badgeText: string;
    statusText: string;
    onCancel?: () => void;
}

export const CONTEXT_PRESETS: Record<
    AuthPromptContext,
    { title: string; badgeText: string; statusText: string }
> = {
    general: {
        title: "WALLET SIGN-IN REQUIRED",
        badgeText: "Awaiting Signature",
        statusText:
            "Please approve the sign-in request in your wallet to proceed. No gas fee required.",
    },
    "quick-match": {
        title: "MATCHMAKING SIGN-IN",
        badgeText: "Awaiting Signature",
        statusText:
            "Please approve the sign-in request in your wallet to search for online opponents.",
    },
    teamup: {
        title: "TEAM UP SIGN-IN",
        badgeText: "Awaiting Signature",
        statusText:
            "Please approve the sign-in request in your wallet to host or join multiplayer parties.",
    },
    messaging: {
        title: "MESSAGING SIGN-IN",
        badgeText: "Awaiting Signature",
        statusText:
            "Please approve the sign-in request in your wallet to decrypt and send end-to-end encrypted messages.",
    },
    social: {
        title: "SOCIAL ACTION SIGN-IN",
        badgeText: "Awaiting Signature",
        statusText:
            "Please approve the sign-in request in your wallet to update friends or send pokes.",
    },
    marketplace: {
        title: "CUSTOMIZATION SIGN-IN",
        badgeText: "Awaiting Signature",
        statusText:
            "Please approve sign-in in your wallet to save your equipped board style and token skins.",
    },
    missions: {
        title: "CLAIM REWARD SIGN-IN",
        badgeText: "Awaiting Signature",
        statusText:
            "Please approve sign-in in your wallet to generate and verify your mission claim voucher.",
    },
    betting: {
        title: "SPECTATOR BETTING SIGN-IN",
        badgeText: "Awaiting Signature",
        statusText:
            "Please approve sign-in in your wallet to register your live match prediction.",
    },
};

let currentState: AuthPromptState = {
    isOpen: false,
    title: CONTEXT_PRESETS.general.title,
    badgeText: CONTEXT_PRESETS.general.badgeText,
    statusText: CONTEXT_PRESETS.general.statusText,
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
    const preset = CONTEXT_PRESETS[opts?.context || "general"];
    currentState = {
        isOpen: true,
        title: opts?.title || preset.title,
        badgeText: opts?.badgeText || preset.badgeText,
        statusText: opts?.statusText || preset.statusText,
        onCancel: opts?.onCancel,
    };
    emit();

    return () => hideAuthPrompt();
}

/**
 * Dismisses the system-wide SignWaitModal.
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
 * Updates status text on the active modal while in-flight.
 */
export function updateAuthPromptStatus(statusText: string): void {
    if (!currentState.isOpen) return;
    currentState = {
        ...currentState,
        statusText,
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
