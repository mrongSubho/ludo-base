import { playChord, playNoiseBurst, playTone, playWarmVoice } from './synthPrimitives';
import type { AudioTheme, SoundCategory, SoundId, SoundPlayOptions } from './types';

export interface SfxRecipe {
    category: SoundCategory;
    cooldownMs?: number;
    haptic?: number | number[];
    duckMusic?: { factor: number; holdMs: number; releaseMs: number };
    render: (ctx: AudioContext, dest: AudioNode, opts: SoundPlayOptions, theme: AudioTheme) => void;
}

const jitter = (pct = 0.035): number => 1 + (Math.random() * 2 - 1) * pct;

const PENTATONIC_HOPS = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.51, 1567.98, 1760.0, 2093.0, 2349.32];

const THEME_PREVIEWS: Record<AudioTheme, { freqs: number[]; type: OscillatorType; filter: number }> = {
    '3077': { freqs: [587.33, 880.0, 1174.66], type: 'triangle', filter: 2800 }, // D5-A5-D6 tactical glass
    retro: { freqs: [440.0, 523.25, 659.25], type: 'sawtooth', filter: 1650 }, // A4-C5-E5 warm synth
    light: { freqs: [349.23, 440.0, 523.25], type: 'sine', filter: 2200 }, // F4-A4-C5 daybreak chime
};

function uiToneProfile(theme: AudioTheme): { base: number; wave: OscillatorType; filter: number } {
    if (theme === 'retro') return { base: 740, wave: 'sawtooth', filter: 2100 };
    if (theme === 'light') return { base: 620, wave: 'sine', filter: 2400 };
    return { base: 860, wave: 'triangle', filter: 3200 };
}

export const SFX_CATALOG: Record<SoundId, SfxRecipe> = {
    // ─── UI & Navigation ───────────────────────────────────────────────────
    ui_hover: {
        category: 'ui',
        cooldownMs: 65,
        render: (ctx, dest, _opts, theme) => {
            const p = uiToneProfile(theme);
            playTone(ctx, dest, {
                type: 'sine',
                freq: p.base * 1.45 * jitter(0.03),
                freqEnd: p.base * 1.65,
                duration: 0.024,
                attack: 0.002,
                gain: 0.028,
            });
        },
    },
    ui_click: {
        category: 'ui',
        cooldownMs: 30,
        render: (ctx, dest, _opts, theme) => {
            const p = uiToneProfile(theme);
            playTone(ctx, dest, {
                type: p.wave,
                freq: p.base * jitter(0.04),
                freqEnd: p.base * 0.56,
                duration: 0.038,
                attack: 0.002,
                gain: 0.08,
                filterType: 'lowpass',
                filterFreq: p.filter,
            });
            playNoiseBurst(ctx, dest, {
                duration: 0.016,
                gain: 0.035,
                filterType: 'bandpass',
                filterFreq: 2600,
                filterQ: 2.0,
            });
        },
    },
    ui_tap: {
        category: 'ui',
        cooldownMs: 30,
        render: (ctx, dest, _opts, theme) => {
            const p = uiToneProfile(theme);
            playTone(ctx, dest, {
                type: 'sine',
                freq: p.base * 0.9 * jitter(0.03),
                freqEnd: p.base * 0.45,
                duration: 0.032,
                attack: 0.002,
                gain: 0.065,
            });
        },
    },
    ui_select: {
        category: 'ui',
        cooldownMs: 35,
        haptic: 6,
        render: (ctx, dest, _opts, theme) => {
            const p = uiToneProfile(theme);
            playTone(ctx, dest, {
                type: 'sine',
                freq: p.base * 0.92,
                freqEnd: p.base * 1.38,
                duration: 0.055,
                attack: 0.003,
                gain: 0.085,
            });
            playTone(ctx, dest, {
                type: p.wave,
                freq: p.base * 1.5,
                startOffset: 0.02,
                duration: 0.05,
                attack: 0.003,
                gain: 0.045,
                filterType: 'lowpass',
                filterFreq: p.filter,
            });
        },
    },
    ui_back: {
        category: 'ui',
        cooldownMs: 35,
        render: (ctx, dest, _opts, theme) => {
            const p = uiToneProfile(theme);
            playTone(ctx, dest, {
                type: 'sine',
                freq: p.base * 0.95,
                freqEnd: p.base * 0.58,
                duration: 0.055,
                attack: 0.003,
                gain: 0.065,
            });
        },
    },
    ui_sheet_open: {
        category: 'ui',
        cooldownMs: 80,
        render: (ctx, dest) => {
            playNoiseBurst(ctx, dest, {
                pink: true,
                duration: 0.14,
                attack: 0.012,
                gain: 0.055,
                filterType: 'bandpass',
                filterFreq: 700,
                filterFreqEnd: 2200,
                filterQ: 1.3,
            });
            playTone(ctx, dest, {
                type: 'sine',
                freq: 420,
                freqEnd: 780,
                duration: 0.12,
                attack: 0.008,
                gain: 0.055,
            });
        },
    },
    ui_sheet_close: {
        category: 'ui',
        cooldownMs: 80,
        render: (ctx, dest) => {
            playNoiseBurst(ctx, dest, {
                pink: true,
                duration: 0.11,
                attack: 0.006,
                gain: 0.045,
                filterType: 'bandpass',
                filterFreq: 1800,
                filterFreqEnd: 520,
                filterQ: 1.2,
            });
            playTone(ctx, dest, {
                type: 'sine',
                freq: 680,
                freqEnd: 340,
                duration: 0.1,
                attack: 0.004,
                gain: 0.045,
            });
        },
    },
    ui_tab_switch: {
        category: 'ui',
        cooldownMs: 45,
        render: (ctx, dest, _opts, theme) => {
            const p = uiToneProfile(theme);
            playTone(ctx, dest, {
                type: 'triangle',
                freq: p.base * 1.15,
                freqEnd: p.base * 1.32,
                duration: 0.04,
                attack: 0.002,
                gain: 0.06,
            });
            playNoiseBurst(ctx, dest, {
                duration: 0.025,
                gain: 0.03,
                filterType: 'highpass',
                filterFreq: 2200,
            });
        },
    },
    ui_knob_tick: {
        category: 'ui',
        cooldownMs: 28,
        haptic: 5,
        render: (ctx, dest, opts) => {
            const idx = Math.max(0, Math.min(12, opts.tierIndex ?? 2));
            const freq = 420 + idx * 62;
            playTone(ctx, dest, {
                type: 'triangle',
                freq,
                freqEnd: freq * 0.65,
                duration: 0.026,
                attack: 0.002,
                gain: 0.075,
            });
        },
    },
    ui_copy: {
        category: 'ui',
        cooldownMs: 80,
        haptic: 8,
        render: (ctx, dest) => {
            playTone(ctx, dest, { type: 'sine', freq: 1174.66, duration: 0.045, gain: 0.075 });
            playTone(ctx, dest, { type: 'sine', freq: 1567.98, startOffset: 0.045, duration: 0.07, gain: 0.08 });
        },
    },
    ui_error: {
        category: 'ui',
        cooldownMs: 120,
        haptic: [20, 30, 20],
        render: (ctx, dest) => {
            playTone(ctx, dest, {
                type: 'sawtooth',
                freq: 190,
                freqEnd: 145,
                duration: 0.08,
                gain: 0.09,
                filterType: 'lowpass',
                filterFreq: 680,
            });
            playTone(ctx, dest, {
                type: 'sawtooth',
                freq: 155,
                freqEnd: 110,
                startOffset: 0.09,
                duration: 0.11,
                gain: 0.09,
                filterType: 'lowpass',
                filterFreq: 560,
            });
        },
    },
    ui_confirm: {
        category: 'ui',
        cooldownMs: 80,
        haptic: 10,
        render: (ctx, dest) => {
            playTone(ctx, dest, { type: 'triangle', freq: 659.25, duration: 0.07, gain: 0.09 });
            playTone(ctx, dest, { type: 'triangle', freq: 987.77, startOffset: 0.055, duration: 0.14, gain: 0.1 });
        },
    },

    // ─── Settings & Cosmetics ──────────────────────────────────────────────
    pref_toggle_on: {
        category: 'ui',
        cooldownMs: 40,
        haptic: 8,
        render: (ctx, dest) => {
            playTone(ctx, dest, { type: 'sine', freq: 660, freqEnd: 880, duration: 0.05, gain: 0.08 });
            playTone(ctx, dest, { type: 'triangle', freq: 990, startOffset: 0.035, duration: 0.075, gain: 0.07 });
        },
    },
    pref_toggle_off: {
        category: 'ui',
        cooldownMs: 40,
        haptic: 6,
        render: (ctx, dest) => {
            playTone(ctx, dest, { type: 'sine', freq: 720, freqEnd: 460, duration: 0.06, gain: 0.065 });
        },
    },
    pref_theme_swap: {
        category: 'ui',
        cooldownMs: 120,
        haptic: 12,
        render: (ctx, dest, opts, theme) => {
            const target = opts.theme ?? theme;
            const preview = THEME_PREVIEWS[target] ?? THEME_PREVIEWS['3077'];
            playChord(ctx, dest, preview.freqs, {
                type: preview.type,
                stagger: 0.045,
                duration: 0.24,
                gain: 0.11,
                filterFreq: preview.filter,
            });
        },
    },
    pref_cosmetic_swap: {
        category: 'ui',
        cooldownMs: 80,
        haptic: 10,
        render: (ctx, dest) => {
            playNoiseBurst(ctx, dest, {
                duration: 0.035,
                gain: 0.05,
                filterType: 'highpass',
                filterFreq: 2400,
            });
            playChord(ctx, dest, [880, 1318.51], {
                type: 'sine',
                stagger: 0.03,
                duration: 0.18,
                gain: 0.09,
            });
        },
    },

    // ─── Lobby & Matchmaking ───────────────────────────────────────────────
    lobby_room_created: {
        category: 'sfx',
        cooldownMs: 150,
        haptic: 15,
        render: (ctx, dest) => {
            playChord(ctx, dest, [440, 659.25, 880], {
                type: 'triangle',
                stagger: 0.045,
                duration: 0.22,
                gain: 0.11,
                filterFreq: 2600,
            });
        },
    },
    lobby_player_join: {
        category: 'sfx',
        cooldownMs: 120,
        haptic: 10,
        render: (ctx, dest) => {
            playTone(ctx, dest, { type: 'sine', freq: 587.33, duration: 0.09, gain: 0.09 });
            playTone(ctx, dest, { type: 'triangle', freq: 880, startOffset: 0.06, duration: 0.16, gain: 0.1 });
        },
    },
    lobby_player_leave: {
        category: 'sfx',
        cooldownMs: 120,
        render: (ctx, dest) => {
            playTone(ctx, dest, { type: 'sine', freq: 659.25, freqEnd: 440, duration: 0.14, gain: 0.075 });
        },
    },
    lobby_seat_swap: {
        category: 'sfx',
        cooldownMs: 80,
        haptic: 10,
        render: (ctx, dest) => {
            playNoiseBurst(ctx, dest, {
                duration: 0.09,
                gain: 0.055,
                filterType: 'bandpass',
                filterFreq: 900,
                filterFreqEnd: 2000,
            });
            playTone(ctx, dest, { type: 'triangle', freq: 520, freqEnd: 780, duration: 0.08, gain: 0.07 });
        },
    },
    lobby_player_kick: {
        category: 'sfx',
        cooldownMs: 120,
        haptic: [20, 30],
        render: (ctx, dest) => {
            playTone(ctx, dest, { type: 'sawtooth', freq: 260, freqEnd: 95, duration: 0.16, gain: 0.1, filterType: 'lowpass', filterFreq: 900 });
            playNoiseBurst(ctx, dest, { duration: 0.06, gain: 0.06, filterType: 'lowpass', filterFreq: 800 });
        },
    },
    lobby_countdown_tick: {
        category: 'sfx',
        cooldownMs: 250,
        haptic: 10,
        render: (ctx, dest, opts) => {
            const step = opts.urgentLevel ?? 3;
            const freq = step <= 1 ? 1046.5 : step === 2 ? 880 : 783.99;
            playTone(ctx, dest, { type: 'sine', freq, duration: 0.11, gain: 0.11 });
        },
    },
    lobby_countdown_go: {
        category: 'sfx',
        cooldownMs: 300,
        haptic: [25, 35, 45],
        duckMusic: { factor: 0.65, holdMs: 350, releaseMs: 400 },
        render: (ctx, dest) => {
            playChord(ctx, dest, [523.25, 783.99, 1046.5, 1318.51], {
                type: 'triangle',
                stagger: 0.025,
                duration: 0.34,
                gain: 0.14,
                filterFreq: 3400,
            });
        },
    },
    match_found: {
        category: 'sfx',
        cooldownMs: 500,
        haptic: [40, 40, 70],
        duckMusic: { factor: 0.4, holdMs: 650, releaseMs: 600 },
        render: (ctx, dest) => {
            // Arena sub drop + warm detuned cyber brass reveal
            playTone(ctx, dest, { type: 'sine', freq: 118, freqEnd: 44, duration: 0.36, gain: 0.28 });
            [440, 554.37, 659.25, 880].forEach((freq, idx) => {
                playWarmVoice(ctx, dest, {
                    type: 'sawtooth',
                    type2: 'triangle',
                    freq,
                    detuneCents: 11,
                    octaveSub: idx === 0,
                    startOffset: idx * 0.036,
                    attack: 0.012,
                    duration: 0.44,
                    gain: 0.14,
                    filterFreq: 3800,
                    filterFreqEnd: 1400,
                    filterQ: 1.8,
                    pan: (idx - 1.5) * 0.2,
                });
            });
            playNoiseBurst(ctx, dest, { duration: 0.14, gain: 0.075, filterType: 'highpass', filterFreq: 2800 });
        },
    },
    invite_received: {
        category: 'sfx',
        cooldownMs: 400,
        haptic: [15, 40, 15],
        render: (ctx, dest) => {
            playTone(ctx, dest, { type: 'sine', freq: 987.77, duration: 0.09, gain: 0.09 });
            playTone(ctx, dest, { type: 'sine', freq: 1318.51, startOffset: 0.08, duration: 0.18, gain: 0.1 });
        },
    },
    invite_accept: {
        category: 'sfx',
        cooldownMs: 120,
        haptic: 15,
        render: (ctx, dest) => {
            playChord(ctx, dest, [587.33, 880, 1174.66], {
                type: 'triangle',
                stagger: 0.035,
                duration: 0.2,
                gain: 0.11,
            });
        },
    },
    invite_reject: {
        category: 'sfx',
        cooldownMs: 120,
        render: (ctx, dest) => {
            playTone(ctx, dest, { type: 'sine', freq: 440, freqEnd: 293.66, duration: 0.12, gain: 0.075 });
        },
    },

    // ─── Wallet, Swaps & On-Chain Flows ────────────────────────────────────
    swap_flip: {
        category: 'ui',
        cooldownMs: 60,
        haptic: 8,
        render: (ctx, dest) => {
            playTone(ctx, dest, { type: 'triangle', freq: 520, freqEnd: 940, duration: 0.06, gain: 0.07 });
            playTone(ctx, dest, { type: 'triangle', freq: 940, freqEnd: 620, startOffset: 0.04, duration: 0.06, gain: 0.06 });
        },
    },
    swap_confirm: {
        category: 'sfx',
        cooldownMs: 150,
        haptic: 15,
        render: (ctx, dest) => {
            playTone(ctx, dest, { type: 'sine', freq: 440, freqEnd: 880, duration: 0.16, gain: 0.09 });
            playTone(ctx, dest, { type: 'triangle', freq: 1174.66, startOffset: 0.09, duration: 0.12, gain: 0.07 });
        },
    },
    swap_complete: {
        category: 'sfx',
        cooldownMs: 250,
        haptic: [15, 30, 25],
        render: (ctx, dest) => {
            playTone(ctx, dest, { type: 'sine', freq: 146.83, duration: 0.24, gain: 0.16 });
            [587.33, 880, 1174.66, 1760].forEach((freq, idx) => {
                playWarmVoice(ctx, dest, {
                    type: 'triangle',
                    type2: 'sine',
                    freq,
                    detuneCents: 8,
                    startOffset: idx * 0.036,
                    attack: 0.006,
                    duration: 0.3,
                    gain: 0.12,
                    filterFreq: 4600,
                    filterFreqEnd: 2000,
                    pan: idx % 2 === 0 ? -0.22 : 0.22,
                });
            });
        },
    },
    tx_sign_open: {
        category: 'ui',
        cooldownMs: 180,
        render: (ctx, dest) => {
            playChord(ctx, dest, [659.25, 987.77], {
                type: 'sine',
                stagger: 0.05,
                duration: 0.22,
                gain: 0.075,
            });
        },
    },
    tx_gas_open: {
        category: 'ui',
        cooldownMs: 180,
        haptic: 12,
        render: (ctx, dest) => {
            playTone(ctx, dest, { type: 'sine', freq: 180, freqEnd: 110, duration: 0.14, gain: 0.09 });
            playChord(ctx, dest, [523.25, 783.99], {
                type: 'triangle',
                stagger: 0.045,
                duration: 0.2,
                gain: 0.085,
            });
        },
    },
    tx_preflight_pass: {
        category: 'ui',
        cooldownMs: 150,
        render: (ctx, dest) => {
            playTone(ctx, dest, { type: 'sine', freq: 880, duration: 0.06, gain: 0.06 });
            playTone(ctx, dest, { type: 'sine', freq: 1318.51, startOffset: 0.05, duration: 0.12, gain: 0.07 });
        },
    },
    tx_preflight_warning: {
        category: 'sfx',
        cooldownMs: 250,
        haptic: [30, 40, 30],
        render: (ctx, dest) => {
            playTone(ctx, dest, { type: 'sawtooth', freq: 340, freqEnd: 240, duration: 0.14, gain: 0.09, filterType: 'lowpass', filterFreq: 950 });
            playTone(ctx, dest, { type: 'sawtooth', freq: 260, freqEnd: 180, startOffset: 0.13, duration: 0.16, gain: 0.09, filterType: 'lowpass', filterFreq: 850 });
        },
    },
    tx_submitted: {
        category: 'ui',
        cooldownMs: 150,
        render: (ctx, dest) => {
            playTone(ctx, dest, { type: 'triangle', freq: 520, freqEnd: 1040, duration: 0.14, gain: 0.075 });
        },
    },
    tx_confirmed: {
        category: 'sfx',
        cooldownMs: 200,
        haptic: [15, 25, 20],
        render: (ctx, dest) => {
            playChord(ctx, dest, [523.25, 783.99, 1046.5], {
                type: 'triangle',
                stagger: 0.04,
                duration: 0.24,
                gain: 0.11,
            });
        },
    },
    tx_rejected: {
        category: 'sfx',
        cooldownMs: 200,
        haptic: [25, 35],
        render: (ctx, dest) => {
            playTone(ctx, dest, { type: 'triangle', freq: 293.66, freqEnd: 196.0, duration: 0.18, gain: 0.09 });
        },
    },
    allowance_approved: {
        category: 'sfx',
        cooldownMs: 200,
        haptic: 15,
        render: (ctx, dest) => {
            playChord(ctx, dest, [440, 659.25, 880], { type: 'sine', stagger: 0.035, duration: 0.22, gain: 0.1 });
        },
    },
    allowance_revoked: {
        category: 'sfx',
        cooldownMs: 200,
        haptic: 15,
        render: (ctx, dest) => {
            playNoiseBurst(ctx, dest, { duration: 0.05, gain: 0.06, filterType: 'bandpass', filterFreq: 1100 });
            playTone(ctx, dest, { type: 'triangle', freq: 620, freqEnd: 240, duration: 0.15, gain: 0.09 });
        },
    },
    claim_radar_ping: {
        category: 'ui',
        cooldownMs: 900,
        render: (ctx, dest) => {
            playTone(ctx, dest, { type: 'sine', freq: 1320, duration: 0.16, attack: 0.005, gain: 0.045 });
        },
    },
    claim_reward_burst: {
        category: 'sfx',
        cooldownMs: 250,
        haptic: [20, 35, 35],
        render: (ctx, dest) => {
            playTone(ctx, dest, { type: 'sine', freq: 261.63, freqEnd: 130.81, duration: 0.28, gain: 0.18 });
            [1046.5, 1318.51, 1567.98, 2093.0].forEach((freq, idx) => {
                playWarmVoice(ctx, dest, {
                    type: 'triangle',
                    type2: 'sine',
                    freq,
                    detuneCents: 9,
                    octaveSub: idx === 0,
                    startOffset: idx * 0.035,
                    attack: 0.005,
                    duration: 0.32,
                    gain: 0.13,
                    filterFreq: 5200,
                    filterFreqEnd: 2400,
                    pan: (idx - 1.5) * 0.24,
                });
            });
        },
    },
    coin_chink: {
        category: 'sfx',
        cooldownMs: 60,
        haptic: 8,
        render: (ctx, dest) => {
            const f = 1760 * jitter(0.03);
            playWarmVoice(ctx, dest, {
                type: 'triangle',
                type2: 'sine',
                freq: f,
                detuneCents: 7,
                duration: 0.13,
                attack: 0.002,
                gain: 0.11,
                filterFreq: 6000,
            });
            playWarmVoice(ctx, dest, {
                type: 'sine',
                type2: 'triangle',
                freq: f * 1.498,
                detuneCents: 6,
                startOffset: 0.026,
                duration: 0.18,
                attack: 0.002,
                gain: 0.095,
                filterFreq: 6800,
            });
        },
    },
    marketplace_purchase: {
        category: 'sfx',
        cooldownMs: 250,
        haptic: [20, 30, 35],
        render: (ctx, dest) => {
            playChord(ctx, dest, [587.33, 880, 1174.66, 1760], {
                type: 'triangle',
                stagger: 0.04,
                duration: 0.3,
                gain: 0.13,
            });
        },
    },
    burn_chips: {
        category: 'sfx',
        cooldownMs: 250,
        haptic: [25, 30, 45],
        render: (ctx, dest) => {
            playNoiseBurst(ctx, dest, {
                pink: true,
                duration: 0.28,
                attack: 0.015,
                gain: 0.09,
                filterType: 'bandpass',
                filterFreq: 1400,
                filterFreqEnd: 3800,
                filterQ: 1.8,
            });
            playTone(ctx, dest, { type: 'sawtooth', freq: 240, freqEnd: 75, duration: 0.26, gain: 0.1, filterType: 'lowpass', filterFreq: 800 });
        },
    },

    // ─── Dice & Turn Flow ──────────────────────────────────────────────────
    dice_roll: {
        category: 'sfx',
        cooldownMs: 120,
        haptic: 35,
        render: (ctx, dest, opts) => {
            // Weighted cup-toss lift + crisp 5-step multi-facet tumble clicks
            const style = opts.diceStyle ?? 'classic';
            const basePitch = style === 'midnight' ? 1280 : style === 'gold' ? 1560 : 960;
            playTone(ctx, dest, { type: 'sine', freq: 180, freqEnd: 340, duration: 0.08, gain: 0.05 });
            const delays = [0, 0.05, 0.11, 0.18, 0.255];
            delays.forEach((d, idx) => {
                const f = basePitch * (0.86 + (idx % 3) * 0.12) * jitter(0.05);
                playNoiseBurst(ctx, dest, {
                    startOffset: d,
                    duration: 0.036,
                    gain: 0.095 - idx * 0.008,
                    filterType: 'bandpass',
                    filterFreq: f,
                    filterQ: 3.4,
                });
                playTone(ctx, dest, {
                    type: style === 'classic' ? 'triangle' : 'sine',
                    freq: f * 0.56,
                    freqEnd: f * 0.34,
                    startOffset: d,
                    duration: 0.034,
                    gain: 0.06,
                });
            });
        },
    },
    dice_land: {
        category: 'sfx',
        cooldownMs: 80,
        haptic: [20, 30, 20],
        render: (ctx, dest, opts) => {
            const style = opts.diceStyle ?? 'classic';
            const thumpFreq = style === 'gold' ? 230 : style === 'midnight' ? 185 : 160;
            playTone(ctx, dest, {
                type: 'sine',
                freq: thumpFreq * jitter(0.04),
                freqEnd: 54,
                duration: 0.09,
                gain: 0.15,
            });
            playNoiseBurst(ctx, dest, {
                duration: 0.032,
                gain: 0.08,
                filterType: 'bandpass',
                filterFreq: style === 'gold' ? 2600 : 1900,
                filterQ: 2.5,
            });
            // Secondary micro-bounce settle tap
            playTone(ctx, dest, {
                type: 'triangle',
                freq: thumpFreq * 1.18,
                freqEnd: 78,
                startOffset: 0.065,
                duration: 0.045,
                gain: 0.07,
            });
        },
    },
    dice_six: {
        category: 'sfx',
        cooldownMs: 120,
        haptic: [30, 40, 40],
        render: (ctx, dest, opts) => {
            const streak = Math.max(1, opts.streak ?? 1);
            const mult = streak >= 2 ? 1.2599 : 1; // Major third up on 2nd consecutive 6
            playTone(ctx, dest, { type: 'sine', freq: 195, freqEnd: 56, duration: 0.14, gain: 0.24 });
            [523.25 * mult, 783.99 * mult, 1046.5 * mult, 1567.98 * mult].forEach((freq, idx) => {
                playWarmVoice(ctx, dest, {
                    type: 'sawtooth',
                    type2: 'triangle',
                    freq,
                    detuneCents: 10,
                    octaveSub: idx === 0,
                    startOffset: idx * 0.03,
                    attack: 0.006,
                    duration: 0.34,
                    gain: 0.13,
                    filterFreq: 4800,
                    filterFreqEnd: 2000,
                    filterQ: 1.5,
                    pan: (idx - 1.5) * 0.22,
                });
            });
        },
    },
    dice_three_sixes_bust: {
        category: 'sfx',
        cooldownMs: 250,
        haptic: [60, 40, 80],
        render: (ctx, dest) => {
            playTone(ctx, dest, {
                type: 'sawtooth',
                freq: 460,
                freqEnd: 72,
                duration: 0.42,
                gain: 0.15,
                filterType: 'lowpass',
                filterFreq: 1800,
                filterFreqEnd: 260,
            });
            playTone(ctx, dest, {
                type: 'square',
                freq: 230,
                freqEnd: 55,
                startOffset: 0.04,
                duration: 0.36,
                gain: 0.09,
                filterType: 'lowpass',
                filterFreq: 900,
            });
        },
    },
    dice_toss_pass: {
        category: 'sfx',
        cooldownMs: 120,
        render: (ctx, dest) => {
            playNoiseBurst(ctx, dest, {
                pink: true,
                duration: 0.11,
                gain: 0.05,
                filterType: 'bandpass',
                filterFreq: 750,
                filterFreqEnd: 1700,
            });
            playTone(ctx, dest, { type: 'sine', freq: 380, freqEnd: 620, duration: 0.09, gain: 0.05 });
        },
    },
    dice_no_moves: {
        category: 'sfx',
        cooldownMs: 120,
        render: (ctx, dest) => {
            playTone(ctx, dest, { type: 'triangle', freq: 310, freqEnd: 240, duration: 0.06, gain: 0.07 });
            playTone(ctx, dest, { type: 'triangle', freq: 240, freqEnd: 180, startOffset: 0.07, duration: 0.08, gain: 0.065 });
        },
    },
    turn_mine: {
        category: 'sfx',
        cooldownMs: 150,
        haptic: 12,
        render: (ctx, dest) => {
            playTone(ctx, dest, { type: 'sine', freq: 783.99, duration: 0.075, gain: 0.085 });
            playTone(ctx, dest, { type: 'triangle', freq: 1174.66, startOffset: 0.055, duration: 0.14, gain: 0.09 });
        },
    },
    turn_other: {
        category: 'sfx',
        cooldownMs: 150,
        render: (ctx, dest) => {
            playTone(ctx, dest, { type: 'sine', freq: 440, freqEnd: 392, duration: 0.055, gain: 0.032 });
        },
    },
    turn_teammate_assist: {
        category: 'sfx',
        cooldownMs: 300,
        haptic: [15, 25, 25],
        render: (ctx, dest) => {
            playChord(ctx, dest, [523.25, 659.25, 783.99, 1046.5], {
                type: 'sine',
                stagger: 0.04,
                duration: 0.25,
                gain: 0.1,
            });
        },
    },

    // ─── Token Movement ────────────────────────────────────────────────────
    token_spawn: {
        category: 'sfx',
        cooldownMs: 90,
        haptic: 18,
        render: (ctx, dest) => {
            playTone(ctx, dest, { type: 'sine', freq: 260, freqEnd: 740, duration: 0.11, gain: 0.12 });
            playTone(ctx, dest, { type: 'triangle', freq: 140, freqEnd: 58, startOffset: 0.09, duration: 0.08, gain: 0.11 });
        },
    },
    token_hop: {
        category: 'sfx',
        cooldownMs: 40,
        haptic: 4,
        render: (ctx, dest, opts) => {
            const idx = Math.max(0, Math.min(PENTATONIC_HOPS.length - 1, opts.step ?? 0));
            const baseFreq = PENTATONIC_HOPS[idx] * jitter(0.015);
            playTone(ctx, dest, {
                type: 'sine',
                freq: baseFreq,
                freqEnd: baseFreq * 1.09,
                duration: 0.065,
                attack: 0.003,
                gain: 0.085,
            });
            if (opts.boosted) {
                playTone(ctx, dest, {
                    type: 'sawtooth',
                    freq: baseFreq * 1.5,
                    duration: 0.055,
                    attack: 0.003,
                    gain: 0.035,
                    filterType: 'bandpass',
                    filterFreq: baseFreq * 2,
                });
            }
        },
    },
    token_land: {
        category: 'sfx',
        cooldownMs: 50,
        render: (ctx, dest) => {
            playTone(ctx, dest, { type: 'sine', freq: 210, freqEnd: 95, duration: 0.055, gain: 0.08 });
        },
    },
    token_safe_star: {
        category: 'sfx',
        cooldownMs: 120,
        haptic: 10,
        render: (ctx, dest) => {
            playChord(ctx, dest, [880, 1318.51, 1760], {
                type: 'sine',
                stagger: 0.025,
                duration: 0.22,
                gain: 0.09,
            });
        },
    },
    token_home_lane: {
        category: 'sfx',
        cooldownMs: 150,
        haptic: 14,
        render: (ctx, dest) => {
            playChord(ctx, dest, [440, 554.37, 659.25, 880], {
                type: 'triangle',
                stagger: 0.035,
                duration: 0.26,
                gain: 0.1,
                filterFreq: 2600,
            });
        },
    },
    token_stack_force: {
        category: 'sfx',
        cooldownMs: 100,
        haptic: 8,
        render: (ctx, dest) => {
            playTone(ctx, dest, { type: 'triangle', freq: 480, freqEnd: 960, duration: 0.045, gain: 0.075 });
            playNoiseBurst(ctx, dest, { duration: 0.025, gain: 0.04, filterType: 'bandpass', filterFreq: 2200 });
        },
    },
    token_finish_home: {
        category: 'sfx',
        cooldownMs: 180,
        haptic: [25, 40, 35],
        render: (ctx, dest, opts) => {
            const count = Math.max(1, Math.min(4, opts.finishCount ?? 1));
            const root = 523.25 * Math.pow(1.059463, (count - 1) * 2);
            playChord(ctx, dest, [root, root * 1.25, root * 1.5, root * 2], {
                type: 'triangle',
                stagger: 0.045,
                duration: 0.36,
                gain: 0.15,
                filterFreq: 3800,
            });
        },
    },
    token_invalid: {
        category: 'ui',
        cooldownMs: 80,
        render: (ctx, dest) => {
            playTone(ctx, dest, { type: 'triangle', freq: 190, freqEnd: 130, duration: 0.06, gain: 0.065 });
        },
    },

    // ─── Combat (Kick vs Got Kicked) ───────────────────────────────────────
    capture_kick: {
        category: 'sfx',
        cooldownMs: 120,
        haptic: [35, 40, 30],
        duckMusic: { factor: 0.6, holdMs: 220, releaseMs: 300 },
        render: (ctx, dest) => {
            // Punchy chest-thump sub hit + crisp shatter + warm rising sting
            playTone(ctx, dest, { type: 'sine', freq: 190, freqEnd: 44, duration: 0.18, gain: 0.3 });
            playNoiseBurst(ctx, dest, { duration: 0.13, gain: 0.14, filterType: 'bandpass', filterFreq: 2400, filterQ: 1.4 });
            [659.25, 987.77, 1318.51].forEach((freq, idx) => {
                playWarmVoice(ctx, dest, {
                    type: 'sawtooth',
                    type2: 'triangle',
                    freq,
                    detuneCents: 12,
                    startOffset: 0.025 + idx * 0.028,
                    attack: 0.006,
                    duration: 0.24,
                    gain: 0.13,
                    filterFreq: 4200,
                    filterFreqEnd: 1600,
                    pan: (idx - 1) * 0.3,
                });
            });
        },
    },
    capture_got_kicked: {
        category: 'sfx',
        cooldownMs: 120,
        haptic: [60, 45, 90],
        duckMusic: { factor: 0.55, holdMs: 260, releaseMs: 350 },
        render: (ctx, dest) => {
            // Heavy hollow gut thud + downward crack + demoralizing drop
            playTone(ctx, dest, { type: 'sawtooth', freq: 320, freqEnd: 62, duration: 0.28, gain: 0.17, filterType: 'lowpass', filterFreq: 1100, filterFreqEnd: 220 });
            playTone(ctx, dest, { type: 'sine', freq: 120, freqEnd: 38, duration: 0.24, gain: 0.22 });
            playNoiseBurst(ctx, dest, { pink: true, duration: 0.14, gain: 0.11, filterType: 'bandpass', filterFreq: 720, filterFreqEnd: 260 });
        },
    },
    capture_teammate_kicked: {
        category: 'sfx',
        cooldownMs: 140,
        haptic: [25, 30, 25],
        render: (ctx, dest) => {
            playTone(ctx, dest, { type: 'triangle', freq: 390, freqEnd: 150, duration: 0.18, gain: 0.11 });
            playNoiseBurst(ctx, dest, { duration: 0.08, gain: 0.06, filterType: 'bandpass', filterFreq: 1100 });
        },
    },
    capture_blocked: {
        category: 'sfx',
        cooldownMs: 100,
        haptic: [15, 20],
        render: (ctx, dest) => {
            playTone(ctx, dest, { type: 'triangle', freq: 920, freqEnd: 540, duration: 0.12, gain: 0.09 });
            playTone(ctx, dest, { type: 'sine', freq: 1380, freqEnd: 880, duration: 0.11, gain: 0.07 });
        },
    },
    run_home_sprint: {
        category: 'sfx',
        cooldownMs: 180,
        render: (ctx, dest) => {
            playTone(ctx, dest, { type: 'sine', freq: 720, freqEnd: 190, duration: 0.34, gain: 0.075 });
            playNoiseBurst(ctx, dest, { pink: true, duration: 0.26, gain: 0.04, filterType: 'bandpass', filterFreq: 1800, filterFreqEnd: 420 });
        },
    },

    // ─── Power System v3 ───────────────────────────────────────────────────
    power_pickup: {
        category: 'sfx',
        cooldownMs: 150,
        haptic: 14,
        render: (ctx, dest, opts) => {
            const r = opts.rarity ?? 'boost';
            const freqs =
                r === 'nuke'
                    ? [587.33, 880, 1174.66, 1760]
                    : r === 'teleport'
                        ? [659.25, 987.77, 1318.51]
                        : r === 'shield'
                            ? [523.25, 783.99, 1046.5]
                            : [440, 659.25, 880];
            playChord(ctx, dest, freqs, {
                type: r === 'nuke' ? 'sawtooth' : 'triangle',
                stagger: 0.035,
                duration: 0.24,
                gain: 0.11,
                filterFreq: 3200,
            });
        },
    },
    power_arm_target: {
        category: 'ui',
        cooldownMs: 80,
        haptic: 10,
        render: (ctx, dest) => {
            playTone(ctx, dest, { type: 'sine', freq: 980, freqEnd: 1480, duration: 0.07, gain: 0.08 });
        },
    },
    power_disarm: {
        category: 'ui',
        cooldownMs: 80,
        render: (ctx, dest) => {
            playTone(ctx, dest, { type: 'sine', freq: 880, freqEnd: 520, duration: 0.07, gain: 0.065 });
        },
    },
    power_shield: {
        category: 'sfx',
        cooldownMs: 180,
        haptic: 18,
        render: (ctx, dest) => {
            // Crisp magnetic lock click -> shimmering hexagonal Aegis harmonic dome
            playNoiseBurst(ctx, dest, { duration: 0.025, gain: 0.075, filterType: 'bandpass', filterFreq: 3200, filterQ: 4 });
            playTone(ctx, dest, { type: 'sine', freq: 520, freqEnd: 1320, duration: 0.26, gain: 0.1 });
            playChord(ctx, dest, [880, 1318.51, 1760], {
                type: 'sine',
                startOffset: 0.04,
                stagger: 0.03,
                duration: 0.3,
                gain: 0.085,
            });
        },
    },
    power_boost: {
        category: 'sfx',
        cooldownMs: 180,
        haptic: 22,
        render: (ctx, dest) => {
            // Rising turbine ignition + plasma afterburner hiss
            playTone(ctx, dest, {
                type: 'sawtooth',
                freq: 220,
                freqEnd: 1380,
                duration: 0.26,
                gain: 0.095,
                filterType: 'bandpass',
                filterFreq: 600,
                filterFreqEnd: 2900,
            });
            playTone(ctx, dest, {
                type: 'triangle',
                freq: 440,
                freqEnd: 1760,
                startOffset: 0.04,
                duration: 0.22,
                gain: 0.07,
            });
            playNoiseBurst(ctx, dest, { duration: 0.2, gain: 0.06, filterType: 'highpass', filterFreq: 1800 });
        },
    },
    power_teleport: {
        category: 'sfx',
        cooldownMs: 180,
        haptic: [12, 35, 15],
        render: (ctx, dest) => {
            // Quantum suction implosion -> crystalline star-chime arrival
            playTone(ctx, dest, { type: 'sine', freq: 1180, freqEnd: 380, duration: 0.09, gain: 0.09 });
            playTone(ctx, dest, { type: 'sine', freq: 420, freqEnd: 1560, startOffset: 0.08, duration: 0.14, gain: 0.1 });
            playNoiseBurst(ctx, dest, { startOffset: 0.06, duration: 0.09, gain: 0.05, filterType: 'bandpass', filterFreq: 2400 });
            playChord(ctx, dest, [1567.98, 2093.0], {
                type: 'sine',
                startOffset: 0.16,
                stagger: 0.035,
                duration: 0.2,
                gain: 0.065,
            });
        },
    },
    power_nuke: {
        category: 'sfx',
        cooldownMs: 500,
        haptic: [80, 60, 130],
        duckMusic: { factor: 0.25, holdMs: 1200, releaseMs: 700 },
        render: (ctx, dest) => {
            // 3 tactical siren wails + falling warhead whistle -> +0.90s sub detonation + debris crunch
            [0, 0.28, 0.56].forEach((start, i) => {
                const f0 = i % 2 === 0 ? 640 : 880;
                const f1 = i % 2 === 0 ? 920 : 620;
                playTone(ctx, dest, {
                    type: 'square',
                    freq: f0,
                    freqEnd: f1,
                    freqExp: false,
                    startOffset: start,
                    duration: 0.24,
                    gain: 0.075,
                    filterType: 'lowpass',
                    filterFreq: 1800,
                });
            });
            // Falling warhead whistle leading directly to detonation at +0.90s
            playTone(ctx, dest, {
                type: 'sine',
                freq: 1480,
                freqEnd: 240,
                startOffset: 0.22,
                duration: 0.66,
                gain: 0.075,
            });
            // Sub boom & rumble tail at +0.90s (all nodes auto-disconnect via REA-12 helpers)
            playTone(ctx, dest, {
                type: 'sine',
                freq: 155,
                freqEnd: 26,
                startOffset: 0.9,
                attack: 0.005,
                duration: 0.58,
                gain: 0.3,
            });
            playTone(ctx, dest, {
                type: 'sawtooth',
                freq: 118,
                freqEnd: 32,
                startOffset: 0.9,
                attack: 0.008,
                duration: 0.52,
                gain: 0.17,
                filterType: 'lowpass',
                filterFreq: 820,
                filterFreqEnd: 130,
            });
            playNoiseBurst(ctx, dest, {
                pink: true,
                startOffset: 0.9,
                attack: 0.005,
                duration: 0.62,
                gain: 0.19,
                filterType: 'lowpass',
                filterFreq: 2800,
                filterFreqEnd: 240,
            });
            // Hot scorch sizzle / metallic crackle tail
            playNoiseBurst(ctx, dest, {
                startOffset: 0.98,
                duration: 0.42,
                gain: 0.07,
                filterType: 'bandpass',
                filterFreq: 3400,
                filterFreqEnd: 950,
            });
        },
    },
    power_expiring: {
        category: 'sfx',
        cooldownMs: 1500,
        render: (ctx, dest) => {
            playTone(ctx, dest, { type: 'sine', freq: 1046.5, duration: 0.055, gain: 0.055 });
            playTone(ctx, dest, { type: 'sine', freq: 880, startOffset: 0.08, duration: 0.065, gain: 0.05 });
        },
    },
    power_expired: {
        category: 'sfx',
        cooldownMs: 300,
        render: (ctx, dest) => {
            playTone(ctx, dest, { type: 'sine', freq: 520, freqEnd: 260, duration: 0.14, gain: 0.06 });
        },
    },

    // ─── Timer, AFK & Match Outcome ────────────────────────────────────────
    timer_urgent: {
        category: 'sfx',
        cooldownMs: 650,
        haptic: 10,
        render: (ctx, dest, opts) => {
            const left = opts.urgentLevel ?? 3;
            const freq = left <= 1 ? 1318.51 : left <= 2 ? 1174.66 : 987.77;
            const gain = left <= 2 ? 0.11 : 0.075;
            playTone(ctx, dest, { type: 'sine', freq, duration: 0.065, attack: 0.002, gain });
        },
    },
    afk_strike: {
        category: 'sfx',
        cooldownMs: 300,
        haptic: 55,
        render: (ctx, dest) => {
            playTone(ctx, dest, {
                type: 'sawtooth',
                freq: 210,
                freqEnd: 75,
                duration: 0.28,
                gain: 0.16,
                filterType: 'lowpass',
                filterFreq: 980,
            });
        },
    },
    afk_ultimatum: {
        category: 'sfx',
        cooldownMs: 800,
        haptic: [40, 50, 40],
        render: (ctx, dest) => {
            playTone(ctx, dest, { type: 'triangle', freq: 880, duration: 0.12, gain: 0.12 });
            playTone(ctx, dest, { type: 'triangle', freq: 880, startOffset: 0.16, duration: 0.12, gain: 0.12 });
        },
    },
    afk_kicked: {
        category: 'sfx',
        cooldownMs: 500,
        haptic: [70, 50, 100],
        render: (ctx, dest) => {
            playTone(ctx, dest, { type: 'sawtooth', freq: 280, freqEnd: 48, duration: 0.45, gain: 0.17, filterType: 'lowpass', filterFreq: 900, filterFreqEnd: 140 });
            playNoiseBurst(ctx, dest, { duration: 0.15, gain: 0.08, filterType: 'lowpass', filterFreq: 600 });
        },
    },
    match_victory: {
        category: 'sfx',
        cooldownMs: 1000,
        haptic: [100, 50, 100, 50, 200],
        duckMusic: { factor: 0.2, holdMs: 1600, releaseMs: 900 },
        render: (ctx, dest) => {
            // Triumphant arena synth-brass fanfare (C5 - E5 - G5 - C6 + warm sub bass + octave shimmer)
            playTone(ctx, dest, { type: 'sine', freq: 130.81, duration: 0.85, gain: 0.24 });
            [523.25, 659.25, 783.99, 1046.5].forEach((freq, idx) => {
                playWarmVoice(ctx, dest, {
                    type: 'sawtooth',
                    type2: 'triangle',
                    freq,
                    detuneCents: 12,
                    octaveSub: idx === 0 || idx === 3,
                    startOffset: idx * 0.08,
                    attack: 0.014,
                    duration: 0.56,
                    gain: 0.15,
                    filterFreq: 4200,
                    filterFreqEnd: 1800,
                    filterQ: 1.6,
                    pan: (idx - 1.5) * 0.22,
                });
            });
            [1046.5, 1318.51, 1567.98].forEach((freq, idx) => {
                playWarmVoice(ctx, dest, {
                    type: 'triangle',
                    type2: 'sine',
                    freq,
                    detuneCents: 9,
                    startOffset: 0.34 + idx * 0.032,
                    attack: 0.01,
                    duration: 0.7,
                    gain: 0.13,
                    filterFreq: 5400,
                    filterFreqEnd: 2600,
                    pan: (idx - 1) * 0.28,
                });
            });
        },
    },
    match_defeat: {
        category: 'sfx',
        cooldownMs: 1000,
        haptic: [80, 60, 120],
        duckMusic: { factor: 0.25, holdMs: 1400, releaseMs: 900 },
        render: (ctx, dest) => {
            // Respectful dramatic descending minor cadence
            playTone(ctx, dest, { type: 'sine', freq: 110, freqEnd: 65.41, duration: 0.7, gain: 0.16 });
            playChord(ctx, dest, [440, 392, 349.23, 293.66], {
                type: 'triangle',
                stagger: 0.12,
                duration: 0.42,
                gain: 0.14,
                filterFreq: 1600,
            });
        },
    },
    match_runnerup: {
        category: 'sfx',
        cooldownMs: 1000,
        haptic: [60, 40, 90],
        duckMusic: { factor: 0.3, holdMs: 1200, releaseMs: 800 },
        render: (ctx, dest) => {
            playChord(ctx, dest, [440, 554.37, 659.25, 880], {
                type: 'triangle',
                stagger: 0.08,
                duration: 0.4,
                gain: 0.14,
                filterFreq: 2800,
            });
        },
    },
    stats_tick: {
        category: 'ui',
        cooldownMs: 35,
        render: (ctx, dest, opts) => {
            const idx = opts.step ?? 0;
            playTone(ctx, dest, { type: 'sine', freq: 980 + idx * 140, duration: 0.03, gain: 0.05 });
        },
    },

    // ─── Social, Spectator, Progression & System ───────────────────────────
    emote_glitch: {
        category: 'emote',
        cooldownMs: 900,
        render: (ctx, dest) => {
            [0, 0.045, 0.09].forEach((d, i) => {
                playTone(ctx, dest, { type: 'square', freq: 920 - i * 210, duration: 0.035, startOffset: d, gain: 0.06, filterType: 'bandpass', filterFreq: 1500 });
            });
        },
    },
    emote_overheat: {
        category: 'emote',
        cooldownMs: 900,
        render: (ctx, dest) => {
            playNoiseBurst(ctx, dest, { duration: 0.18, gain: 0.075, filterType: 'bandpass', filterFreq: 1800, filterFreqEnd: 4200, filterQ: 2.2 });
            playTone(ctx, dest, { type: 'sawtooth', freq: 240, freqEnd: 520, duration: 0.16, gain: 0.06, filterType: 'lowpass', filterFreq: 1200 });
        },
    },
    emote_laser: {
        category: 'emote',
        cooldownMs: 900,
        render: (ctx, dest) => {
            playTone(ctx, dest, { type: 'sawtooth', freq: 1680, freqEnd: 280, duration: 0.16, gain: 0.08, filterType: 'lowpass', filterFreq: 2600 });
        },
    },
    emote_smug: {
        category: 'emote',
        cooldownMs: 900,
        render: (ctx, dest) => {
            playTone(ctx, dest, { type: 'sine', freq: 659.25, duration: 0.06, gain: 0.075 });
            playTone(ctx, dest, { type: 'sine', freq: 987.77, startOffset: 0.06, duration: 0.09, gain: 0.08 });
        },
    },
    emote_bounce: {
        category: 'emote',
        cooldownMs: 900,
        render: (ctx, dest) => {
            playTone(ctx, dest, { type: 'sine', freq: 340, freqEnd: 920, duration: 0.11, gain: 0.085 });
            playTone(ctx, dest, { type: 'sine', freq: 520, freqEnd: 1120, startOffset: 0.1, duration: 0.1, gain: 0.065 });
        },
    },
    emote_crash: {
        category: 'emote',
        cooldownMs: 900,
        render: (ctx, dest) => {
            playTone(ctx, dest, { type: 'square', freq: 620, freqEnd: 180, duration: 0.22, gain: 0.065, filterType: 'lowpass', filterFreq: 1200 });
        },
    },
    emote_diamond: {
        category: 'emote',
        cooldownMs: 900,
        render: (ctx, dest) => {
            playChord(ctx, dest, [1567.98, 2093.0, 2637.02], { type: 'sine', stagger: 0.035, duration: 0.2, gain: 0.075 });
        },
    },
    emote_sonar: {
        category: 'emote',
        cooldownMs: 900,
        render: (ctx, dest) => {
            playTone(ctx, dest, { type: 'sine', freq: 1480, duration: 0.22, gain: 0.08 });
        },
    },
    emote_preset: {
        category: 'emote',
        cooldownMs: 900,
        render: (ctx, dest) => {
            playTone(ctx, dest, { type: 'triangle', freq: 720, freqEnd: 1080, duration: 0.08, gain: 0.07 });
        },
    },
    chat_all: {
        category: 'emote',
        cooldownMs: 350,
        render: (ctx, dest) => {
            playTone(ctx, dest, { type: 'sine', freq: 780, freqEnd: 1040, duration: 0.055, gain: 0.055 });
        },
    },
    chat_team: {
        category: 'emote',
        cooldownMs: 350,
        render: (ctx, dest) => {
            playTone(ctx, dest, { type: 'sine', freq: 920, duration: 0.05, gain: 0.055 });
            playTone(ctx, dest, { type: 'sine', freq: 1240, startOffset: 0.04, duration: 0.065, gain: 0.06 });
        },
    },
    dm_received: {
        category: 'emote',
        cooldownMs: 500,
        render: (ctx, dest) => {
            playTone(ctx, dest, { type: 'sine', freq: 1046.5, duration: 0.065, gain: 0.07 });
            playTone(ctx, dest, { type: 'sine', freq: 1567.98, startOffset: 0.055, duration: 0.11, gain: 0.075 });
        },
    },
    bet_window_open: {
        category: 'sfx',
        cooldownMs: 400,
        haptic: 15,
        render: (ctx, dest) => {
            playChord(ctx, dest, [659.25, 987.77, 1318.51], { type: 'sine', stagger: 0.04, duration: 0.25, gain: 0.1 });
        },
    },
    bet_window_tick: {
        category: 'sfx',
        cooldownMs: 700,
        render: (ctx, dest) => {
            playTone(ctx, dest, { type: 'triangle', freq: 1046.5, duration: 0.05, gain: 0.07 });
        },
    },
    bet_window_closed: {
        category: 'sfx',
        cooldownMs: 400,
        haptic: 20,
        render: (ctx, dest) => {
            playNoiseBurst(ctx, dest, { duration: 0.06, gain: 0.07, filterType: 'lowpass', filterFreq: 900 });
            playTone(ctx, dest, { type: 'triangle', freq: 440, freqEnd: 165, duration: 0.16, gain: 0.1 });
        },
    },
    bet_placed: {
        category: 'sfx',
        cooldownMs: 150,
        haptic: 12,
        render: (ctx, dest) => {
            // Tactile chip stack thud + warm high-roller lock-in chime
            playTone(ctx, dest, { type: 'sine', freq: 240, freqEnd: 88, duration: 0.08, gain: 0.18 });
            playWarmVoice(ctx, dest, {
                type: 'triangle',
                type2: 'sine',
                freq: 740,
                detuneCents: 8,
                duration: 0.12,
                attack: 0.003,
                gain: 0.12,
                filterFreq: 4200,
                pan: -0.15,
            });
            playWarmVoice(ctx, dest, {
                type: 'triangle',
                type2: 'sine',
                freq: 1108.73,
                detuneCents: 8,
                startOffset: 0.036,
                duration: 0.18,
                attack: 0.003,
                gain: 0.12,
                filterFreq: 5200,
                pan: 0.15,
            });
        },
    },
    bet_win: {
        category: 'sfx',
        cooldownMs: 400,
        haptic: [20, 35, 40],
        render: (ctx, dest) => {
            playChord(ctx, dest, [783.99, 987.77, 1174.66, 1567.98], { type: 'sine', stagger: 0.04, duration: 0.3, gain: 0.12 });
        },
    },
    bet_loss: {
        category: 'sfx',
        cooldownMs: 400,
        render: (ctx, dest) => {
            playTone(ctx, dest, { type: 'sine', freq: 349.23, freqEnd: 220, duration: 0.18, gain: 0.08 });
        },
    },
    clan_action: {
        category: 'sfx',
        cooldownMs: 200,
        haptic: 15,
        render: (ctx, dest) => {
            playChord(ctx, dest, [329.63, 493.88, 659.25], { type: 'triangle', stagger: 0.04, duration: 0.24, gain: 0.1 });
        },
    },
    mission_complete: {
        category: 'sfx',
        cooldownMs: 250,
        haptic: [15, 25, 25],
        render: (ctx, dest) => {
            playChord(ctx, dest, [587.33, 783.99, 1174.66, 1479.98], { type: 'triangle', stagger: 0.045, duration: 0.28, gain: 0.12 });
        },
    },
    level_up: {
        category: 'sfx',
        cooldownMs: 500,
        haptic: [40, 40, 80],
        duckMusic: { factor: 0.4, holdMs: 900, releaseMs: 600 },
        render: (ctx, dest) => {
            playChord(ctx, dest, [523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98], {
                type: 'triangle',
                stagger: 0.05,
                duration: 0.42,
                gain: 0.16,
                filterFreq: 3800,
            });
        },
    },
    biometric_unlock: {
        category: 'ui',
        cooldownMs: 200,
        haptic: 12,
        render: (ctx, dest) => {
            playTone(ctx, dest, { type: 'sine', freq: 660, duration: 0.06, gain: 0.08 });
            playTone(ctx, dest, { type: 'sine', freq: 1320, startOffset: 0.055, duration: 0.14, gain: 0.09 });
        },
    },
    biometric_lock: {
        category: 'ui',
        cooldownMs: 200,
        haptic: [25, 30],
        render: (ctx, dest) => {
            playTone(ctx, dest, { type: 'triangle', freq: 380, freqEnd: 180, duration: 0.14, gain: 0.09 });
        },
    },
    net_lost: {
        category: 'ui',
        cooldownMs: 1000,
        render: (ctx, dest) => {
            playTone(ctx, dest, { type: 'sine', freq: 440, freqEnd: 260, duration: 0.16, gain: 0.07 });
        },
    },
    net_restored: {
        category: 'ui',
        cooldownMs: 1000,
        render: (ctx, dest) => {
            playTone(ctx, dest, { type: 'sine', freq: 660, freqEnd: 990, duration: 0.14, gain: 0.07 });
        },
    },
    net_chain_switch: {
        category: 'ui',
        cooldownMs: 600,
        render: (ctx, dest) => {
            playTone(ctx, dest, { type: 'sine', freq: 740, duration: 0.05, gain: 0.055 });
            playTone(ctx, dest, { type: 'sine', freq: 1108.73, startOffset: 0.05, duration: 0.09, gain: 0.06 });
        },
    },
};
