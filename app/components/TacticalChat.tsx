'use client';

import React from 'react';
import { LuSend } from 'react-icons/lu';
import Button from './Button';
import { ChatContent, EmojiPickerPopover } from './EmojiPicker';
import { RichChatField } from './RichChatField';
import {
    encodeChatDraft,
    insertDraftEmote,
    retainChatDraftEmotes,
    type ChatDraftEmote,
} from '@/lib/emotes';

export interface TacticalChatComposerProps {
    value: string;
    emotes: readonly ChatDraftEmote[];
    emojiOpen: boolean;
    onValueChange: (value: string) => void;
    onEmotesChange: (emotes: ChatDraftEmote[]) => void;
    onEmojiToggle: () => void;
    onEmojiClose: () => void;
    onSend: () => void | Promise<void>;
    placeholder?: string;
    ariaLabel?: string;
    maxLength?: number;
    maxEncodedLength?: number;
    disabled?: boolean;
    sending?: boolean;
    cooldown?: number;
    showCounter?: boolean;
    compact?: boolean;
    className?: string;
    onKeyDownExtra?: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
}

/**
 * Unified Tactical Comms Composer (sourced from Clan > Hall).
 * Features the dark capsule input pill, inline emote/emoji picker, and primary
 * Send pill button with paper-plane icon across all messaging surfaces.
 */
export function TacticalChatComposer({
    value,
    emotes,
    emojiOpen,
    onValueChange,
    onEmotesChange,
    onEmojiToggle,
    onEmojiClose,
    onSend,
    placeholder = 'Transmit tactical message...',
    ariaLabel = 'Tactical message',
    maxLength = 280,
    maxEncodedLength,
    disabled = false,
    sending = false,
    cooldown = 0,
    showCounter = false,
    compact = false,
    className = '',
    onKeyDownExtra,
}: TacticalChatComposerProps) {
    const isFieldDisabled = disabled || sending;
    const isCooldown = cooldown > 0;
    const canSend = Boolean(value.trim()) && !isFieldDisabled && !isCooldown;
    const encodedLen = encodeChatDraft(value, emotes).length;
    const limitDisplay = maxEncodedLength ?? maxLength;
    const nearLimit = encodedLen >= Math.max(20, limitDisplay - 20);

    return (
        <form
            onSubmit={(e) => {
                e.preventDefault();
                if (canSend) void onSend();
            }}
            className={`relative flex items-center gap-2 ${
                compact ? '' : 'pt-2.5 border-t border-line-soft'
            } shrink-0 ${className}`}
        >
            <div className="relative flex-1 min-w-0 flex items-center">
                <RichChatField
                    value={value}
                    emotes={emotes}
                    onChange={(next) => {
                        const retained = retainChatDraftEmotes(next, emotes);
                        if (
                            typeof maxEncodedLength === 'number' &&
                            encodeChatDraft(next, retained).length > maxEncodedLength &&
                            next.length > value.length
                        ) {
                            return;
                        }
                        onValueChange(next);
                        onEmotesChange(retained);
                    }}
                    onKeyDown={(e) => {
                        onKeyDownExtra?.(e);
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            if (canSend) void onSend();
                        }
                    }}
                    disabled={isFieldDisabled}
                    placeholder={placeholder}
                    maxLength={maxLength}
                    hasCounter={showCounter}
                    ariaLabel={ariaLabel}
                />
                {showCounter && (
                    <span
                        className={`absolute right-3 top-1/2 -translate-y-1/2 text-ludo-xs font-mono pointer-events-none transition-colors ${
                            nearLimit ? 'text-negative font-bold' : 'text-ink-faint'
                        }`}
                    >
                        {encodedLen}/{limitDisplay}
                    </span>
                )}
            </div>

            <EmojiPickerPopover
                open={emojiOpen}
                onToggle={onEmojiToggle}
                onSelect={(emote) => {
                    const next = insertDraftEmote(
                        emote,
                        value,
                        emotes,
                        maxLength,
                        maxEncodedLength,
                    );
                    onValueChange(next.value);
                    onEmotesChange(next.emotes);
                    onEmojiClose();
                }}
                disabled={isFieldDisabled}
                label="Add emote or emoji"
            />

            <Button
                variant="primary"
                size="sm"
                type="submit"
                disabled={!canSend}
                leftIcon={isCooldown ? undefined : <LuSend className="w-3.5 h-3.5" />}
                aria-label={isCooldown ? `Send locked for ${cooldown}s` : 'Send message'}
                className="rounded-full shrink-0 whitespace-nowrap font-mono px-3.5 tabular-nums"
            >
                {isCooldown ? `${cooldown}s` : sending ? '...' : 'Send'}
            </Button>
        </form>
    );
}

export interface TacticalMessageBubbleProps {
    isMine: boolean;
    sender: string;
    meta?: string;
    content: string;
    failed?: boolean;
    failedError?: string;
    sending?: boolean;
    onRetry?: () => void;
    avatar?: React.ReactNode;
    belowBubble?: React.ReactNode;
    joinAction?: {
        label?: string;
        title?: string;
        onClick: () => void;
    };
    dimmed?: boolean;
}

/**
 * Unified Tactical Message Bubble matching the Clan > Hall comms aesthetic:
 * mono sender/timestamp header + soft accent self-bubbles (`bg-accent-soft
 * border-accent/35`) and elevated surface peer bubbles (`bg-surface-panel`).
 */
export function TacticalMessageBubble({
    isMine,
    sender,
    meta,
    content,
    failed = false,
    failedError,
    sending = false,
    onRetry,
    avatar,
    belowBubble,
    joinAction,
    dimmed = false,
}: TacticalMessageBubbleProps) {
    return (
        <div className={`flex w-full gap-2 items-end ${isMine ? 'flex-row-reverse' : ''}`}>
            {avatar}
            <div
                className={`flex flex-col min-w-0 max-w-[85%] ${
                    isMine ? 'items-end' : 'items-start'
                } ${sending ? 'opacity-50' : ''}`}
            >
                <div
                    className={`flex items-center gap-1.5 text-ludo-xs font-mono mb-0.5 px-1 ${
                        isMine ? 'flex-row-reverse' : ''
                    }`}
                >
                    <span className={isMine ? 'text-accent font-bold' : 'text-warn font-bold'}>
                        {sender}
                    </span>
                    {meta && <span className="text-ink-faint">{meta}</span>}
                </div>

                {joinAction ? (
                    <button
                        type="button"
                        onClick={joinAction.onClick}
                        title={joinAction.title}
                        className="room-join-row w-full text-left px-3 py-2 rounded-2xl rounded-tl-sm border border-accent/40 bg-accent-soft text-ludo-xs font-mono leading-relaxed break-words [overflow-wrap:anywhere] text-ink-strong hover:bg-accent/20 hover:border-accent/60 active:scale-[0.99] transition-all cursor-pointer"
                    >
                        <ChatContent value={content} className="text-ink-strong" />
                        <span className="block mt-1 text-ludo-xs font-extrabold uppercase tracking-[0.18em] text-accent">
                            {joinAction.label || 'Tap to join →'}
                        </span>
                    </button>
                ) : failed && isMine && onRetry ? (
                    <button
                        type="button"
                        onClick={onRetry}
                        className="w-fit min-w-12 max-w-full px-3 py-2 rounded-2xl rounded-tr-sm text-ludo-xs font-mono leading-relaxed break-words [overflow-wrap:anywhere] text-left bg-negative/15 text-negative border border-negative/40 hover:bg-negative/25 active:scale-[0.98] transition-colors"
                    >
                        <ChatContent value={content} />
                    </button>
                ) : (
                    <div
                        className={`w-fit max-w-full px-3 py-2 rounded-2xl text-ludo-xs font-mono leading-relaxed break-words [overflow-wrap:anywhere] border ${
                            isMine
                                ? 'chat-own bg-accent-soft border-accent/35 text-ink-strong rounded-tr-sm'
                                : 'bg-surface-panel border-line-soft text-ink-strong rounded-tl-sm'
                        } ${dimmed ? 'opacity-60' : ''}`}
                    >
                        <ChatContent value={content} />
                        {belowBubble}
                    </div>
                )}

                {failed && isMine && onRetry && (
                    <button
                        type="button"
                        onClick={onRetry}
                        className="text-left text-ludo-xs font-mono text-negative mt-1 px-1 font-bold hover:brightness-110 transition-colors"
                    >
                        {failedError || "Couldn't send that message."}
                        <span className="ml-1 font-normal opacity-75">· tap to retry</span>
                    </button>
                )}
            </div>
        </div>
    );
}
