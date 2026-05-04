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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      autotrade_log: {
        Row: {
          action: string
          conviction: number | null
          created_at: string
          id: string
          pnl_pct: number | null
          position_id: string | null
          price: number | null
          profile: string | null
          reason: string | null
          sentiment_confidence: number | null
          sentiment_headlines: Json | null
          sentiment_score: number | null
          shares: number | null
          strategy: string | null
          ticker: string
          user_id: string
        }
        Insert: {
          action: string
          conviction?: number | null
          created_at?: string
          id?: string
          pnl_pct?: number | null
          position_id?: string | null
          price?: number | null
          profile?: string | null
          reason?: string | null
          sentiment_confidence?: number | null
          sentiment_headlines?: Json | null
          sentiment_score?: number | null
          shares?: number | null
          strategy?: string | null
          ticker: string
          user_id: string
        }
        Update: {
          action?: string
          conviction?: number | null
          created_at?: string
          id?: string
          pnl_pct?: number | null
          position_id?: string | null
          price?: number | null
          profile?: string | null
          reason?: string | null
          sentiment_confidence?: number | null
          sentiment_headlines?: Json | null
          sentiment_score?: number | null
          shares?: number | null
          strategy?: string | null
          ticker?: string
          user_id?: string
        }
        Relationships: []
      }
      autotrade_settings: {
        Row: {
          adaptive_mode: boolean
          advanced_mode: boolean
          auto_add_watchlist: boolean
          auto_watchlist_consideration_floor: number
          auto_watchlist_stale_days: number
          created_at: string
          daily_loss_limit_pct: number
          enabled: boolean
          kill_switch: boolean
          last_scan_at: string | null
          max_nav_exposure_pct: number
          max_positions: number
          max_single_name_pct: number
          min_conviction: number
          next_scan_at: string | null
          notify_on_action: boolean
          paper_mode: boolean
          risk_profile: string
          scan_interval_minutes: number
          starting_nav: number
          updated_at: string
          user_id: string
        }
        Insert: {
          adaptive_mode?: boolean
          advanced_mode?: boolean
          auto_add_watchlist?: boolean
          auto_watchlist_consideration_floor?: number
          auto_watchlist_stale_days?: number
          created_at?: string
          daily_loss_limit_pct?: number
          enabled?: boolean
          kill_switch?: boolean
          last_scan_at?: string | null
          max_nav_exposure_pct?: number
          max_positions?: number
          max_single_name_pct?: number
          min_conviction?: number
          next_scan_at?: string | null
          notify_on_action?: boolean
          paper_mode?: boolean
          risk_profile?: string
          scan_interval_minutes?: number
          starting_nav?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          adaptive_mode?: boolean
          advanced_mode?: boolean
          auto_add_watchlist?: boolean
          auto_watchlist_consideration_floor?: number
          auto_watchlist_stale_days?: number
          created_at?: string
          daily_loss_limit_pct?: number
          enabled?: boolean
          kill_switch?: boolean
          last_scan_at?: string | null
          max_nav_exposure_pct?: number
          max_positions?: number
          max_single_name_pct?: number
          min_conviction?: number
          next_scan_at?: string | null
          notify_on_action?: boolean
          paper_mode?: boolean
          risk_profile?: string
          scan_interval_minutes?: number
          starting_nav?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      autotrader_state: {
        Row: {
          adjustments: Json
          computed_at: string
          effective_max_nav_exposure_pct: number
          effective_max_positions: number
          effective_max_single_name_pct: number
          effective_min_conviction: number
          reason: string | null
          recent_pnl_pct: number | null
          recent_pnl_window_days: number | null
          spy_trend: string | null
          updated_at: string
          user_id: string
          vix_regime: string | null
          vix_value: number | null
        }
        Insert: {
          adjustments?: Json
          computed_at?: string
          effective_max_nav_exposure_pct?: number
          effective_max_positions?: number
          effective_max_single_name_pct?: number
          effective_min_conviction?: number
          reason?: string | null
          recent_pnl_pct?: number | null
          recent_pnl_window_days?: number | null
          spy_trend?: string | null
          updated_at?: string
          user_id: string
          vix_regime?: string | null
          vix_value?: number | null
        }
        Update: {
          adjustments?: Json
          computed_at?: string
          effective_max_nav_exposure_pct?: number
          effective_max_positions?: number
          effective_max_single_name_pct?: number
          effective_min_conviction?: number
          reason?: string | null
          recent_pnl_pct?: number | null
          recent_pnl_window_days?: number | null
          spy_trend?: string | null
          updated_at?: string
          user_id?: string
          vix_regime?: string | null
          vix_value?: number | null
        }
        Relationships: []
      }
      cron_heartbeat: {
        Row: {
          duration_ms: number | null
          job_name: string
          last_run_at: string
          notes: string | null
          status: string
          updated_at: string
        }
        Insert: {
          duration_ms?: number | null
          job_name: string
          last_run_at?: string
          notes?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          duration_ms?: number | null
          job_name?: string
          last_run_at?: string
          notes?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      live_signals: {
        Row: {
          confidence: number
          created_at: string
          entry_price: number
          expires_at: string | null
          id: string
          reasoning: string | null
          regime: string | null
          signal_type: string
          stock_profile: string | null
          strategy: string | null
          target_allocation: number | null
          ticker: string
          weekly_bias: string | null
        }
        Insert: {
          confidence?: number
          created_at?: string
          entry_price: number
          expires_at?: string | null
          id?: string
          reasoning?: string | null
          regime?: string | null
          signal_type: string
          stock_profile?: string | null
          strategy?: string | null
          target_allocation?: number | null
          ticker: string
          weekly_bias?: string | null
        }
        Update: {
          confidence?: number
          created_at?: string
          entry_price?: number
          expires_at?: string | null
          id?: string
          reasoning?: string | null
          regime?: string | null
          signal_type?: string
          stock_profile?: string | null
          strategy?: string | null
          target_allocation?: number | null
          ticker?: string
          weekly_bias?: string | null
        }
        Relationships: []
      }
      news_sentiment_cache: {
        Row: {
          confidence: number
          fetched_at: string
          headlines: Json
          reasoning: string | null
          score: number
          ticker: string
        }
        Insert: {
          confidence: number
          fetched_at?: string
          headlines?: Json
          reasoning?: string | null
          score: number
          ticker: string
        }
        Update: {
          confidence?: number
          fetched_at?: string
          headlines?: Json
          reasoning?: string | null
          score?: number
          ticker?: string
        }
        Relationships: []
      }
      portfolio_caps: {
        Row: {
          created_at: string
          enabled: boolean
          enforcement_mode: string
          id: string
          max_correlated_positions: number
          portfolio_beta_max: number
          sector_max_pct: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          enforcement_mode?: string
          id?: string
          max_correlated_positions?: number
          portfolio_beta_max?: number
          sector_max_pct?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          enforcement_mode?: string
          id?: string
          max_correlated_positions?: number
          portfolio_beta_max?: number
          sector_max_pct?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      prediction_runs: {
        Row: {
          confidence: number
          created_at: string
          current_price: number | null
          feature_importance: Json | null
          historical_data: Json | null
          id: string
          predicted_price: number
          regime: string | null
          sentiment_score: number | null
          target_date: string
          ticker: string
          uncertainty_high: number
          uncertainty_low: number
          user_id: string | null
        }
        Insert: {
          confidence: number
          created_at?: string
          current_price?: number | null
          feature_importance?: Json | null
          historical_data?: Json | null
          id?: string
          predicted_price: number
          regime?: string | null
          sentiment_score?: number | null
          target_date: string
          ticker: string
          uncertainty_high: number
          uncertainty_low: number
          user_id?: string | null
        }
        Update: {
          confidence?: number
          created_at?: string
          current_price?: number | null
          feature_importance?: Json | null
          historical_data?: Json | null
          id?: string
          predicted_price?: number
          regime?: string | null
          sentiment_score?: number | null
          target_date?: string
          ticker?: string
          uncertainty_high?: number
          uncertainty_low?: number
          user_id?: string | null
        }
        Relationships: []
      }
      price_alerts: {
        Row: {
          created_at: string | null
          direction: string
          id: string
          is_triggered: boolean | null
          target_price: number
          ticker: string
          triggered_at: string | null
          user_id: string
          watchlist_item_id: string | null
        }
        Insert: {
          created_at?: string | null
          direction: string
          id?: string
          is_triggered?: boolean | null
          target_price: number
          ticker: string
          triggered_at?: string | null
          user_id: string
          watchlist_item_id?: string | null
        }
        Update: {
          created_at?: string | null
          direction?: string
          id?: string
          is_triggered?: boolean | null
          target_price?: number
          ticker?: string
          triggered_at?: string | null
          user_id?: string
          watchlist_item_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "price_alerts_watchlist_item_id_fkey"
            columns: ["watchlist_item_id"]
            isOneToOne: false
            referencedRelation: "watchlist"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          alert_email_enabled: boolean | null
          avatar_url: string | null
          created_at: string
          dashboard_layout: Json | null
          email: string | null
          full_name: string | null
          id: string
          updated_at: string
          user_id: string
          weekly_digest_enabled: boolean | null
        }
        Insert: {
          alert_email_enabled?: boolean | null
          avatar_url?: string | null
          created_at?: string
          dashboard_layout?: Json | null
          email?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string
          user_id: string
          weekly_digest_enabled?: boolean | null
        }
        Update: {
          alert_email_enabled?: boolean | null
          avatar_url?: string | null
          created_at?: string
          dashboard_layout?: Json | null
          email?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string
          user_id?: string
          weekly_digest_enabled?: boolean | null
        }
        Relationships: []
      }
      scan_universe_log: {
        Row: {
          created_at: string
          fallback_used: boolean
          id: string
          index_count: number
          overlap_count: number
          sample_tickers: Json
          screener_count: number
          source_breakdown: Json
          total_tickers: number
        }
        Insert: {
          created_at?: string
          fallback_used?: boolean
          id?: string
          index_count?: number
          overlap_count?: number
          sample_tickers?: Json
          screener_count?: number
          source_breakdown?: Json
          total_tickers?: number
        }
        Update: {
          created_at?: string
          fallback_used?: boolean
          id?: string
          index_count?: number
          overlap_count?: number
          sample_tickers?: Json
          screener_count?: number
          source_breakdown?: Json
          total_tickers?: number
        }
        Relationships: []
      }
      sell_alerts: {
        Row: {
          created_at: string | null
          current_price: number
          id: string
          is_dismissed: boolean | null
          position_id: string | null
          reason: string
          ticker: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          current_price: number
          id?: string
          is_dismissed?: boolean | null
          position_id?: string | null
          reason: string
          ticker: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          current_price?: number
          id?: string
          is_dismissed?: boolean | null
          position_id?: string | null
          reason?: string
          ticker?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sell_alerts_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "virtual_positions"
            referencedColumns: ["id"]
          },
        ]
      }
      signal_outcomes: {
        Row: {
          bars_held: number | null
          contributing_rules: Json | null
          conviction: number
          created_at: string
          entry_date: string
          entry_price: number
          entry_thesis: string | null
          exit_date: string | null
          exit_price: number | null
          exit_reason: string | null
          id: string
          macro_label: string | null
          macro_score: number | null
          max_adverse_excursion_pct: number | null
          max_favorable_excursion_pct: number | null
          realized_pnl_pct: number | null
          regime: string | null
          signal_id: string | null
          signal_type: string
          spy_at_entry: number | null
          status: string
          stock_profile: string | null
          strategy: string | null
          ticker: string
          updated_at: string
          vix_at_entry: number | null
          weekly_bias: string | null
          weights_id: string | null
        }
        Insert: {
          bars_held?: number | null
          contributing_rules?: Json | null
          conviction: number
          created_at?: string
          entry_date?: string
          entry_price: number
          entry_thesis?: string | null
          exit_date?: string | null
          exit_price?: number | null
          exit_reason?: string | null
          id?: string
          macro_label?: string | null
          macro_score?: number | null
          max_adverse_excursion_pct?: number | null
          max_favorable_excursion_pct?: number | null
          realized_pnl_pct?: number | null
          regime?: string | null
          signal_id?: string | null
          signal_type: string
          spy_at_entry?: number | null
          status?: string
          stock_profile?: string | null
          strategy?: string | null
          ticker: string
          updated_at?: string
          vix_at_entry?: number | null
          weekly_bias?: string | null
          weights_id?: string | null
        }
        Update: {
          bars_held?: number | null
          contributing_rules?: Json | null
          conviction?: number
          created_at?: string
          entry_date?: string
          entry_price?: number
          entry_thesis?: string | null
          exit_date?: string | null
          exit_price?: number | null
          exit_reason?: string | null
          id?: string
          macro_label?: string | null
          macro_score?: number | null
          max_adverse_excursion_pct?: number | null
          max_favorable_excursion_pct?: number | null
          realized_pnl_pct?: number | null
          regime?: string | null
          signal_id?: string | null
          signal_type?: string
          spy_at_entry?: number | null
          status?: string
          stock_profile?: string | null
          strategy?: string | null
          ticker?: string
          updated_at?: string
          vix_at_entry?: number | null
          weekly_bias?: string | null
          weights_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "signal_outcomes_weights_id_fkey"
            columns: ["weights_id"]
            isOneToOne: false
            referencedRelation: "strategy_weights"
            referencedColumns: ["id"]
          },
        ]
      }
      strategy_weights: {
        Row: {
          calibration_curve: Json
          computed_at: string
          created_at: string
          id: string
          is_active: boolean
          notes: Json
          regime_floors: Json
          sample_size: number
          strategy_tilts: Json
          window_days: number
        }
        Insert: {
          calibration_curve?: Json
          computed_at?: string
          created_at?: string
          id?: string
          is_active?: boolean
          notes?: Json
          regime_floors?: Json
          sample_size?: number
          strategy_tilts?: Json
          window_days?: number
        }
        Update: {
          calibration_curve?: Json
          computed_at?: string
          created_at?: string
          id?: string
          is_active?: boolean
          notes?: Json
          regime_floors?: Json
          sample_size?: number
          strategy_tilts?: Json
          window_days?: number
        }
        Relationships: []
      }
      virtual_portfolio_log: {
        Row: {
          cash: number
          created_at: string
          date: string
          id: string
          positions_value: number
          total_value: number
          user_id: string
        }
        Insert: {
          cash?: number
          created_at?: string
          date: string
          id?: string
          positions_value?: number
          total_value?: number
          user_id: string
        }
        Update: {
          cash?: number
          created_at?: string
          date?: string
          id?: string
          positions_value?: number
          total_value?: number
          user_id?: string
        }
        Relationships: []
      }
      virtual_positions: {
        Row: {
          breakout_failed_count: number
          closed_at: string | null
          cooldown_until: string | null
          created_at: string
          entry_atr: number | null
          entry_conviction: number | null
          entry_price: number
          entry_profile: string | null
          entry_strategy: string | null
          entry_weekly_alloc: number | null
          exit_date: string | null
          exit_price: number | null
          exit_reason: string | null
          hard_stop_price: number | null
          id: string
          opened_by: string
          peak_price: number | null
          pnl: number | null
          position_type: string
          shares: number
          signal_id: string | null
          status: string
          target_profit_pct: number | null
          ticker: string
          trailing_stop_price: number | null
          user_id: string
        }
        Insert: {
          breakout_failed_count?: number
          closed_at?: string | null
          cooldown_until?: string | null
          created_at?: string
          entry_atr?: number | null
          entry_conviction?: number | null
          entry_price: number
          entry_profile?: string | null
          entry_strategy?: string | null
          entry_weekly_alloc?: number | null
          exit_date?: string | null
          exit_price?: number | null
          exit_reason?: string | null
          hard_stop_price?: number | null
          id?: string
          opened_by?: string
          peak_price?: number | null
          pnl?: number | null
          position_type?: string
          shares: number
          signal_id?: string | null
          status?: string
          target_profit_pct?: number | null
          ticker: string
          trailing_stop_price?: number | null
          user_id: string
        }
        Update: {
          breakout_failed_count?: number
          closed_at?: string | null
          cooldown_until?: string | null
          created_at?: string
          entry_atr?: number | null
          entry_conviction?: number | null
          entry_price?: number
          entry_profile?: string | null
          entry_strategy?: string | null
          entry_weekly_alloc?: number | null
          exit_date?: string | null
          exit_price?: number | null
          exit_reason?: string | null
          hard_stop_price?: number | null
          id?: string
          opened_by?: string
          peak_price?: number | null
          pnl?: number | null
          position_type?: string
          shares?: number
          signal_id?: string | null
          status?: string
          target_profit_pct?: number | null
          ticker?: string
          trailing_stop_price?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "virtual_positions_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "live_signals"
            referencedColumns: ["id"]
          },
        ]
      }
      watchlist: {
        Row: {
          asset_type: string | null
          created_at: string
          display_name: string | null
          id: string
          last_signal_at: string | null
          notes: string | null
          source: string
          ticker: string
          user_id: string
        }
        Insert: {
          asset_type?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          last_signal_at?: string | null
          notes?: string | null
          source?: string
          ticker: string
          user_id: string
        }
        Update: {
          asset_type?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          last_signal_at?: string | null
          notes?: string | null
          source?: string
          ticker?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
