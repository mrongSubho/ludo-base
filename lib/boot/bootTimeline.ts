export const BOOT_VIDEO_SRC = '/boot/ludo-3077-boot-v3.mp4';
export const BOOT_POSTER_SRC = '/boot/ludo-3077-boot-v3-poster.jpg';
/** Exact byte length of v3 MP4 used when CDN omits Content-Length over HTTP/2. */
export const BOOT_VIDEO_BYTES = 1561129;

/** Minimum time Phase 1 pure-code 3077 lockup charges before auto-launching Phase 2 video. */
export const BOOT_LOCKUP_MIN_MS = 1800;
/** Max network wait to stream the boot MP4 into memory before falling back cleanly. */
export const BOOT_FETCH_TIMEOUT_MS = 12000;

export const BOOT_DURATION_S = 8.79;
export const BOOT_DURATION_MS = 8790;
/** Stall window during playback before falling back to static HUD splash. */
export const BOOT_STALL_TIMEOUT_MS = 6000;
/** Extreme safety ceiling so a broken OS media decoder can never lock boot permanently. */
export const BOOT_MAX_TIMEOUT_MS = 28000;

export const BOOT_SUBSYSTEM_NODES = ['AUTH', 'SYNC', 'VAULT', 'ARENA', 'CORE'] as const;

export interface BootTelemetryCue {
    id: number;
    startS: number;
    telemetry: string;
}

export const BOOT_TELEMETRY_CUES: readonly BootTelemetryCue[] = [
    { id: 1, startS: 0.0, telemetry: 'BOOT // KERNEL INIT' },
    { id: 2, startS: 0.9, telemetry: 'AUTH // SESSION LINK' },
    { id: 3, startS: 1.75, telemetry: 'PROFILE // PILOT SYNC' },
    { id: 4, startS: 2.65, telemetry: 'SOCIAL // FRIENDS & DMS' },
    { id: 5, startS: 4.42, telemetry: 'LEDGER // CHIPS & VAULT' },
    { id: 6, startS: 6.05, telemetry: 'CLAIMS // ARENA & CLAN' },
    { id: 7, startS: 7.0, telemetry: 'ARENA // BOARD MATRIX' },
    { id: 8, startS: 7.95, telemetry: 'SQUAD // 4-FACTION SYNC' },
] as const;

export function getBootTelemetryForTime(seconds: number): string {
    const t = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
    let label = BOOT_TELEMETRY_CUES[0].telemetry;
    for (let i = 0; i < BOOT_TELEMETRY_CUES.length; i++) {
        if (t >= BOOT_TELEMETRY_CUES[i].startS) {
            label = BOOT_TELEMETRY_CUES[i].telemetry;
        } else {
            break;
        }
    }
    return label;
}
