export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      conversations: {
        Row: {
          id: string
          last_message_at: string | null
          last_message_content: string | null
          unread_count_a: number | null
          unread_count_b: number | null
          user_a: string
          user_b: string
        }
        Insert: {
          id?: string
          last_message_at?: string | null
          last_message_content?: string | null
          unread_count_a?: number | null
          unread_count_b?: number | null
          user_a: string
          user_b: string
        }
        Update: {
          id?: string
          last_message_at?: string | null
          last_message_content?: string | null
          unread_count_a?: number | null
          unread_count_b?: number | null
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
      friendships: {
        Row: {
          created_at: string
          friend_address: string
          id: string
          status: string
          user_address: string
        }
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
          created_at: string | null
          entry_fee: number | null
          guest_address: string
          host_address: string
          id: string
          match_type: string | null
          room_code: string
          status: string | null
        }
        Insert: {
          created_at?: string | null
          entry_fee?: number | null
          guest_address: string
          host_address: string
          id?: string
          match_type?: string | null
          room_code: string
          status?: string | null
        }
        Update: {
          created_at?: string | null
          entry_fee?: number | null
          guest_address?: string
          host_address?: string
          id?: string
          match_type?: string | null
          room_code?: string
          status?: string | null
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
      matches: {
        Row: {
          created_at: string | null
          game_mode: string | null
          id: string
          participants: string[] | null
          room_code: string | null
          winner_address: string | null
        }
        Insert: {
          created_at?: string | null
          game_mode?: string | null
          id?: string
          participants?: string[] | null
          room_code?: string | null
          winner_address?: string | null
        }
        Update: {
          created_at?: string | null
          game_mode?: string | null
          id?: string
          participants?: string[] | null
          room_code?: string | null
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
          created_at: string | null
          expires_at: string
          game_mode: string
          id: string
          match_type: string
          player_id: string
          status: string | null
          wager: number | null
        }
        Insert: {
          created_at?: string | null
          expires_at: string
          game_mode: string
          id?: string
          match_type: string
          player_id: string
          status?: string | null
          wager?: number | null
        }
        Update: {
          created_at?: string | null
          expires_at?: string
          game_mode?: string
          id?: string
          match_type?: string
          player_id?: string
          status?: string | null
          wager?: number | null
        }
        Relationships: [
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
          content: string
          created_at: string
          deleted_by_receiver: boolean | null
          deleted_by_sender: boolean | null
          id: string
          is_read: boolean
          receiver_id: string
          sender_id: string
        }
        Insert: {
          content: string
          created_at?: string
          deleted_by_receiver?: boolean | null
          deleted_by_sender?: boolean | null
          id?: string
          is_read?: boolean
          receiver_id: string
          sender_id: string
        }
        Update: {
          content?: string
          created_at?: string
          deleted_by_receiver?: boolean | null
          deleted_by_sender?: boolean | null
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
      players: {
        Row: {
          ai_played: number | null
          avatar_url: string | null
          classic_played: number | null
          coins: number | null
          created_at: string | null
          id: string
          last_played_at: string | null
          last_seen_at: string | null
          peer_id: string | null
          power_played: number | null
          rating: number | null
          season_id: number | null
          status: string | null
          total_games: number | null
          total_wins: number | null
          username: string | null
          wallet_address: string
          xp: number | null
        }
        Insert: {
          ai_played?: number | null
          avatar_url?: string | null
          classic_played?: number | null
          coins?: number | null
          created_at?: string | null
          id?: string
          last_played_at?: string | null
          last_seen_at?: string | null
          peer_id?: string | null
          power_played?: number | null
          rating?: number | null
          season_id?: number | null
          status?: string | null
          total_games?: number | null
          total_wins?: number | null
          username?: string | null
          wallet_address: string
          xp?: number | null
        }
        Update: {
          ai_played?: number | null
          avatar_url?: string | null
          classic_played?: number | null
          coins?: number | null
          created_at?: string | null
          id?: string
          last_played_at?: string | null
          last_seen_at?: string | null
          peer_id?: string | null
          power_played?: number | null
          rating?: number | null
          season_id?: number | null
          status?: string | null
          total_games?: number | null
          total_wins?: number | null
          username?: string | null
          wallet_address?: string
          xp?: number | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      cleanup_matchmaking_queue: { Args: never; Returns: undefined }
      cleanup_old_messages: { Args: never; Returns: undefined }
      cleanup_stale_data: { Args: never; Returns: undefined }
      join_matchmaking: {
        Args: {
          p_game_mode: string
          p_match_type: string
          p_player_id: string
          p_wager: number
        }
        Returns: Json
      }
      mark_conversation_read: {
        Args: { friend: string; me: string }
        Returns: undefined
      }
      update_offline_status: { Args: never; Returns: undefined }
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
