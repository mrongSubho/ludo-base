/**
 * Tactical Clan System Types & Contracts.
 *
 * Single source of truth for Clan models, Roles, Stake-Backed Clan Wars,
 * 3N Fixtures Matrix, and Pull-Based Claim Vouchers.
 */

export type ClanRole = 'commander' | 'officer' | 'elite' | 'member';
export type ClanJoinPolicy = 'open' | 'request' | 'invite_only';
export type ClanStatus = 'active' | 'archived';
export type ClanDivision = 'Bronze' | 'Silver' | 'Gold' | 'Platinum' | 'Diamond' | 'Master';

export interface ClanCrest {
    emblem: string;
    primary: string;
    secondary: string;
}

export interface ClanLevelConfig {
    level: number;
    cxp_required: number;
    member_cap: number;
    officer_slots: number;
    unlocks: Record<string, unknown>;
}

export interface Clan {
    id: string;
    name: string;
    tag: string;
    bio: string | null;
    crest: ClanCrest;
    leader_wallet: string;
    level: number;
    cxp: number;
    division: string;
    cwr: number;
    join_policy: ClanJoinPolicy;
    min_rxp: number;
    min_level: number;
    member_count: number;
    treasury_balance: number;
    farcaster_channel: string | null;
    status: ClanStatus;
    created_at: string;
}

export interface ClanMember {
    id: string;
    clan_id: string;
    wallet_address: string;
    role: ClanRole;
    weekly_cxp: number;
    total_cxp: number;
    war_points: number;
    joined_at: string;
    player?: {
        username: string | null;
        avatar_url: string | null;
        rank_tier: string | null;
    };
}

export interface ClanJoinRequest {
    id: string;
    clan_id: string;
    wallet_address: string;
    status: 'pending' | 'accepted' | 'rejected' | 'expired';
    created_at: string;
    expires_at: string;
    player?: {
        username: string | null;
        avatar_url: string | null;
        rank_tier: string | null;
    };
}

export interface ClanChatMessage {
    id: string;
    clan_id: string;
    wallet_address: string;
    sender_name: string;
    content: string;
    created_at: string;
}

export type ClanWarCallStatus = 'notice_open' | 'searching' | 'matched' | 'cancelled' | 'expired';

export interface ClanWarCall {
    id: string;
    clan_id: string;
    bracket: 5 | 10 | 15 | 20;
    member_fee: number;
    stakers_pct: number;
    treasury_pct: number;
    leader_pct: number;
    officers_pct: number;
    treasury_subsidy: number;
    booster_buffer: number;
    total_stake: number;
    status: ClanWarCallStatus;
    search_expires_at: string | null;
    created_at: string;
}

export type ClanWarStakeKind = 'member_fee' | 'booster' | 'treasury_subsidy';
export type ClanWarStakeStatus = 'locked' | 'claimable_refund' | 'settled';

export interface ClanWarStake {
    id: string;
    war_call_id: string;
    wallet_address: string;
    stake_amount: number;
    kind: ClanWarStakeKind;
    status: ClanWarStakeStatus;
    created_at: string;
}

export type ClanWarStatus = 'prep_phase' | 'active_war' | 'settling' | 'completed' | 'draw_refunded';

export interface ClanWar {
    id: string;
    clan_a_id: string;
    clan_b_id: string;
    bracket: number;
    stake_per_clan: number;
    status: ClanWarStatus;
    matched_at: string;
    war_start_at: string;
    war_end_at: string;
    winner_clan_id: string | null;
    clan_a_score: number;
    clan_b_score: number;
    created_at: string;
    clan_a?: Clan;
    clan_b?: Clan;
}

export type FixtureGameShape = '1v1' | '2v2';
export type FixtureStatus =
    | 'unscheduled'
    | 'scheduled_agreed'
    | 'reschedule_pending'
    | 'in_progress'
    | 'completed'
    | 'walkover'
    | 'mutual_void';

export interface ClanWarFixture {
    id: string;
    war_id: string;
    fixture_index: number;
    game_shape: FixtureGameShape;
    clan_a_seats: string[];
    clan_b_seats: string[];
    scheduled_at: string | null;
    status: FixtureStatus;
    winner_clan_id: string | null;
    match_id: string | null;
    created_at: string;
}

export type ClanClaimType =
    | 'war_principal'
    | 'war_merit_wp'
    | 'war_gov_share'
    | 'war_refund'
    | 'weekly_vault'
    | 'treasury_grant';

export interface ClanClaimItem {
    id: string;
    wallet_address: string;
    clan_id: string;
    claim_type: ClanClaimType;
    amount: number;
    source_id: string;
    status: 'claimable' | 'claimed';
    tx_hash: string | null;
    created_at: string;
    claimed_at: string | null;
    clan?: {
        name: string;
        tag: string;
    };
}

export interface ClanClaimVoucherPayload {
    claimId: `0x${string}`;
    clanId: `0x${string}`;
    recipient: `0x${string}`;
    amount: string; // Base units (1e18) as string
    claimType: number;
    nonce: string;
    deadline: string;
}

export interface IssuedClanClaimVoucher {
    clanClaimContract: `0x${string}`;
    chainId: number;
    voucher: ClanClaimVoucherPayload;
    signature: `0x${string}`;
}
