"use client";

import React, { useCallback, useMemo, useRef } from 'react';
import { parseChatDraft, type ChatDraftEmote } from '@/lib/emotes';

/**
 * Chat composer field with emotes rendered inline.
 *
 * A native <textarea> cannot draw images, so the field keeps a transparent text
 * layer (real caret, real selection, real IME) over a mirrored backing layer
 * that paints the text plus the emote art at the exact positions the shortcodes
 * occupy. Both layers share font metrics and padding, and the backing layer
 * follows the field's scroll, so what you see is the emote itself rather than a
 * separate draft strip.
 */
interface RichChatFieldProps {
    value: string;
    emotes: readonly ChatDraftEmote[];
    onChange: (value: string) => void;
    placeholder?: string;
    disabled?: boolean;
    maxLength?: number;
    autoFocus?: boolean;
    ariaLabel?: string;
    onKeyDown?: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
    /** Reserve room on the right for a floating character counter. */
    hasCounter?: boolean;
    /** Called after an emote is chosen, with the token to insert. */
    children?: React.ReactNode;
}

export function RichChatField({
    value,
    emotes,
    onChange,
    placeholder = '',
    disabled = false,
    maxLength = 500,
    autoFocus = false,
    ariaLabel,
    onKeyDown,
    hasCounter = false,
    children,
}: RichChatFieldProps) {
    const fieldRef = useRef<HTMLTextAreaElement | null>(null);
    const backRef = useRef<HTMLDivElement | null>(null);

    const parts = useMemo(() => parseChatDraft(value, emotes), [value, emotes]);

    // Keep the painted layer glued to the field's scroll position.
    const syncScroll = useCallback(() => {
        const field = fieldRef.current;
        const back = backRef.current;
        if (!field || !back) return;
        back.scrollTop = field.scrollTop;
        back.scrollLeft = field.scrollLeft;
    }, []);

    const handleChange = useCallback(
        (event: React.ChangeEvent<HTMLTextAreaElement>) => {
            onChange(event.target.value);
        },
        [onChange]
    );

    return (
        <div className={`rich-field${hasCounter ? ' has-counter' : ''}`}>
            <div className="rich-field-back" ref={backRef} aria-hidden="true">
                {parts.map((part, index) =>
                    part.emote?.assetUrl ? (
                        // The token text stays in flow (transparent) so it reserves
                        // its exact width — the caret and selection in the real
                        // field line up with the art painted over it. Without
                        // this the painted image is far narrower than the token
                        // and everything after it drifts out of alignment.
                        <span className="rich-field-token" key={`emote-${index}-${part.emote.token}`}>
                            <span className="rich-field-token-text">{part.emote.token}</span>
                            <img
                                className="rich-field-emote"
                                src={part.emote.assetUrl}
                                alt=""
                                draggable={false}
                            />
                        </span>
                    ) : (
                        <span key={`text-${index}`}>{part.text}</span>
                    )
                )}
                {/* Trailing newline keeps the last line's height in sync. */}
                {'\n'}
            </div>
            <textarea
                ref={fieldRef}
                className="rich-field-input"
                value={value}
                onChange={handleChange}
                onScroll={syncScroll}
                onKeyDown={onKeyDown}
                placeholder={placeholder}
                disabled={disabled}
                maxLength={maxLength}
                autoFocus={autoFocus}
                aria-label={ariaLabel}
                rows={1}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="send"
            />
            {children}
        </div>
    );
}
