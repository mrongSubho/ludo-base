"use client";

import { useEffect, useState } from 'react';
import { EMOJI_PACKS, parseChatContent, type EmojiEmote, type EmojiPack } from '@/lib/emotes';

export function useEmojiPacks() {
    const [packs, setPacks] = useState<readonly EmojiPack[]>(EMOJI_PACKS);

    useEffect(() => {
        let active = true;
        fetch('/emotes/packs.json')
            .then((response) => response.ok ? response.json() : null)
            .then((remotePacks: unknown) => {
                if (!active || !Array.isArray(remotePacks)) return;
                const validPacks = remotePacks.filter(isEmojiPack);
                if (validPacks.length > 0) setPacks(validPacks);
            })
            .catch(() => {
                // The bundled starter pack remains available offline.
            });
        return () => {
            active = false;
        };
    }, []);

    return packs;
}

function isEmojiPack(value: unknown): value is EmojiPack {
    if (!value || typeof value !== 'object') return false;
    const pack = value as Record<string, unknown>;
    return typeof pack.id === 'string' &&
        typeof pack.name === 'string' &&
        typeof pack.tabGlyph === 'string' &&
        Array.isArray(pack.items) &&
        pack.items.every(isEmojiEmote);
}

function isEmojiEmote(value: unknown): value is EmojiEmote {
    if (!value || typeof value !== 'object') return false;
    const emote = value as Record<string, unknown>;
    return typeof emote.id === 'string' &&
        typeof emote.label === 'string' &&
        typeof emote.glyph === 'string' &&
        (typeof emote.assetUrl === 'undefined' || typeof emote.assetUrl === 'string');
}

interface EmojiPackGridProps {
    packs: readonly EmojiPack[];
    tab: string;
    onTabChange: (tab: string) => void;
    onSelect: (emote: EmojiEmote) => void;
    className?: string;
    showTabs?: boolean;
}

export function EmojiPackGrid({ packs, tab, onTabChange, onSelect, className = '', showTabs = true }: EmojiPackGridProps) {
    const activePack = packs.find((pack) => pack.id === tab) ?? packs[0];
    return (
        <div className={`emoji-picker-content ${className}`}>
            {showTabs && (
                <div className="emoji-pack-tabs" role="tablist" aria-label="Emoji packs">
                    {packs.map((pack) => (
                        <button
                            key={pack.id}
                            type="button"
                            className={tab === pack.id ? 'active' : ''}
                            onClick={() => onTabChange(pack.id)}
                            role="tab"
                            aria-selected={tab === pack.id}
                            aria-label={pack.name}
                        >
                            {pack.tabGlyph}
                        </button>
                    ))}
                </div>
            )}
            <div className="emoji-pack-grid">
                {(activePack?.items ?? []).map((emote) => (
                    <button
                        key={emote.id}
                        type="button"
                        className="emoji-pack-item"
                        onClick={() => onSelect(emote)}
                        aria-label={emote.label}
                        title={emote.label}
                    >
                        {emote.assetUrl ? <img src={emote.assetUrl} alt="" loading="lazy" /> : emote.glyph}
                    </button>
                ))}
            </div>
        </div>
    );
}

interface EmojiPickerPopoverProps {
    open: boolean;
    onToggle: () => void;
    onSelect: (emote: EmojiEmote) => void;
    disabled?: boolean;
    label?: string;
}

export function EmojiPickerPopover({ open, onToggle, onSelect, disabled, label = 'Add emoji' }: EmojiPickerPopoverProps) {
    const packs = useEmojiPacks();
    const [tab, setTab] = useState(packs[0]?.id ?? '');

    useEffect(() => {
        if (!packs.some((pack) => pack.id === tab)) setTab(packs[0]?.id ?? '');
    }, [packs, tab]);

    return (
        <div className="emoji-picker-popover-wrap">
            <button
                type="button"
                className={`chat-emoji-button ${open ? 'on' : ''}`}
                onClick={onToggle}
                aria-label={label}
                aria-expanded={open}
                disabled={disabled}
            >
                <span aria-hidden="true">☺</span>
            </button>
            {open && (
                <div className="emoji-picker-popover">
                    <EmojiPackGrid packs={packs} tab={tab} onTabChange={setTab} onSelect={onSelect} />
                </div>
            )}
        </div>
    );
}

export function ChatContent({ value, className = '' }: { value: string; className?: string }) {
    const parts = parseChatContent(value);
    const emotes = parts.filter((part) => part.assetUrl);
    const isSingleEmote = parts.length === 1 && emotes.length === 1;
    return (
        <span className={`chat-rich-content ${isSingleEmote ? 'chat-rich-content-single' : ''} ${className}`}>
            {parts.map((part, index) => part.assetUrl ? (
                <img
                    key={`${part.assetUrl}-${index}`}
                    className="chat-rich-emote"
                    src={part.assetUrl}
                    alt={part.glyph || 'Emote'}
                    loading="lazy"
                />
            ) : (
                <span key={`text-${index}`}>{part.text}</span>
            ))}
        </span>
    );
}
