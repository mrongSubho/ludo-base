import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    SCREEN_STACK_PRESETS,
    computeStackPlacement,
    rotateScreenOffsetToBoardSpace,
    sortStackMembers,
    type StackMember,
} from '../lib/stackLayout';
import { resolveControllableColor } from '../lib/engine/core';

describe('Token Stack Cluster Geometry — Percentage Quadrants, Rotation Invariance & 2v2 Priority', () => {
    it('keeps all stack offsets within cell bounds across 1, 2, 3, 4, and 5+ tokens on 390px and 1440px cells', () => {
        const sampleMembers = (n: number): StackMember[] =>
            (['green', 'red', 'yellow', 'blue'] as const)
                .flatMap((color) => [0, 1].map((index) => ({ color, index })))
                .slice(0, n);

        for (const count of [1, 2, 3, 4, 5, 6]) {
            const members = sampleMembers(count);
            for (const m of members) {
                const p = computeStackPlacement(members, m, { counterRotationDeg: 0 });
                assert.ok(Math.abs(p.offset.xPct) <= 30, `count=${count} xPct=${p.offset.xPct} must fit inside cell`);
                assert.ok(Math.abs(p.offset.yPct) <= 30, `count=${count} yPct=${p.offset.yPct} must fit inside cell`);

                // Translate percentage offset to both a ~23px mobile cell and a ~48px desktop cell: never exceeds 0.3 * cellPx!
                for (const cellPx of [23, 48]) {
                    const offsetPxX = (Math.abs(p.offset.xPct) / 100) * cellPx;
                    const offsetPxY = (Math.abs(p.offset.yPct) / 100) * cellPx;
                    assert.ok(offsetPxX <= cellPx * 0.3);
                    assert.ok(offsetPxY <= cellPx * 0.3);
                }
            }
        }
        assert.deepEqual(SCREEN_STACK_PRESETS[2][0], { xPct: -26, yPct: -16 });
    });

    it('preserves upright screen-space orientation across 0, 90, 180, and 270 degree board rotations', () => {
        const members: StackMember[] = [
            { color: 'red', index: 0 },
            { color: 'yellow', index: 0 },
        ];
        const target = members[0];
        for (const deg of [0, 90, 180, 270]) {
            const placement = computeStackPlacement(members, target, { counterRotationDeg: deg });
            // Simulate `.board-wrapper` transform rotate(-deg): resulting screen coordinates match 0-deg preset!
            const screenRoundTrip = rotateScreenOffsetToBoardSpace(placement.offset, -deg);
            assert.deepEqual(screenRoundTrip, SCREEN_STACK_PRESETS[2][0]);
        }
    });

    it('keeps stable arrival-order slots and elevates controllableColor (including 2v2 assist) on top', () => {
        const arrivalOrder = new Map<string, number>([
            ['red-1', 5],
            ['yellow-0', 2],
        ]);
        const members: StackMember[] = [
            { color: 'red', index: 1 },
            { color: 'yellow', index: 0 },
        ];

        // With no controllable priority, yellow arrived earlier (seq 2 < 5) so yellow takes slot 0
        const ordered = sortStackMembers(members, { arrivalOrder });
        assert.deepEqual(ordered, [
            { color: 'yellow', index: 0 },
            { color: 'red', index: 1 },
        ]);

        // In 2v2 once green has all tokens at 57, green controls teammate blue; blue must rise to top zIndex
        const controllable = resolveControllableColor(
            {
                green: [57, 57, 57, 57],
                blue: [12, 18, -1, -1],
                red: [12, -1, -1, -1],
                yellow: [12, -1, -1, -1],
            },
            'green',
            '2v2',
        );
        assert.equal(controllable, 'blue');

        const assistStack: StackMember[] = [
            { color: 'blue', index: 0 },
            { color: 'red', index: 0 },
            { color: 'yellow', index: 0 },
        ];
        const blueTop = computeStackPlacement(assistStack, { color: 'blue', index: 0 }, {
            controllableColor: controllable,
            arrivalOrder,
        });
        assert.equal(blueTop.zIndex, 2, 'assisted teammate token renders on top of 3-stack');
    });
});
