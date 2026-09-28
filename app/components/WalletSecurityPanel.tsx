"use client";

import { useCallback, useState } from "react";
import {
    useCurrentUser,
    useDeletePasskey,
    useEnrollPasskey,
    useExportEvmAccount,
    useIsPasskeySupported,
    useListPasskeys,
} from "@coinbase/cdp-hooks";
import { resolvePlayerIdentity } from "@/lib/playerIdentity";
import { useMfaStepUp } from "@/hooks/useMfaStepUp";
import { usePushReady } from "@/hooks/usePushReady";
import { useAppSession } from "@/hooks/useAppSession";
import WalletDetailsSheet from "./WalletDetailsSheet";

/**
 * Security — passkey MFA, key export, push, wallet details
 * (SMART_WALLET_PLANNING §5 · §9). App Settings live in the header gear only.
 */
export default function WalletSecurityPanel() {
    const { currentUser } = useCurrentUser();
    const id = resolvePlayerIdentity(currentUser);
    const ownerEoa = id.cdpOwnerEoa as `0x${string}` | undefined;
    const supported = useIsPasskeySupported();
    const { enrollPasskey, status: enrollStatus, error: enrollErr } = useEnrollPasskey();
    const { data: passkeys, refetch } = useListPasskeys();
    const { deletePasskeyAsync } = useDeletePasskey();
    const { exportEvmAccount } = useExportEvmAccount();
    const [privateKey, setPrivateKey] = useState<string | null>(null);
    const [showExportConfirm, setShowExportConfirm] = useState(false);
    const [busy, setBusy] = useState(false);
    const [exportErr, setExportErr] = useState<string | null>(null);
    const [exportStatus, setExportStatus] = useState<"idle" | "pending" | "error">("idle");
    const mfa = useMfaStepUp();
    const push = usePushReady();
    const appSession = useAppSession();
    const [pushMsg, setPushMsg] = useState<string | null>(null);

    const onEnroll = useCallback(async () => {
        setBusy(true);
        try {
            await enrollPasskey();
            await refetch();
        } catch {
            /* surfaced via enrollErr */
        } finally {
            setBusy(false);
        }
    }, [enrollPasskey, refetch]);

    const onDelete = useCallback(
        async (credentialId: string) => {
            setBusy(true);
            try {
                await deletePasskeyAsync(credentialId);
                await refetch();
            } catch {
                /* ignore */
            } finally {
                setBusy(false);
            }
        },
        [deletePasskeyAsync, refetch],
    );

    const onExport = useCallback(async () => {
        if (!ownerEoa) return;
        setBusy(true);
        setExportStatus("pending");
        setExportErr(null);
        try {
            const ok = await mfa.stepUp();
            if (!ok) {
                setExportErr(mfa.mfaError || "MFA verification failed");
                setExportStatus("error");
                return;
            }
            const result = await exportEvmAccount({ evmAccount: ownerEoa });
            if (result?.privateKey) setPrivateKey(result.privateKey);
            setExportStatus("idle");
        } catch (e) {
            setExportErr(e instanceof Error ? e.message : String(e));
            setExportStatus("error");
        } finally {
            setBusy(false);
            setShowExportConfirm(false);
        }
    }, [exportEvmAccount, ownerEoa, mfa]);

    return (
        <div className="cb-screen space-y-4">
            {/* Passkey */}
            <section className="cb-section">
                <div className="cb-section-head">
                    <span>Passkey (MFA)</span>
                    <span className="cb-section-tag">
                        {supported.data ? (passkeys?.length ? "Enrolled" : "Optional") : "Unavailable"}
                    </span>
                </div>
                <div className="cb-card cb-pad">
                    <p className="cb-copy">
                        Extra lock after email or Google. Not a login password — it protects sign, send, and key
                        export.
                    </p>
                    {!supported.data && (
                        <p className="cb-warn">Passkey is not available in this browser.</p>
                    )}
                    <button
                        type="button"
                        className="cb-btn primary"
                        disabled={busy || !supported.data || enrollStatus === "pending"}
                        onClick={onEnroll}
                    >
                        {enrollStatus === "pending" ? "Waiting for biometric…" : "Add passkey"}
                    </button>
                    {enrollErr && <p className="cb-error">{String(enrollErr.message || enrollErr)}</p>}
                    {(passkeys || []).length > 0 && (
                        <ul className="cb-list">
                            {(passkeys || []).map((p: { credentialId: string }) => (
                                <li key={p.credentialId} className="cb-list-row">
                                    <span className="cb-list-main font-mono">{p.credentialId.slice(0, 18)}…</span>
                                    <button
                                        type="button"
                                        className="cb-btn danger-ghost sm"
                                        disabled={busy}
                                        onClick={() => onDelete(p.credentialId)}
                                    >
                                        Remove
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </section>

            {/* Notifications */}
            <section className="cb-section">
                <div className="cb-section-head">
                    <span>Notifications</span>
                    <span className="cb-section-tag">
                        {push.permission === "granted" ? (push.remote === "subscribed" ? "Remote on" : "Local only") : push.permission}
                    </span>
                </div>
                <div className="cb-card cb-pad">
                    <p className="cb-copy">
                        Remote push for turn nudges, claim reminders, and wallet events. Permission and a saved
                        server subscription are separate.
                    </p>
                    <div className="cb-btn-row">
                        <button
                            type="button"
                            className="cb-btn primary"
                            disabled={!id.address}
                            onClick={async () => {
                                setPushMsg(null);
                                const r = await push.enableRemotePush({
                                    walletAddress: id.address || "",
                                    sessionId: appSession.peekAppSession(),
                                });
                                setPushMsg(
                                    r.ok
                                        ? "Remote push enabled on this device."
                                        : push.error || "Could not enable remote push",
                                );
                            }}
                        >
                            Enable remote push
                        </button>
                        <button
                            type="button"
                            className="cb-btn"
                            disabled={!id.address}
                            onClick={async () => {
                                setPushMsg(null);
                                const err = await push.sendTestPush({
                                    walletAddress: id.address || "",
                                    sessionId: appSession.peekAppSession(),
                                });
                                setPushMsg(err || "Test push sent.");
                            }}
                        >
                            Send test
                        </button>
                        <button
                            type="button"
                            className="cb-btn ghost"
                            disabled={!id.address}
                            onClick={async () => {
                                setPushMsg(null);
                                await push.disableRemotePush({
                                    walletAddress: id.address || "",
                                    sessionId: appSession.peekAppSession(),
                                });
                                setPushMsg("Remote push disabled on this device.");
                            }}
                        >
                            Disable
                        </button>
                    </div>
                    {pushMsg && <p className="cb-copy ok">{pushMsg}</p>}
                    {push.error && <p className="cb-error">{push.error}</p>}
                </div>
            </section>

            {/* Export key — danger zone */}
            <section className="cb-section">
                <div className="cb-section-head">
                    <span>Export private key</span>
                    <span className="cb-section-tag danger">Danger zone</span>
                </div>
                <div className="cb-card cb-pad danger-card">
                    <p className="cb-copy">
                        Reveals the <strong>owner key</strong> of your in-game smart wallet (Coinbase secure
                        window). MetaMask will show the owner address — not the in-game profile address.
                    </p>
                    {!showExportConfirm ? (
                        <button
                            type="button"
                            className="cb-btn danger"
                            disabled={busy || exportStatus === "pending"}
                            onClick={() => setShowExportConfirm(true)}
                        >
                            Export private key…
                        </button>
                    ) : (
                        <div className="cb-confirm">
                            <p className="cb-warn">
                                Anyone with this key controls the in-game wallet. Prefer leaving it here.
                            </p>
                            <div className="cb-btn-row">
                                <button type="button" className="cb-btn danger" disabled={busy} onClick={onExport}>
                                    I understand — export
                                </button>
                                <button
                                    type="button"
                                    className="cb-btn ghost"
                                    onClick={() => setShowExportConfirm(false)}
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    )}
                    {exportErr && <p className="cb-error">{exportErr}</p>}
                    {privateKey && (
                        <pre className="cb-secret">{privateKey}</pre>
                    )}
                </div>
            </section>

            {/* Identity details */}
            <section className="cb-section">
                <div className="cb-section-head">
                    <span>Wallet details</span>
                </div>
                <div className="cb-card">
                    <WalletDetailsSheet />
                </div>
            </section>
        </div>
    );
}
