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

/**
 * W1 — In-game wallet security (DUAL_PATH_WALLET_PLAN §5.4–5.5).
 * Passkey = MFA after CDP login (not primary sign-in).
 * Export = Coinbase secure iframe (owner EOA key).
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
    }, [exportEvmAccount, ownerEoa]);

    return (
        <div className="space-y-4">
            <div>
                <h4 className="text-[11px] font-black uppercase tracking-[0.25em] text-white/70">
                    Passkey (MFA)
                </h4>
                <p className="text-[11px] text-white/45 mt-1 leading-relaxed">
                    Extra lock after email/Google. Not a login password. Protects sign, send, and key export.
                </p>
                {!supported.data && (
                    <p className="text-[11px] text-amber-300/80 mt-1">Passkey not available in this browser.</p>
                )}
                <button
                    type="button"
                    className="mt-2 rounded-lg bg-cyan-500/15 border border-cyan-400/30 px-3 py-2 text-[11px] font-bold uppercase tracking-wider disabled:opacity-40"
                    disabled={busy || !supported.data || enrollStatus === "pending"}
                    onClick={onEnroll}
                >
                    {enrollStatus === "pending" ? "Waiting for biometric…" : "Add passkey"}
                </button>
                {enrollErr && (
                    <p className="text-red-300 text-[11px] mt-1">{String(enrollErr.message || enrollErr)}</p>
                )}
                <ul className="mt-2 space-y-1">
                    {(passkeys || []).map((p: { credentialId: string }) => (
                        <li
                            key={p.credentialId}
                            className="flex items-center justify-between gap-2 text-[11px] text-white/70 font-mono"
                        >
                            <span className="truncate">{p.credentialId.slice(0, 18)}…</span>
                            <button
                                type="button"
                                className="text-red-300/80 uppercase text-[10px]"
                                disabled={busy}
                                onClick={() => onDelete(p.credentialId)}
                            >
                                Remove
                            </button>
                        </li>
                    ))}
                </ul>
            </div>

            <div className="border-t border-white/10 pt-3">
                <h4 className="text-[11px] font-black uppercase tracking-[0.25em] text-white/70">
                    Export private key
                </h4>
                <p className="text-[11px] text-white/45 mt-1 leading-relaxed">
                    Reveals the <strong>owner key</strong> of your in-game smart wallet (Coinbase secure window).
                    MetaMask will show the owner address — not necessarily the in-game profile address.
                </p>
                {!showExportConfirm ? (
                    <button
                        type="button"
                        className="mt-2 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-red-200"
                        disabled={busy || exportStatus === "pending"}
                        onClick={() => setShowExportConfirm(true)}
                    >
                        Export private key…
                    </button>
                ) : (
                    <div className="mt-2 space-y-2">
                        <p className="text-[11px] text-red-200">
                            Anyone with this key controls the in-game wallet. Prefer leaving it here.
                        </p>
                        <div className="flex gap-2">
                            <button
                                type="button"
                                className="rounded-lg bg-red-500/20 border border-red-400/40 px-3 py-2 text-[11px] font-bold uppercase"
                                disabled={busy}
                                onClick={onExport}
                            >
                                I understand — export
                            </button>
                            <button
                                type="button"
                                className="rounded-lg border border-white/15 px-3 py-2 text-[11px] uppercase"
                                onClick={() => setShowExportConfirm(false)}
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                )}
                {exportErr && (
                    <p className="text-red-300 text-[11px] mt-1">{exportErr}</p>
                )}
                {privateKey && (
                    <pre className="mt-2 max-h-24 overflow-auto rounded-lg bg-black/50 p-2 text-[10px] text-amber-200 font-mono break-all">
                        {privateKey}
                    </pre>
                )}
            </div>
        </div>
    );
}
