"use client";

import React, { useRef } from "react";
import { useChainId } from "wagmi";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { AccountPopover } from "./AccountPopover";
import { StatusBadge } from "./StatusBadge";
import { isCorrectNetwork, useAccountDockState } from "./useAccountDockState";

type DockPanelTarget = "profile" | "settings" | "wallet";

export interface MobileAccountSlotProps {
    panelOpen: boolean;
    onOpenPanel: (panel: DockPanelTarget) => void;
    onCloseActivePanel: () => void;
}

export function MobileAccountSlot({
    panelOpen,
    onOpenPanel,
    onCloseActivePanel,
}: MobileAccountSlotProps) {
    const { isConnected, profile, displayName, isGuest } = useCurrentUser();
    const chainId = useChainId();
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const { state, dispatch } = useAccountDockState({
        connected: isConnected,
        chainId: isGuest ? null : chainId ?? null,
        panelOpen,
    });

    const isExpanded =
        state.phase === "Expanded" || state.phase === "ConfirmDisconnect";
    const status = !isConnected
        ? "offline"
        : isGuest || isCorrectNetwork(state.chainId)
          ? "online"
          : "pending";

    return (
        <>
            <button
                ref={triggerRef}
                type="button"
                aria-expanded={isExpanded}
                aria-controls="account-popover"
                onClick={() => {
                    if (panelOpen) onCloseActivePanel();
                    dispatch({ type: "TOGGLE_EXPAND" });
                }}
                className={`nav-item account-slot-3077 relative z-10 group ${isExpanded ? "active" : ""}`}
            >
                <div className="relative inline-flex items-center justify-center">
                    <div
                        className="w-6 h-6 rounded-md overflow-hidden border flex items-center justify-center"
                        style={{
                            borderColor: "var(--line-strong)",
                            backgroundColor: "var(--surface-2)",
                        }}
                    >
                        {profile?.avatar_url ? (
                            <img
                                src={profile.avatar_url}
                                alt={displayName}
                                width={24}
                                height={24}
                                className="w-full h-full object-cover"
                            />
                        ) : (
                            <span className="font-mono text-[10px] font-semibold uppercase text-accent">
                                {displayName.slice(0, 2)}
                            </span>
                        )}
                    </div>
                    <span className="absolute -bottom-1 -right-1">
                        <StatusBadge status={status} size={8} />
                    </span>
                </div>
                <span className="nav-label">Account</span>
            </button>

            <AccountPopover
                open={isExpanded}
                phase={state.phase}
                dispatch={dispatch}
                returnFocusRef={triggerRef}
                onOpenPanel={(target) => {
                    onOpenPanel(target);
                }}
            />
        </>
    );
}

export default MobileAccountSlot;
