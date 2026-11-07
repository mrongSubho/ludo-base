"use client";

import { useReducer, useEffect, useCallback, useRef } from "react";

export const TARGET_CHAIN_ID = 84532; // Base Sepolia

export type AccountDockState =
  | "SignedOut"
  | "Connecting"
  | "Collapsed"
  | "Expanded"
  | "ConfirmDisconnect"
  | "WrongNetwork"
  | "PanelOpen";

export type AccountDockAction =
  | { type: "CONNECT_START" }
  | { type: "CONNECT_FAIL" }
  | { type: "CONNECT_SUCCESS" }
  | { type: "EXPAND" }
  | { type: "COLLAPSE" }
  | { type: "REQUEST_DISCONNECT" }
  | { type: "CANCEL_DISCONNECT" }
  | { type: "CONFIRM_DISCONNECT" }
  | { type: "TIMEOUT_DISCONNECT" }
  | { type: "NETWORK_CHANGE"; chainId: number | null | undefined }
  | { type: "SWITCH_SUCCESS" }
  | { type: "OPEN_PANEL"; panel?: string }
  | { type: "CLOSE_PANEL" }
  | { type: "DISCONNECT" };

/**
 * §5.4 State machine reducer for Account Dock / Account Sheet
 */
export function accountDockReducer(
  state: AccountDockState,
  action: AccountDockAction
): AccountDockState {
  if (action.type === "DISCONNECT") {
    return "SignedOut";
  }

  switch (state) {
    case "SignedOut": {
      if (action.type === "CONNECT_START") return "Connecting";
      if (action.type === "CONNECT_SUCCESS") return "Collapsed";
      return state;
    }
    case "Connecting": {
      if (action.type === "CONNECT_FAIL") return "SignedOut";
      if (action.type === "CONNECT_SUCCESS") return "Collapsed";
      return state;
    }
    case "Collapsed": {
      if (action.type === "EXPAND") return "Expanded";
      if (action.type === "OPEN_PANEL") return "PanelOpen";
      if (action.type === "NETWORK_CHANGE") {
        return action.chainId != null && action.chainId !== TARGET_CHAIN_ID
          ? "WrongNetwork"
          : "Collapsed";
      }
      return state;
    }
    case "WrongNetwork": {
      if (action.type === "SWITCH_SUCCESS") return "Collapsed";
      if (action.type === "EXPAND") return "Expanded";
      if (action.type === "OPEN_PANEL") return "PanelOpen";
      if (action.type === "NETWORK_CHANGE") {
        return action.chainId === TARGET_CHAIN_ID ? "Collapsed" : "WrongNetwork";
      }
      return state;
    }
    case "Expanded": {
      if (action.type === "COLLAPSE") return "Collapsed";
      if (action.type === "REQUEST_DISCONNECT") return "ConfirmDisconnect";
      if (action.type === "OPEN_PANEL") return "PanelOpen";
      if (action.type === "NETWORK_CHANGE" && action.chainId === TARGET_CHAIN_ID) {
        return "Expanded";
      }
      return state;
    }
    case "ConfirmDisconnect": {
      if (
        action.type === "CANCEL_DISCONNECT" ||
        action.type === "TIMEOUT_DISCONNECT"
      ) {
        return "Expanded";
      }
      if (action.type === "CONFIRM_DISCONNECT") return "SignedOut";
      if (action.type === "COLLAPSE") return "Collapsed";
      return state;
    }
    case "PanelOpen": {
      if (action.type === "CLOSE_PANEL") return "Collapsed";
      if (action.type === "EXPAND") return "Expanded";
      return state;
    }
    default:
      return state;
  }
}

export interface UseAccountDockStateOptions {
  isConnected?: boolean;
  chainId?: number | null;
}

export function useAccountDockState(options: UseAccountDockStateOptions = {}) {
  const { isConnected = false, chainId } = options;

  const initial = isConnected
    ? chainId != null && chainId !== TARGET_CHAIN_ID
      ? "WrongNetwork"
      : "Collapsed"
    : "SignedOut";

  const [state, dispatch] = useReducer(accountDockReducer, initial);
  const prevConnectedRef = useRef(isConnected);

  // Sync connection state transitions
  useEffect(() => {
    const wasConnected = prevConnectedRef.current;
    prevConnectedRef.current = isConnected;

    if (!isConnected && wasConnected) {
      dispatch({ type: "DISCONNECT" });
    } else if (isConnected && !wasConnected) {
      dispatch({ type: "CONNECT_SUCCESS" });
    }
  }, [isConnected]);

  // Sync chain changes if connected
  useEffect(() => {
    if (isConnected && chainId !== undefined) {
      dispatch({ type: "NETWORK_CHANGE", chainId });
    }
  }, [isConnected, chainId]);

  // 8-second auto-timeout for ConfirmDisconnect
  useEffect(() => {
    if (state === "ConfirmDisconnect") {
      const timer = setTimeout(() => {
        dispatch({ type: "TIMEOUT_DISCONNECT" });
      }, 8000);
      return () => clearTimeout(timer);
    }
  }, [state]);

  const expand = useCallback(() => dispatch({ type: "EXPAND" }), []);
  const collapse = useCallback(() => dispatch({ type: "COLLAPSE" }), []);
  const requestDisconnect = useCallback(
    () => dispatch({ type: "REQUEST_DISCONNECT" }),
    []
  );
  const cancelDisconnect = useCallback(
    () => dispatch({ type: "CANCEL_DISCONNECT" }),
    []
  );
  const confirmDisconnect = useCallback(
    () => dispatch({ type: "CONFIRM_DISCONNECT" }),
    []
  );
  const openPanel = useCallback(
    (panel?: string) => dispatch({ type: "OPEN_PANEL", panel }),
    []
  );
  const closePanel = useCallback(() => dispatch({ type: "CLOSE_PANEL" }), []);

  return {
    state,
    isExpanded: state === "Expanded" || state === "ConfirmDisconnect",
    isWrongNetwork: state === "WrongNetwork",
    isConfirmingDisconnect: state === "ConfirmDisconnect",
    dispatch,
    expand,
    collapse,
    requestDisconnect,
    cancelDisconnect,
    confirmDisconnect,
    openPanel,
    closePanel,
  };
}
