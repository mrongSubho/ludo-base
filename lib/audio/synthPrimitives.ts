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
            duration: 0.13,
            gain: gain * 0.9,
            filterType: 'bandpass',
            filterFreq: 1850,
            filterQ: 1.1,
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
