"use client";

import React, { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { LuX, LuShield } from "react-icons/lu";
import { useAppSession } from "@/hooks/useAppSession";
import type { ClanProfileDossier } from "@/lib/clan/types";
import { ClanDossierContent } from "@/app/components/clan/ClanDossierContent";

interface ClanProfileModalProps {
    isOpen: boolean;
    clanIdOrTag: string | null;
    onClose: () => void;
    onJoined?: () => void;
    onInspectMember?: (wallet: string) => void;
}

export default function ClanProfileModal({
    isOpen,
    clanIdOrTag,
    onClose,
    onJoined,
    onInspectMember,
}: ClanProfileModalProps) {
    const { peekAppSession, ensureAppSession } = useAppSession();
    const [activeTarget, setActiveTarget] = useState<string | null>(clanIdOrTag);
    const [dossier, setDossier] = useState<ClanProfileDossier | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setActiveTarget(clanIdOrTag);
    }, [clanIdOrTag]);

    const loadDossier = useCallback(
        async (target: string) => {
            setIsLoading(true);
            setError(null);
            try {
                const sid = peekAppSession();
                const headers: Record<string, string> = {};
                if (sid) headers.Authorization = `Bearer ${sid}`;
                const res = await fetch(`/api/clans?profile=${encodeURIComponent(target)}`, {
                    headers,
                    cache: "no-store",
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok || !data.dossier) {
                    throw new Error(data.error || "Syndicate dossier not found");
                }
                setDossier(data.dossier as ClanProfileDossier);
            } catch (err) {
                setDossier(null);
                setError(err instanceof Error ? err.message : "Failed to load syndicate dossier");
            } finally {
                setIsLoading(false);
            }
        },
        [peekAppSession],
    );

    useEffect(() => {
        if (!isOpen || !activeTarget) {
            setDossier(null);
            setError(null);
            return;
        }
        void loadDossier(activeTarget);
    }, [isOpen, activeTarget, loadDossier]);

    useEffect(() => {
        if (!isOpen) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [isOpen, onClose]);

    const handleJoinRequest = async (clanId: string) => {
        const sid = await ensureAppSession();
        if (!sid) {
            throw new Error("Please sign in to apply to a clan");
        }
        const res = await fetch("/api/clans/action", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${sid}`,
            },
            body: JSON.stringify({
                action: "request_join",
                clanId,
                sessionId: sid,
            }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data.error || "Failed to send join request");
        }
        await loadDossier(clanId);
        onJoined?.();
    };

    return (
        <AnimatePresence>
            {isOpen && activeTarget && (
                <>
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="fixed inset-0 z-[205] bg-black/70 backdrop-blur-sm"
                    />

                    <motion.div
                        initial={{ opacity: 0, scale: 0.96, y: 12 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.96, y: 10 }}
                        transition={{ duration: 0.18 }}
                        className="ludo-pubprofile-scope ludo-clan-scope fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-24px)] max-w-2xl max-h-[86dvh] overflow-hidden border border-line rounded-3xl z-[215] shadow-2xl flex flex-col"
                        style={{
                            backgroundImage: "var(--panel-bg-image, var(--ludo-bg-cosmic))",
                            backgroundColor: "var(--panel-bg, #0b111c)",
                            backdropFilter: "blur(32px)",
                        }}
                        role="dialog"
                        aria-modal="true"
                        aria-label="Syndicate Public Dossier"
                    >
                        {/* Modal Header */}
                        <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-line bg-surface/60">
                            <div className="flex items-center gap-2">
                                <span className="w-7 h-7 rounded-lg bg-accent-soft border border-accent-line flex items-center justify-center text-accent">
                                    <LuShield className="w-4 h-4" />
                                </span>
                                <div>
                                    <div className="text-ludo-xs uppercase tracking-wider font-mono text-ink-soft">
                                        Syndicate Scout Dossier
                                    </div>
                                    <div className="text-ludo-sm font-bold text-ink">
                                        {dossier ? `[${dossier.clan.tag}] ${dossier.clan.name}` : activeTarget}
                                    </div>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={onClose}
                                className="w-8 h-8 rounded-full border border-line bg-surface flex items-center justify-center text-ink-soft hover:text-ink transition-colors"
                                aria-label="Close syndicate dossier"
                            >
                                <LuX className="w-4 h-4" />
                            </button>
                        </div>

                        {/* Scrollable Body */}
                        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                            {isLoading && !dossier ? (
                                <div className="py-12 text-center space-y-2">
                                    <div className="w-8 h-8 rounded-full border-2 border-accent border-t-transparent animate-spin mx-auto" />
                                    <div className="text-ludo-xs font-mono text-ink-soft uppercase tracking-wider">
                                        Decrypting Syndicate Dossier...
                                    </div>
                                </div>
                            ) : error ? (
                                <div className="rounded-xl border border-rose-500/35 bg-rose-500/10 p-5 text-center space-y-2">
                                    <div className="text-ludo-sm font-bold text-rose-300">{error}</div>
                                    <button
                                        type="button"
                                        onClick={() => void loadDossier(activeTarget)}
                                        className="px-3 py-1.5 rounded-lg bg-surface border border-line text-ludo-xs font-mono font-bold text-ink"
                                    >
                                        Retry Lookup
                                    </button>
                                </div>
                            ) : dossier ? (
                                <ClanDossierContent
                                    dossier={dossier}
                                    mode="public"
                                    onJoinRequest={handleJoinRequest}
                                    onInspectMember={onInspectMember}
                                    onInspectClan={(nextTarget) => setActiveTarget(nextTarget)}
                                    onRefresh={() => loadDossier(activeTarget)}
                                />
                            ) : null}
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
