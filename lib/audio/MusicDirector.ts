import { playHeartbeatPulse, playNoiseBurst, playTone } from './synthPrimitives';
import type { AudioTheme, MusicScene } from './types';

interface ThemeScore {
    lobbyBpm: number;
    matchBpm: number;
    chords: readonly (readonly number[])[];
    bassRoots: readonly number[];
    arpNotes: readonly (readonly number[])[];
    bassWave: OscillatorType;
    padWave: OscillatorType;
    leadWave: OscillatorType;
    padCutoff: number;
    leadCutoff: number;
    hatPitch: number;
}

const THEME_SCORES: Record<AudioTheme, ThemeScore> = {
    // 3077: Cyber-Tactical Grid (D Dorian / D minor)
    '3077': {
        lobbyBpm: 100,
        matchBpm: 108,
        bassRoots: [73.42, 58.27, 65.41, 55.0], // D2, Bb1, C2, A1
        chords: [
            [293.66, 349.23, 440.0, 523.25], // Dm7
            [233.08, 293.66, 349.23, 440.0], // Bbmaj7
            [261.63, 329.63, 392.0, 466.16], // C7sus/C9 feel
            [220.0, 261.63, 329.63, 392.0],  // Am7
        ],
        arpNotes: [
            [587.33, 880.0, 1046.5, 880.0],
            [466.16, 698.46, 880.0, 698.46],
            [523.25, 783.99, 987.77, 783.99],
            [440.0, 659.25, 880.0, 659.25],
        ],
        bassWave: 'sawtooth',
        padWave: 'triangle',
        leadWave: 'triangle',
        padCutoff: 880,
        leadCutoff: 2400,
        hatPitch: 6200,
    },
    // Retro-Futurism: Neon Synthwave (A minor)
    retro: {
        lobbyBpm: 108,
        matchBpm: 116,
        bassRoots: [55.0, 43.65, 65.41, 49.0], // A1, F1, C2, G1
        chords: [
            [220.0, 261.63, 329.63, 440.0], // Am
            [174.61, 220.0, 261.63, 329.63], // Fmaj7
            [261.63, 329.63, 392.0, 493.88], // Cmaj7
            [196.0, 246.94, 293.66, 392.0], // G
        ],
        arpNotes: [
            [440.0, 523.25, 659.25, 880.0],
            [349.23, 440.0, 523.25, 698.46],
            [523.25, 659.25, 783.99, 1046.5],
            [392.0, 493.88, 587.33, 783.99],
        ],
        bassWave: 'sawtooth',
        padWave: 'sawtooth',
        leadWave: 'sawtooth',
        padCutoff: 740,
        leadCutoff: 1950,
        hatPitch: 4800,
    },
    // Daybreak: Warm Tactile Atrium (F major / D minor pentatonic)
    light: {
        lobbyBpm: 90,
        matchBpm: 98,
        bassRoots: [87.31, 73.42, 58.27, 65.41], // F2, D2, Bb1, C2
        chords: [
            [349.23, 440.0, 523.25, 659.25], // Fmaj7
            [293.66, 349.23, 440.0, 523.25], // Dm7
            [233.08, 293.66, 349.23, 440.0], // Bbmaj7
            [261.63, 349.23, 392.0, 523.25], // C9sus4
        ],
        arpNotes: [
            [698.46, 880.0, 1046.5, 880.0],
            [587.33, 698.46, 880.0, 698.46],
            [466.16, 587.33, 698.46, 587.33],
            [523.25, 698.46, 783.99, 698.46],
        ],
        bassWave: 'sine',
        padWave: 'sine',
        leadWave: 'sine',
        padCutoff: 1200,
        leadCutoff: 2800,
        hatPitch: 3600,
    },
};

const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD_SEC = 0.14;
const STEPS_PER_BAR = 16;
const TOTAL_BARS = 4;
const TOTAL_STEPS = STEPS_PER_BAR * TOTAL_BARS; // 64 steps per loop

export class MusicDirector {
    private theme: AudioTheme = '3077';
    private scene: MusicScene = 'silent';
    private urgency = 0;
    private step = 0;
    private nextNoteTime = 0;
    private timerId: ReturnType<typeof setInterval> | null = null;
    private nextHeartbeatTime = 0;
    private heartbeatTimerId: ReturnType<typeof setInterval> | null = null;
    private isPlaying = false;

    private getCtx: () => AudioContext | null;
    private getMusicDest: () => AudioNode | null;
    private getHeartbeatDest: () => AudioNode | null;
    private onFilterTarget: (cutoffHz: number, q: number) => void;

    constructor(deps: {
        getCtx: () => AudioContext | null;
        getMusicDest: () => AudioNode | null;
        getHeartbeatDest: () => AudioNode | null;
        onFilterTarget: (cutoffHz: number, q: number) => void;
    }) {
        this.getCtx = deps.getCtx;
        this.getMusicDest = deps.getMusicDest;
        this.getHeartbeatDest = deps.getHeartbeatDest;
        this.onFilterTarget = deps.onFilterTarget;
    }

    public getState(): { theme: AudioTheme; scene: MusicScene; urgency: number; isPlaying: boolean; step: number } {
        return {
            theme: this.theme,
            scene: this.scene,
            urgency: this.urgency,
            isPlaying: this.isPlaying,
            step: this.step,
        };
    }

    public setTheme(next: AudioTheme): void {
        if (this.theme === next) return;
        this.theme = next;
    }

    public setScene(next: MusicScene, urgency = 0): void {
        const clampedUrgency = Math.max(0, Math.min(1, urgency));
        const sceneChanged = this.scene !== next;
        this.scene = next;
        this.urgency = clampedUrgency;

        if (next === 'silent') {
            this.stop();
            return;
        }

        this.updateFilterForScene();
        if (!this.isPlaying) {
            this.start();
        } else if (sceneChanged && next === 'match_crunch') {
            const ctx = this.getCtx();
            if (ctx) this.nextHeartbeatTime = ctx.currentTime + 0.04;
        }
    }

    public start(): void {
        const ctx = this.getCtx();
        if (!ctx || this.scene === 'silent') return;
        if (this.isPlaying) return;

        this.isPlaying = true;
        this.nextNoteTime = ctx.currentTime + 0.03;
        this.nextHeartbeatTime = ctx.currentTime + 0.04;
        this.updateFilterForScene();

        if (!this.timerId) {
            this.timerId = setInterval(() => this.schedulerTick(), LOOKAHEAD_MS);
        }
        if (!this.heartbeatTimerId) {
            this.heartbeatTimerId = setInterval(() => this.heartbeatTick(), 40);
        }
        this.schedulerTick();
        this.heartbeatTick();
    }

    public stop(): void {
        this.isPlaying = false;
        if (this.timerId) {
            clearInterval(this.timerId);
            this.timerId = null;
        }
        if (this.heartbeatTimerId) {
            clearInterval(this.heartbeatTimerId);
            this.heartbeatTimerId = null;
        }
    }

    /** Exposed for deterministic unit testing and manual lookahead pumping. */
    public schedulerTick(): number {
        if (!this.isPlaying || this.scene === 'silent') return 0;
        const ctx = this.getCtx();
        const dest = this.getMusicDest();
        if (!ctx || !dest) return 0;
        if (ctx.state === 'suspended') return 0;

        let scheduled = 0;
        if (this.nextNoteTime < ctx.currentTime - 0.5) {
            // Recover cleanly after tab suspension
            this.nextNoteTime = ctx.currentTime + 0.02;
        }

        while (this.nextNoteTime < ctx.currentTime + SCHEDULE_AHEAD_SEC) {
            this.scheduleStep(ctx, dest, this.step, this.nextNoteTime);
            const stepDur = this.stepDurationSec();
            this.nextNoteTime += stepDur;
            this.step = (this.step + 1) % TOTAL_STEPS;
            scheduled++;
        }
        return scheduled;
    }

    public heartbeatTick(): number {
        if (!this.isPlaying || this.scene !== 'match_crunch') return 0;
        const ctx = this.getCtx();
        const dest = this.getHeartbeatDest();
        if (!ctx || !dest || ctx.state === 'suspended') return 0;

        if (this.nextHeartbeatTime < ctx.currentTime - 0.8) {
            this.nextHeartbeatTime = ctx.currentTime + 0.03;
        }

        let fired = 0;
        while (this.nextHeartbeatTime < ctx.currentTime + 0.12) {
            const offset = Math.max(0, this.nextHeartbeatTime - ctx.currentTime);
            if (offset <= 0.04) {
                playHeartbeatPulse(ctx, dest, this.urgency);
                fired++;
            } else {
                // Schedule aligned to beat interval
                const beatBpm = 76 + this.urgency * 36; // 76..112 BPM
                this.nextHeartbeatTime += 60 / beatBpm;
                break;
            }
            const beatBpm = 76 + this.urgency * 36;
            this.nextHeartbeatTime += 60 / beatBpm;
        }
        return fired;
    }

    private stepDurationSec(): number {
        const score = THEME_SCORES[this.theme];
        const isMatch =
            this.scene === 'match_calm' ||
            this.scene === 'match_heat' ||
            this.scene === 'match_crunch';
        const baseBpm = isMatch ? score.matchBpm : score.lobbyBpm;
        const bpm = this.scene === 'queueing' ? baseBpm + 6 : baseBpm;
        return 60 / bpm / 4; // 16th-note step
    }

    private updateFilterForScene(): void {
        if (this.scene === 'match_crunch') {
            this.onFilterTarget(720, 1.4);
        } else if (this.scene === 'match_calm') {
            this.onFilterTarget(1550, 0.9);
        } else if (this.scene === 'result') {
            this.onFilterTarget(900, 0.7);
        } else {
            this.onFilterTarget(3400, 0.7);
        }
    }

    private scheduleStep(ctx: AudioContext, dest: AudioNode, stepIndex: number, whenSec: number): void {
        const score = THEME_SCORES[this.theme];
        const bar = Math.floor(stepIndex / STEPS_PER_BAR) % TOTAL_BARS;
        const stepInBar = stepIndex % STEPS_PER_BAR;
        const offset = Math.max(0, whenSec - ctx.currentTime);
        const stepDur = this.stepDurationSec();

        const isLobby = this.scene === 'lobby';
        const isQueue = this.scene === 'queueing';
        const isCalm = this.scene === 'match_calm';
        const isHeat = this.scene === 'match_heat';
        const isCrunch = this.scene === 'match_crunch';
        const isResult = this.scene === 'result';

        const root = score.bassRoots[bar];
        const chord = score.chords[bar];
        const arpSeq = score.arpNotes[bar];

        // 1. Warm ambient pad chord on bar start (step 0)
        if (stepInBar === 0) {
            const padLevel = isResult ? 0.018 : isCrunch ? 0.022 : 0.032;
            chord.forEach((freq) => {
                playTone(ctx, dest, {
                    type: score.padWave,
                    freq,
                    startOffset: offset,
                    attack: stepDur * 2.2,
                    duration: stepDur * 14.5,
                    gain: padLevel / Math.sqrt(chord.length),
                    filterType: 'lowpass',
                    filterFreq: score.padCutoff,
                    filterFreqEnd: score.padCutoff * 0.65,
                });
            });
        }

        // 2. Bassline pulse
        if (!isResult) {
            const bassPattern =
                this.theme === 'retro'
                    ? stepInBar % 2 === 0 // Driving 8th-note synthwave bass
                    : stepInBar === 0 || stepInBar === 6 || stepInBar === 10 || (isHeat && stepInBar === 14);
            if (bassPattern) {
                const accent = stepInBar === 0 ? 1.15 : 0.85;
                const bassFreq = stepInBar === 10 && this.theme !== 'light' ? root * 1.5 : root;
                playTone(ctx, dest, {
                    type: score.bassWave,
                    freq: bassFreq,
                    startOffset: offset,
                    attack: 0.006,
                    duration: stepDur * (this.theme === 'retro' ? 1.7 : 2.6),
                    gain: (isCalm ? 0.045 : 0.065) * accent,
                    filterType: 'lowpass',
                    filterFreq: this.theme === 'light' ? 320 : 520,
                    filterFreqEnd: 180,
                });
            }
        }

        // 3. Theme-signature melodic plucks / arpeggios
        if (isLobby || isQueue || isHeat || (isCalm && stepInBar % 4 === 0)) {
            const shouldPluck =
                this.theme === 'light'
                    ? stepInBar === 0 || stepInBar === 3 || stepInBar === 6 || stepInBar === 10 || stepInBar === 12
                    : stepInBar % 2 === 0;
            if (shouldPluck) {
                const note = arpSeq[(stepInBar / 2) % arpSeq.length | 0];
                const octaveMul = isQueue && stepInBar >= 12 ? 2 : 1;
                playTone(ctx, dest, {
                    type: score.leadWave,
                    freq: note * octaveMul,
                    startOffset: offset,
                    attack: 0.005,
                    duration: stepDur * (this.theme === 'light' ? 2.4 : 1.5),
                    gain: isCalm ? 0.02 : isHeat || isQueue ? 0.036 : 0.028,
                    filterType: 'lowpass',
                    filterFreq: score.leadCutoff,
                    filterFreqEnd: score.leadCutoff * 0.45,
                });
            }
        }

        // 4. Percussion groove (subtle pulse kick & filtered hat/shaker)
        if (!isResult && !isCalm) {
            if (stepInBar % 4 === 0 && (isHeat || isCrunch || (this.theme === 'retro' && isLobby))) {
                playTone(ctx, dest, {
                    type: 'sine',
                    freq: 105,
                    freqEnd: 42,
                    startOffset: offset,
                    attack: 0.003,
                    duration: 0.11,
                    gain: isCrunch ? 0.048 : 0.072,
                });
            }
            if ((isHeat || isQueue || (isLobby && stepInBar % 4 === 2)) && stepInBar % 2 === 1) {
                playNoiseBurst(ctx, dest, {
                    startOffset: offset,
                    attack: 0.002,
                    duration: this.theme === 'light' ? 0.035 : 0.024,
                    gain: isHeat ? 0.026 : 0.016,
                    filterType: this.theme === 'light' ? 'bandpass' : 'highpass',
                    filterFreq: score.hatPitch,
                    filterQ: 1.5,
                });
            }
        }

        // 5. Queueing sonar ping on bar 0 & bar 2
        if (isQueue && stepInBar === 0 && bar % 2 === 0) {
            playTone(ctx, dest, {
                type: 'sine',
                freq: 1320,
                startOffset: offset,
                attack: 0.006,
                duration: 0.24,
                gain: 0.038,
            });
        }
    }
}
