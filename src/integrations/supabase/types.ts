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
      compliance_scans: {
        Row: {
          completed_at: string | null
          created_at: string
          critical_count: number | null
          id: string
          passed_count: number | null
          results: Json | null
          scan_type: string
          score: number | null
          status: string
          store_url: string
          user_id: string
          warning_count: number | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          critical_count?: number | null
          id?: string
          passed_count?: number | null
          results?: Json | null
          scan_type?: string
          score?: number | null
          status?: string
          store_url: string
          user_id: string
          warning_count?: number | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          critical_count?: number | null
          id?: string
          passed_count?: number | null
          results?: Json | null
          scan_type?: string
          score?: number | null
          status?: string
          store_url?: string
          user_id?: string
          warning_count?: number | null
        }
        Relationships: []
      }
      listing_snapshots: {
        Row: {
          action_type: string
          created_at: string
          etsy_listing_id: number
          id: string
          snapshot_data: Json
          store_connection_id: string
          user_id: string
        }
        Insert: {
          action_type?: string
          created_at?: string
          etsy_listing_id: number
          id?: string
          snapshot_data: Json
          store_connection_id: string
          user_id: string
        }
        Update: {
          action_type?: string
          created_at?: string
          etsy_listing_id?: number
          id?: string
          snapshot_data?: Json
          store_connection_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "listing_snapshots_store_connection_id_fkey"
            columns: ["store_connection_id"]
            isOneToOne: false
            referencedRelation: "store_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      music_tracks: {
        Row: {
          artist: string | null
          cover_image_path: string | null
          created_at: string
          duration_seconds: number | null
          file_path: string
          genre: string | null
          id: string
          license_holder: string | null
          license_type: string
          mood: string | null
          niche: string | null
          title: string
          user_id: string
        }
        Insert: {
          artist?: string | null
          cover_image_path?: string | null
          created_at?: string
          duration_seconds?: number | null
          file_path: string
          genre?: string | null
          id?: string
          license_holder?: string | null
          license_type?: string
          mood?: string | null
          niche?: string | null
          title: string
          user_id: string
        }
        Update: {
          artist?: string | null
          cover_image_path?: string | null
          created_at?: string
          duration_seconds?: number | null
          file_path?: string
          genre?: string | null
          id?: string
          license_holder?: string | null
          license_type?: string
          mood?: string | null
          niche?: string | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      scan_jobs: {
        Row: {
          completed_at: string | null
          created_at: string
          error_message: string | null
          findings: Json | null
          id: string
          platform: string
          processed_items: number
          scan_type: string
          started_at: string | null
          status: string
          summary: Json | null
          total_items: number
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          findings?: Json | null
          id?: string
          platform?: string
          processed_items?: number
          scan_type?: string
          started_at?: string | null
          status?: string
          summary?: Json | null
          total_items?: number
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          findings?: Json | null
          id?: string
          platform?: string
          processed_items?: number
          scan_type?: string
          started_at?: string | null
          status?: string
          summary?: Json | null
          total_items?: number
          user_id?: string
        }
        Relationships: []
      }
      store_connections: {
        Row: {
          access_token: string
          created_at: string
          id: string
          platform: string
          refresh_token: string | null
          scopes: string | null
          shop_domain: string | null
          shop_name: string | null
          token_expires_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token: string
          created_at?: string
          id?: string
          platform: string
          refresh_token?: string | null
          scopes?: string | null
          shop_domain?: string | null
          shop_name?: string | null
          token_expires_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string
          created_at?: string
          id?: string
          platform?: string
          refresh_token?: string | null
          scopes?: string | null
          shop_domain?: string | null
          shop_name?: string | null
          token_expires_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
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
    Enums: {
      app_role: ["admin", "moderator", "user"],
    },
  },
} as const
