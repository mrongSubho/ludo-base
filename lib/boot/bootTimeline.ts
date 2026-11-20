export const BOOT_VIDEO_SRC = '/boot/ludo-3077-boot-v4.mp4';
export const BOOT_POSTER_SRC = '/boot/ludo-3077-boot-v4-poster.jpg';
/** Exact byte length of trimmed 7.00s v4 MP4 used when CDN omits Content-Length over HTTP/2. */
export const BOOT_VIDEO_BYTES = 1246860;

/** Minimum time Phase 1 pure-code 3077 lockup charges before auto-launching Phase 2 video. */
export const BOOT_LOCKUP_MIN_MS = 1800;
/** Max network wait to stream the boot MP4 into memory before falling back cleanly. */
export const BOOT_FETCH_TIMEOUT_MS = 12000;

export const BOOT_DURATION_S = 7.0;
export const BOOT_DURATION_MS = 7000;
/** Synchronized Phase 3 cyber-shutter close + open transition duration into lobby. */
export const BOOT_EXIT_CLOSE_MS = 190;
export const BOOT_EXIT_OPEN_MS = 430;
/** Stall window during playback before falling back cleanly. */
export const BOOT_STALL_TIMEOUT_MS = 6000;
/** Extreme safety ceiling so a broken OS media decoder can never lock boot permanently. */
export const BOOT_MAX_TIMEOUT_MS = 26000;

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
    { id: 6, startS: 6.05, telemetry: 'CLAIMS // ENTERING ARENA' },
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
