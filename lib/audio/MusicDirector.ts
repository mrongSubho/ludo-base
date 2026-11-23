import {
    playDrumHat,
    playDrumKick,
    playDrumSnareClap,
    playHeartbeatPulse,
    playNoiseBurst,
    playPercAccent,
    playTone,
    playWarmVoice,
} from './synthPrimitives';
import type { AudioTheme, MusicScene } from './types';

interface ThemeScore {
    lobbyBpm: number;
    matchBpm: number;
    /** 8-bar bass root progression (Hz) */
    bassRoots: readonly number[];
    /** 8-bar chord voicings (Hz) */
    chords: readonly (readonly number[])[];
    /** 8 bars × 8 eighth-note hook phrases (0 = rest) */
    hooks: readonly (readonly number[])[];
    /** Bass pattern: 1 = root, 2 = octave up, 3 = fifth up, 0 = rest (16 steps/bar) */
    bassPattern: readonly number[];
    /** Chord stab pattern (16 steps/bar, value = duration multiplier, 0 = rest) */
    stabPattern: readonly number[];
    bassWave: OscillatorType;
    stabWave: OscillatorType;
    leadWave: OscillatorType;
    clapStyle: 'clap' | 'snare' | 'rim';
    hatPitch: number;
    percFreq: number;
}

const THEME_SCORES: Record<AudioTheme, ThemeScore> = {
    // 3077: "Cyber VIP Arena" — High-energy E minor / Dorian Tech-House (124 -> 130 BPM)
    '3077': {
        lobbyBpm: 124,
        matchBpm: 130,
        bassRoots: [82.41, 98.0, 110.0, 123.47, 82.41, 98.0, 73.42, 61.74], // E2, G2, A2, B2, E2, G2, D2, B1
        chords: [
            [329.63, 392.0, 493.88, 587.33], // Em7
            [392.0, 493.88, 587.33, 739.99], // Gmaj7
            [440.0, 523.25, 659.25, 783.99], // Am7
            [493.88, 587.33, 739.99, 880.0], // Bm7
            [329.63, 392.0, 493.88, 659.25], // Em9 feel
            [392.0, 493.88, 587.33, 659.25], // G6
            [293.66, 369.99, 440.0, 587.33], // Dadd9
            [246.94, 329.63, 392.0, 493.88], // B7sus4
        ],
        hooks: [
            [659.25, 0, 783.99, 987.77, 0, 880.0, 783.99, 659.25],
            [783.99, 0, 987.77, 1174.66, 0, 987.77, 880.0, 783.99],
            [880.0, 0, 1046.5, 1174.66, 0, 1046.5, 987.77, 880.0],
            [987.77, 0, 1174.66, 1318.51, 1174.66, 987.77, 880.0, 783.99],
            [659.25, 783.99, 987.77, 0, 1318.51, 1174.66, 987.77, 783.99],
            [783.99, 987.77, 1174.66, 0, 1479.98, 1318.51, 1174.66, 987.77],
            [880.0, 1046.5, 1174.66, 1318.51, 0, 1174.66, 987.77, 880.0],
            [987.77, 1174.66, 1318.51, 1479.98, 1318.51, 1174.66, 987.77, 783.99],
        ],
        bassPattern: [1, 0, 2, 1, 0, 0, 2, 0, 1, 0, 3, 0, 2, 0, 1, 2],
        stabPattern: [1.2, 0, 0, 0.9, 0, 0, 1.1, 0, 0, 0, 1.0, 0, 0, 0, 0.85, 0],
        bassWave: 'sawtooth',
        stabWave: 'sawtooth',
        leadWave: 'sawtooth',
        clapStyle: 'clap',
        hatPitch: 7600,
        percFreq: 740,
    },
    // Retro-Futurism: "Neon Casino Drive" — Upbeat A Major / F#m Nu-Disco Electro-Funk (122 -> 128 BPM)
    retro: {
        lobbyBpm: 122,
        matchBpm: 128,
        bassRoots: [46.25, 55.0, 61.74, 69.3, 73.42, 82.41, 55.0, 82.41], // F#1, A1, B1, C#2, D2, E2, A1, E2
        chords: [
            [369.99, 440.0, 554.37, 659.25], // F#m7
            [440.0, 554.37, 659.25, 830.61], // Amaj7
            [493.88, 587.33, 739.99, 880.0], // Bm7
            [554.37, 659.25, 830.61, 987.77], // C#m7
            [293.66, 369.99, 440.0, 554.37], // Dmaj7
            [329.63, 415.3, 493.88, 659.25], // E6/Eadd9
            [440.0, 554.37, 659.25, 739.99], // A6
            [329.63, 440.0, 493.88, 659.25], // E7sus4
        ],
        hooks: [
            [739.99, 0, 880.0, 1108.73, 0, 987.77, 880.0, 739.99],
            [880.0, 0, 1108.73, 1318.51, 0, 1108.73, 987.77, 880.0],
            [987.77, 0, 1174.66, 1479.98, 0, 1318.51, 1174.66, 987.77],
            [1108.73, 1318.51, 1479.98, 0, 1318.51, 1108.73, 987.77, 880.0],
            [1174.66, 0, 1318.51, 1479.98, 0, 1318.51, 1108.73, 880.0],
            [1318.51, 0, 1479.98, 1661.22, 0, 1479.98, 1318.51, 1108.73],
            [1108.73, 1318.51, 1760.0, 0, 1661.22, 1479.98, 1318.51, 1108.73],
            [1318.51, 1479.98, 1661.22, 1760.0, 1661.22, 1479.98, 1318.51, 987.77],
        ],
        bassPattern: [1, 0, 2, 0, 1, 0, 2, 1, 0, 2, 1, 0, 2, 3, 2, 0], // Bouncy disco octaves!
        stabPattern: [1.1, 0, 0.85, 0, 0, 0, 1.1, 0, 0, 0.9, 0, 0, 1.0, 0, 0.85, 0],
        bassWave: 'sawtooth',
        stabWave: 'sawtooth',
        leadWave: 'square',
        clapStyle: 'snare',
        hatPitch: 6800,
        percFreq: 860,
    },
    // Daybreak: "Golden Lounge Groove" — Warm Funky G Major / Em Luxury Casino Lounge (116 -> 122 BPM)
    light: {
        lobbyBpm: 116,
        matchBpm: 122,
        bassRoots: [98.0, 82.41, 65.41, 73.42, 98.0, 82.41, 55.0, 73.42], // G2, E2, C2, D2, G2, E2, A1, D2
        chords: [
            [392.0, 493.88, 587.33, 739.99], // Gmaj7
            [329.63, 392.0, 493.88, 659.25], // Em9
            [261.63, 329.63, 392.0, 493.88], // Cmaj7
            [293.66, 392.0, 440.0, 587.33], // D9sus4
            [392.0, 493.88, 587.33, 659.25], // G6
            [329.63, 392.0, 493.88, 587.33], // Em7
            [220.0, 261.63, 329.63, 392.0],  // Am7
            [293.66, 369.99, 440.0, 523.25], // D7
        ],
        hooks: [
            [783.99, 0, 987.77, 1174.66, 0, 1174.66, 987.77, 783.99],
            [659.25, 0, 783.99, 987.77, 0, 880.0, 783.99, 659.25],
            [523.25, 0, 659.25, 783.99, 987.77, 0, 880.0, 783.99],
            [783.99, 880.0, 987.77, 1174.66, 0, 987.77, 880.0, 783.99],
            [783.99, 987.77, 1174.66, 1318.51, 0, 1174.66, 987.77, 783.99],
            [987.77, 0, 1174.66, 1318.51, 0, 1174.66, 987.77, 880.0],
            [880.0, 1046.5, 1174.66, 0, 1318.51, 1174.66, 987.77, 880.0],
            [987.77, 1174.66, 1479.98, 1318.51, 1174.66, 987.77, 880.0, 783.99],
        ],
        bassPattern: [1, 0, 0, 2, 0, 0, 1, 0, 1, 0, 2, 0, 3, 0, 2, 0],
        stabPattern: [1.3, 0, 0, 0.9, 0, 0, 1.0, 0, 0, 0, 1.1, 0, 0, 0.8, 0, 0],
        bassWave: 'triangle',
        stabWave: 'triangle',
        leadWave: 'triangle',
        clapStyle: 'rim',
        hatPitch: 6000,
        percFreq: 560,
    },
};

const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD_SEC = 0.14;
const STEPS_PER_BAR = 16;
const TOTAL_BARS = 8;
const TOTAL_STEPS = STEPS_PER_BAR * TOTAL_BARS; // 128 steps per loop

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
    private getDrumDest: () => AudioNode | null;
    private getMelodyDest: () => AudioNode | null;
    private getHeartbeatDest: () => AudioNode | null;
    private onFilterTarget: (cutoffHz: number, q: number) => void;

    constructor(deps: {
        getCtx: () => AudioContext | null;
        getMusicDest: () => AudioNode | null;
        getDrumDest?: () => AudioNode | null;
        getMelodyDest?: () => AudioNode | null;
        getHeartbeatDest: () => AudioNode | null;
        onFilterTarget: (cutoffHz: number, q: number) => void;
    }) {
        this.getCtx = deps.getCtx;
        this.getDrumDest = deps.getDrumDest ?? deps.getMusicDest;
        this.getMelodyDest = deps.getMelodyDest ?? deps.getMusicDest;
        this.getHeartbeatDest = deps.getHeartbeatDest;
        this.onFilterTarget = deps.onFilterTarget;
    }

    public getState(): { theme: AudioTheme; scene: MusicScene; urgency: number; isPlaying: boolean; step: number; bpm: number } {
        return {
            theme: this.theme,
            scene: this.scene,
            urgency: this.urgency,
            isPlaying: this.isPlaying,
            step: this.step,
            bpm: this.currentBpm(),
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
        this.nextNoteTime = ctx.currentTime + 0.025;
        this.nextHeartbeatTime = ctx.currentTime + 0.035;
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
        const drumDest = this.getDrumDest();
        const melodyDest = this.getMelodyDest();
        if (!ctx || !drumDest || !melodyDest) return 0;
        if (ctx.state === 'suspended') return 0;

        let scheduled = 0;
        if (this.nextNoteTime < ctx.currentTime - 0.5) {
            this.nextNoteTime = ctx.currentTime + 0.02;
        }

        while (this.nextNoteTime < ctx.currentTime + SCHEDULE_AHEAD_SEC) {
            this.scheduleStep(ctx, drumDest, melodyDest, this.step, this.nextNoteTime);
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
            const beatBpm = 88 + this.urgency * 36; // 88..124 BPM intense crunch heartbeat
            if (offset <= 0.045) {
                playHeartbeatPulse(ctx, dest, this.urgency);
                fired++;
            }
            this.nextHeartbeatTime += 60 / beatBpm;
            if (offset > 0.045) break;
        }
        return fired;
    }

    private currentBpm(): number {
        const score = THEME_SCORES[this.theme];
        const isMatch =
            this.scene === 'match_calm' ||
            this.scene === 'match_heat' ||
            this.scene === 'match_crunch';
        const baseBpm = isMatch ? score.matchBpm : score.lobbyBpm;
        return this.scene === 'queueing' ? baseBpm + 6 : baseBpm;
    }

    private stepDurationSec(): number {
        return 60 / this.currentBpm() / 4; // 16th-note step
    }

    private updateFilterForScene(): void {
        if (this.scene === 'match_crunch') {
            this.onFilterTarget(2600, 1.3); // Warm, tense focus without cold muffling
        } else if (this.scene === 'match_calm') {
            this.onFilterTarget(7500, 0.8);
        } else if (this.scene === 'result') {
            this.onFilterTarget(4200, 0.7);
        } else {
            this.onFilterTarget(11500, 0.7); // Open, crisp stadium presence
        }
    }

    private scheduleStep(
        ctx: AudioContext,
        drumDest: AudioNode,
        melodyDest: AudioNode,
        stepIndex: number,
        whenSec: number,
    ): void {
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
        const hookSeq = score.hooks[bar];

        // 1. Driving Club / Arena Drums (always energetic — never sleepy!)
        if (!isResult) {
            const kickOnBeat = stepInBar % 4 === 0;
            const kickSynco = (this.theme === 'light' || isHeat) && stepInBar === 10 && bar % 2 === 1;
            if (kickOnBeat || kickSynco) {
                playDrumKick(ctx, drumDest, offset, kickOnBeat ? 0.22 : 0.14);
            }

            // Snare / Clap backbeat on 2 & 4 (steps 4 & 12) + hype bar-4/8 turnaround fills
            const isTurnaround = (bar === 3 || bar === 7) && stepInBar >= 12;
            if (stepInBar === 4 || stepInBar === 12) {
                playDrumSnareClap(ctx, drumDest, offset, isCalm ? 0.11 : 0.145, score.clapStyle);
            } else if (isTurnaround && !isCalm && (stepInBar === 14 || stepInBar === 15)) {
                playDrumSnareClap(ctx, drumDest, offset, 0.085 + (stepInBar - 14) * 0.03, score.clapStyle);
            }

            // Hats & offbeat bounce
            if (isCrunch || isQueue) {
                // Urgent driving 16th hi-hats
                playDrumHat(ctx, drumDest, offset, stepInBar % 2 === 0 ? 0.048 : 0.03, stepInBar % 4 === 2, score.hatPitch);
            } else if (stepInBar % 2 === 0) {
                const isOpen = stepInBar % 4 === 2 && !isCalm;
                playDrumHat(ctx, drumDest, offset, isOpen ? 0.058 : 0.036, isOpen, score.hatPitch);
            } else if ((isLobby || isHeat) && (stepInBar === 7 || stepInBar === 15)) {
                playDrumHat(ctx, drumDest, offset, 0.026, false, score.hatPitch + 900);
            }

            // Syncopated percussion pocket
            if ((isLobby || isHeat || isQueue) && (stepInBar === 3 || stepInBar === 11)) {
                playPercAccent(ctx, drumDest, offset, 0.052, score.percFreq, stepInBar === 3 ? -0.35 : 0.35);
            }
        }

        // 2. Warm Punchy Bouncing Bassline
        if (!isResult) {
            const bassPat = score.bassPattern[stepInBar];
            if (bassPat > 0) {
                const mult = bassPat === 2 ? 2 : bassPat === 3 ? 1.5 : 1;
                const accent = stepInBar === 0 || bassPat === 2 ? 1.15 : 0.9;
                playWarmVoice(ctx, drumDest, {
                    type: score.bassWave,
                    type2: 'triangle',
                    freq: root * mult,
                    octaveSub: bassPat === 2,
                    detuneCents: 6,
                    startOffset: offset,
                    attack: 0.004,
                    duration: stepDur * (bassPat === 2 ? 1.3 : 1.8),
                    gain: (isCalm ? 0.082 : 0.105) * accent,
                    filterFreq: this.theme === 'light' ? 780 : 1050,
                    filterFreqEnd: 260,
                    filterQ: 2.2,
                });
            }
        }

        // 3. Warm Syncopated Chord Stabs (with stereo delay glow)
        const stabDurMult = score.stabPattern[stepInBar];
        if (isResult && stepInBar === 0) {
            chord.forEach((f, idx) => {
                playWarmVoice(ctx, melodyDest, {
                    type: 'triangle',
                    type2: 'sine',
                    freq: f,
                    detuneCents: 7,
                    startOffset: offset,
                    attack: 0.03,
                    duration: stepDur * 12,
                    gain: 0.032,
                    filterFreq: 3200,
                    filterFreqEnd: 1600,
                    pan: (idx - 1.5) * 0.25,
                });
            });
        } else if (!isResult && stabDurMult > 0) {
            const stabGain = isCalm ? 0.028 : isCrunch ? 0.036 : 0.044;
            const cutoff = isCrunch ? 2400 : isQueue ? 5600 : 4400;
            chord.forEach((f, idx) => {
                playWarmVoice(ctx, melodyDest, {
                    type: score.stabWave,
                    type2: 'triangle',
                    freq: f,
                    detuneCents: 9,
                    startOffset: offset,
                    attack: 0.005,
                    duration: stepDur * 1.45 * stabDurMult,
                    gain: stabGain / Math.sqrt(chord.length),
                    filterFreq: cutoff,
                    filterFreqEnd: Math.max(600, cutoff * 0.35),
                    filterQ: 1.5,
                    pan: (idx % 2 === 0 ? -1 : 1) * 0.3,
                });
            });
        }

        // 4. Catchy Call-and-Response Lead Hook (Lobby, Queue & Match Heat)
        if ((isLobby || isQueue || isHeat) && stepInBar % 2 === 0) {
            const note = hookSeq[stepInBar / 2];
            if (note > 0) {
                const pan = stepInBar % 4 === 0 ? -0.22 : 0.22;
                playWarmVoice(ctx, melodyDest, {
                    type: score.leadWave,
                    type2: 'triangle',
                    freq: note,
                    detuneCents: 8,
                    startOffset: offset,
                    attack: 0.005,
                    duration: stepDur * 1.75,
                    gain: isQueue || isHeat ? 0.068 : 0.056,
                    filterFreq: 5200,
                    filterFreqEnd: 1900,
                    filterQ: 1.8,
                    pan,
                });
            }
        }

        // 5. Hype Bar-4 / Bar-8 Noise Riser Sweep
        if ((isLobby || isQueue || isHeat) && (bar === 3 || bar === 7) && stepInBar === 10) {
            playNoiseBurst(ctx, melodyDest, {
                startOffset: offset,
                attack: stepDur * 2.5,
                duration: stepDur * 5.8,
                gain: isQueue ? 0.075 : 0.055,
                filterType: 'bandpass',
                filterFreq: 650,
                filterFreqEnd: 4600,
                filterQ: 1.9,
            });
        }

        // 6. Queueing energetic anticipation ping
        if (isQueue && stepInBar === 0 && bar % 2 === 0) {
            playTone(ctx, melodyDest, {
                type: 'sine',
                freq: 1480,
                freqEnd: 1975,
                startOffset: offset,
                attack: 0.004,
                duration: 0.18,
                gain: 0.048,
            });
        }
    }
}
