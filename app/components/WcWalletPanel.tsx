"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import QRCode from "qrcode";
import { usePlayerSigner } from "@/hooks/usePlayerSigner";
import {
    buildApproveSession,
    getWalletKit,
    isAllowedChain,
    summarizeProposal,
    type PendingProposal,
    type PendingRequest,
} from "@/lib/wcWallet";

/**
 * W5 UI — Ludo as WalletConnect wallet.
 * Paste `wc:` URI from a dapp (or open /wc?uri=). Never auto-approves.
 */
export default function WcWalletPanel() {
    const player = usePlayerSigner();
    const [uri, setUri] = useState("");
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState<string | null>(null);
    const [proposals, setProposals] = useState<PendingProposal[]>([]);
    const [requests, setRequests] = useState<PendingRequest[]>([]);
    const [sessions, setSessions] = useState<{ topic: string; peer: string; chains: string[] }[]>([]);
    const [qrData, setQrData] = useState<string | null>(null);

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
                const approve = buildApproveSession(proposal, [address]);
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
                        const params = req.params as string[];
                        const messageHex = params[0];
                        // Decode hex → string if possible for signer message API
                        const message =
                            messageHex?.startsWith("0x")
                                ? new TextDecoder().decode(
                                      Uint8Array.from(
                                          messageHex
                                              .slice(2)
                                              .match(/.{1,2}/g)!
                                              .map((b) => parseInt(b, 16)),
                                      ),
                                  )
                                : String(messageHex);
                        result = await player.signMessageAsync({
                            account: address as `0x${string}`,
                            message,
                        });
                    } else if (req.method === "eth_signTypedData_v4") {
                        const params = req.params as [string, string];
                        const parsed = JSON.parse(params[1]);
                        result = await player.signTypedDataAsync({
                            account: address as `0x${string}`,
                            domain: parsed.domain,
                            types: parsed.types,
                            primaryType: parsed.primaryType,
                            message: parsed.message,
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
        <div className="space-y-4">
            <div>
                <h4 className="text-[11px] font-black uppercase tracking-[0.25em] text-white/70">
                    Connect to a dapp (WalletConnect)
                </h4>
                <p className="text-[11px] text-white/45 mt-1 leading-relaxed">
                    Paste the <code>wc:</code> link from Uniswap / another dapp. You approve every session
                    and request — nothing is auto-signed. Base chains only.
                </p>
                <div className="flex gap-2 mt-2">
                    <input
                        className="flex-1 rounded-lg border border-white/20 bg-black/40 px-2 py-2 text-[10px] font-mono"
                        placeholder="wc:..."
                        value={uri}
                        onChange={(e) => setUri(e.target.value)}
                    />
                    <button
                        type="button"
                        className="rounded-lg bg-cyan-500/20 border border-cyan-400/40 px-3 py-2 text-[11px] font-bold uppercase"
                        disabled={busy}
                        onClick={onPair}
                    >
                        Pair
                    </button>
                </div>
                {qrData && (
                    <img src={qrData} alt="WalletConnect URI QR" className="mt-2 rounded-lg bg-white p-1" width={140} height={140} />
                )}
            </div>

            {proposals.length > 0 && (
                <div>
                    <h4 className="text-[11px] font-black uppercase tracking-[0.25em] text-white/70">
                        Session proposals
                    </h4>
                    {proposals.map((p) => (
                        <div key={p.id} className="mt-2 rounded-xl border border-white/10 p-3 text-[11px]">
                            <div className="font-bold">{p.proposerName}</div>
                            <div className="text-white/50 break-all">{p.proposerUrl}</div>
                            <div className="text-white/45 mt-1">
                                chains: {[...p.requiredChains, ...p.optionalChains].join(", ") || "eip155"}
                                <br />
                                methods: {[...p.requiredMethods, ...p.optionalMethods].join(", ")}
                            </div>
                            <div className="flex gap-2 mt-2">
                                <button
                                    type="button"
                                    className="rounded-lg bg-cyan-500/20 border border-cyan-400/40 px-3 py-1.5 uppercase font-bold"
                                    disabled={busy}
                                    onClick={() => onApproveProposal(p.id)}
                                >
                                    Approve
                                </button>
                                <button
                                    type="button"
                                    className="rounded-lg border border-white/15 px-3 py-1.5 uppercase"
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

            {requests.length > 0 && (
                <div>
                    <h4 className="text-[11px] font-black uppercase tracking-[0.25em] text-white/70">
                        Requests
                    </h4>
                    {requests.map((r) => (
                        <div key={r.id} className="mt-2 rounded-xl border border-white/10 p-3 text-[11px]">
                            <div className="font-bold">
                                {r.method} · {r.peerName}
                            </div>
                            <div className="text-white/50 font-mono break-all">
                                {r.chainId} · {JSON.stringify(r.params).slice(0, 120)}…
                            </div>
                            <div className="flex gap-2 mt-2">
                                <button
                                    type="button"
                                    className="rounded-lg bg-cyan-500/20 border border-cyan-400/40 px-3 py-1.5 uppercase font-bold"
                                    disabled={busy}
                                    onClick={() => onRespondRequest(r, true)}
                                >
                                    Sign
                                </button>
                                <button
                                    type="button"
                                    className="rounded-lg border border-white/15 px-3 py-1.5 uppercase"
                                    disabled={busy}
                                    onClick={() => onRespondRequest(r, false)}
                                >
                                    Reject
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {sessions.length > 0 && (
                <div>
                    <h4 className="text-[11px] font-black uppercase tracking-[0.25em] text-white/70">
                        Active sessions
                    </h4>
                    <ul className="mt-1 space-y-1">
                        {sessions.map((s) => (
                            <li key={s.topic} className="text-[11px] text-white/70 flex justify-between gap-2">
                                <span className="truncate">
                                    {s.peer} · {s.chains.join(", ")}
                                </span>
                                <button
                                    type="button"
                                    className="text-red-300/80 uppercase text-[10px]"
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
                                    Disconnect
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {msg && <p className="text-[11px] text-white/60">{msg}</p>}
            {!address && (
                <p className="text-[11px] text-amber-200/80">Sign in first so we know which address to expose.</p>
            )}
        </div>
    );
}
