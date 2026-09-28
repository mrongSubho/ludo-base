"use client";
/* eslint-disable @typescript-eslint/no-explicit-any -- WalletKit wire types; typed burn-down */

import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import { usePlayerSigner } from "@/hooks/usePlayerSigner";
import { useSendTransaction } from "wagmi";
import { useCdpUserOp } from "@/hooks/useCdpUserOp";
import QrScanButton from "./QrScanButton";
import {
    buildApproveSession,
    decodeSignMessage,
    getWalletKit,
    isAllowedChain,
    isUnlimitedOrHighRiskCalldata,
    parsePersonalSignParams,
    summarizeProposal,
    type PendingProposal,
    type PendingRequest,
} from "@/lib/wcWallet";
import { decodeCallsList, extractCalls } from "@/lib/wcDecode";
import { sessionExpiryParts } from "@/lib/wcExpiry";

/**
 * W5 UI — Ludo as WalletConnect wallet.
 * Paste `wc:` URI from a dapp (or open /wc?uri=). Never auto-approves.
 */
export default function WcWalletPanel() {
    const player = usePlayerSigner();
    const cdpUserOp = useCdpUserOp();
    const { sendTransactionAsync } = useSendTransaction();
    const [uri, setUri] = useState("");
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState<string | null>(null);
    const [proposals, setProposals] = useState<PendingProposal[]>([]);
    const [requests, setRequests] = useState<PendingRequest[]>([]);
    const [sessions, setSessions] = useState<
        { topic: string; peer: string; chains: string[]; expiry?: number }[]
    >([]);
    const [qrData, setQrData] = useState<string | null>(null);
    /** Tick for WC session expiry countdown (R3). */
    const [nowMs, setNowMs] = useState(() => Date.now());

    const address = player.address;

    const refresh = useCallback(async () => {
        try {
            const kit = await getWalletKit();
            const active = kit.getActiveSessions();
            setSessions(
                Object.values(active).map((s: any) => ({
                    topic: s.topic,
                    peer: s.peer?.metadata?.name || "dapp",
                    chains: Object.values(s.namespaces ?? {}).flatMap((n: any) => n?.chains ?? []),
                    // WalletConnect session expiry (unix seconds)
                    expiry: typeof s.expiry === "number" ? s.expiry : undefined,
                })),
            );
        } catch {
            /* not inited */
        }
    }, []);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    useEffect(() => {
        const t = window.setInterval(() => setNowMs(Date.now()), 1000);
        return () => window.clearInterval(t);
    }, []);

    useEffect(() => {
        let mounted = true;
        (async () => {
            try {
                const kit = await getWalletKit();
                kit.on("session_proposal", (proposal: any) => {
                    if (!mounted) return;
                    const s = summarizeProposal(proposal);
                    setProposals((prev) => [...prev, s]);
                    setMsg(`Session proposal from ${s.proposerName} — review and approve`);
                });
                kit.on("session_request", (req: any) => {
                    if (!mounted) return;
                    const { id, topic, params, context } = req;
                    setRequests((prev) => [
                        ...prev,
                        {
                            id,
                            topic,
                            method: params?.method,
                            params: params?.params,
                            chainId: params?.chainId,
                            peerName: context?.metadata?.name || "dapp",
                        },
                    ]);
                    setMsg(`Request ${params?.method} from ${context?.metadata?.name || "dapp"}`);
                });
            } catch (e) {
                if (mounted) setMsg(e instanceof Error ? e.message : String(e));
            }
        })();
        return () => {
            mounted = false;
        };
    }, []);

    const onPair = useCallback(async () => {
        if (!uri.trim().startsWith("wc:")) {
            setMsg("Paste a WalletConnect URI starting with wc:");
            return;
        }
        setBusy(true);
        setMsg(null);
        try {
            const kit = await getWalletKit();
            await kit.pair({ uri: uri.trim() });
            setMsg("Paired — wait for the dapp session proposal, then approve below.");
            setUri("");
            await refresh();
        } catch (e) {
            setMsg(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    }, [uri, refresh]);

    const onApproveProposal = useCallback(
        async (id: number) => {
            if (!address) {
                setMsg("Sign in to a wallet first (in-game or external).");
                return;
            }
            setBusy(true);
            try {
                const kit = await getWalletKit();
                const proposal = (kit as any).getPendingSessionProposals?.()?.[id];
                if (!proposal) {
                    setMsg("Proposal expired");
                    setProposals((p) => p.filter((x) => x.id !== id));
                    return;
                }
                const approve = buildApproveSession(proposal, [address], player.mode);
                await kit.approveSession(approve as never);
                setProposals((p) => p.filter((x) => x.id !== id));
                setMsg("Session approved");
                await refresh();
            } catch (e) {
                setMsg(e instanceof Error ? e.message : String(e));
            } finally {
                setBusy(false);
            }
        },
        [address, refresh],
    );

    const onRejectProposal = useCallback(async (id: number) => {
        try {
            const kit = await getWalletKit();
            await kit.rejectSession({ id, reason: { code: 5000, message: "User rejected" } });
        } catch {
            /* ignore */
        }
        setProposals((p) => p.filter((x) => x.id !== id));
    }, []);

    const onRespondRequest = useCallback(
        async (req: PendingRequest, approve: boolean) => {
            setBusy(true);
            try {
                const kit = await getWalletKit();
                if (!approve) {
                    await kit.respondSessionRequest({
                        topic: req.topic,
                        response: {
                            id: req.id,
                            jsonrpc: "2.0",
                            error: { code: 5000, message: "User rejected" },
                        },
                    });
                } else {
                    if (!address) throw new Error("No wallet");
                    if (!isAllowedChain(req.chainId)) {
                        throw new Error(`Chain ${req.chainId} not allowed (Base only)`);
                    }
                    let result: unknown;
                    if (req.method === "personal_sign") {
                        const parsed = parsePersonalSignParams(req.params);
                        const message = decodeSignMessage(parsed.message);
                        result = await player.signMessageAsync({
                            account: address as `0x${string}`,
                            message,
                        });
                    } else if (req.method === "eth_signTypedData_v4" || req.method === "eth_signTypedData") {
                        const params = req.params as [string, string];
                        const parsed = JSON.parse(params[1]);
                        result = await player.signTypedDataAsync({
                            account: address as `0x${string}`,
                            domain: parsed.domain,
                            types: parsed.types,
                            primaryType: parsed.primaryType,
                            message: parsed.message,
                        });
                    } else if (req.method === "wallet_sendCalls") {
                        if (player.mode !== "ingame") {
                            throw new Error("wallet_sendCalls for external wallet: use dapp with your extension");
                        }
                        const payload = Array.isArray(req.params) ? req.params[0] : req.params;
                        const calls = (payload?.calls ?? payload) as Array<{
                            to: `0x${string}`;
                            data?: `0x${string}`;
                            value?: string | bigint;
                        }>;
                        result = await cdpUserOp.sendCalls(
                            calls.map((c) => ({
                                to: c.to,
                                data: c.data ?? "0x",
                                value: c.value != null ? BigInt(c.value) : undefined,
                            })),
                        );
                    } else if (req.method === "eth_sendTransaction") {
                        if (player.mode !== "external") {
                            throw new Error(
                                "eth_sendTransaction for in-game wallet ships with CHIPS W4 (UserOp)",
                            );
                        }
                        const tx = Array.isArray(req.params) ? req.params[0] : req.params;
                        result = await sendTransactionAsync({
                            account: address as `0x${string}`,
                            to: tx.to as `0x${string}`,
                            value: tx.value ? BigInt(tx.value) : undefined,
                            data: tx.data as `0x${string}` | undefined,
                        });
                    } else {
                        throw new Error(`Method ${req.method} not supported in W5 v1`);
                    }
                    await kit.respondSessionRequest({
                        topic: req.topic,
                        response: { id: req.id, jsonrpc: "2.0", result },
                    });
                }
                setRequests((r) => r.filter((x) => x.id !== req.id));
                setMsg(approve ? `Approved ${req.method}` : `Rejected ${req.method}`);
            } catch (e) {
                setMsg(e instanceof Error ? e.message : String(e));
            } finally {
                setBusy(false);
            }
        },
        [address, player],
    );

    const showQrFor = useCallback(async (text: string) => {
        try {
            const url = await QRCode.toDataURL(text, { margin: 1, width: 180 });
            setQrData(url);
        } catch {
            setQrData(null);
        }
    }, []);

    useEffect(() => {
        const u = new URLSearchParams(window.location.search).get("uri");
        if (u?.startsWith("wc:")) {
            setUri(u);
            void showQrFor(u);
        }
    }, [showQrFor]);

    return (
        <div className="dapp-sheet">
            {/* Pair */}
            <div className="sec-block">
                <div className="sec-head">
                    <span>Connect</span>
                    <span className="sec-tag">WalletConnect</span>
                </div>
                <div className="sec-card">
                    <div className="dapp-pair">
                        <input
                            className="fld-text"
                            placeholder="Paste wc: link"
                            value={uri}
                            onChange={(e) => setUri(e.target.value)}
                            spellCheck={false}
                            autoComplete="off"
                        />
                        <button type="button" className="btn-main" disabled={busy} onClick={onPair}>
                            Pair
                        </button>
                    </div>
                    <div className="sec-actions">
                        <QrScanButton
                            onScan={(u) => {
                                setUri(u);
                                void showQrFor(u);
                            }}
                        />
                    </div>
                    {qrData && (
                        <img
                            src={qrData}
                            alt="WalletConnect URI QR"
                            className="dapp-qr"
                            width={132}
                            height={132}
                        />
                    )}
                </div>
            </div>

            {/* Proposals */}
            {proposals.length > 0 && (
                <div className="sec-block">
                    <div className="sec-head">
                        <span>Session requests</span>
                        <span className="sec-tag">{proposals.length}</span>
                    </div>
                    {proposals.map((p) => (
                        <div key={p.id} className="sec-card">
                            <div className="sec-row">
                                <div className="sec-text">
                                    <div className="sec-title">{p.proposerName}</div>
                                    <div className="sec-sub mono">{p.proposerUrl}</div>
                                </div>
                            </div>
                            <div className="dapp-chips">
                                {[...p.requiredChains, ...p.optionalChains].map((c) => (
                                    <span key={c} className="dapp-chip">{c}</span>
                                ))}
                                {[...p.requiredMethods, ...p.optionalMethods].slice(0, 6).map((m) => (
                                    <span key={m} className="dapp-chip soft">{m}</span>
                                ))}
                            </div>
                            <div className="sec-actions">
                                <button
                                    type="button"
                                    className="btn-mini primary"
                                    disabled={busy}
                                    onClick={() => onApproveProposal(p.id)}
                                >
                                    Approve
                                </button>
                                <button
                                    type="button"
                                    className="btn-mini ghost"
                                    disabled={busy}
                                    onClick={() => onRejectProposal(p.id)}
                                >
                                    Reject
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Requests */}
            {requests.length > 0 && (
                <div className="sec-block">
                    <div className="sec-head">
                        <span>Requests</span>
                        <span className="sec-tag">{requests.length}</span>
                    </div>
                    {requests.map((r) => {
                        const isValue =
                            r.method === "eth_sendTransaction" || r.method === "wallet_sendCalls";
                        const callPack = isValue ? decodeCallsList(extractCalls(r.params)) : null;
                        const risk = isValue
                            ? {
                                  unlimitedApprove:
                                      callPack?.unlimited ||
                                      isUnlimitedOrHighRiskCalldata(
                                          Array.isArray(r.params)
                                              ? ((r.params[0] as { data?: string })?.data ??
                                                    (r.params as { data?: string })?.data)
                                              : undefined,
                                      ).unlimitedApprove,
                              }
                            : { unlimitedApprove: false };
                        return (
                            <div key={r.id} className="sec-card">
                                <div className="sec-row">
                                    <div className="sec-text">
                                        <div className="sec-title">
                                            {r.method}
                                            {risk.unlimitedApprove ? " · risky" : ""}
                                        </div>
                                        <div className="sec-sub">
                                            {r.peerName} · {r.chainId}
                                        </div>
                                    </div>
                                    {callPack && (
                                        <span className={`sec-tag ${risk.unlimitedApprove ? "danger" : ""}`}>
                                            {callPack.valueAtRiskEth} ETH
                                        </span>
                                    )}
                                </div>
                                {callPack && (
                                    <ul className="dapp-calls">
                                        {callPack.decoded.map((c, i) => (
                                            <li key={i}>
                                                <span className="mono">{c.to}</span>
                                                <span>{c.summary}</span>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                                {!callPack && (
                                    <p className="sec-sub mono">
                                        {JSON.stringify(r.params).slice(0, 120)}…
                                    </p>
                                )}
                                {risk.unlimitedApprove && (
                                    <div className="dapp-risk">
                                        Unlimited approve — dapp can move full balance
                                    </div>
                                )}
                                <div className="sec-actions">
                                    <button
                                        type="button"
                                        className="btn-mini primary"
                                        disabled={busy}
                                        onClick={() => onRespondRequest(r, true)}
                                    >
                                        Sign
                                    </button>
                                    <button
                                        type="button"
                                        className="btn-mini ghost"
                                        disabled={busy}
                                        onClick={() => onRespondRequest(r, false)}
                                    >
                                        Reject
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Sessions */}
            {sessions.length > 0 && (
                <div className="sec-block">
                    <div className="sec-head">
                        <span>Active</span>
                        <button
                            type="button"
                            className="lnk danger"
                            disabled={busy}
                            onClick={async () => {
                                try {
                                    const kit = await getWalletKit();
                                    await Promise.all(
                                        sessions.map((s) =>
                                            kit.disconnectSession({
                                                topic: s.topic,
                                                reason: { code: 6000, message: "Disconnect all" },
                                            }),
                                        ),
                                    );
                                    await refresh();
                                    setMsg("Disconnected all sessions");
                                } catch (e) {
                                    setMsg(e instanceof Error ? e.message : String(e));
                                }
                            }}
                        >
                            Disconnect all
                        </button>
                    </div>
                    <div className="sec-card">
                        <ul className="sec-list">
                            {sessions.map((s) => {
                                const exp = sessionExpiryParts(s.expiry, nowMs);
                                return (
                                    <li key={s.topic} className="sec-row">
                                        <div className="sec-text">
                                            <div className="sec-title">{s.peer}</div>
                                            <div className="sec-sub">
                                                {s.chains.join(", ")}
                                                {exp ? ` · ${exp.expired ? "expired" : exp.label}` : ""}
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            className="btn-mini danger-ghost"
                                            disabled={busy}
                                            onClick={async () => {
                                                try {
                                                    const kit = await getWalletKit();
                                                    await kit.disconnectSession({
                                                        topic: s.topic,
                                                        reason: { code: 6000, message: "User disconnected" },
                                                    });
                                                    await refresh();
                                                } catch {
                                                    /* ignore */
                                                }
                                            }}
                                        >
                                            End
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                </div>
            )}

            {msg && <p className="ok-inline">{msg}</p>}
            {!address && (
                <p className="sec-sub pad">Sign in to expose an address to dapps.</p>
            )}
        </div>
    );
}
