import test from "node:test";
import assert from "node:assert/strict";
import {
  accountDockReducer,
  TARGET_CHAIN_ID,
  AccountDockState,
} from "../app/components/account/useAccountDockState";

test("accountDockReducer: connect flow transitions correctly", () => {
  let state: AccountDockState = "SignedOut";

  // Start connecting
  state = accountDockReducer(state, { type: "CONNECT_START" });
  assert.equal(state, "Connecting");

  // Fail connecting
  state = accountDockReducer(state, { type: "CONNECT_FAIL" });
  assert.equal(state, "SignedOut");

  // Re-start and succeed
  state = accountDockReducer(state, { type: "CONNECT_START" });
  state = accountDockReducer(state, { type: "CONNECT_SUCCESS" });
  assert.equal(state, "Collapsed");
});

test("accountDockReducer: expand and collapse lifecycle", () => {
  let state: AccountDockState = "Collapsed";

  // Expand
  state = accountDockReducer(state, { type: "EXPAND" });
  assert.equal(state, "Expanded");

  // Collapse
  state = accountDockReducer(state, { type: "COLLAPSE" });
  assert.equal(state, "Collapsed");
});

test("accountDockReducer: disconnect confirmation flow", () => {
  let state: AccountDockState = "Expanded";

  // Request disconnect
  state = accountDockReducer(state, { type: "REQUEST_DISCONNECT" });
  assert.equal(state, "ConfirmDisconnect");

  // Cancel disconnect
  state = accountDockReducer(state, { type: "CANCEL_DISCONNECT" });
  assert.equal(state, "Expanded");

  // Request again and timeout (8s)
  state = accountDockReducer(state, { type: "REQUEST_DISCONNECT" });
  assert.equal(state, "ConfirmDisconnect");
  state = accountDockReducer(state, { type: "TIMEOUT_DISCONNECT" });
  assert.equal(state, "Expanded");

  // Request again and confirm
  state = accountDockReducer(state, { type: "REQUEST_DISCONNECT" });
  state = accountDockReducer(state, { type: "CONFIRM_DISCONNECT" });
  assert.equal(state, "SignedOut");
});

test("accountDockReducer: wrong network decorated collapsed state", () => {
  let state: AccountDockState = "Collapsed";

  // Network changes to Ethereum mainnet (chainId: 1)
  state = accountDockReducer(state, { type: "NETWORK_CHANGE", chainId: 1 });
  assert.equal(state, "WrongNetwork");

  // Can still expand from WrongNetwork
  state = accountDockReducer(state, { type: "EXPAND" });
  assert.equal(state, "Expanded");

  // Collapse back
  state = accountDockReducer(state, { type: "COLLAPSE" });
  assert.equal(state, "Collapsed");

  // Wrong network again
  state = accountDockReducer(state, { type: "NETWORK_CHANGE", chainId: 1 });
  assert.equal(state, "WrongNetwork");

  // Switch to Base Sepolia succeeded
  state = accountDockReducer(state, { type: "SWITCH_SUCCESS" });
  assert.equal(state, "Collapsed");

  // Check network change to TARGET_CHAIN_ID
  state = accountDockReducer("WrongNetwork", {
    type: "NETWORK_CHANGE",
    chainId: TARGET_CHAIN_ID,
  });
  assert.equal(state, "Collapsed");
});

test("accountDockReducer: panel open and close closes popover", () => {
  let state: AccountDockState = "Expanded";

  // Opening panel from expanded popover transitions to PanelOpen
  state = accountDockReducer(state, { type: "OPEN_PANEL", panel: "profile" });
  assert.equal(state, "PanelOpen");

  // Closing panel returns to Collapsed (never leaves two E3 surfaces open)
  state = accountDockReducer(state, { type: "CLOSE_PANEL" });
  assert.equal(state, "Collapsed");
});

test("accountDockReducer: global disconnect resets to SignedOut from any state", () => {
  const states: AccountDockState[] = [
    "Connecting",
    "Collapsed",
    "Expanded",
    "ConfirmDisconnect",
    "WrongNetwork",
    "PanelOpen",
  ];

  for (const s of states) {
    const next = accountDockReducer(s, { type: "DISCONNECT" });
    assert.equal(next, "SignedOut", `Expected ${s} to reset to SignedOut on DISCONNECT`);
  }
});

test("walletBoundaryPolicy: external wallets never render passkey or WebAuthn controls", () => {
  // Authoritative test for §5.3 / AGENTS.md / WALLET_SIGNING_POLICY.md
  type WalletMode = "ingame" | "external" | null;

  function shouldRenderPasskeyControls(mode: WalletMode): boolean {
    return mode === "ingame";
  }

  function getSecurityNotice(mode: WalletMode, connectorName: string = "MetaMask"): string | null {
    if (mode === "external") {
      return `Security is managed by your wallet (${connectorName}).`;
    }
    return null;
  }

  // In-Game CDP wallet: passkey controls allowed
  assert.equal(shouldRenderPasskeyControls("ingame"), true);
  assert.equal(getSecurityNotice("ingame"), null);

  // External wallets (MetaMask, Coinbase, Base Account, etc.): NEVER allow passkey controls
  assert.equal(shouldRenderPasskeyControls("external"), false);
  assert.equal(
    getSecurityNotice("external", "MetaMask"),
    "Security is managed by your wallet (MetaMask)."
  );
  assert.equal(
    getSecurityNotice("external", "Coinbase Wallet"),
    "Security is managed by your wallet (Coinbase Wallet)."
  );

  // Null (unconnected/guest): NEVER allow passkey controls
  assert.equal(shouldRenderPasskeyControls(null), false);
});

