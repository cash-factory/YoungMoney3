import { useMemo, useState } from 'react';
import { Wallet, Target, TrendingUp, Flame, Activity, Plus, ArrowUpRight, ArrowDownRight, Minus, Star, Clock, Eye } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, Cell } from 'recharts';
import { useAllTestTrades, useBacktests, useForwardTrades, useTestSessions, useTrades, useTradingAccounts, useTradingAccountAdjustments } from '@/hooks/useData';
import { useAuth } from '@/context/AuthContext';
import { computeDashboardStats, equityCurveData, dailyPnlData, formatCurrency, formatPercent, formatDateTime, groupByPair } from '@/lib/utils';
import { StatCard } from '@/components/ui/StatCard';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { LoadingSpinner, EmptyState } from '@/components/ui/Feedback';
import { Modal } from '@/components/ui/Modal';
import { TradeForm } from '@/components/TradeForm';
import { TradeCalculator } from '@/components/TradeCalculator';
import { ActivityHeatmap } from '@/components/ActivityHeatmap';
import { Achievements } from '@/components/Achievements';
import { MoodTracker } from '@/components/MoodTracker';
import { StrategyEdgeScore } from '@/components/StrategyEdgeScore';
import { RiskGuardian } from '@/components/RiskGuardian';
import { RiskSettingsModal } from '@/components/RiskSettingsModal';
import { TradeAttachments } from '@/components/TradeAttachments';
import { useRiskSettings, useChecklist, useTradingPlans } from '@/hooks/useData';
import type { Trade, TradeInput, RiskSettingsInput } from '@/lib/types';
import { subDays, format } from 'date-fns';

export function DashboardPage() {
  const { user } = useAuth();
  const { trades: liveTrades, loading, addTrade } = useTrades(user?.id);
  const { accounts } = useTradingAccounts(user?.id);
  const { adjustments } = useTradingAccountAdjustments(user?.id);
  const { backtests } = useBacktests(user?.id);
  const { forwardTrades } = useForwardTrades(user?.id);
  const { sessions } = useTestSessions(user?.id);
  const { trades: loggedTestTrades } = useAllTestTrades(user?.id);
  const { settings, saveSettings } = useRiskSettings(user?.id);
  const { plans } = useTradingPlans(user?.id);
  const { checklist, addChecklistItem, deleteChecklistItem } = useChecklist(user?.id);
  const [showAdd, setShowAdd] = useState(false);
  const [selectedTrade, setSelectedTrade] = useState<Trade | null>(null);
  const [showRiskSettings, setShowRiskSettings] = useState(false);
  const [accountFilter, setAccountFilter] = useState('all');
  const [source, setSource] = useState<'live' | 'backtest' | 'forward'>('live');

  const account = accounts.find(a => a.id === accountFilter) || null;
  const accountPlan = plans.find(plan => plan.id === account?.default_plan_id) || null;
  const sessionSourceTrades = useMemo(() => loggedTestTrades.flatMap(test => {
    const session = sessions.find(s => s.id === test.session_id);
    if (!session || (source === 'backtest' ? session.test_type !== 'backtest' : session.test_type !== 'forward_test')) return [];
    return [toDashboardTrade({
      id: `test-${test.id}`, account_id: test.account_id || session.account_id || null,
      pair: session.instrument || 'Test instrument', direction: test.direction,
      entry_price: test.entry_price, exit_price: test.exit_price,
      pnl: test.pnl, pips: 0, outcome: test.outcome,
      entry_time: test.entry_time || test.created_at, exit_time: test.exit_time,
    })];
  }), [loggedTestTrades, sessions, source]);
  const sourceTrades = useMemo(() => {
    if (source === 'live') return liveTrades;
    if (source === 'forward') return [
      ...sessionSourceTrades,
      ...forwardTrades.map(t => toDashboardTrade({
        id: `forward-${t.id}`, account_id: t.account_id || null, pair: t.instrument,
        direction: t.direction, entry_price: t.entry_price, exit_price: t.exit_price,
        pnl: t.pnl || 0, pips: t.pips || 0,
        outcome: t.pnl == null ? null : t.pnl > 0 ? 'win' : t.pnl < 0 ? 'loss' : 'breakeven',
        entry_time: t.entry_time || t.created_at, exit_time: t.exit_time,
        status: t.status === 'closed' ? 'closed' : 'open',
      })),
    ];
    const summaryTrades = backtests.flatMap(test => (test.trades || []).map((t, index) => toDashboardTrade({
      id: `backtest-${test.id}-${index}`, account_id: test.account_id || null, pair: test.instrument,
      direction: t.direction, entry_price: t.entry_price, exit_price: t.exit_price,
      pnl: t.pnl, pips: t.pips, outcome: t.outcome, entry_time: t.entry_time, exit_time: t.exit_time,
    })));
    return [...sessionSourceTrades, ...summaryTrades];
  }, [source, liveTrades, sessionSourceTrades, forwardTrades, backtests]);
  const trades = useMemo(() => sourceTrades.filter(t => accountFilter === 'all' || t.account_id === accountFilter), [sourceTrades, accountFilter]);

  const currencyTotals = useMemo(() => {
    const totals = new Map<string, number>();
    trades.filter(t => t.status === 'closed').forEach(t => {
      const currency = accounts.find(a => a.id === t.account_id)?.base_currency || 'USD';
      totals.set(currency, (totals.get(currency) || 0) + t.pnl);
    });
    return [...totals.entries()];
  }, [trades, accounts]);
  const allHasMixedCurrencies = accountFilter === 'all' && new Set(accounts.filter(a => a.is_active).map(a => a.base_currency)).size > 1;
  const mixedCurrencyView = allHasMixedCurrencies;
  const formatAccountMoney = (value: number, currency: string) => new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
  const currentBalance = account ? account.balance + liveTrades.filter(t => t.account_id === account.id && t.status === 'closed').reduce((sum, t) => sum + t.pnl, 0) + adjustments.filter(a => a.account_id === account.id).reduce((sum, a) => sum + a.amount, 0) : null;
  const accountPnl = account && currentBalance != null ? currentBalance - account.balance : 0;
  const challengeProgress = account?.challenge_target_pct && account.balance > 0 ? Math.max(0, Math.min(100, accountPnl / (account.balance * account.challenge_target_pct / 100) * 100)) : 0;
  const accountTodayPnl = account ? liveTrades.filter(t => t.account_id === account.id && t.status === 'closed' && localDayInZone(t.exit_time || t.entry_time, account.challenge_reset_timezone || 'UTC') === localDayInZone(new Date().toISOString(), account.challenge_reset_timezone || 'UTC')).reduce((sum, t) => sum + t.pnl, 0) : 0;
  const balancesByCurrency = useMemo(() => accounts.filter(a => a.is_active).reduce((groups, a) => {
    const pnl = liveTrades.filter(t => t.account_id === a.id && t.status === 'closed').reduce((sum, t) => sum + t.pnl, 0);
    const adjustmentTotal = adjustments.filter(item => item.account_id === a.id).reduce((sum, item) => sum + item.amount, 0);
    groups.set(a.base_currency, (groups.get(a.base_currency) || 0) + a.balance + pnl + adjustmentTotal);
    return groups;
  }, new Map<string, number>()), [accounts, liveTrades, adjustments]);

  const stats = useMemo(() => computeDashboardStats(trades), [trades]);
  const equity = useMemo(() => equityCurveData(trades), [trades]);

  const last7Days = useMemo(() => {
    const end = new Date();
    const start = subDays(end, 6);
    const days: Date[] = [];
    for (let d = start; d <= end; d = new Date(d.getTime() + 86400000)) days.push(d);
    return dailyPnlData(trades, days);
  }, [trades]);

  const topPairs = useMemo(() => groupByPair(trades).slice(0, 5), [trades]);
  const recentTrades = useMemo(() => trades.slice(0, 6), [trades]);

  const handleSubmit = async (data: TradeInput) => {
    await addTrade(data);
    setShowAdd(false);
  };

  const handleSaveRiskSettings = async (input: RiskSettingsInput) => {
    await saveSettings(input);
  };

  if (loading) return <LoadingSpinner label="Loading your dashboard..." />;

  return (
    <div>
      <SectionHeader
        title="Dashboard"
        subtitle="Your trading performance at a glance"
        action={
          <button onClick={() => setShowAdd(true)} className="btn-primary">
            <Plus size={18} /> Add Trade
          </button>
        }
      />

      <div className="card p-4 mb-6 flex flex-col sm:flex-row sm:items-end gap-3">
        <div className="flex-1"><label className="block text-xs font-semibold text-secondary mb-1.5">View account</label><select className="input-field" value={accountFilter} onChange={e => setAccountFilter(e.target.value)}><option value="all">All accounts</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.name} · {a.base_currency}</option>)}</select></div>
        <div className="flex-1"><label className="block text-xs font-semibold text-secondary mb-1.5">Performance source</label><select className="input-field" value={source} onChange={e => setSource(e.target.value as 'live'|'backtest'|'forward')}><option value="live">Live trades</option><option value="backtest">Backtest logs</option><option value="forward">Forward test logs</option></select></div>
        {source !== 'live' && <p className="text-xs text-muted sm:max-w-56">Simulated performance is shown separately from live account equity.</p>}
      </div>

      {source === 'live' && <div className="card p-4 mb-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        {account ? <><span className="text-secondary">Current balance</span><strong className="font-mono">{formatAccountMoney(currentBalance || 0, account.base_currency)}</strong><span className="text-xs text-muted">Opening balance plus closed trade P&amp;L</span></> : accounts.length ? <><span className="text-secondary">Balances by currency</span>{Array.from(balancesByCurrency).map(([currency, value]) => <strong key={currency} className="font-mono">{formatAccountMoney(value, currency)}</strong>)}</> : <span className="text-muted">Add a trading account to track account balance here.</span>}
      </div>}

      {source === 'live' && account?.account_type === 'propfirm' && <div className="card p-4 mb-6 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">Challenge progress</h3><span className="text-xs text-muted">Resets daily at midnight {account.challenge_reset_timezone || 'UTC'}</span></div>
        {account.challenge_target_pct != null ? <><div className="flex items-center justify-between text-xs"><span className="text-secondary">Profit target · {account.challenge_target_pct}%</span><strong>{challengeProgress.toFixed(0)}% complete</strong></div><div className="h-2 rounded-full bg-secondary overflow-hidden"><div className="h-full rounded-full bg-orange-500 transition-[width]" style={{ width: `${challengeProgress}%` }} /></div></> : <p className="text-xs text-muted">Set a profit target in account settings to track challenge progress.</p>}
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs"><span>Today: <strong className={accountTodayPnl < 0 ? 'text-error-500' : 'text-secondary'}>{formatAccountMoney(accountTodayPnl, account.base_currency)}</strong>{account.daily_loss_limit_pct != null && <> · Daily loss limit {formatAccountMoney(account.balance * account.daily_loss_limit_pct / 100, account.base_currency)}</>}</span><span>Current balance: <strong>{formatAccountMoney(currentBalance || 0, account.base_currency)}</strong>{account.max_loss_limit_pct != null && <> · Max loss limit {formatAccountMoney(account.balance * account.max_loss_limit_pct / 100, account.base_currency)}</>}</span></div>
        {(account.daily_loss_limit_pct != null && accountTodayPnl <= -(account.balance * account.daily_loss_limit_pct / 100) || account.max_loss_limit_pct != null && accountPnl <= -(account.balance * account.max_loss_limit_pct / 100)) && <p role="alert" className="text-xs font-semibold text-error-500">One of this account’s configured loss limits has been reached or exceeded.</p>}
      </div>}

      {source === 'live' && account && accountPlan && <div className="card p-4 mb-6 space-y-1">
        <p className="text-sm font-semibold">Plan guardrails · {accountPlan.title}</p>
        <p className="text-xs text-secondary">
          Default plan limits: {accountPlan.max_risk_per_trade_pct ?? 'not set'}% risk / trade · {accountPlan.max_daily_loss_pct ?? 'not set'}% daily loss · {accountPlan.max_drawdown_pct ?? 'not set'}% max drawdown. Account and prop-firm limits are separate.
        </p>
        {accountPlan.max_daily_loss_pct != null && accountTodayPnl <= -(account.balance * accountPlan.max_daily_loss_pct / 100) && <p role="alert" className="text-xs font-semibold text-error-500">The default plan’s daily loss limit has been reached or exceeded.</p>}
      </div>}

      {mixedCurrencyView && <div className="card px-4 py-3 mb-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs"><span className="font-semibold text-secondary">Closed P&amp;L by currency</span>{currencyTotals.length ? currencyTotals.map(([currency, pnl]) => <strong key={currency} className={`font-mono ${pnl >= 0 ? 'text-success-500' : 'text-error-500'}`}>{currency} {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}</strong>) : <span className="text-muted">No closed trades in this view.</span>}</div>}

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard
          label="Net P&L"
          value={mixedCurrencyView ? 'Grouped' : formatCurrency(stats.totalPnl)}
          icon={<Wallet size={20} className="text-orange-500" />}
          trend={stats.totalPnl >= 0 ? 'up' : 'down'}
          trendValue={mixedCurrencyView ? 'See P&L by currency above' : `${stats.totalTrades} trades`}
          accent="blue"
        />
        <StatCard
          label="Win Rate"
          value={formatPercent(stats.winRate)}
          icon={<Target size={20} className="text-amber-500" />}
          sublabel={`${stats.wins}W · ${stats.losses}L · ${stats.breakevens}BE`}
          accent="amber"
        />
        <StatCard
          label="Avg Win"
          value={mixedCurrencyView ? 'Grouped' : formatCurrency(stats.avgWin)}
          icon={<TrendingUp size={20} className="text-success-500" />}
          sublabel={mixedCurrencyView ? 'Average wins and losses use each account currency' : `Avg Loss: ${formatCurrency(stats.avgLoss)}`}
          accent="emerald"
        />
        <StatCard
          label="Profit Factor"
          value={mixedCurrencyView ? 'Select account' : stats.profitFactor === Infinity ? '∞' : stats.profitFactor.toFixed(2)}
          icon={<Activity size={20} className="text-orange-500" />}
          sublabel={mixedCurrencyView ? 'Profit factor is not combined across currencies' : `Expectancy: ${formatCurrency(stats.expectancy)}`}
          accent="blue"
        />
      </div>

      {/* Streak + consecutive */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard
          label="Current Streak"
          value={stats.currentStreak.type === 'none' ? '—' : `${stats.currentStreak.count} ${stats.currentStreak.type === 'win' ? 'Wins' : 'Losses'}`}
          icon={<Flame size={20} className={stats.currentStreak.type === 'win' ? 'text-success-500' : stats.currentStreak.type === 'loss' ? 'text-error-500' : 'text-muted'} />}
          accent={stats.currentStreak.type === 'loss' ? 'rose' : 'amber'}
        />
        <StatCard
          label="Max Consecutive Wins"
          value={String(stats.maxConsecutiveWins)}
          icon={<ArrowUpRight size={20} className="text-success-500" />}
          accent="emerald"
        />
        <StatCard
          label="Max Consecutive Losses"
          value={String(stats.maxConsecutiveLosses)}
          icon={<ArrowDownRight size={20} className="text-error-500" />}
          accent="rose"
        />
        <StatCard
          label="Avg Risk : Reward"
          value={stats.avgRiskReward > 0 ? `1:${stats.avgRiskReward.toFixed(2)}` : '—'}
          icon={<Star size={20} className="text-amber-500" />}
          accent="amber"
        />
      </div>

      {/* Risk Guardian */}
      {source === 'live' && <div className="mb-6">
        <RiskGuardian trades={trades} settings={settings} account={account} plan={accountPlan} onConfigure={() => setShowRiskSettings(true)} />
      </div>}

      {/* Trade Calculator */}
      <div className="mb-6">
        <TradeCalculator />
      </div>

      {/* Equity curve + Daily P&L */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="card p-5 lg:col-span-2">
          <h3 className="text-sm font-semibold mb-4">Equity Curve</h3>
          {mixedCurrencyView ? <p className="py-20 text-center text-sm text-muted">Choose one account to view a combined equity curve. Balances in different currencies stay separate.</p> : equity.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={equity} margin={{ left: -10, right: 10, top: 5, bottom: 0 }}>
                <defs>
                  <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--brand)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="var(--brand)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} width={50} tickFormatter={(v) => `$${v}`} />
                <Tooltip
                  contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 12 }}
                  formatter={(v) => [formatCurrency(Number(v)), 'Equity']}
                />
                <Area type="monotone" dataKey="equity" stroke="var(--brand)" strokeWidth={2} fill="url(#equityGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState icon={<TrendingUp size={40} />} title="No equity data yet" message="Add your first trade to see your equity curve grow over time." />
          )}
        </div>

        <div className="card p-5">
          <h3 className="text-sm font-semibold mb-4">Last 7 Days P&L</h3>
          {mixedCurrencyView ? <p className="py-20 text-center text-sm text-muted">Choose one account to compare daily P&amp;L in a single currency.</p> : last7Days.some(d => d.trades > 0) ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={last7Days} margin={{ left: -10, right: 10, top: 5, bottom: 0 }}>
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} width={50} tickFormatter={(v) => `$${v}`} />
                <Tooltip
                  contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 12 }}
                  formatter={(v, _name, p) => [formatCurrency(Number(v)), `P&L (${p.payload.trades} trades)`]}
                />
                <Bar dataKey="pnl" radius={[6, 6, 0, 0]}>
                  {last7Days.map((d, i) => (
                    <Cell key={i} fill={d.pnl >= 0 ? '#10b981' : '#f87171'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState icon={<Activity size={40} />} title="No recent activity" message="Your daily P&L will appear here once you start logging trades." />
          )}
        </div>
      </div>

      {/* Best/Worst day + Top pairs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        {mixedCurrencyView ? <div className="card p-5"><h3 className="text-sm font-semibold mb-4">Currency Breakdown</h3><div className="space-y-2">{currencyTotals.length ? currencyTotals.map(([currency, pnl]) => <div key={currency} className="flex items-center justify-between rounded-lg bg-secondary px-3 py-2"><span className="text-sm font-medium">{currency}</span><span className={`font-mono text-sm font-semibold ${pnl >= 0 ? 'text-success-500' : 'text-error-500'}`}>{pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}</span></div>) : <p className="text-sm text-muted">No closed trades in this view.</p>}</div></div> : <div className="card p-5">
          <h3 className="text-sm font-semibold mb-4">Best & Worst Days</h3>
          <div className="space-y-3">
            {stats.bestDay ? (
              <div className="flex items-center justify-between p-3 rounded-xl bg-success-500/5 border border-success-500/15">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-success-500/10">
                    <ArrowUpRight size={18} className="text-success-500" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Best Day</p>
                    <p className="text-xs text-muted">{format(new Date(stats.bestDay.date), 'EEE, MMM d yyyy')}</p>
                  </div>
                </div>
                <span className="text-lg font-bold font-mono text-success-500">{formatCurrency(stats.bestDay.pnl)}</span>
              </div>
            ) : <p className="text-sm text-muted">No data yet.</p>}
            {stats.worstDay ? (
              <div className="flex items-center justify-between p-3 rounded-xl bg-error-500/5 border border-error-500/15">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-error-500/10">
                    <ArrowDownRight size={18} className="text-error-500" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Worst Day</p>
                    <p className="text-xs text-muted">{format(new Date(stats.worstDay.date), 'EEE, MMM d yyyy')}</p>
                  </div>
                </div>
                <span className="text-lg font-bold font-mono text-error-500">{formatCurrency(stats.worstDay.pnl)}</span>
              </div>
            ) : null}
          </div>
        </div>}

        <div className="card p-5">
          <h3 className="text-sm font-semibold mb-4">Top Currency Pairs</h3>
          {topPairs.length > 0 ? (
            <div className="space-y-2">
              {topPairs.map(p => (
                <div key={p.pair} className="flex items-center justify-between p-2.5 rounded-lg hover:bg-secondary transition-colors">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-mono font-semibold">{p.pair}</span>
                    <span className="text-xs text-muted">{p.trades} trades</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted">{formatPercent(p.winRate)} WR</span>
                    <span className={`text-sm font-mono font-semibold ${p.pnl >= 0 ? 'text-success-500' : 'text-error-500'}`}>
                      {formatCurrency(p.pnl)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={<Wallet size={36} />} title="No pairs tracked yet" message="Your most-traded pairs will show up here." />
          )}
        </div>
      </div>

      {/* Activity Heatmap */}
      <div className="mb-6">
        <ActivityHeatmap trades={trades} />
      </div>

      {/* Achievements + Mood Tracker */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <Achievements trades={trades} />
        <MoodTracker trades={trades} />
      </div>

      {/* Strategy Edge Scores */}
      <div className="mb-6">
        <StrategyEdgeScore trades={trades} />
      </div>

      {/* Recent trades */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold mb-4">Recent Trades</h3>
        {recentTrades.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted uppercase tracking-wide border-b border-themed">
                  <th className="text-left py-2 px-2 font-medium">Date</th>
                  <th className="text-left py-2 px-2 font-medium">Pair</th>
                  <th className="text-left py-2 px-2 font-medium">Dir</th>
                  <th className="text-left py-2 px-2 font-medium">Outcome</th>
                  <th className="text-right py-2 px-2 font-medium">P&L</th>
                  <th className="text-right py-2 px-2 font-medium">Pips</th>
                  <th className="text-right py-2 px-2 font-medium">View</th>
                </tr>
              </thead>
              <tbody>
                {recentTrades.map(t => (
                  <tr key={t.id} className="border-b border-themed/50 hover:bg-secondary transition-colors">
                    <td className="py-2.5 px-2 text-xs text-muted">{formatDateTime(t.entry_time)}</td>
                    <td className="py-2.5 px-2 font-mono font-semibold">{t.pair}</td>
                    <td className="py-2.5 px-2">
                      <span className={`badge ${t.direction === 'long' ? 'badge-success' : 'badge-error'}`}>
                        {t.direction === 'long' ? 'Long' : 'Short'}
                      </span>
                    </td>
                    <td className="py-2.5 px-2">
                      {t.status === 'open' ? (
                        <span className="badge bg-orange-500/10 text-orange-600 dark:text-orange-400 border border-orange-500/20">
                          <Clock size={12} /> Open
                        </span>
                      ) : (
                        <span className={`badge ${t.outcome === 'win' ? 'badge-success' : t.outcome === 'loss' ? 'badge-error' : 'badge-neutral'}`}>
                          {t.outcome === 'win' ? <ArrowUpRight size={12} /> : t.outcome === 'loss' ? <ArrowDownRight size={12} /> : <Minus size={12} />}
                          {t.outcome || '—'}
                        </span>
                      )}
                    </td>
                    <td className={`py-2.5 px-2 text-right font-mono font-semibold ${t.status === 'open' ? 'text-orange-500' : t.pnl >= 0 ? 'text-success-500' : 'text-error-500'}`}>
                      {t.status === 'open' ? 'Pending' : mixedCurrencyView ? formatAccountMoney(t.pnl, accounts.find(a => a.id === t.account_id)?.base_currency || 'USD') : account ? formatAccountMoney(t.pnl, account.base_currency) : formatCurrency(t.pnl)}
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono text-muted">{t.pips?.toFixed(1) || '0.0'}</td>
                    <td className="py-2.5 px-2 text-right">
                      <button
                        type="button"
                        onClick={() => setSelectedTrade(t)}
                        className="btn-ghost p-1.5"
                        aria-label={`View ${t.pair} trade details`}
                        title="View trade details"
                      >
                        <Eye size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={<Plus size={36} />} title="No trades yet" message="Click 'Add Trade' to log your first trade and start building your journal." />
        )}
      </div>

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add New Trade" size="lg">
        <TradeForm onSubmit={handleSubmit} onCancel={() => setShowAdd(false)} />
      </Modal>

      <Modal
        open={!!selectedTrade}
        onClose={() => setSelectedTrade(null)}
        title={selectedTrade ? `${selectedTrade.pair} · Trade details` : 'Trade details'}
        size="lg"
      >
        {selectedTrade && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <TradeDetail label="Entered" value={formatDateTime(selectedTrade.entry_time)} />
              <TradeDetail label="Direction" value={selectedTrade.direction === 'long' ? 'Long' : 'Short'} />
              <TradeDetail label="Status" value={selectedTrade.status === 'open' ? 'Open' : selectedTrade.outcome || 'Closed'} />
              <TradeDetail label="Entry" value={selectedTrade.entry_price?.toString() || '—'} />
              <TradeDetail label="Exit" value={selectedTrade.exit_price?.toString() || '—'} />
              <TradeDetail
                label="P&L"
                value={selectedTrade.status === 'open'
                  ? 'Pending'
                  : formatAccountMoney(selectedTrade.pnl, accounts.find(item => item.id === selectedTrade.account_id)?.base_currency || 'USD')}
              />
              <TradeDetail label="Account" value={accounts.find(item => item.id === selectedTrade.account_id)?.name || 'Unassigned'} />
              <TradeDetail label="Strategy" value={selectedTrade.strategy || '—'} />
              <TradeDetail label="Broker" value={selectedTrade.broker || '—'} />
            </div>
            {selectedTrade.notes && (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Notes</h3>
                <p className="mt-1 whitespace-pre-wrap text-sm">{selectedTrade.notes}</p>
              </div>
            )}
            {selectedTrade.lessons && (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Lesson</h3>
                <p className="mt-1 whitespace-pre-wrap text-sm">{selectedTrade.lessons}</p>
              </div>
            )}
            <TradeAttachments trade={selectedTrade} />
          </div>
        )}
      </Modal>

      <RiskSettingsModal
        open={showRiskSettings}
        onClose={() => setShowRiskSettings(false)}
        settings={settings}
        checklist={checklist}
        onSaveSettings={handleSaveRiskSettings}
        onAddChecklistItem={addChecklistItem}
        onDeleteChecklistItem={deleteChecklistItem}
      />
    </div>
  );
}

function TradeDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-secondary p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 break-words text-sm font-medium">{value}</p>
    </div>
  );
}

function toDashboardTrade(value: {
  id: string; account_id: string | null; pair: string; direction: Trade['direction'];
  entry_price: number | null; exit_price: number | null; pnl: number; pips: number;
  outcome: Trade['outcome']; entry_time: string; exit_time: string | null; status?: Trade['status'];
}): Trade {
  const now = value.entry_time || new Date().toISOString();
  return {
    id: value.id, user_id: null, pair: value.pair, direction: value.direction,
    entry_price: value.entry_price, exit_price: value.exit_price, lot_size: null,
    take_profit: null, outcome: value.outcome,
    status: value.status || (value.exit_price == null ? 'open' : 'closed'),
    pnl: value.pnl, pips: value.pips, strategy: null, session: null, broker: null,
    account_type: null, entry_time: now, exit_time: value.exit_time, risk_percent: null,
    risk_reward_ratio: null, emotional_state: null, setup_quality: null, mistakes: [],
    lessons: null, notes: null, screenshot_url: null, voice_note_url: null,
    entry_screenshot_url: null, entry_voice_note_url: null, closure_screenshot_url: null,
    closure_voice_note_url: null, what_went_wrong: null, observations: null,
    strategy_id: null, setup_id: null, account_id: value.account_id,
    checklist_items: null, checklist_override_reason: null, checklist_completed: false,
    created_at: now, updated_at: now,
  };
}

function localDayInZone(value: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}
