/**
 * Ludo Base: Game Constants
 * Global source of truth for board indices, game rules, and AI weights.
 */

// --- Board Indices & Metadata ---
export const BOARD_FINISH_INDEX = 57;
export const HOME_LANE_START_INDEX = 52;
export const TOTAL_PATH_CELLS = 52;
export const START_TILE_INDEX = 0;
export const BASE_INDEX = -1;

// --- Game Rules ---
export const DEFAULT_TURN_TIMER_SECS = 15;
export const IDLE_WARNING_TIMER_SECS = 10;
export const MAX_CONSECUTIVE_SIXES = 3;
export const POWER_TILES_COUNT = 4;
export const MAX_AFK_STRIKES = 3;
export const AFK_CANCEL_REASON = 'USER_ACTIVITY';

// --- Dice ---
export const DICE_MIN = 1;
export const DICE_MAX = 6;
export const DICE_ROLL_SIX = 6;

// --- AI Heuristics & Scoring ---
export const AI_SCORES = {
  REACH_FINISH: 150,
  POWER_TILE_HUNT: 120,
  CAPTURE_TOKEN: 100,
  REINFORCE_ALLY: 60,
  ENTER_SAFE_ZONE: 50,
  EXIT_BASE: 40,
  ENTER_HOME_LANE: 25,
  PROGRESSION_MULTIPLIER: 1, // Points per step forward
};

// --- Animations & Delays ---
export const BOT_ROLL_DELAY_MIN = 3000;
export const BOT_ROLL_DELAY_MAX = 6000;
export const BOT_MOVE_DELAY = 1500;
export const GUEST_SYNC_DELAY = 800; // ms to wait for host init
export const JOINER_SYNC_DELAY = 1500; // ms wait for Host PeerJS ID
