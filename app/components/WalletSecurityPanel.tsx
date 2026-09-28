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
 * Security — passkey, notifications, export, details.
 * Short labels only; copy lives in tooltips/subtext one-liners
 * (SMART_WALLET_PLANNING §5 · §9).
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
    const mfa = useMfaStepUp();
    const push = usePushReady();
    const appSession = useAppSession();
    const [note, setNote] = useState<string | null>(null);

    const passkeyCount = (passkeys || []).length;
    const passkeyTag = !supported.data ? "Unavailable" : passkeyCount > 0 ? `${passkeyCount} active` : "Off";

    const onEnroll = useCallback(async () => {
        setBusy(true);
        setNote(null);
        try {
            await enrollPasskey();
            await refetch();
            setNote("Passkey added.");
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
        setExportErr(null);
        setNote(null);
        try {
            const ok = await mfa.stepUp();
            if (!ok) {
                setExportErr(mfa.mfaError || "MFA verification failed");
                return;
            }
            const result = await exportEvmAccount({ evmAccount: ownerEoa });
            if (result?.privateKey) setPrivateKey(result.privateKey);
        } catch (e) {
            setExportErr(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
            setShowExportConfirm(false);
        }
    }, [exportEvmAccount, ownerEoa, mfa]);

    return (
        <div className="sec-sheet">
            {/* Passkey */}
            <div className="sec-block">
                <div className="sec-head">
                    <span>Passkey</span>
                    <span className="sec-tag">{passkeyTag}</span>
                </div>
                <div className="sec-card">
                    <div className="sec-row">
                        <div className="sec-icon" aria-hidden>
                            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M12 3l8 4v5c0 5-3.5 8.2-8 9-4.5-.8-8-4-8-9V7l8-4z" />
                                <path d="M9.5 12l1.8 1.8L15 10" />
                            </svg>
                        </div>
                        <div className="sec-text">
                            <div className="sec-title">Device unlock</div>
                            <div className="sec-sub">Protects sign · send · export</div>
                        </div>
                        <button
                            type="button"
                            className="btn-mini primary"
                            disabled={busy || !supported.data || enrollStatus === "pending"}
                            onClick={onEnroll}
                        >
                            {enrollStatus === "pending" ? "Wait…" : passkeyCount > 0 ? "Add" : "Enable"}
                        </button>
                    </div>
                    {!supported.data && <p className="sec-sub pad">Not available in this browser</p>}
                    {enrollErr && <p className="err-text pad">{String(enrollErr.message || enrollErr)}</p>}
                    {passkeyCount > 0 && (
                        <ul className="sec-list">
                            {(passkeys || []).map((p: { credentialId: string }) => (
                                <li key={p.credentialId} className="sec-row">
                                    <div className="sec-text">
                                        <div className="sec-title font-mono">{p.credentialId.slice(0, 14)}…</div>
                                        <div className="sec-sub">Passkey</div>
                                    </div>
                                    <button
                                        type="button"
                                        className="btn-mini danger-ghost"
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
            </div>

            {/* Notifications */}
            <div className="sec-block">
                <div className="sec-head">
                    <span>Notifications</span>
                    <span className="sec-tag">
                        {push.remote === "subscribed"
                            ? "Remote"
                            : push.permission === "granted"
                              ? "Local"
                              : "Off"}
                    </span>
                </div>
                <div className="sec-card">
                    <div className="sec-row">
                        <div className="sec-icon" aria-hidden>
                            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M6 9a6 6 0 1 1 12 0c0 4 2 5 2 5H4s2-1 2-5" />
                                <path d="M10 19a2 2 0 0 0 4 0" />
                            </svg>
                        </div>
                        <div className="sec-text">
                            <div className="sec-title">Turn & claim nudges</div>
                            <div className="sec-sub">Push on this device</div>
                        </div>
                    </div>
                    <div className="sec-actions">
                        <button
                            type="button"
                            className="btn-mini primary"
                            disabled={!id.address}
                            onClick={async () => {
                                setNote(null);
                                const r = await push.enableRemotePush({
                                    walletAddress: id.address || "",
                                    sessionId: appSession.peekAppSession(),
                                });
                                setNote(r.ok ? "Remote push on." : push.error || "Could not enable push");
                            }}
                        >
                            Enable
                        </button>
                        <button
                            type="button"
                            className="btn-mini"
                            disabled={!id.address}
                            onClick={async () => {
                                setNote(null);
                                const err = await push.sendTestPush({
                                    walletAddress: id.address || "",
                                    sessionId: appSession.peekAppSession(),
                                });
                                setNote(err || "Test sent.");
                            }}
                        >
                            Test
                        </button>
                        <button
                            type="button"
                            className="btn-mini ghost"
                            disabled={!id.address}
                            onClick={async () => {
                                setNote(null);
                                await push.disableRemotePush({
                                    walletAddress: id.address || "",
                                    sessionId: appSession.peekAppSession(),
                                });
                                setNote("Push off.");
                            }}
                        >
                            Off
                        </button>
                    </div>
                </div>
            </div>

            {/* Export */}
            <div className="sec-block">
                <div className="sec-head">
                    <span>Export key</span>
                    <span className="sec-tag danger">Danger</span>
                </div>
                <div className="sec-card danger">
                    <div className="sec-row">
                        <div className="sec-icon danger" aria-hidden>
                            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="5" y="10" width="14" height="10" rx="2" />
                                <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                            </svg>
                        </div>
                        <div className="sec-text">
                            <div className="sec-title">Owner private key</div>
                            <div className="sec-sub">Owner EOA · not profile address</div>
                        </div>
                        {!showExportConfirm ? (
                            <button
                                type="button"
                                className="btn-mini danger"
                                disabled={busy}
                                onClick={() => setShowExportConfirm(true)}
                            >
                                Export
                            </button>
                        ) : null}
                    </div>
                    {showExportConfirm && (
                        <div className="sec-confirm">
                            <p className="sec-sub">Anyone with this key controls the wallet.</p>
                            <div className="sec-actions">
                                <button type="button" className="btn-mini danger" disabled={busy} onClick={onExport}>
                                    Confirm
                                </button>
                                <button
                                    type="button"
                                    className="btn-mini ghost"
                                    onClick={() => setShowExportConfirm(false)}
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    )}
                    {exportErr && <p className="err-text pad">{exportErr}</p>}
                    {privateKey && <pre className="sec-secret">{privateKey}</pre>}
                </div>
            </div>

            {/* Details */}
            <div className="sec-block">
                <div className="sec-head">
                    <span>Wallet details</span>
                </div>
                <div className="sec-card">
                    <WalletDetailsSheet />
                </div>
            </div>

            {note && <p className="ok-inline">{note}</p>}
        </div>
    );
}
