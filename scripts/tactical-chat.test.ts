import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    CYBER_ORB_PACK,
    encodeChatDraft,
    insertDraftEmote,
    parseChatContent,
    type ChatDraftEmote,
} from '../lib/emotes';

const root = join(import.meta.dirname ?? __dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('Unified Tactical Chat & Clan > Hall Emote Composer', () => {
    it('enforces maxEncodedLength when inserting emotes for 280-char Clan Hall backend limits', () => {
        const sampleEmote = CYBER_ORB_PACK.items[0];
        let value = '';
        let emotes: ChatDraftEmote[] = [];

        // Repeatedly insert until encoded length hits the 280-char ceiling
        for (let i = 0; i < 10; i += 1) {
            const next = insertDraftEmote(sampleEmote, value, emotes, 280, 280);
            value = next.value;
            emotes = next.emotes;
        }

        const encoded = encodeChatDraft(value, emotes);
        assert.ok(encoded.length > 0 && encoded.length <= 280, `encoded length ${encoded.length} should stay <= 280`);
        const parsed = parseChatContent(encoded);
        assert.ok(parsed.some((p) => p.assetUrl === sampleEmote.assetUrl));
    });

    it('unifies Clan Hall, DMs, Live/Broadcast Chat, Spectator Global Comm, and Board Chat onto the Clan > Hall UI', () => {
        const composerSrc = read('app/components/TacticalChat.tsx');
        assert.match(composerSrc, /<RichChatField/);
        assert.match(composerSrc, /<EmojiPickerPopover/);
        assert.match(composerSrc, /<LuSend/);
        assert.match(composerSrc, /rounded-full shrink-0 whitespace-nowrap font-mono/);
        assert.match(composerSrc, /bg-accent-soft border-accent\/35 text-ink-strong rounded-tr-sm/);

        const clan = read('app/components/ClanPanel.tsx');
        assert.match(clan, /<TacticalMessageBubble/);
        assert.match(clan, /<TacticalChatComposer/);
        assert.match(clan, /maxEncodedLength=\{280\}/);

        const dms = read('app/components/MessagesPanel.tsx');
        assert.match(dms, /<TacticalMessageBubble/);
        assert.match(dms, /<TacticalChatComposer/);

        const feed = read('app/components/ActivityFeed.tsx');
        assert.match(feed, /<TacticalMessageBubble/);
        assert.match(feed, /<TacticalChatComposer/);

        const spectator = read('app/components/SpectatorHUD.tsx');
        assert.match(spectator, /<ChatContent/);
        assert.match(spectator, /<TacticalChatComposer/);

        const board = read('app/components/Board.tsx');
        assert.match(board, /<LuSend/);
        assert.match(board, /<span>Send<\/span>/);
    });

    it('drives RichChatField pill radius and EmojiPicker accents via semantic CSS variables', () => {
        const css = read('app/styles/board.css');
        assert.match(css, /\.rich-field-back,[\s\S]*border-radius:\s*9999px/);
        assert.match(css, /caret-color:\s*var\(--accent/);
        assert.match(css, /\.chat-composer-send[\s\S]*border-radius:\s*9999px/);
    });
});
