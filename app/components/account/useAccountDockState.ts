"use client";

import { useEffect, useReducer } from "react";
import { DEFAULT_CHAIN_ID } from "@/lib/chains";

export type AccountDockPhase =
    | "SignedOut"
    | "Connecting"
    | "Collapsed"
    | "Expanded"
    | "ConfirmDisconnect"
    | "WrongNetwork"
    | "PanelOpen";

export interface AccountDockState {
    phase: AccountDockPhase;
    connected: boolean;
    chainId: number | null;
    error: string | null;
}

export type AccountDockAction =
    | { type: "CONNECT_START" }
    | { type: "CONNECT_SUCCESS"; chainId: number | null }
    | { type: "CONNECT_ERROR"; error?: string }
    | { type: "TOGGLE_EXPAND" }
    | { type: "OPEN" }
    | { type: "CLOSE" }
    | { type: "REQUEST_DISCONNECT" }
    | { type: "CANCEL_DISCONNECT" }
    | { type: "CONFIRM_DISCONNECT" }
    | { type: "CHAIN_CHANGED"; chainId: number | null }
    | { type: "PANEL_OPENED" }
    | { type: "PANEL_CLOSED" };

export const CONFIRM_DISCONNECT_TIMEOUT_MS = 8_000;

export function isCorrectNetwork(chainId: number | null | undefined): boolean {
    return chainId == null || chainId === DEFAULT_CHAIN_ID;
}

export function initialAccountDockState(
    connected = false,
    chainId: number | null = DEFAULT_CHAIN_ID,
): AccountDockState {
    if (!connected) {
        return { phase: "SignedOut", connected: false, chainId, error: null };
    }
    return {
        phase: isCorrectNetwork(chainId) ? "Collapsed" : "WrongNetwork",
        connected: true,
        chainId,
        error: null,
    };
}

function settledPhase(chainId: number | null): "Collapsed" | "WrongNetwork" {
    return isCorrectNetwork(chainId) ? "Collapsed" : "WrongNetwork";
}

export function accountDockReducer(
    state: AccountDockState,
    action: AccountDockAction,
): AccountDockState {
    switch (action.type) {
        case "CONNECT_START":
            return { ...state, phase: "Connecting", error: null };

        case "CONNECT_SUCCESS":
            return {
                phase: settledPhase(action.chainId),
                connected: true,
                chainId: action.chainId,
                error: null,
            };

        case "CONNECT_ERROR":
            return {
                phase: "SignedOut",
                connected: false,
                chainId: state.chainId,
                error: action.error ?? null,
            };

        case "TOGGLE_EXPAND":
            if (!state.connected) return state;
            if (state.phase === "Expanded" || state.phase === "ConfirmDisconnect") {
                return { ...state, phase: settledPhase(state.chainId) };
            }
            return { ...state, phase: "Expanded" };

        case "OPEN":
            if (!state.connected) return state;
            return { ...state, phase: "Expanded" };

        case "CLOSE":
            if (!state.connected) {
                return { ...state, phase: "SignedOut" };
            }
            if (state.phase === "Expanded" || state.phase === "ConfirmDisconnect") {
                return { ...state, phase: settledPhase(state.chainId) };
            }
            return state;

        case "REQUEST_DISCONNECT":
            if (!state.connected) return state;
            return { ...state, phase: "ConfirmDisconnect" };

        case "CANCEL_DISCONNECT":
            if (!state.connected) return state;
            return { ...state, phase: "Expanded" };

        case "CONFIRM_DISCONNECT":
            return { phase: "SignedOut", connected: false, chainId: null, error: null };

        case "CHAIN_CHANGED": {
            const chainId = action.chainId;
            if (!state.connected) {
                return { ...state, chainId };
            }
            // Keep open popover / confirm / panel states stable while updating chain telemetry.
            if (
                state.phase === "Expanded" ||
                state.phase === "ConfirmDisconnect" ||
                state.phase === "PanelOpen"
            ) {
                return { ...state, chainId };
            }
            return { ...state, chainId, phase: settledPhase(chainId) };
        }

        case "PANEL_OPENED":
            if (!state.connected) return state;
            return { ...state, phase: "PanelOpen" };

        case "PANEL_CLOSED":
            if (!state.connected) return { ...state, phase: "SignedOut" };
            if (state.phase !== "PanelOpen") return state;
            return { ...state, phase: settledPhase(state.chainId) };

        default:
            return state;
    }
}

export function useAccountDockState(params: {
    connected: boolean;
    chainId: number | null;
    panelOpen: boolean;
}) {
    const { connected, chainId, panelOpen } = params;
    const [state, dispatch] = useReducer(
        accountDockReducer,
        initialAccountDockState(connected, chainId),
    );

    useEffect(() => {
        if (connected) {
            if (!state.connected) {
                dispatch({ type: "CONNECT_SUCCESS", chainId });
            } else if (state.chainId !== chainId) {
                dispatch({ type: "CHAIN_CHANGED", chainId });
            }
        } else if (state.connected) {
            dispatch({ type: "CONFIRM_DISCONNECT" });
        }
    }, [connected, chainId, state.connected, state.chainId]);

    useEffect(() => {
        if (panelOpen) {
            dispatch({ type: "PANEL_OPENED" });
        } else if (state.phase === "PanelOpen") {
            dispatch({ type: "PANEL_CLOSED" });
        }
    }, [panelOpen, state.phase]);

    useEffect(() => {
        if (state.phase !== "ConfirmDisconnect") return;
        const timer = window.setTimeout(() => {
            dispatch({ type: "CANCEL_DISCONNECT" });
        }, CONFIRM_DISCONNECT_TIMEOUT_MS);
        return () => window.clearTimeout(timer);
    }, [state.phase]);

    return { state, dispatch };
}

export interface AccountSecurityView {
    showPasskeyControls: boolean;
    externalWalletNotice: string | null;
}

/**
 * Wallet locking boundary (AGENTS.md & docs/architecture/WALLET_SIGNING_POLICY.md):
 * Only the in-game CDP wallet may render Ludo passkey / biometric lock rows.
 * External wallets rely strictly on their native extension/app authentication.
 */
export function resolveAccountSecurityView(
    walletMode: "ingame" | "external" | null,
    connectorName?: string | null,
): AccountSecurityView {
    if (walletMode === "ingame") {
        return {
            showPasskeyControls: true,
            externalWalletNotice: null,
        };
    }
    if (walletMode === "external") {
        const walletLabel = connectorName?.trim() || "your connected wallet";
        return {
            showPasskeyControls: false,
            externalWalletNotice: `Security is managed by your wallet (${walletLabel})`,
        };
    }
    return {
        showPasskeyControls: false,
        externalWalletNotice: "Connect an account to manage allowances and session security.",
    };
}

