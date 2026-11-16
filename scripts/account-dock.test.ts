/**
 * Account Dock & Wallet Security Boundary tests (3077 Mobile P6).
 *
 * Covers:
 *   1. Pure reducer state machine (§5.4 of docs/UI_UX_PRODUCTION_PLAN.md).
 *   2. Strict wallet locking boundary: Ludo passkey / biometric controls may
 *      only be surfaced for `walletMode === 'ingame'` (CDP). External wallets
 *      must never expose Ludo passkey toggles or WebAuthn prompts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
    accountDockReducer,
    initialAccountDockState,
    resolveAccountSecurityView,
} from "../app/components/account/useAccountDockState";

const root = join(import.meta.dirname ?? __dirname, "..");

test("P6-1: initialAccountDockState resolves SignedOut, Collapsed, and WrongNetwork", () => {
    const out = initialAccountDockState(false, 84532);
    assert.equal(out.phase, "SignedOut");
    assert.equal(out.connected, false);

    const ok = initialAccountDockState(true, 84532);
    assert.equal(ok.phase, "Collapsed");
    assert.equal(ok.connected, true);

    const wrong = initialAccountDockState(true, 1);
    assert.equal(wrong.phase, "WrongNetwork");
});

test("P6-2: full §5.4 state machine transitions", () => {
    let s = initialAccountDockState(false, null);
    s = accountDockReducer(s, { type: "CONNECT_START" });
    assert.equal(s.phase, "Connecting");

    s = accountDockReducer(s, { type: "CONNECT_ERROR", error: "rejected" });
    assert.equal(s, s);
    assert.equal(s.phase, "SignedOut");
    assert.equal(s.error, "rejected");

    s = accountDockReducer(s, { type: "CONNECT_SUCCESS", chainId: 84532 });
    assert.equal(s.phase, "Collapsed");
    assert.equal(s.connected, true);

    s = accountDockReducer(s, { type: "TOGGLE_EXPAND" });
    assert.equal(s.phase, "Expanded");

    s = accountDockReducer(s, { type: "REQUEST_DISCONNECT" });
    assert.equal(s.phase, "ConfirmDisconnect");

    s = accountDockReducer(s, { type: "CANCEL_DISCONNECT" });
    assert.equal(s.phase, "Expanded");

    s = accountDockReducer(s, { type: "PANEL_OPENED" });
    assert.equal(s.phase, "PanelOpen");

    s = accountDockReducer(s, { type: "PANEL_CLOSED" });
    assert.equal(s.phase, "Collapsed");

    s = accountDockReducer(s, { type: "CHAIN_CHANGED", chainId: 784 });
    assert.equal(s.phase, "WrongNetwork");

    s = accountDockReducer(s, { type: "CHAIN_CHANGED", chainId: 84532 });
    assert.equal(s.phase, "Collapsed");

    s = accountDockReducer(s, { type: "OPEN" });
    assert.equal(s.phase, "Expanded");

    s = accountDockReducer(s, { type: "CLOSE" });
    assert.equal(s.phase, "Collapsed");

    s = accountDockReducer(s, { type: "CONFIRM_DISCONNECT" });
    assert.equal(s.phase, "SignedOut");
    assert.equal(s.connected, false);
});

test("P6-3: resolveAccountSecurityView strictly gates passkeys on ingame CDP wallet", () => {
    const ingame = resolveAccountSecurityView("ingame", "Coinbase Smart Wallet");
    assert.equal(ingame.showPasskeyControls, true);
    assert.equal(ingame.externalWalletNotice, null);

    const ext = resolveAccountSecurityView("external", "MetaMask");
    assert.equal(ext.showPasskeyControls, false);
    assert.match(ext.externalWalletNotice ?? "", /Security is managed by your wallet \(MetaMask\)/);

    const guest = resolveAccountSecurityView(null);
    assert.equal(guest.showPasskeyControls, false);
});

test("P6-4: AccountPopover delegates security UI to resolveAccountSecurityView and gates passkeys", () => {
    const src = readFileSync(
        join(root, "app/components/account/AccountPopover.tsx"),
        "utf8",
    );
    assert.match(src, /resolveAccountSecurityView\(/);
    assert.match(src, /\{securityView\.showPasskeyControls \?/);
    assert.match(src, /securityView\.externalWalletNotice/);
    assert.doesNotMatch(src, /useEnrollPasskey|useBiometricGate|useListPasskeys/);
});
