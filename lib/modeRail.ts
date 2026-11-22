/**
 * Pure geometry and detent math for the Ludo 3077 Curved Magnetic Shuttle Rail.
 *
 * The rail forms a shallow orbital smile arc hugging the bottom of the 3D
 * Action Dice holographic pedestal. Angles are measured in degrees from the
 * bottom-center nadir (0 deg = TEAM, -17.5 deg = QUICK, +17.5 deg = OFFLINE).
 */

export type DeploymentModeId = 'quick' | 'team' | 'offline';

export interface ModeRailStop {
    id: DeploymentModeId;
    label: string;
    shortLabel: string;
    code: string;
    angleDeg: number;
    hex: string;
}

export const RAIL_VIEWBOX_W = 320;
export const RAIL_VIEWBOX_H = 82;

/** Orbital circle geometry — center sits above the viewBox to form a sleek smile arc. */
export const RAIL_CX = 160;
export const RAIL_CY = -274;
export const RAIL_RADIUS = 320;

export const RAIL_MIN_ANGLE_DEG = -17.5;
export const RAIL_MAX_ANGLE_DEG = 17.5;
export const RAIL_HOUSING_MIN_DEG = -26.8;
export const RAIL_HOUSING_MAX_DEG = 26.8;

export const MODE_RAIL_STOPS: readonly ModeRailStop[] = [
    {
        id: 'quick',
        label: 'QUICK MATCH',
        shortLabel: 'QUICK',
        code: '01',
        angleDeg: -17.5,
        hex: '#00E5FF',
    },
    {
        id: 'team',
        label: 'TEAM UP',
        shortLabel: 'TEAM',
        code: '02',
        angleDeg: 0,
        hex: '#F59E0B',
    },
    {
        id: 'offline',
        label: 'OFFLINE MATCH',
        shortLabel: 'OFFLINE',
        code: '03',
        angleDeg: 17.5,
        hex: '#00FF66',
    },
] as const;

/** Clamp any angle into the shuttle's physical travel stops. */
export function clampRailAngle(angleDeg: number): number {
    if (!Number.isFinite(angleDeg)) return 0;
    return Math.max(RAIL_MIN_ANGLE_DEG, Math.min(RAIL_MAX_ANGLE_DEG, angleDeg));
}

/** Convert an arc angle (0 deg = straight down) + radius into SVG (x, y). */
export function railArcPoint(
    angleDeg: number,
    radius: number = RAIL_RADIUS,
): { x: number; y: number } {
    const rad = (angleDeg * Math.PI) / 180;
    return {
        x: Number((RAIL_CX + Math.sin(rad) * radius).toFixed(2)),
        y: Number((RAIL_CY + Math.cos(rad) * radius).toFixed(2)),
    };
}

/** Build an SVG arc path (`M x1 y1 A r r 0 0 sweep x2 y2`) along the orbital circle. */
export function describeRailArc(
    startAngleDeg: number,
    endAngleDeg: number,
    radius: number = RAIL_RADIUS,
): string {
    const start = railArcPoint(startAngleDeg, radius);
    const end = railArcPoint(endAngleDeg, radius);
    const sweepFlag = endAngleDeg >= startAngleDeg ? 0 : 1;
    return `M ${start.x} ${start.y} A ${radius} ${radius} 0 0 ${sweepFlag} ${end.x} ${end.y}`;
}

/** Build a closed annular sector band path (machined curved bezel housing). */
export function describeRailBand(
    startAngleDeg: number,
    endAngleDeg: number,
    innerRadius: number,
    outerRadius: number,
): string {
    const outerStart = railArcPoint(startAngleDeg, outerRadius);
    const outerEnd = railArcPoint(endAngleDeg, outerRadius);
    const innerEnd = railArcPoint(endAngleDeg, innerRadius);
    const innerStart = railArcPoint(startAngleDeg, innerRadius);
    return [
        `M ${outerStart.x} ${outerStart.y}`,
        `A ${outerRadius} ${outerRadius} 0 0 0 ${outerEnd.x} ${outerEnd.y}`,
        `L ${innerEnd.x} ${innerEnd.y}`,
        `A ${innerRadius} ${innerRadius} 0 0 1 ${innerStart.x} ${innerStart.y}`,
        'Z',
    ].join(' ');
}

/** Return the canonical detent angle for a mode id. */
export function modeToRailAngle(mode: DeploymentModeId): number {
    const stop = MODE_RAIL_STOPS.find((s) => s.id === mode);
    return stop ? stop.angleDeg : 0;
}

/** Snap any continuous arc angle to the nearest mode stop. */
export function angleToRailMode(angleDeg: number): DeploymentModeId {
    const clamped = clampRailAngle(angleDeg);
    let best = MODE_RAIL_STOPS[0];
    let bestDist = Infinity;
    for (const stop of MODE_RAIL_STOPS) {
        const d = Math.abs(clamped - stop.angleDeg);
        if (d < bestDist) {
            bestDist = d;
            best = stop;
        }
    }
    return best.id;
}

/** Map an SVG pointer coordinate (svgX, svgY) to a clamped rail angle. */
export function pointerToRailAngle(svgX: number, svgY: number): number {
    const dx = svgX - RAIL_CX;
    const dy = Math.max(1, svgY - RAIL_CY);
    const deg = (Math.atan2(dx, dy) * 180) / Math.PI;
    return clampRailAngle(deg);
}

/** Step one detent left (-1) or right (+1), clamped at endpoints. */
export function stepRailMode(current: DeploymentModeId, dir: -1 | 1): DeploymentModeId {
    const idx = MODE_RAIL_STOPS.findIndex((s) => s.id === current);
    const base = idx >= 0 ? idx : 0;
    const next = Math.max(0, Math.min(MODE_RAIL_STOPS.length - 1, base + dir));
    return MODE_RAIL_STOPS[next].id;
}
