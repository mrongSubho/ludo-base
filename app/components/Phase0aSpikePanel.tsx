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
import { useCdpParentSigner } from "@/hooks/useCdpParentSigner";
import {
    APP_SESSION_TTL_MS,
    buildMatchSessionPayload,
    buildSessionDomain,
    buildSiweMessage,
    LUDO_SESSION_TYPES,
} from "@/lib/sessionProof";
import { parseChainId, DEFAULT_CHAIN_ID } from "@/lib/chains";

const CHAIN_ID = 84532; // Base Sepolia for Phase 0a

type StepResult = { ok: boolean; detail: string };

/**
 * Phase 0a spike console — parent-signed Ludo SIWE + match-session EIP-712.
 * No sub-accounts, no spend permissions, no value transfers.
 * Checklist: docs/planning/PHASE_0A_SPIKE_CHECKLIST.md §C.
 */
export default function Phase0aSpikePanel() {
    const { isSignedIn } = useIsSignedIn();
    const { currentUser } = useCurrentUser();
    const { signInWithEmail } = useSignInWithEmail();
    const { verifyEmailOTP } = useVerifyEmailOTP();
    const { signInWithOAuth } = useSignInWithOAuth();
    const { signOut } = useSignOut();
    const parent = useCdpParentSigner();

    const [email, setEmail] = useState("");
    const [otp, setOtp] = useState("");
    const [flowId, setFlowId] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [siwe, setSiwe] = useState<StepResult | null>(null);
    const [eip712, setEip712] = useState<StepResult | null>(null);
    const [move, setMove] = useState<StepResult | null>(null);
    const [log, setLog] = useState<string[]>([]);

    const note = useCallback((line: string) => {
        setLog((prev) => [`${new Date().toISOString().slice(11, 19)} ${line}`, ...prev].slice(0, 40));
    }, []);

    const sendOtp = useCallback(async () => {
        if (!email) return;
        setBusy(true);
        try {
            const r = await signInWithEmail({ email });
            setFlowId(r.flowId);
            note("OTP sent — check email (10 min expiry)");
        } catch (e) {
            note(`OTP send failed: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
            setBusy(false);
        }
    }, [email, signInWithEmail, note]);

    const confirmOtp = useCallback(async () => {
        if (!flowId || !otp) return;
        setBusy(true);
        try {
            const r = await verifyEmailOTP({ flowId, otp });
            note(
                `signed in userId=${r.user.userId} smart=${r.user.evmSmartAccountObjects?.[0]?.address ?? "none"} eoa=${r.user.evmAccountObjects?.[0]?.address ?? "none"}`,
            );
            setFlowId(null);
            setOtp("");
        } catch (e) {
            note(`OTP verify failed: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
            setBusy(false);
        }
    }, [flowId, otp, verifyEmailOTP, note]);

    const runSiwe = useCallback(async () => {
        if (!parent.address) {
            setSiwe({ ok: false, detail: "no parent smart account" });
            return;
        }
        setBusy(true);
        try {
            const domain = window.location.hostname;
            const issuedAt = new Date().toISOString();
            const expirationTime = new Date(Date.now() + APP_SESSION_TTL_MS).toISOString();
            const nonce = crypto.randomUUID();
            const chainId = parseChainId(CHAIN_ID) ?? DEFAULT_CHAIN_ID;
            const message = buildSiweMessage({
                domain,
                address: parent.address,
                issuedAt,
                expirationTime,
                nonce,
                chainId,
            });
            const signature = await parent.signMessageAsync({
                account: parent.address as `0x${string}`,
                message,
            });
            note(`SIWE signed as parent ${parent.address}`);
            const res = await fetch("/api/siwe/verify", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    domain,
                    address: parent.address,
                    nonce,
                    issuedAt,
                    expirationTime,
                    signature,
                    message,
                    chainId,
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok && data.sessionId) {
                setSiwe({ ok: true, detail: `sessionId=${data.sessionId}` });
                note("C2 PASS — /api/siwe/verify 200");
            } else {
                setSiwe({
                    ok: false,
                    detail: `HTTP ${res.status} code=${data.code ?? "?"} ${JSON.stringify(data).slice(0, 120)}`,
                });
                note(`C2 FAIL — ${res.status}`);
            }
        } catch (e) {
            setSiwe({ ok: false, detail: e instanceof Error ? e.message : String(e) });
            note("C2 exception");
        } finally {
            setBusy(false);
        }
    }, [parent, note]);

    const runEip712 = useCallback(async () => {
        if (!parent.address) {
            setEip712({ ok: false, detail: "no parent smart account" });
            return;
        }
        setBusy(true);
        try {
            const domain = buildSessionDomain(CHAIN_ID);
            const payload = buildMatchSessionPayload({
                wallet: parent.address,
                matchId: `spike-${Date.now()}`,
                roomCode: "SPIKE0",
            });
            const signature = await parent.signTypedDataAsync({
                account: parent.address as `0x${string}`,
                domain,
                types: LUDO_SESSION_TYPES as never,
                primaryType: "LudoMatchSession",
                message: {
                    wallet: payload.wallet as `0x${string}`,
                    matchId: payload.matchId,
                    roomCode: payload.roomCode,
                    expiresAt: BigInt(payload.expiresAt),
                    nonce: payload.nonce,
                },
            });
            setEip712({
                ok: true,
                detail: `sig=${signature.slice(0, 20)}… (parent ${parent.address})`,
            });
            note("C3 signed LudoMatchSession EIP-712 as parent (verify via Edge move-auth next)");
        } catch (e) {
            setEip712({ ok: false, detail: e instanceof Error ? e.message : String(e) });
            note("C3 FAIL — typed-data sign/reject");
        } finally {
            setBusy(false);
        }
    }, [parent, note]);

    const runMoveProof = useCallback(async () => {
        if (!parent.address) {
            setMove({ ok: false, detail: "no parent smart account" });
            return;
        }
        setBusy(true);
        try {
            const message = [
                "Ludo Base move",
                "Phase 0a parent-sign spike (no game state).",
                `actor: ${parent.address.toLowerCase()}`,
                `color: green`,
                `token: 0`,
                `roll: spike`,
                `seq: 0`,
                `issued: ${new Date().toISOString()}`,
            ].join("\n");
            const signature = await parent.signMessageAsync({
                account: parent.address as `0x${string}`,
                message,
            });
            setMove({ ok: true, detail: `sig=${signature.slice(0, 20)}…` });
            note("C4 parent personal_sign move-proof OK (server verify optional)");
        } catch (e) {
            setMove({ ok: false, detail: e instanceof Error ? e.message : String(e) });
            note("C4 FAIL");
        } finally {
            setBusy(false);
        }
    }, [parent, note]);

    return (
        <div className="ludo-wallet-scope rounded-2xl border border-white/10 bg-black/40 p-6 max-w-xl space-y-4 text-sm text-white/90">
            <div>
                <h2 className="text-base font-bold uppercase tracking-wider">Phase 0a — CDP parent-sign spike</h2>
                <p className="text-white/50 text-xs mt-1">
                    Identity = parent Smart Account only. No sub-accounts · no spend permissions · no value.
                </p>
            </div>

            <div className="rounded-lg border border-white/10 p-3 space-y-1 font-mono text-xs">
                <div>projectId: {(process.env.NEXT_PUBLIC_CDP_PROJECT_ID || "").slice(0, 8)}…</div>
                <div>parent (smart): {parent.address ?? "—"}</div>
                <div>owner EOA (do not use as id): {parent.ownerEoa ?? "—"}</div>
                <div>userId: {currentUser?.userId ?? "—"}</div>
            </div>

            {!isSignedIn ? (
                <div className="space-y-2">
                    <div className="flex gap-2">
                        <input
                            className="flex-1 rounded border border-white/20 bg-black/30 px-2 py-1"
                            placeholder="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                        />
                        <button
                            className="rounded bg-cyan-500/20 border border-cyan-400/40 px-3 py-1 uppercase"
                            disabled={busy || !email}
                            onClick={sendOtp}
                        >
                            OTP
                        </button>
                    </div>
                    {flowId && (
                        <div className="flex gap-2">
                            <input
                                className="flex-1 rounded border border-white/20 bg-black/30 px-2 py-1"
                                placeholder="6-digit code"
                                value={otp}
                                onChange={(e) => setOtp(e.target.value)}
                            />
                            <button
                                className="rounded bg-cyan-500/20 border border-cyan-400/40 px-3 py-1 uppercase"
                                disabled={busy || otp.length < 6}
                                onClick={confirmOtp}
                            >
                                Verify
                            </button>
                        </div>
                    )}
                    <div className="flex gap-2">
                        {(["google", "apple"] as const).map((p) => (
                            <button
                                key={p}
                                className="rounded border border-white/20 px-3 py-1 uppercase"
                                disabled={busy}
                                onClick={() => signInWithOAuth(p)}
                            >
                                {p}
                            </button>
                        ))}
                    </div>
                </div>
            ) : (
                <div className="space-y-3">
                    <div className="flex gap-2">
                        <button
                            className="rounded bg-cyan-500/20 border border-cyan-400/40 px-3 py-1 uppercase"
                            disabled={busy || !parent.address}
                            onClick={runSiwe}
                        >
                            C2 · Ludo SIWE
                        </button>
                        <button
                            className="rounded bg-cyan-500/20 border border-cyan-400/40 px-3 py-1 uppercase"
                            disabled={busy || !parent.address}
                            onClick={runEip712}
                        >
                            C3 · Match EIP-712
                        </button>
                        <button
                            className="rounded bg-cyan-500/20 border border-cyan-400/40 px-3 py-1 uppercase"
                            disabled={busy || !parent.address}
                            onClick={runMoveProof}
                        >
                            C4 · Move sign
                        </button>
                        <button
                            className="rounded border border-white/20 px-3 py-1 uppercase"
                            disabled={busy}
                            onClick={() => signOut()}
                        >
                            Out
                        </button>
                    </div>
                    <div className="space-y-1 text-xs">
                        {siwe && (
                            <div className={siwe.ok ? "text-emerald-300" : "text-red-300"}>
                                SIWE: {siwe.ok ? "PASS" : "FAIL"} — {siwe.detail}
                            </div>
                        )}
                        {eip712 && (
                            <div className={eip712.ok ? "text-emerald-300" : "text-red-300"}>
                                EIP-712: {eip712.ok ? "PASS" : "FAIL"} — {eip712.detail}
                            </div>
                        )}
                        {move && (
                            <div className={move.ok ? "text-emerald-300" : "text-red-300"}>
                                Move: {move.ok ? "PASS" : "FAIL"} — {move.detail}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {log.length > 0 && (
                <pre className="text-[10px] text-white/40 whitespace-pre-wrap max-h-32 overflow-auto">
                    {log.join("\n")}
                </pre>
            )}
        </div>
    );
}
