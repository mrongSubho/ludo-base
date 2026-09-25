"use client";

import { useCallback, useState } from "react";
import {
    useCurrentUser,
    useIsSignedIn,
    useSignInWithSiwe,
    useSignOut,
    useVerifySiweSignature,
} from "@coinbase/cdp-hooks";
import { useBaseAccountSigner } from "@/hooks/useBaseAccountSigner";
import { resolvePlayerIdentity } from "@/lib/playerIdentity";
import { getGuestId, migrateGuestStash } from "@/lib/guest";
import {
    APP_SESSION_TTL_MS,
    buildMatchSessionPayload,
    buildSessionDomain,
    buildSiweMessage,
    LUDO_SESSION_TYPES,
} from "@/lib/sessionProof";
import { parseChainId, DEFAULT_CHAIN_ID } from "@/lib/chains";

const CHAIN_ID = 84532;

type StepResult = { ok: boolean; detail: string };

/**
 * Phase 1 — Option A: Continue with Base. Player id = Base Account
 * (`authenticationMethods.siwe.address`) — same as Base app.
 */
export default function Phase0aSpikePanel() {
    useIsSignedIn();
    const { currentUser } = useCurrentUser();
    const { signInWithSiwe } = useSignInWithSiwe();
    const { verifySiweSignature } = useVerifySiweSignature();
    const { signOut } = useSignOut();
    const baseSigner = useBaseAccountSigner();

    const [busy, setBusy] = useState(false);
    const [baseId, setBaseId] = useState<string | null>(null);
    const [auth, setAuth] = useState<StepResult | null>(null);
    const [siwe, setSiwe] = useState<StepResult | null>(null);
    const [eip712, setEip712] = useState<StepResult | null>(null);
    const [move, setMove] = useState<StepResult | null>(null);
    const [log, setLog] = useState<string[]>([]);

    const note = useCallback((line: string) => {
        setLog((prev) =>
            [`${new Date().toISOString().slice(11, 19)} ${line}`, ...prev].slice(0, 40),
        );
    }, []);

    const id = resolvePlayerIdentity(currentUser);
    // Option A: Base Account from @base-org/account is the player id.
    // CDP user.siwe.address is optional (CDP verify wants ERC-191; smart wallets wrap 1271).
    const playerId = baseId ?? id.address ?? undefined;

    const continueWithBase = useCallback(async () => {
        setBusy(true);
        try {
            // Must use hook connect() so signMessageAsync's parent guard is armed.
            const address = await baseSigner.connect();
            setBaseId(address);
            note(`Base Account connected ${address}`);
            const guest = getGuestId();
            if (guest && migrateGuestStash(guest, address)) {
                note(`guest stash migrated ${guest} -> ${address}`);
            }

            // Optional CDP session (diagnostic only). Smart-wallet personal_sign
            // returns an ERC-1271 wrap (~4k bytes); CDP verifySiweSignature expects
            // ERC-191 ECDSA and will report "Invalid signature". That must not
            // block Option A — Ludo SIWE (C2) verifies 1271/6492 server-side.
            try {
                const domain = window.location.host;
                const uri = `${window.location.origin}/`;
                note(`SIWE domain=${domain} uri=${uri}`);
                const { message, flowId } = await signInWithSiwe({
                    address: address as `0x${string}`,
                    chainId: CHAIN_ID,
                    domain,
                    uri,
                });
                const signature = await baseSigner.signMessageAsync({
                    account: address as `0x${string}`,
                    message,
                });
                note(`signed msg len=${message.length} sigLen=${signature.length}`);
                const { user } = await verifySiweSignature({
                    flowId,
                    signature: signature as `0x${string}`,
                });
                const resolved = resolvePlayerIdentity(user);
                note(
                    resolved.address
                        ? `CDP SIWE OK ${resolved.address}`
                        : "CDP SIWE user without siwe.address",
                );
            } catch (cdpErr) {
                const msg =
                    cdpErr instanceof Error
                        ? cdpErr.message
                        : typeof cdpErr === "object"
                          ? JSON.stringify(cdpErr)
                          : String(cdpErr);
                note(`CDP SIWE skipped (smart-wallet wrap) — ${msg}`);
            }

            setAuth({
                ok: true,
                detail: `player=${address} (Base Account) · ready for C2–C4`,
            });
            note(`Continue with Base PASS ${address}`);
        } catch (e) {
            const msg =
                e instanceof Error
                    ? e.message
                    : typeof e === "object"
                      ? JSON.stringify(e)
                      : String(e);
            setAuth({ ok: false, detail: msg });
            note(`Continue with Base FAIL — ${msg}`);
        } finally {
            setBusy(false);
        }
    }, [signInWithSiwe, verifySiweSignature, baseSigner, note]);

    const runSiwe = useCallback(async () => {
        if (!playerId) {
            setSiwe({ ok: false, detail: "no Base Account id" });
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
                address: playerId,
                issuedAt,
                expirationTime,
                nonce,
                chainId,
            });
            const signature = await baseSigner.signMessageAsync({
                account: playerId as `0x${string}`,
                message,
            });
            note(`Ludo SIWE signed as ${playerId}`);
            const res = await fetch("/api/siwe/verify", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    domain,
                    address: playerId,
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
                setSiwe({ ok: false, detail: `HTTP ${res.status} code=${data.code ?? "?"}` });
                note(`C2 FAIL — ${res.status}`);
            }
        } catch (e) {
            setSiwe({ ok: false, detail: e instanceof Error ? e.message : String(e) });
            note("C2 exception");
        } finally {
            setBusy(false);
        }
    }, [playerId, baseSigner, note]);

    const runEip712 = useCallback(async () => {
        if (!playerId) {
            setEip712({ ok: false, detail: "no Base Account id" });
            return;
        }
        setBusy(true);
        try {
            const domain = buildSessionDomain(CHAIN_ID);
            const payload = buildMatchSessionPayload({
                wallet: playerId,
                matchId: `spike-${Date.now()}`,
                roomCode: "SPIKE0",
            });
            const signature = await baseSigner.signTypedDataAsync({
                account: playerId as `0x${string}`,
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
            setEip712({ ok: true, detail: `sig=${signature.slice(0, 18)}… as ${playerId}` });
            note("C3 LudoMatchSession as Base Account");
        } catch (e) {
            setEip712({ ok: false, detail: e instanceof Error ? e.message : String(e) });
            note("C3 FAIL");
        } finally {
            setBusy(false);
        }
    }, [playerId, baseSigner, note]);

    const runMoveProof = useCallback(async () => {
        if (!playerId) {
            setMove({ ok: false, detail: "no Base Account id" });
            return;
        }
        setBusy(true);
        try {
            const message = [
                "Ludo Base move",
                "Phase 1 Option A Base Account spike (no game state).",
                `actor: ${playerId.toLowerCase()}`,
                "color: green",
                "token: 0",
                "roll: spike",
                "seq: 0",
                `issued: ${new Date().toISOString()}`,
            ].join("\n");
            const signature = await baseSigner.signMessageAsync({
                account: playerId as `0x${string}`,
                message,
            });
            setMove({ ok: true, detail: `sig=${signature.slice(0, 18)}…` });
            note("C4 Base Account personal_sign OK");
        } catch (e) {
            setMove({ ok: false, detail: e instanceof Error ? e.message : String(e) });
            note("C4 FAIL");
        } finally {
            setBusy(false);
        }
    }, [playerId, baseSigner, note]);

    // C2–C4 need a Base Account id only. CDP session is optional (smart-wallet wrap).
    const ready = Boolean(playerId);

    return (
        <div className="ludo-wallet-scope rounded-2xl border border-white/10 bg-black/40 p-6 max-w-xl space-y-4 text-sm text-white/90">
            <div>
                <h2 className="text-base font-bold uppercase tracking-wider">
                    Phase 1 — Continue with Base
                </h2>
                <p className="text-white/50 text-xs mt-1">
                    Option A: player id = Base Account (Base app address). Email/CDP embedded is never
                    wallet_address.
                </p>
            </div>

            <div className="rounded-lg border border-white/10 p-3 space-y-1 font-mono text-xs">
                <div>player (Base Account): {playerId ?? "—"}</div>
                <div>cdp embedded smart (diag only): {id.cdpSmartAccount ?? "—"}</div>
                <div>cdp owner EOA (never id): {id.cdpOwnerEoa ?? "—"}</div>
                <div>userId: {id.userId ?? "—"}</div>
                <div className="text-white/40">
                    proofs via @base-org/account personal_sign / eth_signTypedData_v4
                </div>
            </div>

            {!ready ? (
                <div className="space-y-2">
                    <button
                        className="rounded bg-cyan-500/20 border border-cyan-400/40 px-4 py-2 uppercase font-bold"
                        disabled={busy}
                        onClick={continueWithBase}
                    >
                        Continue with Base
                    </button>
                    <p className="text-white/40 text-xs">
                        Signs in with your Base Account (keys.coinbase.com / Base app). Same address in
                        Ludo Base and the Base app.
                    </p>
                </div>
            ) : (
                <div className="space-y-3">
                    <div className="flex gap-2 flex-wrap">
                        <button
                            className="rounded bg-cyan-500/20 border border-cyan-400/40 px-3 py-1 uppercase"
                            disabled={busy}
                            onClick={runSiwe}
                        >
                            C2 · Ludo SIWE
                        </button>
                        <button
                            className="rounded bg-cyan-500/20 border border-cyan-400/40 px-3 py-1 uppercase"
                            disabled={busy}
                            onClick={runEip712}
                        >
                            C3 · Match EIP-712
                        </button>
                        <button
                            className="rounded bg-cyan-500/20 border border-cyan-400/40 px-3 py-1 uppercase"
                            disabled={busy}
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
                        {auth && (
                            <div className={auth.ok ? "text-emerald-300" : "text-red-300"}>
                                Base: {auth.ok ? "PASS" : "FAIL"} — {auth.detail}
                            </div>
                        )}
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
