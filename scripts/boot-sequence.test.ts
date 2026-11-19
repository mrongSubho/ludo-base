import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
    BOOT_DURATION_MS,
    BOOT_MAX_TIMEOUT_MS,
    BOOT_POSTER_SRC,
    BOOT_START_TIMEOUT_MS,
    BOOT_TELEMETRY_CUES,
    BOOT_VIDEO_SRC,
    getBootTelemetryForTime,
} from '../lib/boot/bootTimeline';

function readRepoFile(relPath: string): string {
    return fs.readFileSync(path.resolve(process.cwd(), relPath), 'utf8');
}

test('bootTimeline: video & poster assets exist on disk with valid timing safeguards', () => {
    assert.equal(BOOT_VIDEO_SRC, '/boot/ludo-3077-boot-v1.mp4');
    assert.equal(BOOT_POSTER_SRC, '/boot/ludo-3077-boot-v1-poster.jpg');
    assert.ok(BOOT_START_TIMEOUT_MS >= 5000 && BOOT_START_TIMEOUT_MS < BOOT_DURATION_MS);
    assert.ok(BOOT_MAX_TIMEOUT_MS >= 15000);

    const videoDiskPath = path.resolve(process.cwd(), 'public', BOOT_VIDEO_SRC.replace(/^\//, ''));
    const posterDiskPath = path.resolve(process.cwd(), 'public', BOOT_POSTER_SRC.replace(/^\//, ''));
    assert.ok(fs.existsSync(videoDiskPath), 'boot MP4 missing in public/boot/');
    assert.ok(fs.existsSync(posterDiskPath), 'boot poster JPEG missing in public/boot/');
    assert.ok(fs.statSync(videoDiskPath).size > 100_000);
    assert.ok(fs.statSync(posterDiskPath).size > 1_000);
});

test('bootTimeline: telemetry cues are sorted and getBootTelemetryForTime clamps cleanly', () => {
    assert.ok(BOOT_TELEMETRY_CUES.length >= 6);
    for (let i = 1; i < BOOT_TELEMETRY_CUES.length; i++) {
        assert.ok(BOOT_TELEMETRY_CUES[i].startS > BOOT_TELEMETRY_CUES[i - 1].startS);
    }

    assert.equal(getBootTelemetryForTime(-5), BOOT_TELEMETRY_CUES[0].telemetry);
    assert.equal(getBootTelemetryForTime(0), BOOT_TELEMETRY_CUES[0].telemetry);
    assert.equal(getBootTelemetryForTime(7.2), 'ARENA // BOARD MATRIX');
    assert.equal(getBootTelemetryForTime(999), BOOT_TELEMETRY_CUES[BOOT_TELEMETRY_CUES.length - 1].telemetry);
});

test('public/_headers: marks /boot/* immutable for disk caching across reloads', () => {
    const headers = readRepoFile('public/_headers');
    assert.match(headers, /\/boot\/\*/);
    assert.match(headers, /Cache-Control:\s*public,max-age=31536000,immutable/);
});

test('BootSequence & page.tsx: tries unmuted autoplay, never flashes TAP FOR AUDIO, stabilizes callback, and guards duration', () => {
    const bootSrc = readRepoFile('app/components/BootSequence.tsx');
    assert.match(bootSrc, /<video/);
    assert.match(bootSrc, /onCompleteRef/);
    assert.match(bootSrc, /video\.muted = false/);
    assert.match(bootSrc, /video\.duration >= 1/);
    assert.match(bootSrc, /NETWORK_LOADING/);
    assert.match(bootSrc, /playsInline/);
    assert.match(bootSrc, /prefersReducedMotion/);
    assert.match(bootSrc, /useBootPreload/);
    assert.doesNotMatch(bootSrc, /TAP FOR AUDIO/);
    assert.doesNotMatch(bootSrc, /SKIP/);

    const pageSrc = readRepoFile('app/page.tsx');
    assert.match(pageSrc, /handleBootComplete/);
    assert.match(pageSrc, /BootSequence/);
    assert.match(pageSrc, /prefersReducedMotion/);
});
