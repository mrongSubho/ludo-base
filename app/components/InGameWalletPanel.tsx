"use client";

/**
 * W1 — Create in-game wallet (CDP Smart Account).
 * Stages: auth (socials + email OTP) → ready (passkey nudge) → done.
 * No private key at create. Returning users: welcome-back / silent handoff.
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
    useCurrentUser,
    useEnrollPasskey,
    useIsPasskeySupported,
    useIsSignedIn,
    useListPasskeys,
    useSignInWithEmail,
    useOAuthState,
    useSignInWithOAuth,
    useSignOut,
    useVerifyEmailOTP,
} from "@coinbase/cdp-hooks";
import { resolvePlayerIdentity } from "@/lib/playerIdentity";
import { writeWalletMode } from "@/lib/walletMode";
import { isCdpAuthEnabled } from "./CdpAuthProvider";
import { markBootUnlocked } from "./BootLock";
import {
    hasSeenWalletReady,
    markProtectNudged,
    markWalletCreated,
} from "@/lib/walletOnboarding";

type SocialId = "google" | "apple" | "x" | "telegram";
type Stage = "auth" | "ready" | "welcome";

const SOCIALS: { id: SocialId; label: string; icon: ReactNode }[] = [
    {
        id: "google",
        label: "Google",
        icon: (
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
                <path fill="#EA4335" d="M12 10.2v3.6h5.1c-.2 1.2-1.5 3.5-5.1 3.5-3.1 0-5.6-2.5-5.6-5.6S8.9 6.1 12 6.1c1.8 0 2.9.7 3.6 1.4l2.4-2.4C16.7 3.8 14.6 3 12 3 6.9 3 2.8 7.1 2.8 12S6.9 21 12 21c5.4 0 9-3.8 9-9.1 0-.6-.1-1.1-.2-1.7H12z" />
            </svg>
        ),
    },
    {
        id: "apple",
        label: "Apple",
        icon: (
            <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden>
                <path d="M16.4 12.7c0-2.2 1.8-3.3 1.9-3.4-1-1.5-2.6-1.7-3.2-1.7-1.4-.1-2.7.8-3.4.8-.7 0-1.8-.8-2.9-.8-1.5 0-2.9.9-3.7 2.2-1.6 2.7-.4 6.8 1.1 9 .8 1.1 1.7 2.3 2.9 2.2 1.2 0 1.6-.7 3-.7s1.8.7 3 .7 2-1.1 2.8-2.2c.9-1.2 1.2-2.4 1.2-2.5-.1 0-2.4-.9-2.7-3.6zM14.5 5.9c.6-.8 1-1.8.9-2.9-.9 0-2 .6-2.6 1.4-.6.7-1.1 1.8-.9 2.8 1 .1 2-.5 2.6-1.3z" />
            </svg>
        ),
    },
    {
        id: "x",
        label: "X",
        icon: (
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden>
                <path d="M17.5 3h3l-6.6 7.5L22 21h-6.2l-4.9-6.4L5.3 21H2.2l7-8L2 3h6.3l4.4 5.8L17.5 3zm-1.1 16.2h1.7L7.7 4.7H5.9l10.5 14.5z" />
            </svg>
        ),
    },
    {
        id: "telegram",
        label: "Telegram",
        icon: (
            <svg viewBox="0 0 24 24" width="22" height="22" fill="#229ED9" aria-hidden>
                <path d="M21.7 4.2 3.9 10.9c-1.2.5-1.2 1.1-.2 1.4l4.5 1.4 1.7 5.2c.2.6.1.8.7.8.5 0 .7-.2 1-.5l2.2-2.1 4.5 3.3c.8.5 1.4.2 1.6-.8l2.9-13.5c.3-1.2-.4-1.7-1.2-1.4zM8.7 13.7l9.2-5.8c.4-.3.8-.1.5.2l-7.6 6.9-.3 3-1.8-4.3z" />
            </svg>
        ),
    },
];

function shortAddr(a: string) {
    return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export default function InGameWalletPanel({
    onDone,
    onBack,
}: {
    onDone?: () => void;
    onBack?: () => void;
}) {
    const { isSignedIn } = useIsSignedIn();
    const { currentUser } = useCurrentUser();
    const { signInWithEmail } = useSignInWithEmail();
    const { verifyEmailOTP } = useVerifyEmailOTP();
    const { signInWithOAuth } = useSignInWithOAuth();
    const { signOut } = useSignOut();
    const { oauthState } = useOAuthState();
    const passkeySupported = useIsPasskeySupported();
    const { enrollPasskey, status: enrollStatus } = useEnrollPasskey();
    const { data: passkeys } = useListPasskeys();

    const [email, setEmail] = useState("");
    const [otp, setOtp] = useState("");
    const [flowId, setFlowId] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [stage, setStage] = useState<Stage>("auth");

    const id = resolvePlayerIdentity(currentUser);
    const address = id.address;
    const hasPasskey = Boolean((passkeys || []).length || currentUser?.mfaMethods?.passkey?.length);

    // OAuth return errors (redirect back without a session).
    useEffect(() => {
        if (oauthState?.status === "error" && oauthState.errorDescription) {
            setErr(oauthState.errorDescription);
        }
    }, [oauthState]);

    // Route a live session off the auth form (first time vs returning).
    useEffect(() => {
        if (!isSignedIn) return;
        if (stage !== "auth") return;
        if (address) {
            if (hasSeenWalletReady(address)) setStage("welcome");
            else setStage("ready");
        }
        // Signed in without an address yet: keep waiting on auth stage but
        // block the form below (CDP is still provisioning the smart account).
    }, [isSignedIn, address, stage]);

    const enterArena = useCallback(() => {
        if (address) markWalletCreated(address);
        markBootUnlocked();
        writeWalletMode("ingame");
        onDone?.();
    }, [address, onDone]);

    const sendOtp = useCallback(async () => {
        const clean = email.trim();
        if (!clean) return;
        setBusy(true);
        setErr(null);
        try {
            const r = await signInWithEmail({ email: clean });
            setFlowId(r.flowId);
            setOtp("");
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            if (/already authenticated/i.test(msg)) {
                if (address) setStage(hasSeenWalletReady(address) ? "welcome" : "ready");
                else setErr("Already signed in — finishing wallet setup. Try Continue in a moment.");
            } else {
                setErr(msg);
            }
        } finally {
            setBusy(false);
        }
    }, [email, signInWithEmail, address]);

    const confirmOtp = useCallback(async () => {
        if (!flowId || otp.trim().length < 6) return;
        setBusy(true);
        setErr(null);
        try {
            await verifyEmailOTP({ flowId, otp: otp.trim() });
            setFlowId(null);
            setOtp("");
            // stage flips via effect once CDP user lands
        } catch (e) {
            setErr(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    }, [flowId, otp, verifyEmailOTP]);

    const onEnrollPasskey = useCallback(async () => {
        if (!address) return;
        setBusy(true);
        setErr(null);
        try {
            await enrollPasskey();
            markProtectNudged(address);
            markWalletCreated(address);
            markBootUnlocked();
            writeWalletMode("ingame");
            onDone?.();
        } catch (e) {
            setErr(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    }, [address, enrollPasskey, onDone]);

    const skipProtect = useCallback(() => {
        if (address) {
            markProtectNudged(address);
            markWalletCreated(address);
        }
        markBootUnlocked();
        writeWalletMode("ingame");
        onDone?.();
    }, [address, onDone]);

    // ── Returning user (seen ready before) ──
    if (stage === "welcome" && address) {
        return (
            <div className="ingame-signin">
                {onBack && (
                    <button type="button" className="ingame-back" onClick={onBack} aria-label="Back">
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M15 18l-6-6 6-6" />
                        </svg>
                    </button>
                )}
                <h2 className="ingame-title">Welcome back</h2>
                <p className="ingame-sub">You&apos;re signed in as</p>
                <div className="ingame-card">
                    <div className="ingame-card-label">In-game wallet</div>
                    <div className="ingame-card-addr font-mono">{shortAddr(address)}</div>
                    <p className="ingame-note">Not your Base app or MetaMask address.</p>
                </div>
                <button type="button" className="ingame-cta" onClick={enterArena}>
                    Continue to arena
                </button>
                <button
                    type="button"
                    className="ingame-ghost"
                    onClick={() => {
                        void signOut();
                        setStage("auth");
                    }}
                >
                    Use a different account
                </button>
            </div>
        );
    }

    // ── First-time wallet ready + passkey ladder ──
    if (stage === "ready" && address) {
        const showProtect = !hasPasskey && passkeySupported.data !== false;
        return (
            <div className="ingame-signin">
                <div className="ingame-ready-badge" aria-hidden>
                    <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 6L9 17l-5-5" />
                    </svg>
                </div>
                <h2 className="ingame-title">Wallet ready</h2>
                <p className="ingame-sub">Your in-game wallet is live on Base Sepolia</p>
                <div className="ingame-card">
                    <div className="ingame-card-label">Address</div>
                    <div className="ingame-card-addr font-mono">{shortAddr(address)}</div>
                    <p className="ingame-note">
                        Smart wallet for Ludo only — not your Base app or MetaMask address.
                    </p>
                </div>

                {/* Security ladder */}
                <div className="ingame-ladder" aria-label="Setup progress">
                    <span className="ingame-ladder-step done">✓ Wallet</span>
                    <span className={`ingame-ladder-step ${showProtect ? "now" : "done"}`}>
                        {showProtect ? "→ Protect" : "✓ Protect"}
                    </span>
                    <span className="ingame-ladder-step">Play</span>
                </div>

                {showProtect ? (
                    <>
                        <div className="ingame-nudge">
                            <div className="ingame-nudge-title">Add Face ID / Touch ID</div>
                            <p className="ingame-nudge-copy">
                                Confirm sends with your face or fingerprint. One tap — not another password.
                            </p>
                        </div>
                        <button
                            type="button"
                            className="ingame-cta"
                            disabled={busy || enrollStatus === "pending"}
                            onClick={onEnrollPasskey}
                        >
                            {enrollStatus === "pending" ? "Waiting for biometric…" : "Protect my wallet"}
                        </button>
                        <button type="button" className="ingame-ghost" onClick={skipProtect}>
                            Skip — I&apos;ll do this later
                        </button>
                    </>
                ) : (
                    <button type="button" className="ingame-cta" onClick={enterArena}>
                        Continue to arena
                    </button>
                )}

                {err && <p className="ingame-err">{err}</p>}
                <p className="ingame-fine">Export key stays in Wallet → Security. We never show it here.</p>
            </div>
        );
    }

    // ── Signed in but wallet address still landing ──
    if (isSignedIn && !address) {
        return (
            <div className="ingame-signin">
                <h2 className="ingame-title">Finishing setup</h2>
                <p className="ingame-sub">Your in-game wallet is being prepared…</p>
                {err && <p className="ingame-err">{err}</p>}
                <button
                    type="button"
                    className="ingame-cta"
                    disabled={busy}
                    onClick={() => {
                        if (id.cdpSmartAccount || id.cdpOwnerEoa) {
                            setStage("ready");
                        } else {
                            setErr("Wallet not ready yet. Try again in a second.");
                        }
                    }}
                >
                    Continue
                </button>
                <button
                    type="button"
                    className="ingame-ghost"
                    onClick={() => {
                        void signOut();
                        setStage("auth");
                        setErr(null);
                    }}
                >
                    Sign out
                </button>
            </div>
        );
    }

    // ── Auth: socials + email → OTP ──
    const otpStage = Boolean(flowId);

    return (
        <div className="ingame-signin">
            {onBack && (
                <button type="button" className="ingame-back" onClick={onBack} aria-label="Back">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M15 18l-6-6 6-6" />
                    </svg>
                </button>
            )}

            <h2 className="ingame-title">Sign In</h2>
            <p className="ingame-sub">Your in-game wallet</p>

            <div className="ingame-socials" role="group" aria-label="Social sign in">
                {SOCIALS.map((s) => (
                    <button
                        key={s.id}
                        type="button"
                        className="ingame-social"
                        title={s.label}
                        aria-label={`Continue with ${s.label}`}
                        disabled={busy}
                        onClick={() => {
                            void (async () => {
                                if (!isCdpAuthEnabled()) {
                                    setErr("Sign-in is not configured (missing CDP project id on this deploy).");
                                    return;
                                }
                                setBusy(true);
                                setErr(null);
                                writeWalletMode("ingame");
                                try {
                                    await signInWithOAuth(s.id);
                                    // Redirect / popup path — success flips stage via effect on return.
                                } catch (e) {
                                    const msg = e instanceof Error ? e.message : String(e);
                                    if (/already authenticated/i.test(msg)) {
                                        if (id.address) {
                                            setStage(hasSeenWalletReady(id.address) ? "welcome" : "ready");
                                        } else {
                                            setErr("Already signed in — finishing wallet setup.");
                                        }
                                    } else {
                                        setErr(msg);
                                    }
                                } finally {
                                    setBusy(false);
                                }
                            })();
                        }}
                    >
                        {s.icon}
                    </button>
                ))}
            </div>
            {busy && <p className="ingame-hint" style={{ textAlign: "center" }}>Opening provider…</p>}

            <div className="ingame-divider">
                <span>or create in-game wallet using your email</span>
            </div>

            <label className="ingame-field">
                <span className="ingame-field-label">{otpStage ? "Verification code" : "Email"}</span>
                {otpStage ? (
                    <input
                        className="ingame-input"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        placeholder="6-digit code"
                        value={otp}
                        onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                        maxLength={6}
                        autoFocus
                    />
                ) : (
                    <input
                        className="ingame-input"
                        type="email"
                        autoComplete="email"
                        placeholder="Email address"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") void sendOtp();
                        }}
                    />
                )}
            </label>

            {otpStage && (
                <div className="ingame-row">
                    <span className="ingame-hint">Code sent to {email}</span>
                    <button
                        type="button"
                        className="ingame-link"
                        disabled={busy}
                        onClick={() => {
                            setFlowId(null);
                            setOtp("");
                            setErr(null);
                        }}
                    >
                        Change email
                    </button>
                </div>
            )}

            {err && <p className="ingame-err">{err}</p>}

            <button
                type="button"
                className="ingame-cta"
                disabled={busy || (otpStage ? otp.length < 6 : !email.trim())}
                onClick={otpStage ? confirmOtp : sendOtp}
            >
                {busy ? "Please wait…" : otpStage ? "Create in-game wallet" : "Send code"}
            </button>

            {otpStage && (
                <button type="button" className="ingame-ghost" disabled={busy} onClick={sendOtp}>
                    Resend code
                </button>
            )}

            <p className="ingame-fine">Email or Google · no extension · not your Base app wallet.</p>
        </div>
    );
}
