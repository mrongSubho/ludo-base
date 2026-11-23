/**
 * Procedural Web Audio synthesis primitives.
 *
 * Strictly enforces the REA-12 teardown contract: every oscillator and buffer
 * source attaches an `onended` callback that disconnects itself and every
 * intermediate GainNode / BiquadFilterNode / StereoPannerNode so long matches
 * never accumulate orphaned nodes in the AudioContext graph.
 */

export interface ToneOpts {
    type?: OscillatorType;
    freq: number;
    freqEnd?: number;
    freqExp?: boolean;
    detune?: number;
    startOffset?: number;
    attack?: number;
    duration: number;
    gain: number;
    filterType?: BiquadFilterType;
    filterFreq?: number;
    filterFreqEnd?: number;
    filterQ?: number;
    pan?: number;
}

export interface WarmVoiceOpts {
    type?: OscillatorType;
    type2?: OscillatorType;
    freq: number;
    freqEnd?: number;
    detuneCents?: number;
    octaveSub?: boolean;
    startOffset?: number;
    attack?: number;
    duration: number;
    gain: number;
    filterFreq?: number;
    filterFreqEnd?: number;
    filterQ?: number;
    pan?: number;
}

export interface NoiseOpts {
    pink?: boolean;
    startOffset?: number;
    attack?: number;
    duration: number;
    gain: number;
    filterType?: BiquadFilterType;
    filterFreq?: number;
    filterFreqEnd?: number;
    filterQ?: number;
    pan?: number;
}

export interface ChordOpts {
    type?: OscillatorType;
    startOffset?: number;
    stagger?: number;
    attack?: number;
    duration: number;
    gain: number;
    filterFreq?: number;
    detune?: number;
}

export interface ReeseBassOpts {
    freq: number;
    freqEnd?: number;
    startOffset?: number;
    attack?: number;
    duration: number;
    gain: number;
    filterFreq?: number;
    filterFreqEnd?: number;
    filterQ?: number;
}

export interface FmBellOpts {
    freq: number;
    modRatio?: number;
    modIndex?: number;
    startOffset?: number;
    attack?: number;
    duration: number;
    gain: number;
    pan?: number;
}

export interface SynthPadOpts {
    startOffset?: number;
    attack?: number;
    duration: number;
    gain: number;
    filterFreq?: number;
    filterFreqEnd?: number;
}

export interface MalletNoteOpts {
    freq: number;
    startOffset?: number;
    duration: number;
    gain: number;
    pan?: number;
}

export interface ElectricPianoOpts {
    startOffset?: number;
    stagger?: number;
    duration: number;
    gain: number;
    panSpread?: number;
    panCenter?: number;
}

export interface BinauralPulseOpts {
    /** Center musical frequency (Hz) in key with current chord */
    freq: number;
    /** Exact frequency delta between Left and Right ears (default 14.0 Hz) */
    beatHz?: number;
    /** Which ear leads this rhythmic bilateral pulse (-1 = Left ear, +1 = Right ear) */
    leadSide: -1 | 1;
    startOffset?: number;
    duration: number;
    gain: number;
}

const MIN_GAIN = 0.0005;
const MIN_HZ = 18;

interface NoiseBank {
    white: AudioBuffer;
    pink: AudioBuffer;
}

const noiseBanks = new WeakMap<AudioContext, NoiseBank>();

function safeDisconnect(node: AudioNode | null | undefined): void {
    if (!node) return;
    try {
        node.disconnect();
    } catch {
        /* already torn down */
    }
}

export function getNoiseBank(ctx: AudioContext): NoiseBank | null {
    const existing = noiseBanks.get(ctx);
    if (existing) return existing;
    if (typeof ctx.createBuffer !== 'function' || !ctx.sampleRate) return null;

    const length = Math.max(1024, Math.floor(ctx.sampleRate * 1.5));
    const white = ctx.createBuffer(1, length, ctx.sampleRate);
    const pink = ctx.createBuffer(1, length, ctx.sampleRate);
    const wData = white.getChannelData(0);
    const pData = pink.getChannelData(0);

    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let b3 = 0;
    let b4 = 0;
    let b5 = 0;
    let b6 = 0;

    for (let i = 0; i < length; i++) {
        const w = Math.random() * 2 - 1;
        wData[i] = w;
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.96900 * b2 + w * 0.1538520;
        b3 = 0.86650 * b3 + w * 0.3104856;
        b4 = 0.55000 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.0168980;
        pData[i] = Math.max(-1, Math.min(1, (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11));
        b6 = w * 0.115926;
    }

    const bank = { white, pink };
    noiseBanks.set(ctx, bank);
    return bank;
}

export function playTone(ctx: AudioContext, dest: AudioNode, opts: ToneOpts): void {
    const now = ctx.currentTime;
    const t0 = now + Math.max(0, opts.startOffset ?? 0);
    const dur = Math.max(0.015, opts.duration);
    const atk = Math.min(dur * 0.45, Math.max(0.002, opts.attack ?? 0.005));
    const tEnd = t0 + dur;
    const peakGain = Math.max(MIN_GAIN * 2, opts.gain);
    const f0 = Math.max(MIN_HZ, opts.freq);
    const f1 = opts.freqEnd !== undefined ? Math.max(MIN_HZ, opts.freqEnd) : undefined;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const teardownNodes: AudioNode[] = [osc, gain];

    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(f0, t0);
    if (opts.detune !== undefined && osc.detune) {
        osc.detune.setValueAtTime(opts.detune, t0);
    }
    if (f1 !== undefined && Math.abs(f1 - f0) > 0.5) {
        if (opts.freqExp === false) {
            osc.frequency.linearRampToValueAtTime(f1, tEnd);
        } else {
            osc.frequency.exponentialRampToValueAtTime(f1, tEnd);
        }
    }

    gain.gain.setValueAtTime(MIN_GAIN, t0);
    gain.gain.linearRampToValueAtTime(peakGain, t0 + atk);
    gain.gain.exponentialRampToValueAtTime(MIN_GAIN, tEnd);

    let tail: AudioNode = osc;
    if (opts.filterType && typeof ctx.createBiquadFilter === 'function') {
        const filter = ctx.createBiquadFilter();
        filter.type = opts.filterType;
        const cf0 = Math.max(40, opts.filterFreq ?? 1800);
        filter.frequency.setValueAtTime(cf0, t0);
        if (opts.filterFreqEnd !== undefined) {
            filter.frequency.exponentialRampToValueAtTime(Math.max(40, opts.filterFreqEnd), tEnd);
        }
        if (opts.filterQ !== undefined) {
            filter.Q.setValueAtTime(opts.filterQ, t0);
        }
        tail.connect(filter);
        tail = filter;
        teardownNodes.push(filter);
    }

    tail.connect(gain);

    if (opts.pan !== undefined && Math.abs(opts.pan) > 0.01 && typeof ctx.createStereoPanner === 'function') {
        const panner = ctx.createStereoPanner();
        panner.pan.setValueAtTime(Math.max(-1, Math.min(1, opts.pan)), t0);
        gain.connect(panner);
        panner.connect(dest);
        teardownNodes.push(panner);
    } else {
        gain.connect(dest);
    }

    osc.onended = () => {
        for (const n of teardownNodes) safeDisconnect(n);
    };
    osc.start(t0);
    osc.stop(tEnd + 0.012);
}

/**
 * Rich dual-oscillator analog/stadium voice with resonant lowpass envelope.
 */
export function playWarmVoice(ctx: AudioContext, dest: AudioNode, opts: WarmVoiceOpts): void {
    const now = ctx.currentTime;
    const t0 = now + Math.max(0, opts.startOffset ?? 0);
    const dur = Math.max(0.025, opts.duration);
    const atk = Math.min(dur * 0.4, Math.max(0.003, opts.attack ?? 0.006));
    const tEnd = t0 + dur;
    const peakGain = Math.max(MIN_GAIN * 2, opts.gain);
    const f0 = Math.max(MIN_HZ, opts.freq);
    const f1 = opts.freqEnd !== undefined ? Math.max(MIN_HZ, opts.freqEnd) : undefined;
    const detune = opts.detuneCents ?? 8;

    const oscA = ctx.createOscillator();
    const oscB = ctx.createOscillator();
    const gain = ctx.createGain();
    const sharedTeardown: AudioNode[] = [gain];

    oscA.type = opts.type ?? 'sawtooth';
    oscB.type = opts.type2 ?? opts.type ?? 'sawtooth';
    oscA.frequency.setValueAtTime(f0, t0);
    oscB.frequency.setValueAtTime(opts.octaveSub ? Math.max(MIN_HZ, f0 * 0.5) : f0, t0);

    if (oscA.detune) oscA.detune.setValueAtTime(detune, t0);
    if (oscB.detune) oscB.detune.setValueAtTime(-detune, t0);

    if (f1 !== undefined && Math.abs(f1 - f0) > 0.5) {
        oscA.frequency.exponentialRampToValueAtTime(f1, tEnd);
        oscB.frequency.exponentialRampToValueAtTime(opts.octaveSub ? Math.max(MIN_HZ, f1 * 0.5) : f1, tEnd);
    }

    gain.gain.setValueAtTime(MIN_GAIN, t0);
    gain.gain.linearRampToValueAtTime(peakGain, t0 + atk);
    gain.gain.exponentialRampToValueAtTime(MIN_GAIN, tEnd);

    let destForOscs: AudioNode = gain;
    if (typeof ctx.createBiquadFilter === 'function') {
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        const cf0 = Math.max(80, opts.filterFreq ?? 3200);
        const cf1 = Math.max(80, opts.filterFreqEnd ?? cf0 * 0.38);
        filter.frequency.setValueAtTime(cf0, t0);
        filter.frequency.exponentialRampToValueAtTime(cf1, tEnd);
        filter.Q.setValueAtTime(opts.filterQ ?? 1.6, t0);
        filter.connect(gain);
        destForOscs = filter;
        sharedTeardown.push(filter);
    }

    oscA.connect(destForOscs);
    oscB.connect(destForOscs);

    if (opts.pan !== undefined && Math.abs(opts.pan) > 0.01 && typeof ctx.createStereoPanner === 'function') {
        const panner = ctx.createStereoPanner();
        panner.pan.setValueAtTime(Math.max(-1, Math.min(1, opts.pan)), t0);
        gain.connect(panner);
        panner.connect(dest);
        sharedTeardown.push(panner);
    } else {
        gain.connect(dest);
    }

    let ended = 0;
    const finishShared = () => {
        if (++ended >= 2) {
            for (const n of sharedTeardown) safeDisconnect(n);
        }
    };
    oscA.onended = () => {
        safeDisconnect(oscA);
        finishShared();
    };
    oscB.onended = () => {
        safeDisconnect(oscB);
        finishShared();
    };

    oscA.start(t0);
    oscB.start(t0);
    oscA.stop(tEnd + 0.012);
    oscB.stop(tEnd + 0.012);
}

/**
 * 3077 Cyberpunk Dark-Synth / Phonk Reese Bass:
 * Wide-detuned dual sawtooth + sub-octave square/sine through a high-Q resonant lowpass sweep.
 */
export function playReeseBass(ctx: AudioContext, dest: AudioNode, opts: ReeseBassOpts): void {
    const now = ctx.currentTime;
    const t0 = now + Math.max(0, opts.startOffset ?? 0);
    const dur = Math.max(0.04, opts.duration);
    const atk = Math.min(dur * 0.35, Math.max(0.004, opts.attack ?? 0.008));
    const tEnd = t0 + dur;
    const peakGain = Math.max(MIN_GAIN * 2, opts.gain);
    const f0 = Math.max(MIN_HZ, opts.freq);
    const f1 = opts.freqEnd !== undefined ? Math.max(MIN_HZ, opts.freqEnd) : undefined;

    const sawL = ctx.createOscillator();
    const sawR = ctx.createOscillator();
    const subOsc = ctx.createOscillator();
    const gain = ctx.createGain();
    const sharedTeardown: AudioNode[] = [gain];

    sawL.type = 'sawtooth';
    sawR.type = 'sawtooth';
    subOsc.type = 'square';

    sawL.frequency.setValueAtTime(f0, t0);
    sawR.frequency.setValueAtTime(f0, t0);
    subOsc.frequency.setValueAtTime(Math.max(MIN_HZ, f0 * 0.5), t0);

    if (sawL.detune) sawL.detune.setValueAtTime(16, t0);
    if (sawR.detune) sawR.detune.setValueAtTime(-16, t0);

    if (f1 !== undefined && Math.abs(f1 - f0) > 0.5) {
        sawL.frequency.exponentialRampToValueAtTime(f1, tEnd);
        sawR.frequency.exponentialRampToValueAtTime(f1, tEnd);
        subOsc.frequency.exponentialRampToValueAtTime(Math.max(MIN_HZ, f1 * 0.5), tEnd);
    }

    gain.gain.setValueAtTime(MIN_GAIN, t0);
    gain.gain.linearRampToValueAtTime(peakGain, t0 + atk);
    gain.gain.exponentialRampToValueAtTime(MIN_GAIN, tEnd);

    let destForOscs: AudioNode = gain;
    if (typeof ctx.createBiquadFilter === 'function') {
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        const cf0 = Math.max(90, opts.filterFreq ?? 1350);
        const cf1 = Math.max(70, opts.filterFreqEnd ?? 210);
        filter.frequency.setValueAtTime(cf0, t0);
        filter.frequency.exponentialRampToValueAtTime(cf1, tEnd);
        filter.Q.setValueAtTime(opts.filterQ ?? 3.1, t0);
        filter.connect(gain);
        destForOscs = filter;
        sharedTeardown.push(filter);
    }

    sawL.connect(destForOscs);
    sawR.connect(destForOscs);
    subOsc.connect(destForOscs);
    gain.connect(dest);

    let ended = 0;
    const finishShared = () => {
        if (++ended >= 3) {
            for (const n of sharedTeardown) safeDisconnect(n);
        }
    };
    sawL.onended = () => {
        safeDisconnect(sawL);
        finishShared();
    };
    sawR.onended = () => {
        safeDisconnect(sawR);
        finishShared();
    };
    subOsc.onended = () => {
        safeDisconnect(subOsc);
        finishShared();
    };

    sawL.start(t0);
    sawR.start(t0);
    subOsc.start(t0);
    sawL.stop(tEnd + 0.012);
    sawR.stop(tEnd + 0.012);
    subOsc.stop(tEnd + 0.012);
}

/**
 * Retro 80s DX-style 2-Operator FM Synthesizer Bell / Pluck Lead.
 */
export function playFmBell(ctx: AudioContext, dest: AudioNode, opts: FmBellOpts): void {
    const now = ctx.currentTime;
    const t0 = now + Math.max(0, opts.startOffset ?? 0);
    const dur = Math.max(0.04, opts.duration);
    const atk = Math.min(dur * 0.25, Math.max(0.003, opts.attack ?? 0.004));
    const tEnd = t0 + dur;
    const peakGain = Math.max(MIN_GAIN * 2, opts.gain);
    const f0 = Math.max(MIN_HZ, opts.freq);
    const ratio = opts.modRatio ?? 2.0;
    const modIndex = opts.modIndex ?? 2.6;

    const carrier = ctx.createOscillator();
    const modulator = ctx.createOscillator();
    const modGain = ctx.createGain();
    const carrierGain = ctx.createGain();
    const sharedTeardown: AudioNode[] = [modGain, carrierGain];

    carrier.type = 'sine';
    modulator.type = 'sine';
    carrier.frequency.setValueAtTime(f0, t0);
    modulator.frequency.setValueAtTime(f0 * ratio, t0);

    const peakModHz = Math.max(10, f0 * modIndex);
    modGain.gain.setValueAtTime(peakModHz, t0);
    modGain.gain.exponentialRampToValueAtTime(1, t0 + dur * 0.65);

    carrierGain.gain.setValueAtTime(MIN_GAIN, t0);
    carrierGain.gain.linearRampToValueAtTime(peakGain, t0 + atk);
    carrierGain.gain.exponentialRampToValueAtTime(MIN_GAIN, tEnd);

    modulator.connect(modGain);
    try {
        modGain.connect(carrier.frequency as unknown as AudioNode);
    } catch {
        /* fallback if environment mock does not accept AudioParam targets */
    }
    carrier.connect(carrierGain);

    if (opts.pan !== undefined && Math.abs(opts.pan) > 0.01 && typeof ctx.createStereoPanner === 'function') {
        const panner = ctx.createStereoPanner();
        panner.pan.setValueAtTime(Math.max(-1, Math.min(1, opts.pan)), t0);
        carrierGain.connect(panner);
        panner.connect(dest);
        sharedTeardown.push(panner);
    } else {
        carrierGain.connect(dest);
    }

    let ended = 0;
    const finishShared = () => {
        if (++ended >= 2) {
            for (const n of sharedTeardown) safeDisconnect(n);
        }
    };
    carrier.onended = () => {
        safeDisconnect(carrier);
        finishShared();
    };
    modulator.onended = () => {
        safeDisconnect(modulator);
        finishShared();
    };

    carrier.start(t0);
    modulator.start(t0);
    carrier.stop(tEnd + 0.012);
    modulator.stop(tEnd + 0.012);
}

/**
 * Retro 80s Outrun Lush Polysynth Chord Pad (slow attack, wide stereo chorus spread).
 */
export function playSynthPad(ctx: AudioContext, dest: AudioNode, freqs: readonly number[], opts: SynthPadOpts): void {
    const baseOffset = opts.startOffset ?? 0;
    const perVoiceGain = opts.gain / Math.max(1, Math.sqrt(freqs.length));
    const attack = opts.attack ?? Math.min(0.14, opts.duration * 0.28);

    freqs.forEach((freq, idx) => {
        const pan = freqs.length > 1 ? ((idx / (freqs.length - 1)) * 2 - 1) * 0.42 : 0;
        playWarmVoice(ctx, dest, {
            type: 'sawtooth',
            type2: 'triangle',
            freq,
            detuneCents: 11 + (idx % 2) * 3,
            startOffset: baseOffset + idx * 0.012,
            attack,
            duration: opts.duration,
            gain: perVoiceGain,
            filterFreq: opts.filterFreq ?? 2200,
            filterFreqEnd: opts.filterFreqEnd ?? 950,
            filterQ: 1.1,
            pan,
        });
    });
}

/**
 * Retro 80s Simmons / Linndrum Pitch-Drop Electronic Tom.
 */
export function playSynthTom(
    ctx: AudioContext,
    dest: AudioNode,
    startOffset = 0,
    gain = 0.16,
    startHz = 240,
    endHz = 78,
    pan = 0,
): void {
    playTone(ctx, dest, {
        type: 'triangle',
        freq: startHz,
        freqEnd: endHz,
        startOffset,
        attack: 0.002,
        duration: 0.18,
        gain,
        pan,
    });
    playNoiseBurst(ctx, dest, {
        startOffset,
        attack: 0.002,
        duration: 0.045,
        gain: gain * 0.35,
        filterType: 'bandpass',
        filterFreq: startHz * 4.5,
        filterQ: 1.6,
        pan,
    });
}

/**
 * Daybreak (Light) Tropical Wooden Marimba / Vibraphone Mallet Voice.
 * Combines a resonant warm fundamental with a fast-decaying 4th harmonic wood-bar overtone.
 */
export function playMalletNote(ctx: AudioContext, dest: AudioNode, opts: MalletNoteOpts): void {
    const now = ctx.currentTime;
    const t0 = now + Math.max(0, opts.startOffset ?? 0);
    const dur = Math.max(0.05, opts.duration);
    const tEnd = t0 + dur;
    const peakGain = Math.max(MIN_GAIN * 2, opts.gain);
    const f0 = Math.max(MIN_HZ, opts.freq);

    const fundOsc = ctx.createOscillator();
    const harmonicOsc = ctx.createOscillator();
    const fundGain = ctx.createGain();
    const harmGain = ctx.createGain();
    const sharedTeardown: AudioNode[] = [fundGain, harmGain];

    fundOsc.type = 'sine';
    harmonicOsc.type = 'triangle';
    fundOsc.frequency.setValueAtTime(f0, t0);
    harmonicOsc.frequency.setValueAtTime(f0 * 4, t0); // Marimba 2-octave wood overtone

    fundGain.gain.setValueAtTime(MIN_GAIN, t0);
    fundGain.gain.linearRampToValueAtTime(peakGain, t0 + 0.003);
    fundGain.gain.exponentialRampToValueAtTime(MIN_GAIN, tEnd);

    const harmDur = Math.min(dur * 0.35, 0.045);
    harmGain.gain.setValueAtTime(MIN_GAIN, t0);
    harmGain.gain.linearRampToValueAtTime(peakGain * 0.38, t0 + 0.002);
    harmGain.gain.exponentialRampToValueAtTime(MIN_GAIN, t0 + harmDur);

    fundOsc.connect(fundGain);
    harmonicOsc.connect(harmGain);

    if (opts.pan !== undefined && Math.abs(opts.pan) > 0.01 && typeof ctx.createStereoPanner === 'function') {
        const panner = ctx.createStereoPanner();
        panner.pan.setValueAtTime(Math.max(-1, Math.min(1, opts.pan)), t0);
        fundGain.connect(panner);
        harmGain.connect(panner);
        panner.connect(dest);
        sharedTeardown.push(panner);
    } else {
        fundGain.connect(dest);
        harmGain.connect(dest);
    }

    let ended = 0;
    const finishShared = () => {
        if (++ended >= 2) {
            for (const n of sharedTeardown) safeDisconnect(n);
        }
    };
    fundOsc.onended = () => {
        safeDisconnect(fundOsc);
        finishShared();
    };
    harmonicOsc.onended = () => {
        safeDisconnect(harmonicOsc);
        finishShared();
    };

    fundOsc.start(t0);
    harmonicOsc.start(t0);
    fundOsc.stop(tEnd + 0.012);
    harmonicOsc.stop(tEnd + 0.012);
}

/**
 * Daybreak (Light) Monte Carlo Rhodes Electric Piano Jazz Chord Comping.
 */
export function playElectricPiano(
    ctx: AudioContext,
    dest: AudioNode,
    freqs: readonly number[],
    opts: ElectricPianoOpts,
): void {
    const baseOffset = opts.startOffset ?? 0;
    const stagger = opts.stagger ?? 0.008;
    const spread = opts.panSpread ?? 0.32;
    const panCenter = opts.panCenter ?? 0;
    const perVoiceGain = opts.gain / Math.max(1, Math.sqrt(freqs.length));

    freqs.forEach((freq, idx) => {
        const offset = baseOffset + idx * stagger;
        const relPan = freqs.length > 1 ? ((idx / (freqs.length - 1)) * 2 - 1) * spread : 0;
        const pan = Math.max(-1, Math.min(1, panCenter + relPan));
        // Warm Rhodes body
        playWarmVoice(ctx, dest, {
            type: 'sine',
            type2: 'triangle',
            freq,
            detuneCents: 4,
            startOffset: offset,
            attack: 0.005,
            duration: opts.duration,
            gain: perVoiceGain,
            filterFreq: 2400,
            filterFreqEnd: 780,
            filterQ: 0.9,
            pan,
        });
        // Subtle metallic Rhodes tine chime on top notes
        if (idx >= freqs.length - 2) {
            playTone(ctx, dest, {
                type: 'sine',
                freq: freq * 4,
                startOffset: offset,
                attack: 0.002,
                duration: Math.min(0.065, opts.duration * 0.3),
                gain: perVoiceGain * 0.16,
                pan,
            });
        }
    });
}

/**
 * Rhythmic Bilateral 14 Hz Dichotic Binaural Pulse:
 * Plays `freq - 7 Hz` hard-panned to the Left ear (-1.0) and `freq + 7 Hz` hard-panned
 * to the Right ear (+1.0) simultaneously with a clean musical pluck envelope (zero continuous hum)
 * while alternating the leading ear (-1 Left <-> +1 Right) so the player feels a vivid
 * ear-to-ear stereo bounce + 14 Hz binaural shimmer on every beat.
 */
export function playBinauralPulse(ctx: AudioContext, dest: AudioNode, opts: BinauralPulseOpts): void {
    const now = ctx.currentTime;
    const t0 = now + Math.max(0, opts.startOffset ?? 0);
    const dur = Math.max(0.06, opts.duration);
    const tEnd = t0 + dur;
    const peakGain = Math.max(MIN_GAIN * 2, opts.gain);
    const halfDelta = (opts.beatHz ?? 14.0) * 0.5;
    const leftHz = Math.max(MIN_HZ, opts.freq - halfDelta);
    const rightHz = Math.max(MIN_HZ, opts.freq + halfDelta);

    const oscL = ctx.createOscillator();
    const oscR = ctx.createOscillator();
    const gainL = ctx.createGain();
    const gainR = ctx.createGain();
    const sharedTeardown: AudioNode[] = [gainL, gainR];

    oscL.type = 'sine';
    oscR.type = 'sine';
    oscL.frequency.setValueAtTime(leftHz, t0);
    oscR.frequency.setValueAtTime(rightHz, t0);

    // Bilateral alternation: the leading ear strikes first at 100% while the opposite ear
    // swells in 28ms later at 72% soboth ears lock onto the 14 Hz delta AND feel L <-> R motion.
    const leadLeft = opts.leadSide < 0;
    const peakL = leadLeft ? peakGain : peakGain * 0.72;
    const peakR = leadLeft ? peakGain * 0.72 : peakGain;
    const atkL = leadLeft ? 0.006 : Math.min(dur * 0.35, 0.032);
    const atkR = leadLeft ? Math.min(dur * 0.35, 0.032) : 0.006;

    gainL.gain.setValueAtTime(MIN_GAIN, t0);
    gainL.gain.linearRampToValueAtTime(peakL, t0 + atkL);
    gainL.gain.exponentialRampToValueAtTime(MIN_GAIN, tEnd);

    gainR.gain.setValueAtTime(MIN_GAIN, t0);
    gainR.gain.linearRampToValueAtTime(peakR, t0 + atkR);
    gainR.gain.exponentialRampToValueAtTime(MIN_GAIN, tEnd);

    oscL.connect(gainL);
    oscR.connect(gainR);

    if (typeof ctx.createStereoPanner === 'function') {
        const panL = ctx.createStereoPanner();
        const panR = ctx.createStereoPanner();
        panL.pan.setValueAtTime(-1.0, t0);
        panR.pan.setValueAtTime(1.0, t0);
        gainL.connect(panL);
        gainR.connect(panR);
        panL.connect(dest);
        panR.connect(dest);
        sharedTeardown.push(panL, panR);
    } else {
        gainL.connect(dest);
        gainR.connect(dest);
    }

    let ended = 0;
    const finishShared = () => {
        if (++ended >= 2) {
            for (const n of sharedTeardown) safeDisconnect(n);
        }
    };
    oscL.onended = () => {
        safeDisconnect(oscL);
        finishShared();
    };
    oscR.onended = () => {
        safeDisconnect(oscR);
        finishShared();
    };

    oscL.start(t0);
    oscR.start(t0);
    oscL.stop(tEnd + 0.012);
    oscR.stop(tEnd + 0.012);
}

/**
 * Daybreak (Light) Brushed Pink-Noise Bossa Nova Shaker.
 */
export function playShaker(
    ctx: AudioContext,
    dest: AudioNode,
    startOffset = 0,
    gain = 0.036,
    accent = false,
    pan = 0,
): void {
    playNoiseBurst(ctx, dest, {
        pink: true,
        startOffset,
        attack: 0.009,
        duration: accent ? 0.065 : 0.042,
        gain: accent ? gain * 1.35 : gain,
        filterType: 'bandpass',
        filterFreq: accent ? 5800 : 5100,
        filterQ: 1.9,
        pan,
    });
}

export function playNoiseBurst(ctx: AudioContext, dest: AudioNode, opts: NoiseOpts): void {
    const bank = getNoiseBank(ctx);
    if (!bank || typeof ctx.createBufferSource !== 'function') {
        playTone(ctx, dest, {
            type: 'triangle',
            freq: opts.filterFreq ?? 800,
            freqEnd: (opts.filterFreq ?? 800) * 0.4,
            startOffset: opts.startOffset,
            attack: opts.attack,
            duration: opts.duration,
            gain: opts.gain * 0.45,
        });
        return;
    }

    const now = ctx.currentTime;
    const t0 = now + Math.max(0, opts.startOffset ?? 0);
    const dur = Math.max(0.012, opts.duration);
    const atk = Math.min(dur * 0.4, Math.max(0.002, opts.attack ?? 0.003));
    const tEnd = t0 + dur;
    const peakGain = Math.max(MIN_GAIN * 2, opts.gain);

    const src = ctx.createBufferSource();
    src.buffer = opts.pink ? bank.pink : bank.white;
    const maxOffset = Math.max(0, (src.buffer.duration || 1) - dur - 0.05);
    const bufOffset = maxOffset > 0.05 ? Math.random() * maxOffset : 0;

    const gain = ctx.createGain();
    const teardownNodes: AudioNode[] = [src, gain];

    gain.gain.setValueAtTime(MIN_GAIN, t0);
    gain.gain.linearRampToValueAtTime(peakGain, t0 + atk);
    gain.gain.exponentialRampToValueAtTime(MIN_GAIN, tEnd);

    let tail: AudioNode = src;
    if (typeof ctx.createBiquadFilter === 'function') {
        const filter = ctx.createBiquadFilter();
        filter.type = opts.filterType ?? 'bandpass';
        const cf0 = Math.max(40, opts.filterFreq ?? 1400);
        filter.frequency.setValueAtTime(cf0, t0);
        if (opts.filterFreqEnd !== undefined) {
            filter.frequency.exponentialRampToValueAtTime(Math.max(40, opts.filterFreqEnd), tEnd);
        }
        filter.Q.setValueAtTime(opts.filterQ ?? 1.4, t0);
        tail.connect(filter);
        tail = filter;
        teardownNodes.push(filter);
    }

    tail.connect(gain);

    if (opts.pan !== undefined && Math.abs(opts.pan) > 0.01 && typeof ctx.createStereoPanner === 'function') {
        const panner = ctx.createStereoPanner();
        panner.pan.setValueAtTime(Math.max(-1, Math.min(1, opts.pan)), t0);
        gain.connect(panner);
        panner.connect(dest);
        teardownNodes.push(panner);
    } else {
        gain.connect(dest);
    }

    src.onended = () => {
        for (const n of teardownNodes) safeDisconnect(n);
    };
    src.start(t0, bufOffset, dur + 0.015);
    src.stop(tEnd + 0.012);
}

export function playChord(ctx: AudioContext, dest: AudioNode, freqs: readonly number[], opts: ChordOpts): void {
    const baseOffset = opts.startOffset ?? 0;
    const stagger = opts.stagger ?? 0;
    const perVoiceGain = opts.gain / Math.max(1, Math.sqrt(freqs.length));

    freqs.forEach((freq, i) => {
        playTone(ctx, dest, {
            type: opts.type ?? 'triangle',
            freq,
            detune: opts.detune,
            startOffset: baseOffset + i * stagger,
            attack: opts.attack ?? 0.012,
            duration: opts.duration,
            gain: perVoiceGain,
            filterType: opts.filterFreq ? 'lowpass' : undefined,
            filterFreq: opts.filterFreq,
            filterFreqEnd: opts.filterFreq ? Math.max(220, opts.filterFreq * 0.45) : undefined,
            filterQ: 1.1,
        });
    });
}

// ─── Club / Arena Drum Synthesizers ─────────────────────────────────────────

export function playDrumKick(ctx: AudioContext, dest: AudioNode, startOffset = 0, gain = 0.24): void {
    // Sub punch body
    playTone(ctx, dest, {
        type: 'sine',
        freq: 158,
        freqEnd: 46,
        startOffset,
        attack: 0.003,
        duration: 0.17,
        gain,
    });
    // Mid-punch transient (helps kick read cleanly on small phone speakers)
    playTone(ctx, dest, {
        type: 'triangle',
        freq: 260,
        freqEnd: 68,
        startOffset,
        attack: 0.002,
        duration: 0.048,
        gain: gain * 0.42,
    });
    // Beater snap
    playNoiseBurst(ctx, dest, {
        startOffset,
        attack: 0.002,
        duration: 0.014,
        gain: gain * 0.22,
        filterType: 'bandpass',
        filterFreq: 1650,
        filterQ: 1.4,
    });
}

export function playDrumSnareClap(
    ctx: AudioContext,
    dest: AudioNode,
    startOffset = 0,
    gain = 0.14,
    style: 'clap' | 'snare' | 'rim' = 'clap',
): void {
    if (style === 'rim') {
        playTone(ctx, dest, {
            type: 'triangle',
            freq: 920,
            freqEnd: 440,
            startOffset,
            attack: 0.002,
            duration: 0.032,
            gain: gain * 0.72,
        });
        playNoiseBurst(ctx, dest, {
            startOffset,
            attack: 0.002,
            duration: 0.038,
            gain: gain * 0.48,
            filterType: 'bandpass',
            filterFreq: 2100,
            filterQ: 2.0,
        });
        return;
    }

    // Punchy snare/clap body
    playTone(ctx, dest, {
        type: 'triangle',
        freq: 205,
        freqEnd: 118,
        startOffset,
        attack: 0.002,
        duration: 0.07,
        gain: gain * 0.55,
    });

    if (style === 'snare') {
        playNoiseBurst(ctx, dest, {
            startOffset,
            attack: 0.002,
            duration: 0.15,
            gain: gain * 0.92,
            filterType: 'bandpass',
            filterFreq: 1850,
            filterQ: 1.0,
        });
        return;
    }

    // Dual-burst crisp stadium clap
    playNoiseBurst(ctx, dest, {
        startOffset,
        attack: 0.002,
        duration: 0.038,
        gain: gain * 0.78,
        filterType: 'bandpass',
        filterFreq: 1650,
        filterQ: 1.5,
    });
    playNoiseBurst(ctx, dest, {
        startOffset: startOffset + 0.014,
        attack: 0.002,
        duration: 0.11,
        gain: gain * 0.85,
        filterType: 'bandpass',
        filterFreq: 2150,
        filterQ: 1.2,
    });
}

export function playDrumHat(
    ctx: AudioContext,
    dest: AudioNode,
    startOffset = 0,
    gain = 0.055,
    open = false,
    pitchHz = 7800,
): void {
    playNoiseBurst(ctx, dest, {
        startOffset,
        attack: 0.002,
        duration: open ? 0.145 : 0.028,
        gain: open ? gain * 1.15 : gain,
        filterType: 'highpass',
        filterFreq: pitchHz,
        filterQ: open ? 0.9 : 1.3,
    });
}

export function playPercAccent(
    ctx: AudioContext,
    dest: AudioNode,
    startOffset = 0,
    gain = 0.075,
    freq = 640,
    pan = 0,
): void {
    playTone(ctx, dest, {
        type: 'triangle',
        freq,
        freqEnd: freq * 0.56,
        startOffset,
        attack: 0.002,
        duration: 0.062,
        gain,
        pan,
    });
    playNoiseBurst(ctx, dest, {
        startOffset,
        attack: 0.002,
        duration: 0.024,
        gain: gain * 0.45,
        filterType: 'bandpass',
        filterFreq: freq * 2.4,
        filterQ: 2.2,
        pan,
    });
}

/**
 * Dual-thump organic + sub-bass heartbeat (`lub` ... `dub`).
 * Intensity ranges from 0 (steady subtle pulse) to 1 (adrenaline crunch).
 */
export function playHeartbeatPulse(ctx: AudioContext, dest: AudioNode, intensity: number): void {
    const t = Math.max(0, Math.min(1, intensity));
    const lubGain = 0.28 + t * 0.24;
    const dubGain = 0.19 + t * 0.18;

    playTone(ctx, dest, {
        type: 'sine',
        freq: 76 + t * 14,
        freqEnd: 34,
        startOffset: 0,
        attack: 0.008,
        duration: 0.14,
        gain: lubGain,
    });
    playTone(ctx, dest, {
        type: 'triangle',
        freq: 136 + t * 24,
        freqEnd: 52,
        startOffset: 0,
        attack: 0.004,
        duration: 0.09,
        gain: lubGain * 0.42,
        filterType: 'lowpass',
        filterFreq: 340 + t * 180,
    });
    playNoiseBurst(ctx, dest, {
        pink: true,
        startOffset: 0,
        attack: 0.003,
        duration: 0.055,
        gain: lubGain * 0.18,
        filterType: 'lowpass',
        filterFreq: 240,
    });

    const dubDelay = 0.205 - t * 0.035;
    playTone(ctx, dest, {
        type: 'sine',
        freq: 64 + t * 10,
        freqEnd: 30,
        startOffset: dubDelay,
        attack: 0.007,
        duration: 0.12,
        gain: dubGain,
    });
    playTone(ctx, dest, {
        type: 'triangle',
        freq: 114 + t * 18,
        freqEnd: 46,
        startOffset: dubDelay,
        attack: 0.004,
        duration: 0.08,
        gain: dubGain * 0.35,
        filterType: 'lowpass',
        filterFreq: 300 + t * 140,
    });
}
