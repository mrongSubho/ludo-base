import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
    BOOT_BUFFER_MAX_WAIT_MS,
    BOOT_LOCKUP_MIN_MS,
    BOOT_MAX_TIMEOUT_MS,
    BOOT_POSTER_SRC,
    BOOT_STALL_TIMEOUT_MS,
    BOOT_SUBSYSTEM_NODES,
    BOOT_TELEMETRY_CUES,
    BOOT_VIDEO_SRC,
    getBootTelemetryForTime,
} from '../lib/boot/bootTimeline';

function readRepoFile(relPath: string): string {
    return fs.readFileSync(path.resolve(process.cwd(), relPath), 'utf8');
}

test('bootTimeline: v3 trimmed video & poster assets exist under 2MB with valid two-phase safeguards', () => {
    assert.equal(BOOT_VIDEO_SRC, '/boot/ludo-3077-boot-v3.mp4');
    assert.equal(BOOT_POSTER_SRC, '/boot/ludo-3077-boot-v3-poster.jpg');
    assert.ok(BOOT_LOCKUP_MIN_MS >= 1500 && BOOT_BUFFER_MAX_WAIT_MS >= BOOT_LOCKUP_MIN_MS);
    assert.ok(BOOT_STALL_TIMEOUT_MS >= 6000);
    assert.ok(BOOT_MAX_TIMEOUT_MS >= 20000);
    assert.deepEqual(BOOT_SUBSYSTEM_NODES, ['AUTH', 'SYNC', 'VAULT', 'ARENA', 'CORE']);

    const videoDiskPath = path.resolve(process.cwd(), 'public', BOOT_VIDEO_SRC.replace(/^\//, ''));
    const posterDiskPath = path.resolve(process.cwd(), 'public', BOOT_POSTER_SRC.replace(/^\//, ''));
    assert.ok(fs.existsSync(videoDiskPath), 'boot MP4 v3 missing in public/boot/');
    assert.ok(fs.existsSync(posterDiskPath), 'boot poster JPEG v3 missing in public/boot/');
    const videoSize = fs.statSync(videoDiskPath).size;
    assert.ok(videoSize > 500_000 && videoSize < 2_000_000, `expected trimmed v3 MP4 under 2MB, got ${videoSize}`);
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

test('bootPhase1Audio: exports BootPhase1Synth with REA-12 node cleanup', () => {
    const synthSrc = readRepoFile('lib/boot/bootPhase1Audio.ts');
    assert.match(synthSrc, /class BootPhase1Synth/);
    assert.match(synthSrc, /tryResume\s*\(/);
    assert.match(synthSrc, /playStepTick\s*\(/);
    assert.match(synthSrc, /playReadyChime\s*\(/);
    assert.match(synthSrc, /dispose\s*\(/);
    assert.match(synthSrc, /\.disconnect\s*\(/);
});

test('BootSequence & page.tsx: runs two-phase lockup -> auto-launch video with laser rail and zero nag banners', () => {
    const headers = readRepoFile('public/_headers');
    assert.match(headers, /\/boot\/\*/);
    assert.match(headers, /Cache-Control:\s*public,max-age=31536000,immutable/);

    const bootSrc = readRepoFile('app/components/BootSequence.tsx');
    assert.match(bootSrc, /'lockup'\s*\|\s*'video'\s*\|\s*'fallback'/);
    assert.match(bootSrc, /BootPhase1Synth/);
    assert.match(bootSrc, /BOOT_SUBSYSTEM_NODES/);
    assert.match(bootSrc, /THE ONCHAIN ARENA/);
    assert.match(bootSrc, /launchVideoPhase/);
    assert.match(bootSrc, /onCompleteRef/);
    assert.match(bootSrc, /prefersReducedMotion/);
    assert.doesNotMatch(bootSrc, /TAP FOR AUDIO/);
    assert.doesNotMatch(bootSrc, /SKIP/);

    const pageSrc = readRepoFile('app/page.tsx');
    assert.match(pageSrc, /handleBootComplete/);
    assert.match(pageSrc, /BootSequence/);
    assert.match(pageSrc, /reducedMotion/);
});
