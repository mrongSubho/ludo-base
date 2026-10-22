import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { seatedColorsFor } from '../lib/engine/core';

const root = join(import.meta.dirname ?? __dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

test('S1-1: migration SQL creates match_seats table with strict integrity and RLS', () => {
    const sql = read('supabase/migrations/202610220002_match_seats.sql');

    assert.match(sql, /create table if not exists public\.match_seats/i);
    assert.match(sql, /primary key\s*\(match_id,\s*color\)/i);
    assert.match(sql, /unique\s*\(match_id,\s*wallet_address\)/i);
    assert.match(sql, /alter table public\.match_seats enable row level security/i);
    assert.match(sql, /create policy "match_seats_select_all"/i);
});

test('S1-2: assign_match_seats enforces explicit byte-order COLLATE "C" sorting', () => {
    const sql = read('supabase/migrations/202610220002_match_seats.sql');

    assert.match(sql, /create or replace function public\.assign_match_seats/i);
    assert.match(sql, /order by w collate "C"/i);
    assert.match(sql, /perform public\.assign_match_seats\(m,\s*p_match_type,\s*matched_player_ids\)/i);
    assert.match(sql, /perform public\.assign_match_seats\(v_match_id,\s*p_match_type,\s*array\[p_player_id,\s*v_opponent_id\]\)/i);
});

test('S1-3: seat counts and color sets match seatedColorsFor for all shapes', () => {
    const shapes = ['1v1', '2v2', '4P'];

    for (const shape of shapes) {
        const expectedColors = seatedColorsFor(shape);
        if (shape === '1v1') {
            assert.equal(expectedColors.length, 2);
            assert.deepEqual([...expectedColors], ['green', 'yellow']);
        } else {
            assert.equal(expectedColors.length, 4);
            assert.deepEqual([...expectedColors], ['green', 'red', 'yellow', 'blue']);
        }
    }
});

test('S1-4: §6.6 deterministic seat assignment algorithm produces identical ordering', () => {
    const wallets = [
        '0x71C845187C5d4a1F694F9c6fFA17855bE677F213',
        '0x28C6c06298d514Db089934071355E5743bf21d60',
    ];

    // Canonical byte-order sort
    const sorted = [...new Set(wallets.map(w => w.trim().toLowerCase()))].sort((a, b) =>
        a < b ? -1 : a > b ? 1 : 0
    );

    assert.equal(sorted[0], '0x28c6c06298d514db089934071355e5743bf21d60');
    assert.equal(sorted[1], '0x71c845187c5d4a1f694f9c6ffa17855be677f213');

    const colors1v1 = seatedColorsFor('1v1');
    const assignedSeats = sorted.map((wallet, idx) => ({
        color: colors1v1[idx],
        wallet,
        seat_index: idx,
    }));

    assert.deepEqual(assignedSeats, [
        { color: 'green', wallet: '0x28c6c06298d514db089934071355e5743bf21d60', seat_index: 0 },
        { color: 'yellow', wallet: '0x71c845187c5d4a1f694f9c6ffa17855be677f213', seat_index: 1 },
    ]);
});
