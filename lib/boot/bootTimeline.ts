export const BOOT_VIDEO_SRC = '/boot/ludo-3077-boot-v1.mp4';
export const BOOT_POSTER_SRC = '/boot/ludo-3077-boot-v1-poster.jpg';

export const BOOT_DURATION_S = 10.0;
export const BOOT_DURATION_MS = 10000;
/** Grace window before falling back if video cannot decode/buffer on restricted devices. */
export const BOOT_START_TIMEOUT_MS = 6500;
/** Hard fail-safe ceiling allowing slow buffer + full 10s playback without ever hanging. */
export const BOOT_MAX_TIMEOUT_MS = 16000;

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
    { id: 5, startS: 4.45, telemetry: 'LEDGER // CHIPS & VAULT' },
    { id: 6, startS: 6.15, telemetry: 'CLAIMS // ARENA & CLAN' },
    { id: 7, startS: 7.05, telemetry: 'ARENA // BOARD MATRIX' },
    { id: 8, startS: 7.95, telemetry: 'SQUAD // 4-FACTION SYNC' },
    { id: 9, startS: 8.85, telemetry: 'SYS.READY // 100%' },
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
