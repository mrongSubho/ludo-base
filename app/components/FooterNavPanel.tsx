"use client";

import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useIsMobileView } from '@/hooks/useIsMobileView';
import { usePreferences } from '@/hooks/usePreferences';
import { RetroArcLight } from './RetroArcLight';
import {
    ApexRankIcon,
    ArmoryCrateIcon,
    DirectiveTargetIcon,
    SquadLinkIcon,
    SyndicateShieldIcon,
} from './icons';

// Tab Type
type Tab = 'friends' | 'leaderboard' | 'mission' | 'arena' | 'marketplace' | 'settings' | 'messages' | 'wallet' | 'profile' | 'clan' | null;

// ─── Component ───────────────────────────────────────────────────────────────

interface FooterNavPanelProps {
    activeTab: Tab;
    onToggleTab: (tab: Tab) => void;
    onCloseTab: () => void;
    selectedChatId: string | null;
    onSelectChat: (id: string | null) => void;
    onOpenProfile: (address: string) => void;
}

const NAV_TABS = [
    { id: 'friends', icon: SquadLinkIcon, label: 'Friends' },
    { id: 'leaderboard', icon: ApexRankIcon, label: 'Ranking' },
    { id: 'clan', icon: SyndicateShieldIcon, label: 'Clan' },
    { id: 'mission', icon: DirectiveTargetIcon, label: 'Mission' },
    { id: 'marketplace', icon: ArmoryCrateIcon, label: 'Market' },
] as const;

export const FooterNavPanel = ({
    activeTab,
    onToggleTab,
}: FooterNavPanelProps) => {
    // Mobile: no layout spring / backdrop-blur on the active pill — those
    // stall the compositor while sandwich panels are mounting beside it.
    const isMobile = useIsMobileView();
    const { preferences } = usePreferences();
    const isRetro = preferences.theme === 'retro';

    const navRef = useRef<HTMLElement | null>(null);
    const dragStateRef = useRef<{
        pointerId: number;
        startX: number;
        startY: number;
        dragging: boolean;
    } | null>(null);
    const suppressClickRef = useRef(false);
    const [dragX, setDragX] = useState<number | null>(null);
    const [dragHoverIdx, setDragHoverIdx] = useState<number | null>(null);

    const activeIdx = NAV_TABS.findIndex((tab) => tab.id === activeTab);

    // Single source of truth for footer clearance: measure the real rendered
    // box (compact vs full breakpoint, font loading — safe-area padding included).
    useEffect(() => {
        const el = navRef.current ?? document.querySelector('.footer-nav');
        if (!el) return;
        const set = () => {
            const rect = el.getBoundingClientRect();
            const cs = window.getComputedStyle(el);
            const bottomPx = parseFloat(cs.bottom) || 0;
            const deadBottomPx =
                parseFloat(window.getComputedStyle(document.documentElement).getPropertyValue('--vv-dead-bottom')) || 0;
            const floatGap = Math.max(0, bottomPx - deadBottomPx);
            document.documentElement.style.setProperty('--footer-h', `${Math.ceil(rect.height + floatGap)}px`);
        };
        set();
        const ro = new ResizeObserver(set);
        ro.observe(el);
        const mo = new MutationObserver(set);
        mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
        window.addEventListener('resize', set);
        return () => {
            ro.disconnect();
            mo.disconnect();
            window.removeEventListener('resize', set);
        };
    }, []);

    const idxFromClientX = (clientX: number): { relX: number; idx: number } | null => {
        const el = navRef.current;
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0) return null;
        const relX = clientX - rect.left;
        const idx = Math.min(
            NAV_TABS.length - 1,
            Math.max(0, Math.round((relX / rect.width) * NAV_TABS.length - 0.5)),
        );
        return { relX, idx };
    };

    const handlePointerDown = (e: React.PointerEvent<HTMLElement>) => {
        if (!isRetro) return;
        dragStateRef.current = {
            pointerId: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            dragging: false,
        };
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLElement>) => {
        if (!isRetro) return;
        const st = dragStateRef.current;
        if (!st || st.pointerId !== e.pointerId) return;
        const dx = e.clientX - st.startX;
        const dy = e.clientY - st.startY;
        if (!st.dragging && Math.abs(dx) > 7 && Math.abs(dx) > Math.abs(dy)) {
            st.dragging = true;
            try {
                e.currentTarget.setPointerCapture?.(e.pointerId);
            } catch {
                /* ignore if synthetic event */
            }
        }
        if (st.dragging) {
            const pos = idxFromClientX(e.clientX);
            if (pos) {
                setDragX(pos.relX);
                setDragHoverIdx(pos.idx);
            }
        }
    };

    const handlePointerFinish = (e: React.PointerEvent<HTMLElement>, commitTab: boolean) => {
        const st = dragStateRef.current;
        if (!st || st.pointerId !== e.pointerId) return;
        const wasDragging = st.dragging;
        dragStateRef.current = null;
        if (!wasDragging) return;

        try {
            if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
                e.currentTarget.releasePointerCapture(e.pointerId);
            }
        } catch {
            /* ignore if capture lost */
        }

        const pos = idxFromClientX(e.clientX);
        const fallbackIdx = dragHoverIdx ?? (activeIdx >= 0 ? activeIdx : 0);
        const targetIdx = pos ? pos.idx : fallbackIdx;

        setDragX(null);
        setDragHoverIdx(null);
        suppressClickRef.current = true;
        window.requestAnimationFrame(() => {
            suppressClickRef.current = false;
        });

        if (commitTab) {
            const targetTab = NAV_TABS[targetIdx]?.id;
            if (targetTab && targetTab !== activeTab) {
                onToggleTab(targetTab as Tab);
            }
        }
    };

    return (
        <nav
            ref={navRef}
            className="footer-nav ludo-footer-scope overflow-hidden"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={(e) => handlePointerFinish(e, true)}
            onPointerCancel={(e) => handlePointerFinish(e, false)}
        >
            {isRetro && <RetroArcLight navRef={navRef} activeIdx={activeIdx} dragX={dragX} />}
            {NAV_TABS.map((tab, idx) => {
                const isActive = activeTab === tab.id;
                const isArcLit = isRetro && (dragHoverIdx === idx || (dragHoverIdx === null && isActive));
                const Icon = tab.icon;
                return (
                    <button
                        key={tab.id}
                        type="button"
                        className={`nav-item relative z-10 group ${isActive ? 'active' : ''} ${isArcLit ? 'arc-target' : ''}`}
                        onClick={() => {
                            if (suppressClickRef.current) {
                                suppressClickRef.current = false;
                                return;
                            }
                            onToggleTab(tab.id as Tab);
                        }}
                        aria-pressed={isActive}
                    >
                        {/* Active indicator: static on mobile, spring slide on desktop (non-Retro themes) */}
                        {!isRetro &&
                            isActive &&
                            (isMobile ? (
                                <div
                                    className="footer-active-plate absolute inset-0 border border-line-soft rounded-2xl -z-10"
                                    style={{ background: 'var(--nav-active-bg, rgba(13, 13, 13, 0.4))' }}
                                >
                                    <span className="footer-active-laser" aria-hidden="true" />
                                </div>
                            ) : (
                                <motion.div
                                    layoutId="active-nav-bg"
                                    className="footer-active-plate absolute inset-0 border border-line-soft rounded-2xl -z-10 shadow-[0_4px_12px_rgba(0,0,0,0.3)]"
                                    style={{ background: 'var(--nav-active-bg, rgba(13, 13, 13, 0.4))' }}
                                    transition={{ type: 'spring', stiffness: 350, damping: 25 }}
                                >
                                    <span className="footer-active-laser" aria-hidden="true" />
                                </motion.div>
                            ))}

                        {/* Hover Background */}
                        {!isRetro && !isActive && (
                            <div className="absolute inset-0 bg-surface-hover border border-line-soft rounded-2xl -z-10 opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
                        )}

                        <div className="relative inline-flex items-center justify-center">
                            <Icon className="nav-icon" active={isActive || isArcLit} />
                        </div>

                        <span className="nav-label">{tab.label}</span>
                    </button>
                );
            })}
        </nav>
    );
};
