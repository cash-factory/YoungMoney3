export interface RiskSettings {
  id: string;
  user_id: string;
  max_daily_loss_pct: number;
  max_daily_trades: number;
  max_risk_per_trade_pct: number;
  account_balance: number;
  max_drawdown_pct: number;
  daily_loss_limit_amount: number | null;
  created_at: string;
  updated_at: string;
}

export type RiskSettingsInput = Omit<RiskSettings, 'id' | 'user_id' | 'created_at' | 'updated_at'>;

export interface PreTradeChecklistItem {
  id: string;
  user_id: string;
  plan_id?: string | null;
  label: string;
  is_required: boolean;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type PreTradeChecklistInput = Omit<PreTradeChecklistItem, 'id' | 'user_id' | 'created_at' | 'updated_at'>;

export interface TradeChecklistSnapshot {
  id?: string;
  label: string;
  checked: boolean;
  is_required?: boolean;
  source_scope?: 'plan' | 'strategy' | 'entry_model' | 'legacy';
}

export interface TradeCalculationSnapshot {
  quantity_step?: number;
  min_quantity?: number;
  instrument_id: string;
  symbol: string;
  asset_class: InstrumentAssetClass;
  base_currency: string | null;
  quote_currency: string;
  account_currency: string;
  price_increment: number;
  pip_size: number | null;
  price_precision: number;
  contract_multiplier: number;
  tick_value: number;
  quantity_unit: string;
  conversion_rate: number;
  calculated_at: string;
}

export type TradeDirection = 'long' | 'short';
export type TradeOutcome = 'win' | 'loss' | 'breakeven' | null;
export type TradeStatus = 'open' | 'closed';
export type TradeSession = 'asian' | 'london' | 'new_york' | 'overlap' | 'sydney';
export type AccountType = 'personal' | 'propfirm';
export type EmotionalState = 'calm' | 'confident' | 'rushed' | 'frustrated' | 'focused' | 'anxious' | 'greedy' | 'fearful';

export interface StrategyChecklistItem {
  id: string;
  strategy_id: string;
  entry_model_id?: string | null;
  label: string;
  is_required: boolean;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type StrategyChecklistInput = Omit<StrategyChecklistItem, 'id' | 'strategy_id' | 'created_at' | 'updated_at'>;

export interface TraderStrategy {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  plan_id?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface StrategyEntryModel {
  id: string;
  user_id: string;
  strategy_id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
export type StrategyEntryModelInput = Omit<StrategyEntryModel, 'id' | 'user_id' | 'created_at' | 'updated_at'>;

export type TraderStrategyInput = Omit<TraderStrategy, 'id' | 'user_id' | 'created_at' | 'updated_at'>;

export interface Trade {
  trade_source?: 'manual' | 'mt5';
  settlement_currency?: string;
  pnl_decimal?: string;
  risk_capital_at_entry?: number | null;
  realized_r?: number | null;
  initial_risk?: number | null;
  planned_r?: number | null;
  broker_details?: Record<string, string | number | boolean>;
  id: string;
  user_id: string | null;
  pair: string;
  direction: TradeDirection;
  entry_price: number | null;
  exit_price: number | null;
  lot_size: number | null;
  take_profit: number | null;
  outcome: TradeOutcome;
  status: TradeStatus;
  pnl: number;
  pips: number;
  strategy: string | null;
  session: TradeSession | null;
  broker: string | null;
  account_type: AccountType | null;
  entry_time: string;
  exit_time: string | null;
  risk_percent: number | null;
  risk_reward_ratio: number | null;
  emotional_state: EmotionalState | null;
  setup_quality: number | null;
  mistakes: string[];
  lessons: string | null;
  notes: string | null;
  screenshot_url: string | null;
  voice_note_url: string | null;
  entry_screenshot_url: string | null;
  entry_voice_note_url: string | null;
  closure_screenshot_url: string | null;
  closure_voice_note_url: string | null;
  what_went_wrong: string | null;
  observations: string | null;
  strategy_id: string | null;
  setup_id: string | null;
  plan_id?: string | null;
  entry_model_id?: string | null;
  account_id?: string | null;
  instrument_id?: string | null;
  stop_loss?: number | null;
  conversion_rate?: number | null;
  fees?: number | null;
  calculation_snapshot?: TradeCalculationSnapshot | null;
  risk_override_reason?: string | null;
  example_values_confirmed?: boolean;
  entry_price_confirmed_actual?: boolean;
  capture_mode?: 'live' | 'historical' | 'legacy';
  checklist_items: TradeChecklistSnapshot[] | null;
  checklist_override_reason: string | null;
  checklist_completed: boolean;
  created_at: string;
  updated_at: string;
}

export type TradeInput = Omit<Trade, 'id' | 'user_id' | 'created_at' | 'updated_at'> & { client_request_id?: string; expected_revision?: string };

export type JournalType = 'daily' | 'weekly' | 'monthly';

export interface ChecklistItem {
  label: string;
  checked: boolean;
}

export interface ReviewPrompt {
  question: string;
  answer: string;
}

export interface JournalEntry {
  id: string;
  user_id: string | null;
  entry_date: string;
  entry_type: JournalType;
  daily_goals: string | null;
  weekly_focus: string | null;
  pre_market_notes: string | null;
  post_session_review: string | null;
  trading_plan_checklist: ChecklistItem[];
  review_prompts: ReviewPrompt[];
  mood: string | null;
  notes: string | null;
  screenshot_url: string | null;
  voice_note_url?: string | null;
  strategy_id: string | null;
  plan_id?: string | null;
  entry_model_id?: string | null;
  setup_id?: string | null;
  instrument_id?: string | null;
  account_id?: string | null;
  linked_trade_ids: string[];
  created_at: string;
  updated_at: string;
}

export type JournalInput = Omit<JournalEntry, 'id' | 'user_id' | 'created_at' | 'updated_at'>;

export interface AISummary {
  id: string;
  period_type: JournalType;
  period_start: string;
  period_end: string;
  summary: string;
  suggestions: string[];
  patterns: PatternInsight[];
  comparison: ComparisonData;
  trade_count: number;
  created_at: string;
}

export interface PatternInsight {
  title: string;
  detail: string;
  type: 'positive' | 'negative' | 'neutral';
}

export interface ComparisonData {
  current: Record<string, number | string>;
  previous: Record<string, number | string>;
  deltas: Record<string, number>;
}

export interface DashboardStats {
  totalPnl: number;
  totalTrades: number;
  winRate: number;
  wins: number;
  losses: number;
  breakevens: number;
  avgWin: number;
  avgLoss: number;
  bestDay: { date: string; pnl: number } | null;
  worstDay: { date: string; pnl: number } | null;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
  currentStreak: { type: 'win' | 'loss' | 'none'; count: number };
  profitFactor: number;
  expectancy: number;
  avgRiskReward: number;
}

export interface TraderProfile {
  id: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  trading_style: string | null;
  is_public: boolean;
  username?: string | null;
  role?: 'member' | 'admin';
  account_status?: 'active' | 'suspended';
  suspended_at?: string | null;
  suspension_expires_at?: string | null;
  created_at: string;
}

// ── Trading Plan ──
export interface TradingPlan {
  id: string;
  user_id: string;
  title: string;
  philosophy: string | null;
  htf_selection: string | null;
  ltf_execution: string | null;
  trade_management: string | null;
  risk_management: string | null;
  max_risk_per_trade_pct?: number | null;
  max_daily_loss_pct?: number | null;
  max_drawdown_pct?: number | null;
  mapping_process: string | null;
  entry_models: string | null;
  market_conditions: string | null;
  additional_notes: string | null;
  adherence_score: number | null;
  screenshot_url?: string | null;
  voice_note_url?: string | null;
  created_at: string;
  updated_at: string;
}

export type TradingPlanInput = Omit<TradingPlan, 'id' | 'user_id' | 'created_at' | 'updated_at'>;

// ── Goals ──
export type GoalCategory = 'profit' | 'win_rate' | 'discipline' | 'risk' | 'growth' | 'process' | 'personal' | 'general';
export type GoalStatus = 'active' | 'completed' | 'paused' | 'failed';

export interface Goal {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  category: GoalCategory;
  target_metric: string | null;
  target_value: number | null;
  current_value: number | null;
  deadline: string | null;
  status: GoalStatus;
  goal_type: GoalType;
  priority: GoalPriority;
  progress_notes: string | null;
  year: number | null;
  is_template: boolean;
  created_at: string;
  updated_at: string;
}

export type GoalInput = Omit<Goal, 'id' | 'user_id' | 'created_at' | 'updated_at'>;

// ── Backtest Results ──
export interface BacktestTrade {
  entry_time: string;
  exit_time: string;
  direction: 'long' | 'short';
  entry_price: number;
  exit_price: number;
  pnl: number;
  pips: number;
  outcome: 'win' | 'loss' | 'breakeven';
}

export interface BacktestResult {
  id: string;
  user_id: string;
  name: string;
  instrument: string;
  strategy_rules: Record<string, unknown>;
  equity_curve: { date: string; equity: number }[];
  trades: BacktestTrade[];
  start_date: string | null;
  end_date: string | null;
  initial_balance: number;
  final_balance: number;
  total_trades: number;
  win_rate: number;
  profit_factor: number;
  max_drawdown: number;
  sharpe_ratio: number;
  avg_rr: number;
  monthly_performance: { month: string; pnl: number }[];
  screenshot_url: string | null;
  strategy_id: string | null;
  setup_id?: string | null;
  plan_id?: string | null;
  entry_model_id?: string | null;
  instrument_id?: string | null;
  account_id?: string | null;
  voice_note_url?: string | null;
  created_at: string;
}

export type BacktestInput = Omit<BacktestResult, 'id' | 'user_id' | 'created_at'>;

// ── Forward Testing ──
export type ForwardTradeStatus = 'open' | 'closed' | 'cancelled';

export interface ForwardTrade {
  id: string;
  user_id: string;
  instrument: string;
  direction: 'long' | 'short';
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  position_size: number;
  status: ForwardTradeStatus;
  exit_price: number | null;
  pnl: number | null;
  pips: number | null;
  notes: string | null;
  journal_entry: string | null;
  emotional_state: EmotionalState | null;
  entry_time: string | null;
  exit_time: string | null;
  screenshot_url: string | null;
  strategy_id: string | null;
  setup_id: string | null;
  plan_id?: string | null;
  entry_model_id?: string | null;
  account_id?: string | null;
  instrument_id?: string | null;
  conversion_rate?: number | null;
  example_values_confirmed?: boolean;
  voice_note_url?: string | null;
  created_at: string;
}

export type ForwardTradeInput = Omit<ForwardTrade, 'id' | 'user_id' | 'created_at'>;

// ── Trading Rules ──
export type RuleCategory = 'risk' | 'entry' | 'exit' | 'discipline' | 'news' | 'position_sizing';

export interface TradingRule {
  id: string;
  user_id: string;
  plan_id?: string | null;
  rule_text: string;
  category: RuleCategory;
  priority: number;
  is_active: boolean;
  times_broken: number;
  created_at: string;
  updated_at: string;
}

export type TradingRuleInput = Omit<TradingRule, 'id' | 'user_id' | 'created_at' | 'updated_at'>;

// ── Market Sessions / Events ──
export type MarketEventType = 'news' | 'speech' | 'data' | 'holiday' | 'session_open' | 'session_close';
export type MarketImpact = 'high' | 'medium' | 'low';

export interface MarketEvent {
  id: string;
  user_id: string;
  event_name: string;
  event_date: string;
  event_type: MarketEventType;
  impact: MarketImpact;
  session: TradeSession | null;
  is_no_trade: boolean;
  notes: string | null;
  created_at: string;
}

export type MarketEventInput = Omit<MarketEvent, 'id' | 'user_id' | 'created_at'>;

// ── Trading Setups ──
export type SetupCategory = 'breakout' | 'reversal' | 'trend_following' | 'range' | 'scalping' | 'swing' | 'other';

export interface TradingSetup {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  category: string;
  market_conditions: string | null;
  timeframes: string | null;
  entry_criteria: string | null;
  exit_criteria: string | null;
  example_notes: string | null;
  screenshot_url: string | null;
  voice_note_url?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type TradingSetupInput = Omit<TradingSetup, 'id' | 'user_id' | 'created_at' | 'updated_at'>;

// ── Strategy Test Sessions ──
export type TestType = 'backtest' | 'forward_test';

export interface StrategyTestSession {
  id: string;
  user_id: string;
  name: string;
  strategy_name: string | null;
  instrument: string | null;
  timeframe: string | null;
  test_type: TestType;
  start_date: string | null;
  end_date: string | null;
  initial_balance: number;
  notes: string | null;
  screenshot_url: string | null;
  strategy_id: string | null;
  plan_id?: string | null;
  entry_model_id?: string | null;
  entry_model_mode?: 'one' | 'all' | 'unspecified';
  account_id?: string | null;
  instrument_id?: string | null;
  setup_id?: string | null;
  voice_note_url?: string | null;
  created_at: string;
  updated_at: string;
}

export type StrategyTestSessionInput = Omit<StrategyTestSession, 'id' | 'user_id' | 'created_at' | 'updated_at'>;

// ── Strategy Test Trades ──
export type TestTradeOutcome = 'win' | 'loss' | 'breakeven';

export interface StrategyTestTrade {
  id: string;
  session_id: string;
  user_id: string;
  direction: TradeDirection;
  entry_price: number;
  exit_price: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  position_size: number | null;
  pnl: number;
  r_multiple: number | null;
  outcome: TestTradeOutcome;
  entry_time: string | null;
  exit_time: string | null;
  notes: string | null;
  screenshot_url: string | null;
  account_id?: string | null;
  instrument_id?: string | null;
  setup_id?: string | null;
  plan_id?: string | null;
  entry_model_id?: string | null;
  conversion_rate?: number | null;
  voice_note_url?: string | null;
  checklist_items?: TradeChecklistSnapshot[] | null;
  setup_quality?: number | null;
  created_at: string;
}

export type StrategyTestTradeInput = Omit<StrategyTestTrade, 'id' | 'user_id' | 'created_at'>;

// ── Resources ──
export type ResourceCategory = 'book' | 'video' | 'article' | 'course' | 'tool' | 'podcast' | 'other';

export interface Resource {
  id: string;
  user_id: string;
  title: string;
  url: string | null;
  category: string;
  description: string | null;
  tags: string[];
  thumbnail_url: string | null;
  created_at: string;
  updated_at: string;
}

export type ResourceInput = Omit<Resource, 'id' | 'user_id' | 'created_at' | 'updated_at'>;

// ── Notes ──
export interface Note {
  id: string;
  user_id: string;
  title: string;
  content: string | null;
  tags: string[];
  is_pinned: boolean;
  screenshot_url: string | null;
  created_at: string;
  updated_at: string;
}

export type NoteInput = Omit<Note, 'id' | 'user_id' | 'created_at' | 'updated_at'>;

// ── Study Materials ──
export type StudyType = 'book' | 'course' | 'video_series' | 'article' | 'podcast' | 'other';
export type StudyStatus = 'not_started' | 'in_progress' | 'completed';

export interface StudyMaterial {
  id: string;
  user_id: string;
  title: string;
  type: string;
  status: string;
  progress: number;
  total_units: number | null;
  completed_units: number;
  notes: string | null;
  url: string | null;
  cover_image_url: string | null;
  created_at: string;
  updated_at: string;
}

export type StudyMaterialInput = Omit<StudyMaterial, 'id' | 'user_id' | 'created_at' | 'updated_at'>;

// ── Brokers ──
export interface Broker {
  id: string;
  user_id: string;
  name: string;
  account_type: string | null;
  account_number: string | null;
  leverage: string | null;
  commission: string | null;
  spread: string | null;
  funding_method: string | null;
  login_url: string | null;
  notes: string | null;
  is_active: boolean;
  provider_id?: string | null;
  created_at: string;
  updated_at: string;
}

export type BrokerInput = Omit<Broker, 'id' | 'user_id' | 'created_at' | 'updated_at'>;

export type InstrumentAssetClass = 'fx' | 'metal' | 'index' | 'crypto' | 'stock' | 'future' | 'energy' | 'agriculture' | 'custom';
export interface MarketInstrument {
  id: string;
  user_id: string | null;
  symbol: string;
  display_name: string;
  asset_class: InstrumentAssetClass;
  chart_symbol: string | null;
  base_currency: string | null;
  quote_currency: string;
  price_increment: number;
  pip_size?: number | null;
  price_precision: number;
  contract_multiplier: number;
  quantity_unit: string;
  quantity_step?: number;
  min_quantity?: number;
  example_price: number | null;
  example_size: number;
  tick_value?: number | null;
  default_stop_ticks?: number;
  default_target_r?: number;
  created_at: string;
}
export type MarketInstrumentInput = Omit<MarketInstrument, 'id' | 'user_id' | 'created_at'>;

export interface TradingAccount {
  id: string;
  user_id: string;
  broker_id: string | null;
  broker_provider_id?: string | null;
  broker_name?: string | null;
  name: string;
  account_number: string | null;
  account_type: string | null;
  base_currency: string;
  balance: number;
  balance_as_of?: string;
  broker_balance?: number;
  broker_balance_at?: string;
  broker_equity?: number;
  broker_equity_at?: string;
  risk_per_trade_pct: number;
  default_strategy_id?: string | null;
  default_plan_id?: string | null;
  challenge_target_pct?: number | null;
  daily_loss_limit_pct?: number | null;
  max_loss_limit_pct?: number | null;
  challenge_reset_timezone?: string | null;
  broker_account_type?: string | null;
  prop_firm_id?: string | null;
  prop_program_id?: string | null;
  prop_phase?: string | null;
  provider_region?: string | null;
  rule_version_id?: string | null;
  prop_rule_snapshot?: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
export type TradingAccountInput = Omit<TradingAccount, 'id' | 'user_id' | 'created_at' | 'updated_at'>;

export interface TradingAccountAdjustment {
  id: string;
  user_id: string;
  account_id: string;
  amount: number;
  reason: string;
  created_at: string;
}
export type TradingAccountAdjustmentInput = Omit<TradingAccountAdjustment, 'id' | 'user_id' | 'created_at'>;

export type ProviderKind = 'broker' | 'prop_firm';
export interface ProviderCatalogEntry {
  id: string;
  provider_kind: ProviderKind;
  name: string;
  website_url: string;
  market_group: string | null;
  availability: Record<string, 'available' | 'unavailable' | 'unknown'>;
  is_active: boolean;
}
export interface ProviderOffering {
  id: string;
  provider_id: string;
  offering_kind: 'broker_account_type' | 'prop_program';
  name: string;
  market_group: string | null;
  details: Record<string, unknown>;
  region_code: string | null;
  contracting_entity: string | null;
  source_url: string | null;
  verified_at: string | null;
  source_status: 'verified' | 'needs_verification' | 'archived';
  is_active: boolean;
}
export interface PropFirmRuleVersion {
  id: string;
  offering_id: string;
  program_name: string;
  phase: string;
  account_size: number | null;
  currency: string | null;
  region_code: string | null;
  contracting_entity: string | null;
  purchase_effective_from: string | null;
  purchase_effective_until: string | null;
  effective_from: string | null;
  verified_at: string;
  source_urls: string[];
  rules: Record<string, unknown>;
  rule_status: 'verified' | 'needs_verification' | 'review_required' | 'archived';
}
export interface ProviderChangeReview {
  id: string;
  source_watch_id: string;
  provider_id: string;
  offering_id: string | null;
  detected_at: string;
  previous_hash: string | null;
  current_hash: string | null;
  status: 'pending' | 'reviewed' | 'dismissed';
  reviewer_note: string | null;
  reviewed_at: string | null;
  provider_catalog?: { name: string } | null;
  provider_source_watches?: { source_url: string } | null;
}

// ── Charting Tools ──
export interface ChartingTool {
  id: string;
  user_id: string;
  name: string;
  subscription_status: string;
  renewal_date: string | null;
  price: number | null;
  features: string | null;
  url: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type ChartingToolInput = Omit<ChartingTool, 'id' | 'user_id' | 'created_at' | 'updated_at'>;

// ── Weekly Reviews ──
export interface WeeklyReview {
  id: string;
  user_id: string;
  week_start: string;
  week_end: string;
  rating: number;
  trades_taken: number;
  trades_planned: number;
  pnl: number;
  what_went_well: string | null;
  what_went_wrong: string | null;
  lessons_learned: string | null;
  focus_next_week: string | null;
  psychological_notes: string | null;
  screenshot_url: string | null;
  strategy_id: string | null;
  plan_id?: string | null;
  entry_model_id?: string | null;
  setup_id?: string | null;
  instrument_id?: string | null;
  account_id?: string | null;
  voice_note_url?: string | null;
  created_at: string;
  updated_at: string;
}

export type WeeklyReviewInput = Omit<WeeklyReview, 'id' | 'user_id' | 'created_at' | 'updated_at'>;

// ── Goal Templates ──
export type GoalType = 'trading' | 'personal' | 'general';
export type GoalPriority = 'high' | 'medium' | 'low';

export interface GoalTemplate {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  category: string;
  target_metric: string | null;
  target_value: number | null;
  is_public: boolean;
  created_at: string;
}

export type GoalTemplateInput = Omit<GoalTemplate, 'id' | 'user_id' | 'created_at'>;
