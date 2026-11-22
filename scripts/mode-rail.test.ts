import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    MODE_RAIL_STOPS,
    RAIL_MAX_ANGLE_DEG,
    RAIL_MIN_ANGLE_DEG,
    angleToRailMode,
    clampRailAngle,
    describeRailArc,
    describeRailBand,
    modeToRailAngle,
    pointerToRailAngle,
    railArcPoint,
    stepRailMode,
} from '../lib/modeRail';

const root = join(import.meta.dirname ?? __dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('Curved Magnetic Deployment Mode Rail', () => {
    it('defines 3 ordered mode stops symmetrically around 0 deg', () => {
        assert.deepEqual(
            MODE_RAIL_STOPS.map((s) => s.id),
            ['quick', 'team', 'offline'],
        );
        assert.equal(modeToRailAngle('quick'), RAIL_MIN_ANGLE_DEG);
        assert.equal(modeToRailAngle('team'), 0);
        assert.equal(modeToRailAngle('offline'), RAIL_MAX_ANGLE_DEG);
    });

    it('snaps continuous arc angles cleanly to the nearest mode detent', () => {
        assert.equal(angleToRailMode(-25), 'quick');
        assert.equal(angleToRailMode(-17.5), 'quick');
        assert.equal(angleToRailMode(-9.1), 'quick');
        assert.equal(angleToRailMode(-8.5), 'team');
        assert.equal(angleToRailMode(0), 'team');
        assert.equal(angleToRailMode(8.5), 'team');
        assert.equal(angleToRailMode(9.1), 'offline');
        assert.equal(angleToRailMode(30), 'offline');
    });

    it('clamps out-of-range and non-finite angles safely', () => {
        assert.equal(clampRailAngle(-90), RAIL_MIN_ANGLE_DEG);
        assert.equal(clampRailAngle(90), RAIL_MAX_ANGLE_DEG);
        assert.equal(clampRailAngle(Number.NaN), 0);
    });

    it('maps SVG pointer positions onto the smile arc deterministically', () => {
        const left = railArcPoint(RAIL_MIN_ANGLE_DEG);
        const mid = railArcPoint(0);
        const right = railArcPoint(RAIL_MAX_ANGLE_DEG);

        assert.ok(left.x < mid.x && mid.x < right.x);
        // Smile curve: center dips lower (larger Y) than left/right ends
        assert.ok(mid.y > left.y && mid.y > right.y);
        assert.ok(Math.abs(left.y - right.y) < 0.05);

        assert.equal(angleToRailMode(pointerToRailAngle(left.x, left.y)), 'quick');
        assert.equal(angleToRailMode(pointerToRailAngle(mid.x, mid.y)), 'team');
        assert.equal(angleToRailMode(pointerToRailAngle(right.x, right.y)), 'offline');
    });

    it('steps modes left/right with endpoint clamping and builds valid SVG arc paths', () => {
        assert.equal(stepRailMode('quick', -1), 'quick');
        assert.equal(stepRailMode('quick', 1), 'team');
        assert.equal(stepRailMode('team', 1), 'offline');
        assert.equal(stepRailMode('offline', 1), 'offline');
        assert.equal(stepRailMode('offline', -1), 'team');

        assert.match(describeRailArc(-17.5, 17.5), /^M [\d.]+ [\d.]+ A 320 320 0 0 0 [\d.]+ [\d.]+$/);
        assert.match(describeRailBand(-26.8, 26.8, 304.5, 335.5), /^M .+ Z$/);
    });

    it('wires DeploymentModeRail in 3077 and 3-chip mode rail in Retro & Daybreak', () => {
        const diceSrc = read('app/components/ActionDice.tsx');
        assert.match(diceSrc, /import \{ DeploymentModeRail \} from '\.\/DeploymentModeRail'/);
        assert.match(diceSrc, /<DeploymentModeRail/);
        assert.match(diceSrc, /MODE_HEX_DAYBREAK/);
        assert.match(diceSrc, /aria-label="Deployment Mode Switcher"/);

        const railSrc = read('app/components/DeploymentModeRail.tsx');
        assert.match(railSrc, /role="radiogroup"/);
        assert.match(railSrc, /role="radio"/);
        assert.match(railSrc, /prefersReducedMotion/);
        assert.match(railSrc, /setPointerCapture/);
    });
});
