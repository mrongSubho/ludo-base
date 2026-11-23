import type { PowerType } from '@/lib/types';

export type AudioTheme = '3077' | 'retro' | 'light';

export type MusicScene =
    | 'silent'
    | 'lobby'
    | 'queueing'
    | 'match_calm'
    | 'match_heat'
    | 'match_crunch'
    | 'result';

export type SoundCategory = 'sfx' | 'ui' | 'emote';

export type SoundId =
    // UI & Navigation
    | 'ui_hover'
    | 'ui_click'
    | 'ui_tap'
    | 'ui_select'
    | 'ui_back'
    | 'ui_sheet_open'
    | 'ui_sheet_close'
    | 'ui_tab_switch'
    | 'ui_knob_tick'
    | 'ui_copy'
    | 'ui_error'
    | 'ui_confirm'
    // Settings & Cosmetics
    | 'pref_toggle_on'
    | 'pref_toggle_off'
    | 'pref_theme_swap'
    | 'pref_cosmetic_swap'
    // Lobby & Matchmaking
    | 'lobby_room_created'
    | 'lobby_player_join'
    | 'lobby_player_leave'
    | 'lobby_seat_swap'
    | 'lobby_player_kick'
    | 'lobby_countdown_tick'
    | 'lobby_countdown_go'
    | 'match_found'
    | 'invite_received'
    | 'invite_accept'
    | 'invite_reject'
    // Wallet, Swaps & On-Chain
    | 'swap_flip'
    | 'swap_confirm'
    | 'swap_complete'
    | 'tx_sign_open'
    | 'tx_gas_open'
    | 'tx_preflight_pass'
    | 'tx_preflight_warning'
    | 'tx_submitted'
    | 'tx_confirmed'
    | 'tx_rejected'
    | 'allowance_approved'
    | 'allowance_revoked'
    | 'claim_radar_ping'
    | 'claim_reward_burst'
    | 'coin_chink'
    | 'marketplace_purchase'
    | 'burn_chips'
    // Dice & Turn Flow
    | 'dice_roll'
    | 'dice_land'
    | 'dice_six'
    | 'dice_three_sixes_bust'
    | 'dice_toss_pass'
    | 'dice_no_moves'
    | 'turn_mine'
    | 'turn_other'
    | 'turn_teammate_assist'
    // Token Movement
    | 'token_spawn'
    | 'token_hop'
    | 'token_land'
    | 'token_safe_star'
    | 'token_home_lane'
    | 'token_stack_force'
    | 'token_finish_home'
    | 'token_invalid'
    // Combat
    | 'capture_kick'
    | 'capture_got_kicked'
    | 'capture_teammate_kicked'
    | 'capture_blocked'
    | 'run_home_sprint'
    // Power v3
    | 'power_pickup'
    | 'power_arm_target'
    | 'power_disarm'
    | 'power_shield'
    | 'power_boost'
    | 'power_teleport'
    | 'power_nuke'
    | 'power_expiring'
    | 'power_expired'
    // Timer, AFK & Match End
    | 'timer_urgent'
    | 'afk_strike'
    | 'afk_ultimatum'
    | 'afk_kicked'
    | 'match_victory'
    | 'match_defeat'
    | 'match_runnerup'
    | 'stats_tick'
    // Social, Spectator, Progression & System
    | 'emote_glitch'
    | 'emote_overheat'
    | 'emote_laser'
    | 'emote_smug'
    | 'emote_bounce'
    | 'emote_crash'
    | 'emote_diamond'
    | 'emote_sonar'
    | 'emote_preset'
    | 'chat_all'
    | 'chat_team'
    | 'dm_received'
    | 'bet_window_open'
    | 'bet_window_tick'
    | 'bet_window_closed'
    | 'bet_placed'
    | 'bet_win'
    | 'bet_loss'
    | 'clan_action'
    | 'mission_complete'
    | 'level_up'
    | 'biometric_unlock'
    | 'biometric_lock'
    | 'net_lost'
    | 'net_restored'
    | 'net_chain_switch';

export interface SoundPlayOptions {
    /** 0-based hop index within a move */
    step?: number;
    /** Total hops in a move */
    totalSteps?: number;
    /** Entry fee dial tier index (0..9) */
    tierIndex?: number;
    /** Consecutive sixes streak (1, 2, 3) */
    streak?: number;
    /** Number of tokens finished (1..4) */
    finishCount?: number;
    /** Power tile rarity/type */
    rarity?: PowerType;
    /** Whether move is boosted (+6) */
    boosted?: boolean;
    /** Equipped dice skin */
    diceStyle?: string;
    /** Active theme override */
    theme?: AudioTheme;
    /** Countdown urgency (e.g. seconds remaining 5..1) */
    urgentLevel?: number;
    /** Per-call relative volume scalar (0..1.5) */
    volume?: number;
    /** Bypass sfx-off mute check (used for explicit SFX-enable preview) */
    force?: boolean;
}

export interface AudioPrefsSnapshot {
    theme: AudioTheme;
    sfx: boolean;
    music: boolean;
    sfxVolume: number; // 0..100
    musicVolume: number; // 0..100
    haptics: boolean;
}

export function normalizeAudioTheme(raw?: string | null): AudioTheme {
    if (raw === 'retro' || raw === 'dark' || raw === 'ui') return 'retro';
    if (raw === 'light' || raw === 'porcelain') return 'light';
    return '3077';
}
