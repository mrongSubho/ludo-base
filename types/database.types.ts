export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      activities: {
        Row: {
          actor_id: string
          created_at: string
          id: string
          metadata: NonNullable<Json>
          type: string
        }
        ComputedFields: never
        Insert: {
          actor_id: string
          created_at?: string
          id?: string
          metadata?: NonNullable<Json>
          type: string
        }
        Update: {
          actor_id?: string
          created_at?: string
          id?: string
          metadata?: NonNullable<Json>
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "activities_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["wallet_address"]
          },
        ]
      }
      app_sessions: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          nonce: string
          revoked_at: string | null
          wallet_address: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          nonce: string
          revoked_at?: string | null
          wallet_address: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          nonce?: string
          revoked_at?: string | null
          wallet_address?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_sessions_wallet_address_fkey"
            columns: ["wallet_address"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["wallet_address"]
          },
        ]
      }
      auth_challenges: {
        Row: {
          consumed_at: string | null
          created_at: string
          expires_at: string
          id: string
          ip: string | null
          nonce: string
          user_agent: string | null
          wallet_address: string | null
        }
        ComputedFields: never
        Insert: {
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          id?: string
          ip?: string | null
          nonce: string
          user_agent?: string | null
          wallet_address?: string | null
        }
        Update: {
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          ip?: string | null
          nonce?: string
          user_agent?: string | null
          wallet_address?: string | null
        }
        Relationships: []
      }
      chain_indexer_cursors: {
        Row: {
          chain_id: number
          last_block: number
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          chain_id: number
          last_block?: number
          updated_at?: string
        }
        Update: {
          chain_id?: number
          last_block?: number
          updated_at?: string
        }
        Relationships: []
      }
      chips_claimable: {
        Row: {
          amount: number
          claim_tx: string | null
          claimed_at: string | null
          credited_at: string
          ref_id: string
          source: string
          status: string
          wallet_address: string
        }
        ComputedFields: never
        Insert: {
          amount: number
          claim_tx?: string | null
          claimed_at?: string | null
          credited_at?: string
          ref_id: string
          source: string
          status?: string
          wallet_address: string
        }
        Update: {
          amount?: number
          claim_tx?: string | null
          claimed_at?: string | null
          credited_at?: string
          ref_id?: string
          source?: string
          status?: string
          wallet_address?: string
        }
        Relationships: []
      }
      chips_escrow_accounts: {
        Row: {
          balance: number
          updated_at: string
          wallet_address: string
        }
        ComputedFields: never
        Insert: {
          balance?: number
          updated_at?: string
          wallet_address: string
        }
        Update: {
          balance?: number
          updated_at?: string
          wallet_address?: string
        }
        Relationships: [
          {
            foreignKeyName: "chips_escrow_accounts_wallet_address_fkey"
            columns: ["wallet_address"]
            isOneToOne: true
            referencedRelation: "players"
            referencedColumns: ["wallet_address"]
          },
        ]
      }
      chips_escrow_config: {
        Row: {
          allow_self_bets: boolean
          enabled: boolean
          id: boolean
          max_bet_base: number
          min_bet_base: number
          rake_bps: number
          treasury_wallet: string | null
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          allow_self_bets?: boolean
          enabled?: boolean
          id?: boolean
          max_bet_base?: number
          min_bet_base?: number
          rake_bps?: number
          treasury_wallet?: string | null
          updated_at?: string
        }
        Update: {
          allow_self_bets?: boolean
          enabled?: boolean
          id?: boolean
          max_bet_base?: number
          min_bet_base?: number
          rake_bps?: number
          treasury_wallet?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      chips_escrow_ledger: {
        Row: {
          created_at: string
          delta: number
          id: number
          reason: string
          ref: string
          wallet_address: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          delta: number
          id?: number
          reason: string
          ref: string
          wallet_address: string
        }
        Update: {
          created_at?: string
          delta?: number
          id?: number
          reason?: string
          ref?: string
          wallet_address?: string
        }
        Relationships: [
          {
            foreignKeyName: "chips_escrow_ledger_wallet_address_fkey"
            columns: ["wallet_address"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["wallet_address"]
          },
        ]
      }
      chips_events: {
        Row: {
          amount: number | null
          chain_id: number
          event_name: string
          ingested_at: string
          log_index: number
          memo_bytes32: string | null
          memo_tag: string | null
          payload: NonNullable<Json>
          tx_hash: string
          wallet_address: string | null
        }
        ComputedFields: never
        Insert: {
          amount?: number | null
          chain_id: number
          event_name: string
          ingested_at?: string
          log_index: number
          memo_bytes32?: string | null
          memo_tag?: string | null
          payload?: NonNullable<Json>
          tx_hash: string
          wallet_address?: string | null
        }
        Update: {
          amount?: number | null
          chain_id?: number
          event_name?: string
          ingested_at?: string
          log_index?: number
          memo_bytes32?: string | null
          memo_tag?: string | null
          payload?: NonNullable<Json>
          tx_hash?: string
          wallet_address?: string | null
        }
        Relationships: []
      }
      chips_marketplace_purchases: {
        Row: {
          created_at: string
          id: string
          item_ids: NonNullable<Json>
          request_id: string
          total_base: number
          wallet_address: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          id?: string
          item_ids: NonNullable<Json>
          request_id: string
          total_base: number
          wallet_address: string
        }
        Update: {
          created_at?: string
          id?: string
          item_ids?: NonNullable<Json>
          request_id?: string
          total_base?: number
          wallet_address?: string
        }
        Relationships: [
          {
            foreignKeyName: "chips_marketplace_purchases_wallet_address_fkey"
            columns: ["wallet_address"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["wallet_address"]
          },
        ]
      }
      chips_pool_seats: {
        Row: {
          claimed_tx: string | null
          credited_amount: number | null
          entry_amount: number | null
          join_tx: string | null
          pool_id: string
          seat_index: number
          wallet_address: string
        }
        ComputedFields: never
        Insert: {
          claimed_tx?: string | null
          credited_amount?: number | null
          entry_amount?: number | null
          join_tx?: string | null
          pool_id: string
          seat_index: number
          wallet_address: string
        }
        Update: {
          claimed_tx?: string | null
          credited_amount?: number | null
          entry_amount?: number | null
          join_tx?: string | null
          pool_id?: string
          seat_index?: number
          wallet_address?: string
        }
        Relationships: []
      }
      chips_pools: {
        Row: {
          burn: number | null
          chain_id: number | null
          claim_unlock_at: string | null
          entry_fee: number | null
          filled_seats: number | null
          game_mode: string | null
          gross: number | null
          host_bond: number | null
          match_id: string | null
          max_seats: number | null
          pool_id: string
          prize_fund: number | null
          protocol_fee: number | null
          result_hash: string | null
          room_code: string | null
          settle_by: string | null
          settle_tx: string | null
          settled_at: string | null
          status: string | null
          tx_create: string | null
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          burn?: number | null
          chain_id?: number | null
          claim_unlock_at?: string | null
          entry_fee?: number | null
          filled_seats?: number | null
          game_mode?: string | null
          gross?: number | null
          host_bond?: number | null
          match_id?: string | null
          max_seats?: number | null
          pool_id: string
          prize_fund?: number | null
          protocol_fee?: number | null
          result_hash?: string | null
          room_code?: string | null
          settle_by?: string | null
          settle_tx?: string | null
          settled_at?: string | null
          status?: string | null
          tx_create?: string | null
          updated_at?: string
        }
        Update: {
          burn?: number | null
          chain_id?: number | null
          claim_unlock_at?: string | null
          entry_fee?: number | null
          filled_seats?: number | null
          game_mode?: string | null
          gross?: number | null
          host_bond?: number | null
          match_id?: string | null
          max_seats?: number | null
          pool_id?: string
          prize_fund?: number | null
          protocol_fee?: number | null
          result_hash?: string | null
          room_code?: string | null
          settle_by?: string | null
          settle_tx?: string | null
          settled_at?: string | null
          status?: string | null
          tx_create?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      coin_ledger: {
        Row: {
          amount: number
          balance_after: number | null
          created_at: string
          id: string
          idempotency_key: string
          metadata: NonNullable<Json>
          player_id: string
          reason: string
          reference_id: string | null
          reference_type: string | null
        }
        ComputedFields: never
        Insert: {
          amount: number
          balance_after?: number | null
          created_at?: string
          id?: string
          idempotency_key: string
          metadata?: NonNullable<Json>
          player_id: string
          reason: string
          reference_id?: string | null
          reference_type?: string | null
        }
        Update: {
          amount?: number
          balance_after?: number | null
          created_at?: string
          id?: string
          idempotency_key?: string
          metadata?: NonNullable<Json>
          player_id?: string
          reason?: string
          reference_id?: string | null
          reference_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "coin_ledger_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["wallet_address"]
          },
        ]
      }
      conversations: {
        Row: {
          id: string
          last_message_at: string | null
          last_message_content: string | null
          unread_count_a: number
          unread_count_b: number
          user_a: string
          user_b: string
        }
        ComputedFields: never
        Insert: {
          id?: string
          last_message_at?: string | null
          last_message_content?: string | null
          unread_count_a?: number
          unread_count_b?: number
          user_a: string
          user_b: string
        }
        Update: {
          id?: string
          last_message_at?: string | null
          last_message_content?: string | null
          unread_count_a?: number
          unread_count_b?: number
          user_a?: string
          user_b?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_user_a_fkey"
            columns: ["user_a"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["wallet_address"]
          },
          {
            foreignKeyName: "conversations_user_b_fkey"
            columns: ["user_b"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["wallet_address"]
          },
        ]
      }
      feedback: {
        Row: {
          address: string | null
          created_at: string
          id: string
          message: string
          topic: string
        }
        ComputedFields: never
        Insert: {
          address?: string | null
          created_at?: string
          id?: string
          message: string
          topic: string
        }
        Update: {
          address?: string | null
          created_at?: string
          id?: string
          message?: string
          topic?: string
        }
        Relationships: []
      }
      friendships: {
        Row: {
          created_at: string
          friend_address: string
          id: string
          status: string
          user_address: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          friend_address: string
          id?: string
          status?: string
          user_address: string
        }
        Update: {
          created_at?: string
          friend_address?: string
          id?: string
          status?: string
          user_address?: string
        }
        Relationships: [
          {
            foreignKeyName: "friendships_friend_address_fkey"
            columns: ["friend_address"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["wallet_address"]
          },
          {
            foreignKeyName: "friendships_user_address_fkey"
            columns: ["user_address"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["wallet_address"]
          },
        ]
      }
      game_invites: {
        Row: {
          created_at: string
          entry_fee: number
          guest_address: string
          host_address: string
          id: string
          match_type: string | null
          room_code: string
          status: string
          validation_token: string | null
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          entry_fee?: number
          guest_address: string
          host_address: string
          id?: string
          match_type?: string | null
          room_code: string
          status?: string
          validation_token?: string | null
        }
        Update: {
          created_at?: string
          entry_fee?: number
          guest_address?: string
          host_address?: string
          id?: string
          match_type?: string | null
          room_code?: string
          status?: string
          validation_token?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "game_invites_guest_address_fkey"
            columns: ["guest_address"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["wallet_address"]
          },
          {
            foreignKeyName: "game_invites_host_address_fkey"
            columns: ["host_address"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["wallet_address"]
          },
        ]
      }
      live_chat: {
        Row: {
          avatar_url: string | null
          content: string
          country: string | null
          created_at: string
          id: string
          room_code: string | null
          room_open: boolean
          sender_id: string
          username: string | null
        }
        ComputedFields: never
        Insert: {
          avatar_url?: string | null
          content: string
          country?: string | null
          created_at?: string
          id?: string
          room_code?: string | null
          room_open?: boolean
          sender_id: string
          username?: string | null
        }
        Update: {
          avatar_url?: string | null
          content?: string
          country?: string | null
          created_at?: string
          id?: string
          room_code?: string | null
          room_open?: boolean
          sender_id?: string
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "live_chat_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["wallet_address"]
          },
        ]
      }
      live_matches: {
        Row: {
          arena_key: string | null
          authority_heartbeat: string | null
          authority_id: string | null
          bet_window_status: string
          created_at: string
          current_bet_type: string | null
          host_address: string | null
          join_secret_hash: string | null
          match_id: string
          room_code: string
          spectator_count: number
          updated_at: string
          window_closed_at: string | null
          window_opened_at: string | null
        }
        ComputedFields: never
        Insert: {
          arena_key?: string | null
          authority_heartbeat?: string | null
          authority_id?: string | null
          bet_window_status?: string
          created_at?: string
          current_bet_type?: string | null
          host_address?: string | null
          join_secret_hash?: string | null
          match_id: string
          room_code: string
          spectator_count?: number
          updated_at?: string
          window_closed_at?: string | null
          window_opened_at?: string | null
        }
        Update: {
          arena_key?: string | null
          authority_heartbeat?: string | null
          authority_id?: string | null
          bet_window_status?: string
          created_at?: string
          current_bet_type?: string | null
          host_address?: string | null
          join_secret_hash?: string | null
          match_id?: string
          room_code?: string
          spectator_count?: number
          updated_at?: string
          window_closed_at?: string | null
          window_opened_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "live_matches_host_address_fkey"
            columns: ["host_address"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["wallet_address"]
          },
          {
            foreignKeyName: "live_matches_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: true
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
        ]
      }
      lobby_join_policies: {
        Row: {
          created_at: string
          credential_hash: string | null
          host_address: string
          join_policy: string
          room_code: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          credential_hash?: string | null
          host_address: string
          join_policy?: string
          room_code: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          credential_hash?: string | null
          host_address?: string
          join_policy?: string
          room_code?: string
          updated_at?: string
        }
        Relationships: []
      }
      lobby_join_requests: {
        Row: {
          avatar_url: string | null
          coins: number | null
          created_at: string
          desired_seat: number | null
          id: string
          room_code: string
          username: string | null
          validation_token: string | null
          wallet_address: string
        }
        ComputedFields: never
        Insert: {
          avatar_url?: string | null
          coins?: number | null
          created_at?: string
          desired_seat?: number | null
          id?: string
          room_code: string
          username?: string | null
          validation_token?: string | null
          wallet_address: string
        }
        Update: {
          avatar_url?: string | null
          coins?: number | null
          created_at?: string
          desired_seat?: number | null
          id?: string
          room_code?: string
          username?: string | null
          validation_token?: string | null
          wallet_address?: string
        }
        Relationships: [
          {
            foreignKeyName: "lobby_join_requests_wallet_address_fkey"
            columns: ["wallet_address"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["wallet_address"]
          },
        ]
      }
      marketplace_purchases: {
        Row: {
          created_at: string
          id: string
          item_ids: NonNullable<Json>
          request_id: string
          total: number
          wallet_address: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          id?: string
          item_ids: NonNullable<Json>
          request_id: string
          total: number
          wallet_address: string
        }
        Update: {
          created_at?: string
          id?: string
          item_ids?: NonNullable<Json>
          request_id?: string
          total?: number
          wallet_address?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_purchases_wallet_address_fkey"
            columns: ["wallet_address"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["wallet_address"]
          },
        ]
      }
      match_moves: {
        Row: {
          actor: string
          bonus_roll: boolean
          captured: boolean
          color: string | null
          created_at: string
          dice: number | null
          from_pos: number | null
          id: string
          match_id: string
          roll_id: string | null
          seq: number
          to_pos: number | null
          token_index: number | null
        }
        ComputedFields: never
        Insert: {
          actor: string
          bonus_roll?: boolean
          captured?: boolean
          color?: string | null
          created_at?: string
          dice?: number | null
          from_pos?: number | null
          id?: string
          match_id: string
          roll_id?: string | null
          seq: number
          to_pos?: number | null
          token_index?: number | null
        }
        Update: {
          actor?: string
          bonus_roll?: boolean
          captured?: boolean
          color?: string | null
          created_at?: string
          dice?: number | null
          from_pos?: number | null
          id?: string
          match_id?: string
          roll_id?: string | null
          seq?: number
          to_pos?: number | null
          token_index?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "match_moves_actor_fkey"
            columns: ["actor"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["wallet_address"]
          },
        ]
      }
      match_rolls: {
        Row: {
          action_id: string | null
          consumed_seq: number | null
          created_at: string
          id: string
          match_id: string
          result: number
          seat_color: string | null
          status: string
          turn_seq: number | null
          wallet_address: string
        }
        ComputedFields: never
        Insert: {
          action_id?: string | null
          consumed_seq?: number | null
          created_at?: string
          id?: string
          match_id: string
          result: number
          seat_color?: string | null
          status?: string
          turn_seq?: number | null
          wallet_address: string
        }
        Update: {
          action_id?: string | null
          consumed_seq?: number | null
          created_at?: string
          id?: string
          match_id?: string
          result?: number
          seat_color?: string | null
          status?: string
          turn_seq?: number | null
          wallet_address?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_rolls_wallet_address_fkey"
            columns: ["wallet_address"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["wallet_address"]
          },
        ]
      }
      match_sessions: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          match_id: string
          revoked_at: string | null
          room_code: string
          wallet_address: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          match_id: string
          revoked_at?: string | null
          room_code: string
          wallet_address: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          match_id?: string
          revoked_at?: string | null
          room_code?: string
          wallet_address?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_sessions_wallet_address_fkey"
            columns: ["wallet_address"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["wallet_address"]
          },
        ]
      }
      match_states: {
        Row: {
          color_corner: NonNullable<Json>
          host_address: string
          match_id: string
          player_seats: NonNullable<Json>
          room_code: string
          room_version: number
          seq: number
          state: NonNullable<Json>
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          color_corner?: NonNullable<Json>
          host_address: string
          match_id: string
          player_seats?: NonNullable<Json>
          room_code: string
          room_version?: number
          seq?: number
          state?: NonNullable<Json>
          updated_at?: string
        }
        Update: {
          color_corner?: NonNullable<Json>
          host_address?: string
          match_id?: string
          player_seats?: NonNullable<Json>
          room_code?: string
          room_version?: number
          seq?: number
          state?: NonNullable<Json>
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_states_host_address_fkey"
            columns: ["host_address"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["wallet_address"]
          },
        ]
      }
      match_room_events: {
        Row: {
          created_at: string
          event_type: string
          id: number
          match_id: string
          payload: NonNullable<Json>
          seq: number | null
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          event_type: string
          id?: never
          match_id: string
          payload?: NonNullable<Json>
          seq?: number | null
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: never
          match_id?: string
          payload?: NonNullable<Json>
          seq?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "match_room_events_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
        ]
      }
      matches: {
        Row: {
          created_at: string
          finished_at: string | null
          game_mode: string
          game_mode_code: number | null
          host_proven: boolean
          id: string
          match_shape: string | null
          metadata: NonNullable<Json>
          participants: string[]
          room_code: string | null
          room_owner: string | null
          spectator_count: number
          streaming_enabled: boolean
          total_bet_volume: number
          winner_address: string | null
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          finished_at?: string | null
          game_mode?: string
          game_mode_code?: number | null
          host_proven?: boolean
          id?: string
          match_shape?: string | null
          metadata?: NonNullable<Json>
          participants?: string[]
          room_code?: string | null
          room_owner?: string | null
          spectator_count?: number
          streaming_enabled?: boolean
          total_bet_volume?: number
          winner_address?: string | null
        }
        Update: {
          created_at?: string
          finished_at?: string | null
          game_mode?: string
          game_mode_code?: number | null
          host_proven?: boolean
          id?: string
          match_shape?: string | null
          metadata?: NonNullable<Json>
          participants?: string[]
          room_code?: string | null
          room_owner?: string | null
          spectator_count?: number
          streaming_enabled?: boolean
          total_bet_volume?: number
          winner_address?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "matches_winner_address_fkey"
            columns: ["winner_address"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["wallet_address"]
          },
        ]
      }
      matchmaking_queue: {
        Row: {
          created_at: string
          expires_at: string
          game_mode: string
          id: string
          match_id: string | null
          match_type: string
          player_id: string
          room_code: string | null
          status: string
          validation_token: string | null
          wager: number
          wager_max: number | null
          wager_min: number | null
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          expires_at?: string
          game_mode: string
          id?: string
          match_id?: string | null
          match_type: string
          player_id: string
          room_code?: string | null
          status?: string
          validation_token?: string | null
          wager?: number
          wager_max?: number | null
          wager_min?: number | null
        }
        Update: {
          created_at?: string
          expires_at?: string
          game_mode?: string
          id?: string
          match_id?: string | null
          match_type?: string
          player_id?: string
          room_code?: string | null
          status?: string
          validation_token?: string | null
          wager?: number
          wager_max?: number | null
          wager_min?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "matchmaking_queue_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matchmaking_queue_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["wallet_address"]
          },
        ]
      }
      messages: {
        Row: {
          ciphertext: string | null
          content: string
          created_at: string
          deleted_by_receiver: boolean
          deleted_by_sender: boolean
          encryption_nonce: string | null
          encryption_version: number
          id: string
          is_read: boolean
          receiver_id: string
          sender_id: string
        }
        ComputedFields: never
        Insert: {
          ciphertext?: string | null
          content: string
          created_at?: string
          deleted_by_receiver?: boolean
          deleted_by_sender?: boolean
          encryption_nonce?: string | null
          encryption_version?: number
          id?: string
          is_read?: boolean
          receiver_id: string
          sender_id: string
        }
        Update: {
          ciphertext?: string | null
          content?: string
          created_at?: string
          deleted_by_receiver?: boolean
          deleted_by_sender?: boolean
          encryption_nonce?: string | null
          encryption_version?: number
          id?: string
          is_read?: boolean
          receiver_id?: string
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_receiver_id_fkey"
            columns: ["receiver_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["wallet_address"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["wallet_address"]
          },
        ]
      }
      mission_catalog: {
        Row: {
          active: boolean
          category: string
          description: string
          mission_id: string
          period: string
          reward_chips: number
          sort_order: number
          target: number
          title: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          active?: boolean
          category: string
          description?: string
          mission_id: string
          period: string
          reward_chips: number
          sort_order?: number
          target?: number
          title: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          category?: string
          description?: string
          mission_id?: string
          period?: string
          reward_chips?: number
          sort_order?: number
          target?: number
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      mission_vouchers: {
        Row: {
          amount: number
          claimed_tx: string | null
          created_at: string
          deadline: string
          id: string
          mission_id: string
          period_id: string
          reserved_at: string
          signature: string
          wallet_address: string
        }
        ComputedFields: never
        Insert: {
          amount: number
          claimed_tx?: string | null
          created_at?: string
          deadline: string
          id?: string
          mission_id: string
          period_id: string
          reserved_at?: string
          signature: string
          wallet_address: string
        }
        Update: {
          amount?: number
          claimed_tx?: string | null
          created_at?: string
          deadline?: string
          id?: string
          mission_id?: string
          period_id?: string
          reserved_at?: string
          signature?: string
          wallet_address?: string
        }
        Relationships: [
          {
            foreignKeyName: "mission_vouchers_wallet_address_fkey"
            columns: ["wallet_address"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["wallet_address"]
          },
        ]
      }
      onboarding_progress: {
        Row: {
          is_claimed: boolean
          progress: number
          target: number
          track: string
          updated_at: string
          voucher_id: string | null
          wallet_address: string
        }
        ComputedFields: never
        Insert: {
          is_claimed?: boolean
          progress?: number
          target?: number
          track: string
          updated_at?: string
          voucher_id?: string | null
          wallet_address: string
        }
        Update: {
          is_claimed?: boolean
          progress?: number
          target?: number
          track?: string
          updated_at?: string
          voucher_id?: string | null
          wallet_address?: string
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_progress_wallet_address_fkey"
            columns: ["wallet_address"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["wallet_address"]
          },
        ]
      }
      player_missions: {
        Row: {
          created_at: string
          id: string
          is_claimed: boolean
          last_updated: string
          mission_id: string
          period_id: string
          player_id: string
          progress: number
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          id?: string
          is_claimed?: boolean
          last_updated?: string
          mission_id: string
          period_id?: string
          player_id: string
          progress?: number
        }
        Update: {
          created_at?: string
          id?: string
          is_claimed?: boolean
          last_updated?: string
          mission_id?: string
          period_id?: string
          player_id?: string
          progress?: number
        }
        Relationships: [
          {
            foreignKeyName: "player_missions_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["wallet_address"]
          },
        ]
      }
      players: {
        Row: {
          ai_played: number
          avatar_url: string | null
          classic_played: number
          coins: number
          created_at: string
          current_room_code: string | null
          ecdh_pubkey: Json | null
          id: string
          last_played_at: string | null
          last_seen_at: string
          lxp: number
          peer_id: string | null
          power_played: number
          rank_tier: string
          rxp: number
          season_id: number
          status: string
          total_games: number | null
          total_wins: number
          username: string | null
          wallet_address: string
        }
        ComputedFields: never
        Insert: {
          ai_played?: number
          avatar_url?: string | null
          classic_played?: number
          coins?: number
          created_at?: string
          current_room_code?: string | null
          ecdh_pubkey?: Json | null
          id?: string
          last_played_at?: string | null
          last_seen_at?: string
          lxp?: number
          peer_id?: string | null
          power_played?: number
          rank_tier?: string
          rxp?: number
          season_id?: number
          status?: string
          total_games?: never
          total_wins?: number
          username?: string | null
          wallet_address: string
        }
        Update: {
          ai_played?: number
          avatar_url?: string | null
          classic_played?: number
          coins?: number
          created_at?: string
          current_room_code?: string | null
          ecdh_pubkey?: Json | null
          id?: string
          last_played_at?: string | null
          last_seen_at?: string
          lxp?: number
          peer_id?: string | null
          power_played?: number
          rank_tier?: string
          rxp?: number
          season_id?: number
          status?: string
          total_games?: never
          total_wins?: number
          username?: string | null
          wallet_address?: string
        }
        Relationships: []
      }
      pokes: {
        Row: {
          created_at: string
          id: string
          poked_back_at: string | null
          receiver_id: string
          sender_id: string
          status: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          id?: string
          poked_back_at?: string | null
          receiver_id: string
          sender_id: string
          status?: string
        }
        Update: {
          created_at?: string
          id?: string
          poked_back_at?: string | null
          receiver_id?: string
          sender_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "pokes_receiver_id_fkey"
            columns: ["receiver_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["wallet_address"]
          },
          {
            foreignKeyName: "pokes_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["wallet_address"]
          },
        ]
      }
      provisional_match_sessions: {
        Row: {
          authorization_key: string
          created_at: string
          expires_at: string
          id: string
          room_code: string
          wallet_address: string
        }
        ComputedFields: never
        Insert: {
          authorization_key: string
          created_at?: string
          expires_at: string
          id?: string
          room_code: string
          wallet_address: string
        }
        Update: {
          authorization_key?: string
          created_at?: string
          expires_at?: string
          id?: string
          room_code?: string
          wallet_address?: string
        }
        Relationships: [
          {
            foreignKeyName: "provisional_match_sessions_wallet_address_fkey"
            columns: ["wallet_address"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["wallet_address"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          last_used_at: string
          p256dh: string
          user_agent: string | null
          wallet_address: string
        }
        ComputedFields: never
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          last_used_at?: string
          p256dh: string
          user_agent?: string | null
          wallet_address: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          last_used_at?: string
          p256dh?: string
          user_agent?: string | null
          wallet_address?: string
        }
        Relationships: []
      }
      referral_links: {
        Row: {
          claim_tx: string | null
          code: string
          completed_at: string | null
          created_at: string
          referee_wallet: string
          referrer_wallet: string
          status: string
          tier_paid: number | null
        }
        ComputedFields: never
        Insert: {
          claim_tx?: string | null
          code: string
          completed_at?: string | null
          created_at?: string
          referee_wallet: string
          referrer_wallet: string
          status?: string
          tier_paid?: number | null
        }
        Update: {
          claim_tx?: string | null
          code?: string
          completed_at?: string | null
          created_at?: string
          referee_wallet?: string
          referrer_wallet?: string
          status?: string
          tier_paid?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "referral_links_referee_wallet_fkey"
            columns: ["referee_wallet"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["wallet_address"]
          },
          {
            foreignKeyName: "referral_links_referrer_wallet_fkey"
            columns: ["referrer_wallet"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["wallet_address"]
          },
        ]
      }
      sessions: {
        Row: {
          created_at?: string
          device_id: string | null
          expires_at: string
          id: string
          idle_expires_at: string
          issued_at: string
          last_seen_at: string
          match_id: string | null
          revoked_at: string | null
          rotated_from: string | null
          scope: string
          token_hash: string
          wallet_address: string
        }
        ComputedFields: never
        Insert: {
          device_id?: string | null
          expires_at: string
          id?: string
          idle_expires_at: string
          issued_at?: string
          last_seen_at?: string
          match_id?: string | null
          revoked_at?: string | null
          rotated_from?: string | null
          scope: string
          token_hash: string
          wallet_address: string
        }
        Update: {
          device_id?: string | null
          expires_at?: string
          id?: string
          idle_expires_at?: string
          issued_at?: string
          last_seen_at?: string
          match_id?: string | null
          revoked_at?: string | null
          rotated_from?: string | null
          scope?: string
          token_hash?: string
          wallet_address?: string
        }
        Relationships: [
          {
            foreignKeyName: "sessions_wallet_address_fkey"
            columns: ["wallet_address"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["wallet_address"]
          },
          {
            foreignKeyName: "sessions_rotated_from_fkey"
            columns: ["rotated_from"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      spectator_bets: {
        Row: {
          action_id: string
          amount: number
          bet_metadata: NonNullable<Json>
          bet_type: string
          bet_value: string
          created_at: string
          escrow_ref: string | null
          id: string
          match_id: string
          odds: number
          payout_amount: number | null
          player_id: string
          potential_payout: number
          resolved_at: string | null
          stake_settled: boolean
          status: string
          window_closed_at: string | null
        }
        ComputedFields: never
        Insert: {
          action_id: string
          amount: number
          bet_metadata?: NonNullable<Json>
          bet_type: string
          bet_value: string
          created_at?: string
          escrow_ref?: string | null
          id?: string
          match_id: string
          odds: number
          payout_amount?: number | null
          player_id: string
          potential_payout: number
          resolved_at?: string | null
          stake_settled?: boolean
          status?: string
          window_closed_at?: string | null
        }
        Update: {
          action_id?: string
          amount?: number
          bet_metadata?: NonNullable<Json>
          bet_type?: string
          bet_value?: string
          created_at?: string
          escrow_ref?: string | null
          id?: string
          match_id?: string
          odds?: number
          payout_amount?: number | null
          player_id?: string
          potential_payout?: number
          resolved_at?: string | null
          stake_settled?: boolean
          status?: string
          window_closed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "spectator_bets_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spectator_bets_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["wallet_address"]
          },
        ]
      }
      tournament_matches: {
        Row: {
          bracket_col: number
          bracket_row: number
          created_at: string
          id: string
          match_id: string
          round_number: number
          status: string
          tournament_id: string
          winner_id: string | null
        }
        ComputedFields: never
        Insert: {
          bracket_col: number
          bracket_row: number
          created_at?: string
          id?: string
          match_id: string
          round_number: number
          status?: string
          tournament_id: string
          winner_id?: string | null
        }
        Update: {
          bracket_col?: number
          bracket_row?: number
          created_at?: string
          id?: string
          match_id?: string
          round_number?: number
          status?: string
          tournament_id?: string
          winner_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tournament_matches_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_matches_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_matches_winner_id_fkey"
            columns: ["winner_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["wallet_address"]
          },
        ]
      }
      tournament_participants: {
        Row: {
          final_rank: number | null
          id: string
          joined_at: string
          player_id: string
          seed: number | null
          tournament_id: string
        }
        ComputedFields: never
        Insert: {
          final_rank?: number | null
          id?: string
          joined_at?: string
          player_id: string
          seed?: number | null
          tournament_id: string
        }
        Update: {
          final_rank?: number | null
          id?: string
          joined_at?: string
          player_id?: string
          seed?: number | null
          tournament_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tournament_participants_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["wallet_address"]
          },
          {
            foreignKeyName: "tournament_participants_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
      }
      tournaments: {
        Row: {
          created_at: string
          description: string | null
          entry_fee: number
          id: string
          max_players: number
          min_players: number
          prize_pool: number
          start_at: string | null
          status: string
          title: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          description?: string | null
          entry_fee?: number
          id?: string
          max_players: number
          min_players?: number
          prize_pool?: number
          start_at?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          entry_fee?: number
          id?: string
          max_players?: number
          min_players?: number
          prize_pool?: number
          start_at?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_blocks: {
        Row: {
          blocked_address: string
          blocker_address: string
          created_at: string
          id: string
        }
        ComputedFields: never
        Insert: {
          blocked_address: string
          blocker_address: string
          created_at?: string
          id?: string
        }
        Update: {
          blocked_address?: string
          blocker_address?: string
          created_at?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_blocks_blocked_address_fkey"
            columns: ["blocked_address"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["wallet_address"]
          },
          {
            foreignKeyName: "user_blocks_blocker_address_fkey"
            columns: ["blocker_address"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["wallet_address"]
          },
        ]
      }
      user_reports: {
        Row: {
          created_at: string
          id: string
          reason: string
          reported_address: string
          reporter_address: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          id?: string
          reason: string
          reported_address: string
          reporter_address: string
        }
        Update: {
          created_at?: string
          id?: string
          reason?: string
          reported_address?: string
          reporter_address?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_reports_reported_address_fkey"
            columns: ["reported_address"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["wallet_address"]
          },
          {
            foreignKeyName: "user_reports_reporter_address_fkey"
            columns: ["reporter_address"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["wallet_address"]
          },
        ]
      }
      wallet_links: {
        Row: {
          created_at: string
          id: string
          link_type: string
          linked_wallet: string
          primary_wallet: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          id?: string
          link_type?: string
          linked_wallet: string
          primary_wallet: string
        }
        Update: {
          created_at?: string
          id?: string
          link_type?: string
          linked_wallet?: string
          primary_wallet?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      cash_out_bet: {
        Args: { p_bet_id: string; p_player_id: string }
        Returns: Json
      }
      chips_escrow_deposit: {
        Args: { p_amount: number; p_ref: string; p_wallet: string }
        Returns: Json
      }
      chips_escrow_place_bet: {
        Args: {
          p_action_id: string
          p_amount: number
          p_bet_type: string
          p_bet_value: string
          p_match_id: string
          p_player: string
        }
        Returns: Json
      }
      chips_escrow_settle_bets: {
        Args: { p_bet_type: string; p_match_id: string; p_result: string }
        Returns: Json
      }
      chips_escrow_solvency: { Args: Record<PropertyKey, never>; Returns: Json }
      chips_escrow_spend_purchase: {
        Args: {
          p_item_ids: string[]
          p_request_id: string
          p_total_base: number
          p_wallet: string
        }
        Returns: Json
      }
      chips_escrow_touch: { Args: { p_wallet: string }; Returns: undefined }
      chips_escrow_withdraw: {
        Args: { p_amount: number; p_ref: string; p_wallet: string }
        Returns: Json
      }
      cleanup_auth_challenges: {
        Args: { p_keep_hours: number }
        Returns: number
      }
      cleanup_match_room_events: {
        Args: { p_keep_days?: number }
        Returns: number
      }
      cleanup_matchmaking_queue: {
        Args: Record<PropertyKey, never>
        Returns: undefined
      }
      cleanup_sessions: {
        Args: { p_keep_days: number }
        Returns: number
      }
      cleanup_stale_data: {
        Args: Record<PropertyKey, never>
        Returns: undefined
      }
      get_chain_indexer_cursor: {
        Args: { p_chain_id: number }
        Returns: number
      }
      update_chain_indexer_cursor: {
        Args: { p_chain_id: number; p_last_block: number }
        Returns: undefined
      }
      match_commit_action: {
        Args: {
          p_event_payload?: Json
          p_event_type?: string
          p_expected_seq: number
          p_match_id: string
          p_new_state: Json
        }
        Returns: Json
      }
      join_matchmaking: {
        Args: {
          p_game_mode: string
          p_match_type: string
          p_player_id: string
          p_wager?: number
          p_wager_max?: number
          p_wager_min?: number
        }
        Returns: Json
      }
      join_matchmaking_hybrid: {
        Args: {
          p_game_mode: string
          p_match_type: string
          p_player_id: string
          p_room_code?: string
          p_wager?: number
          p_wager_max?: number
          p_wager_min?: number
        }
        Returns: Json
      }
      join_tournament: {
        Args: { p_player_id: string; p_tournament_id: string }
        Returns: Json
      }
      mark_conversation_read: {
        Args: { friend: string; me: string }
        Returns: undefined
      }
      next_mission_voucher_nonce: {
        Args: Record<PropertyKey, never>
        Returns: number
      }
      purchase_marketplace: {
        Args: {
          p_item_ids: string[]
          p_request_id: string
          p_total: number
          p_wallet: string
        }
        Returns: Json
      }
      settle_match_bets: {
        Args: { p_bet_type: string; p_match_id: string; p_result: string }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
