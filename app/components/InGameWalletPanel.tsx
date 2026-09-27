"use client";

import { useCallback, useState } from "react";
import {
    useCurrentUser,
    useIsSignedIn,
    useSignInWithEmail,
    useSignInWithOAuth,
    useSignOut,
    useVerifyEmailOTP,
} from "@coinbase/cdp-hooks";
import { resolvePlayerIdentity } from "@/lib/playerIdentity";
import { writeWalletMode } from "@/lib/walletMode";

/**
 * W1 — Create in-game wallet (CDP Smart Account).
 * Copy: this is NOT the Base app / MetaMask address (DUAL_PATH §5).
 * No CHIPS value in W1. Passkey MFA + export live in Settings later (W1 checklist).
 */
export default function InGameWalletPanel({ onDone }: { onDone?: () => void }) {
    const { isSignedIn } = useIsSignedIn();
    const { currentUser } = useCurrentUser();
    const { signInWithEmail } = useSignInWithEmail();
    const { verifyEmailOTP } = useVerifyEmailOTP();
    const { signInWithOAuth } = useSignInWithOAuth();
    const { signOut } = useSignOut();

    const [email, setEmail] = useState("");
    const [otp, setOtp] = useState("");
    const [flowId, setFlowId] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    const id = resolvePlayerIdentity(currentUser);

    const finish = useCallback(() => {
        if (id.address) {
            writeWalletMode("ingame");
            onDone?.();
        }
    }, [id.address, onDone]);

    const sendOtp = useCallback(async () => {
        if (!email) return;
        setBusy(true);
        setErr(null);
        try {
            const r = await signInWithEmail({ email });
            setFlowId(r.flowId);
        } catch (e) {
            setErr(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    }, [email, signInWithEmail]);

    const confirmOtp = useCallback(async () => {
        if (!flowId || !otp) return;
        setBusy(true);
        setErr(null);
        try {
            await verifyEmailOTP({ flowId, otp });
            setFlowId(null);
            setOtp("");
            // identity resolves after re-render from useCurrentUser
            setTimeout(finish, 50);
        } catch (e) {
            setErr(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    }, [flowId, otp, verifyEmailOTP, finish]);

    if (isSignedIn && id.address) {
        return (
            <div className="rounded-2xl border border-white/10 bg-black/40 p-4 space-y-2 text-xs text-white/85">
                <div className="font-bold uppercase tracking-wider text-[11px]">In-game wallet</div>
                <div className="font-mono break-all">{id.address}</div>
                <p className="text-white/45 text-[11px] leading-relaxed">
                    Smart Account for Ludo only — not your Base app or MetaMask address.
                    CHIPS / assets stay on this address.
                </p>
                <div className="flex gap-2">
                    <button
                        type="button"
                        className="rounded-lg bg-cyan-500/20 border border-cyan-400/40 px-3 py-1.5 uppercase font-bold"
                        onClick={finish}
                    >
                        Use this wallet
                    </button>
                    <button
                        type="button"
                        className="rounded-lg border border-white/15 px-3 py-1.5 uppercase"
                        onClick={() => signOut()}
                    >
                        Sign out
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="rounded-2xl border border-white/10 bg-black/40 p-4 space-y-3 text-xs text-white/85">
            <div className="font-bold uppercase tracking-wider text-[11px]">
                Create in-game wallet
            </div>
            <p className="text-white/45 text-[11px] leading-relaxed">
                Email or Google · no extension · not your Base app wallet.
            </p>
            {!flowId ? (
                <>
                    <div className="flex gap-2">
                        <input
                            className="flex-1 rounded-lg border border-white/20 bg-black/40 px-2 py-2"
                            type="email"
                            placeholder="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                        />
                        <button
                            type="button"
                            className="rounded-lg bg-cyan-500/20 border border-cyan-400/40 px-3 py-2 uppercase font-bold"
                            disabled={busy || !email}
                            onClick={sendOtp}
                        >
                            Continue
                        </button>
                    </div>
                    <div className="flex gap-2">
                        {(["google", "apple"] as const).map((p) => (
                            <button
                                key={p}
                                type="button"
                                className="flex-1 rounded-lg border border-white/15 py-2 uppercase"
                                disabled={busy}
                                onClick={() => signInWithOAuth(p)}
                            >
                                {p}
                            </button>
                        ))}
                    </div>
                </>
            ) : (
                <div className="flex gap-2">
                    <input
                        className="flex-1 rounded-lg border border-white/20 bg-black/40 px-2 py-2"
                        placeholder="6-digit code"
                        value={otp}
                        onChange={(e) => setOtp(e.target.value)}
                    />
                    <button
                        type="button"
                        className="rounded-lg bg-cyan-500/20 border border-cyan-400/40 px-3 py-2 uppercase font-bold"
                        disabled={busy || otp.length < 6}
                        onClick={confirmOtp}
                    >
                        Verify
                    </button>
                </div>
            )}
            {err && <div className="text-red-300 text-[11px]">{err}</div>}
        </div>
    );
}
