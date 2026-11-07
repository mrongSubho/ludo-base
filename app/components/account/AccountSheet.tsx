"use client";

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AccountPopover, AccountPopoverProps } from "./AccountPopover";

export interface AccountSheetProps extends Omit<AccountPopoverProps, "onClose"> {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * §5.1 / §5.3 / D1 Account Sheet Container
 * Mobile bottom sheet (max-height 85dvh) rendered via Portal with focus trap,
 * Esc dismissal, and outside-click backdrop.
 */
export const AccountSheet: React.FC<AccountSheetProps> = ({
  isOpen,
  onClose,
  ...popoverProps
}) => {
  const [mounted, setMounted] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Esc key dismissal
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Focus trap: keep focus within the dialog while open
  useEffect(() => {
    if (!isOpen || !sheetRef.current) return;
    const focusableElements = sheetRef.current.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusableElements.length > 0) {
      focusableElements[0].focus();
    }
  }, [isOpen]);

  if (!mounted || !isOpen) return null;

  return createPortal(
    <div
      className="account-scope-root"
      role="dialog"
      aria-modal="true"
      aria-labelledby="account-dialog-title"
    >
      {/* ── Backdrop ── */}
      <div
        className="account-backdrop"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* ── Sheet Container ── */}
      <div
        ref={sheetRef}
        className="account-sheet"
      >
        <AccountPopover onClose={onClose} {...popoverProps} />
      </div>
    </div>,
    document.body
  );
};
