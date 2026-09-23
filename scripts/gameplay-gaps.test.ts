/**
 * G2/G4/G5 unit tests — local room, notices, emotes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    seatCount,
    passPlayLabels,
    passToCopy,
    buildLocalShareUrl,
    buildPassPlayRoster,
} from '../lib/localRoom';
import {
    buildNoticeMessage,
    filterActiveNotices,
    parseNoticeBundle,
    isNoticeActive,
    defaultSeedNotices,
} from '../lib/notices';
import {
    PRESET_EMOTES,
    isEmoteId,
    createEmoteEvent,
    emoteById,
} from '../lib/emotes';
import { parseEmotePayload } from '../app/components/EmoteTray';

test('G2 pass-and-play roster is all-human', () => {
    assert.equal(seatCount('1v1'), 2);
    assert.equal(seatCount('4P'), 4);
    assert.deepEqual(passPlayLabels('1v1'), ['Player 1', 'Player 2']);
    const roster = buildPassPlayRoster('4P');
    assert.equal(roster.length, 4);
    assert.ok(roster.every((p) => p.isAi === false));
    assert.match(passToCopy('Player 2'), /Pass the device to Player 2/);
});

test('G2 share URL carries room + secret + seat', () => {
    const url = buildLocalShareUrl({
        roomCode: 'ABC123',
        roomSecret: 'deadbeef',
        seat: 1,
        origin: 'https://example.test',
    });
    assert.equal(url, 'https://example.test/?room=ABC123&s=deadbeef&seat=1');
});

test('G4 notices filter expiry and parse-or-drop', () => {
    const now = Date.parse('2026-09-22T12:00:00Z');
    const notices = [
        { id: 'a', level: 'info' as const, title: 'A', body: 'live', issuedAt: 'x' },
        { id: 'b', level: 'warn' as const, title: 'B', body: 'old', expiresAt: '2026-09-22T11:00:00Z', issuedAt: 'x' },
        { id: 'c', level: 'critical' as const, title: 'C', body: 'later', expiresAt: '2026-09-23T00:00:00Z', issuedAt: 'x' },
    ];
    assert.equal(isNoticeActive(notices[0], now), true);
    assert.equal(isNoticeActive(notices[1], now), false);
    assert.equal(filterActiveNotices(notices, now).map((n) => n.id).join(','), 'a,c');

    const msg = buildNoticeMessage({ version: 1, issuedAt: 't', notices: [notices[0]] });
    assert.match(msg, /Ludo Base notices v1/);
    assert.match(msg, /a\|info\|A/);

    assert.equal(parseNoticeBundle(null), null);
    assert.equal(parseNoticeBundle({ version: 'x', notices: [] }), null);
    const ok = parseNoticeBundle({
        version: 1,
        issuedAt: 't',
        notices: [{ id: 'n1', level: 'info', title: 'T', body: 'B', issuedAt: 't' }],
    });
    assert.ok(ok);
    assert.equal(ok!.notices.length, 1);
    assert.ok(defaultSeedNotices().length >= 1);
});

test('G5 emotes are preset-only and parse-or-drop on the wire', () => {
    assert.ok(PRESET_EMOTES.length >= 6);
    assert.ok(PRESET_EMOTES.every((e) => e.text.length > 0 && !/\p{Extended_Pictographic}/u.test(e.text)));
    assert.equal(isEmoteId('gl'), true);
    assert.equal(isEmoteId('free text hack'), false);

    const ev = createEmoteEvent('nice', 'green', '0xabc');
    assert.equal(ev.emoteId, 'nice');
    assert.equal(emoteById('phew')?.text, 'That was close');

    assert.ok(parseEmotePayload({ emoteId: 'wow', color: 'blue', t: 1 }));
    assert.equal(parseEmotePayload({ emoteId: 'nope', color: 'blue' }), null);
    assert.equal(parseEmotePayload(null), null);
});
