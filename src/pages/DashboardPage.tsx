import { ExecutionMetricsPanel, ExecutionSummaryCards, ExecutionSessionSummary } from '@/components/ExecutionMetrics';
import { executionMovement, formatHoldDuration } from '@/lib/executionPresentation';
import { getExecutionMetrics } from '@/lib/executionMetrics';
import { accountLedger, tradeCurrency } from '@/lib/tradeFinance';
import { dateKeyInTimeZone } from '@/lib/riskMetrics';
import { useEffect, useMemo, useState } from 'react';
import { Wallet, Target, TrendingUp, Flame, Activity, BarChart3, ChevronDown, Plus, ArrowUpRight, ArrowDownRight, Minus, Star, Clock, Eye } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, Cell } from 'recharts';
import { useAllTestTrades, useBacktests, useForwardTrades, useTestSessions, useTrades, useTradingAccounts, useTradingAccountAdjustments } from '@/hooks/useData';
import { useAuth } from '@/context/AuthContext';
import { computeDashboardStats, equityCurveData, dailyPnlData, formatPercent, formatDateTime, groupByPair } from '@/lib/utils';
import { StatCard } from '@/components/ui/StatCard';
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
  const { trades: liveTrades, loading, loadError, asOf, addTrade } = useTrades(user?.id);
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
  const [activeSection, setActiveSection] = useState('ym-overview');
  const [selectedTrade, setSelectedTrade] = useState<Trade | null>(null);
  const [showRiskSettings, setShowRiskSettings] = useState(false);
  const [accountFilter, setAccountFilter] = useState('all');
  const [tradeOrigin, setTradeOrigin] = useState('all');
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
  const trades = useMemo(() => sourceTrades.filter(t =>
    (accountFilter === 'all' || t.account_id === accountFilter)
    && (source !== 'live' || tradeOrigin === 'all' || (t.trade_source || 'manual') === tradeOrigin)
  ), [sourceTrades, accountFilter, source, tradeOrigin]);

  type Summary = {account_id:string|null;currency:string;origin:string;profit:string;trades:number};
  const [summaries,setSummaries]=useState<{at:number;rows:Summary[]}|null>(null);
  useEffect(()=>{
    if(!asOf) return;
    const cancel=new AbortController();
    fetch('/api/account-summaries',{signal:cancel.signal}).then(async reply=>{
      if(!reply.ok) return;
      const result=await reply.json();
      if(!cancel.signal.aborted && Array.isArray(result.rows)) setSummaries({at:asOf,rows:result.rows});
    }).catch(()=>{ /* The already-loaded journal provides the fallback below. */ });
    return ()=>cancel.abort();
  },[asOf]);
  const currencyTotals = useMemo(() => {
    const totals = new Map<string, number>();
    if(source==='live' && summaries && summaries.at===asOf){
      for(const row of summaries.rows) if((accountFilter==='all'||row.account_id===accountFilter) && (tradeOrigin==='all'||row.origin===tradeOrigin)) totals.set(row.currency,(totals.get(row.currency) || 0)+Number(row.profit));
      return [...totals.entries()];
    }
    trades.filter(t => t.status === 'closed').forEach(t => {
      const currency = tradeCurrency(t, accounts);
      totals.set(currency, (totals.get(currency) || 0) + t.pnl);
    });
    return [...totals.entries()];
  }, [trades, accounts, source, summaries, asOf, accountFilter,tradeOrigin]);
  const mixedCurrencyView = currencyTotals.length > 1;
  const currency = currencyTotals[0]?.[0] || account?.base_currency || 'USD';
  const formatAccountMoney = (value: number, currency: string) => /^[A-Z]{3}$/.test(currency) ? new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value) : value.toFixed(2) + ' (currency needs review)';
  const formatCurrency = (value: number) => formatAccountMoney(value, currency);
  const ledger = account ? accountLedger(account, liveTrades, adjustments) : null;
  const currentBalance = ledger?.balance ?? null;
  const accountPnl = ledger?.profit ?? 0;
  const challengeProgress = account?.challenge_target_pct && account.balance > 0 ? Math.max(0, Math.min(100, accountPnl / (account.balance * account.challenge_target_pct / 100) * 100)) : 0;
  const accountTodayPnl = account ? liveTrades.filter(t => t.account_id === account.id && t.status === 'closed' && t.exit_time && dateKeyInTimeZone(t.exit_time, account.challenge_reset_timezone || 'UTC') === dateKeyInTimeZone(new Date(), account.challenge_reset_timezone || 'UTC')).reduce((sum, t) => sum + t.pnl, 0) : 0;
  const balancesByCurrency = useMemo(() => accounts.filter(a => a.is_active).reduce((groups, a) => {
    const balance = accountLedger(a, liveTrades, adjustments).balance;
    groups.set(a.base_currency, (groups.get(a.base_currency) || 0) + balance);
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

  useEffect(() => {
    if (loading || typeof IntersectionObserver === 'undefined') return;
    const ids = ['ym-overview', 'ym-risk', 'ym-performance', 'ym-recent', 'ym-deep-dive'];
    const observer = new IntersectionObserver(entries => {
      const visible = entries.filter(entry => entry.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]) setActiveSection(visible[0].target.id);
    }, { rootMargin: '-10% 0px -65% 0px', threshold: 0 });
    for (const id of ids) {
      const target = document.getElementById(id);
      if (target) observer.observe(target);
    }
    return () => observer.disconnect();
  }, [loading, source]);

  const jumpToSection = (id: string) => {
    setActiveSection(id);
    document.getElementById(id)?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'start',
    });
  };

  if (loading) return <LoadingSpinner label="Loading your dashboard..." />;

  if (loadError && !asOf) return <p role="alert">Trade history unavailable. Risk figures will appear after the next successful refresh.</p>;
  return (
    <div className="ym-dashboard">
      {loadError && <p role="alert">Trade history unavailable. Showing figures last refreshed {new Date(asOf!).toLocaleString()}.</p>}
      {trades.some(t=>t.status==='closed' && (!t.exit_time || tradeCurrency(t,accounts)==='Unknown' || getExecutionMetrics(t).realized_r == null)) && <p className="card p-3 text-sm" role="status">Some closed trades need review for close time, currency or initial risk. Daily risk and R statistics may be incomplete.</p>}
      {account?.broker_balance != null && (!account.broker_balance_at || Date.now()-Date.parse(account.broker_balance_at)>120000) && <p role="status" className="card p-3 text-xs text-secondary">Broker balance needs refreshing. Check the latest sync in MT5 Connections.</p>}

      <div className="ym-dash-heading" id="ym-overview">
        <div className="min-w-0">
          <h1>Trading overview</h1>
          <p>Account performance, execution quality and trading risk.</p>
        </div>
        <button type="button" onClick={() => setShowAdd(true)} className="btn-primary ym-dash-new-trade">
          <Plus size={18} /> Add trade
        </button>
      </div>

      <div className="ym-dash-controls ym-toolbar card" role="group" aria-label="Performance filters">
        <label>
          <span>Trading account</span>
          <select className="input-field" value={accountFilter} onChange={event => setAccountFilter(event.target.value)}>
            <option value="all">All accounts</option>
            {accounts.map(item => <option key={item.id} value={item.id}>{item.name} · {item.base_currency}</option>)}
          </select>
        </label>
        <label>
          <span>Performance view</span>
          <select className="input-field" value={source} onChange={event => setSource(event.target.value as 'live' | 'backtest' | 'forward')}>
            <option value="live">Recorded trades</option>
            <option value="backtest">Backtest results</option>
            <option value="forward">Forward test results</option>
          </select>
        </label>
        {source === 'live' ? <label>
          <span>Trade origin</span>
          <select className="input-field" value={tradeOrigin} onChange={event => setTradeOrigin(event.target.value)}>
            <option value="all">All sources</option>
            <option value="manual">Manual entries</option>
            <option value="mt5">MT5 imports</option>
          </select>
        </label> : <div className="ym-dash-filter-note">Practice results are separate from recorded account balances.</div>}
      </div>

      <nav className="ym-dash-jump" aria-label="Dashboard sections">
        <button type="button" className="ym-dashboard-tab" aria-current={activeSection === 'ym-overview' ? 'location' : undefined} onClick={() => jumpToSection('ym-overview')}>Overview</button>
        {source === 'live' && <button type="button" className="ym-dashboard-tab" aria-current={activeSection === 'ym-risk' ? 'location' : undefined} onClick={() => jumpToSection('ym-risk')}>Risk &amp; rules</button>}
        <button type="button" className="ym-dashboard-tab" aria-current={activeSection === 'ym-performance' ? 'location' : undefined} onClick={() => jumpToSection('ym-performance')}>Performance</button>
        <button type="button" className="ym-dashboard-tab" aria-current={activeSection === 'ym-recent' ? 'location' : undefined} onClick={() => jumpToSection('ym-recent')}>Recent trades</button>
        <button type="button" className="ym-dashboard-tab" aria-current={activeSection === 'ym-deep-dive' ? 'location' : undefined} onClick={() => jumpToSection('ym-deep-dive')}>Deep dive</button>
      </nav>

      <section className="ym-dash-balance" aria-label="Account and trading result">
        <div className="ym-dash-balance-main">

          <h2>{account?.name || (source === 'live' ? 'All trading accounts' : source === 'backtest' ? 'Backtest workspace' : 'Forward testing')}</h2>
          {source === 'live' ? (
            account ? (
              <>
                <p className="ym-dash-measure-label">{account.broker_balance != null ? 'Broker reported balance' : 'Journal balance'}</p>
                <p className="ym-dash-balance-number">{formatAccountMoney(currentBalance ?? 0, account.base_currency)}</p>
                <p className="ym-dash-balance-hint">{account.broker_balance != null ? 'Latest balance received from your connected MT5 terminal.' : 'Opening balance, realized trades and cash adjustments.'}</p>
              </>
            ) : balancesByCurrency.size ? (
              <>
                <p className="ym-dash-measure-label">Account balances · by currency</p>
                <div className="ym-dash-balances">
                  {Array.from(balancesByCurrency).map(([code, amount]) => <strong key={code}>{formatAccountMoney(amount, code)}</strong>)}
                </div>
                <p className="ym-dash-balance-hint">Balances stay separate across currencies and accounts.</p>
              </>
            ) : (
              <>
                <p className="ym-dash-balance-number">No accounts yet</p>
                <p className="ym-dash-balance-hint">Create a journal account to see its balance. You can still add a trade.</p>
              </>
            )
          ) : (
            <>
              <p className="ym-dash-measure-label">Net result · closed test trades</p>
              <p className="ym-dash-balance-number">{mixedCurrencyView ? 'By currency' : formatCurrency(stats.totalPnl)}</p>
              <p className="ym-dash-balance-hint">Simulation results are separate from recorded account balances.</p>
            </>
          )}
          <div className="ym-dash-balance-foot">
            <span>{account ? account.base_currency : balancesByCurrency.size + (balancesByCurrency.size===1?' account currency':' account currencies')}</span>
            {asOf && <span>Updated {new Date(asOf).toLocaleTimeString(undefined, {hour:'2-digit',minute:'2-digit'})}</span>}
          </div>
        </div>
        <div className="ym-dash-result">
          <div className="ym-dash-result-heading">
            <span>Realized trading result</span>
            <span className="ym-dash-result-period">Current filters</span>
          </div>
          <p className={stats.totalPnl < 0 && !mixedCurrencyView ? 'ym-dash-result-value is-negative' : 'ym-dash-result-value'}>
            {mixedCurrencyView ? 'By currency' : formatCurrency(stats.totalPnl)}
          </p>
          {mixedCurrencyView ? (
            <div className="ym-dash-currency-results">
              {currencyTotals.map(([code, amount]) => (
                <div key={code}><span>{code}</span><strong className={amount < 0 ? 'is-negative' : ''}>{formatAccountMoney(amount, code)}</strong></div>
              ))}
            </div>
          ) : (
            <p className="ym-dash-result-description">Realized exits use the selected account and trade source.</p>
          )}
          <div className="ym-dash-result-stats">
            <div><span>Win rate</span><strong>{formatPercent(stats.winRate)}</strong></div>
            <div><span>Closed trades</span><strong>{stats.totalTrades}</strong></div>
          </div>
        </div>
      </section>

      <div className="ym-dash-section-title">
        <div><h2>Key performance</h2></div>
        <span>Closed trades · selected view</span>
      </div>
      <div className="ym-dash-metric-grid">
        <StatCard label="Net P&L" value={mixedCurrencyView ? 'By currency' : formatCurrency(stats.totalPnl)}
          icon={<Wallet size={19} />} trend={mixedCurrencyView ? 'neutral' : stats.totalPnl >= 0 ? 'up' : 'down'}
          trendValue={mixedCurrencyView ? 'See the currency breakdown above' : String(stats.totalTrades) + ' closed trades'} accent="blue" />
        <StatCard label="Win rate" value={formatPercent(stats.winRate)} icon={<Target size={19} />}
          sublabel={stats.wins + ' wins · ' + stats.losses + ' losses · ' + stats.breakevens + ' break-even'} accent="amber" />
        <StatCard label="Closed trades" value={String(stats.totalTrades)} icon={<Activity size={19} />}
          sublabel={String(trades.filter(item => item.status === 'open').length) + ' open trades in this view'} accent="emerald" />
        <StatCard label="Profit factor"
          value={mixedCurrencyView ? 'Choose account' : stats.profitFactor === Infinity ? '∞' : stats.profitFactor.toFixed(2)}
          icon={<TrendingUp size={19} />}
          sublabel={mixedCurrencyView ? 'Grouped by currency' : stats.totalTrades === 0 ? 'No closed trades yet' : 'Expectancy: ' + formatCurrency(stats.expectancy)}
          accent="blue" />
      </div>

      <div className="ym-dash-execution mb-6"><ExecutionSummaryCards trades={trades} /></div>

      {source === 'live' && <section id="ym-risk" className="ym-dash-section">
        <div className="ym-dash-section-title">
          <div><h2>Risk &amp; trading rules</h2></div>
          <span>Review limits before the next trade</span>
        </div>
        <div className="ym-dash-risk-area">
          <RiskGuardian trades={liveTrades} settings={settings} account={account} plan={accountPlan} onConfigure={() => setShowRiskSettings(true)} />
        </div>
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


      </section>}

      <section className="ym-dash-section" id="ym-performance">
        <div className="ym-dash-section-title">
          <div><h2>Performance trends</h2></div>
          <span>Results from closed trades</span>
        </div>
      <div className="ym-dash-charts grid grid-cols-1 xl:grid-cols-5 gap-4 mb-6">
        <div className="ym-dash-chart-card card p-4 sm:p-5 xl:col-span-3">
          <h3 className="text-sm font-semibold mb-1">Cumulative realized P&amp;L</h3><p className="ym-dash-chart-caption">Running total of realized exits, including partial closes.</p>
          {mixedCurrencyView ? <p className="py-20 text-center text-sm text-muted">Select one account to view cumulative closed P&L. Results in different currencies cannot be combined.</p> : equity.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={equity} margin={{ left: -10, right: 10, top: 5, bottom: 0 }}>
                <defs>
                  <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--brand)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="var(--brand)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} width={50} tickFormatter={value => Number(value).toLocaleString(undefined, { notation: 'compact', maximumFractionDigits: 1 })} />
                <Tooltip
                  contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 12 }}
                  formatter={(v) => [formatCurrency(Number(v)), 'Cumulative P&L']}
                />
                <Area type="monotone" dataKey="equity" stroke="var(--brand)" strokeWidth={2} fill="url(#equityGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState icon={<TrendingUp size={40} />} title="No equity data yet" message="Add your first trade to see your equity curve grow over time." />
          )}
        </div>

        <div className="ym-dash-chart-card card p-4 sm:p-5 xl:col-span-2">
          <h3 className="text-sm font-semibold mb-1">Last 7 days</h3><p className="ym-dash-chart-caption">Realized daily P&amp;L for current filters.</p>
          {mixedCurrencyView ? <p className="py-20 text-center text-sm text-muted">Choose one account to compare daily P&amp;L in a single currency.</p> : last7Days.some(d => d.trades > 0) ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={last7Days} margin={{ left: -10, right: 10, top: 5, bottom: 0 }}>
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} width={50} tickFormatter={value => Number(value).toLocaleString(undefined, { notation: 'compact', maximumFractionDigits: 1 })} />
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

      </section>



      <div className="mb-6"><ExecutionSessionSummary trades={trades} /></div>

      <section className="ym-dash-section" id="ym-recent">
        <div className="ym-dash-section-title">
          <div><h2>Recent trades</h2></div>
          <span>Open a trade to review its details</span>
        </div>
      <div className="ym-dash-recent-card card p-4 sm:p-5">
        {recentTrades.length > 0 ? (
          <>
            <div className="divide-y divide-themed sm:hidden">
              {recentTrades.map(trade => {
                const pnl = trade.status === 'open'
                  ? 'Pending'
                  : mixedCurrencyView
                    ? formatAccountMoney(trade.pnl, tradeCurrency(trade, accounts))
                    : formatCurrency(trade.pnl);
                const entered = new Date(trade.entry_time).toLocaleString(undefined, {
                  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                });
                return <button
                  key={trade.id}
                  type="button"
                  onClick={() => setSelectedTrade(trade)}
                  className="ym-mobile-trade w-full py-4 text-left transition-colors first:pt-1 last:pb-1"
                  aria-label={`Review ${trade.pair} ${trade.direction} trade, ${pnl}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="break-words text-sm font-semibold tracking-tight">{trade.pair}</p>
                      <p className="mt-1 flex items-center gap-1.5 text-[11px] text-secondary">
                        {trade.direction === 'long' ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                        <span>{trade.direction === 'long' ? 'Long' : 'Short'}</span>
                        <span className="text-muted" aria-hidden="true">·</span>
                        <span className="capitalize">{trade.status === 'open' ? 'Open' : trade.outcome || 'Closed'}</span>
                      </p>
                    </div>
                    <span className={`shrink-0 text-right text-sm font-semibold tabular-nums ${trade.status === 'open' ? 'text-secondary' : trade.pnl >= 0 ? 'text-success-500' : 'text-error-500'}`}>{pnl}</span>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[10px] text-muted">
                    <time dateTime={trade.entry_time}>{entered}</time>
                    <span className="tabular-nums">{executionMovement(trade)} · {formatHoldDuration(getExecutionMetrics(trade).duration_seconds)}</span>
                  </div>
                </button>;
              })}
            </div>
            <div className="hidden overflow-x-auto sm:block">
            <table className="ym-table w-full min-w-[680px] text-sm">
              <thead>
                <tr className="text-xs text-muted uppercase tracking-wide border-b border-themed">
                  <th className="text-left py-2 px-2 font-medium">Date</th>
                  <th className="text-left py-2 px-2 font-medium">Pair</th>
                  <th className="text-left py-2 px-2 font-medium">Dir</th>
                  <th className="text-left py-2 px-2 font-medium">Outcome</th>
                  <th className="text-right py-2 px-2 font-medium">P&L</th>
                  <th className="text-right py-2 px-2 font-medium">Movement / Hold</th>
                  <th className="text-right py-2 px-2 font-medium">View</th>
                </tr>
              </thead>
              <tbody>
                {recentTrades.map(t => (
                  <tr key={t.id} className="border-b border-themed/50 hover:bg-secondary transition-colors">
                    <td className="whitespace-nowrap py-2.5 px-2 text-xs text-muted"><time dateTime={t.entry_time}>{formatDateTime(t.entry_time)}</time></td>
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
                      {t.status === 'open' ? 'Pending' : mixedCurrencyView ? formatAccountMoney(t.pnl, tradeCurrency(t, accounts)) : account ? formatAccountMoney(t.pnl, account.base_currency) : formatCurrency(t.pnl)}
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono text-muted">{executionMovement(t)}<span className="block text-xs">{formatHoldDuration(getExecutionMetrics(t).duration_seconds)}</span></td>
                    <td className="py-2.5 px-2 text-right">
                      <button
                        type="button"
                        onClick={() => setSelectedTrade(t)}
                        className="btn-ghost p-2.5 rounded-full"
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
          </>
        ) : (
          <EmptyState icon={<Plus size={36} />} title="No trades yet" message="Click 'Add Trade' to log your first trade and start building your journal." />
        )}
      </div>

      </section>

      <details className="ym-dash-details" id="ym-deep-dive">
        <summary className="ym-dash-details-trigger">
          <span className="ym-dash-detail-icon"><BarChart3 size={19} /></span>
          <span className="ym-dash-detail-copy"><strong>Deep-dive analytics &amp; tools</strong><small>Streaks, best days, trade calculator, heatmap and coaching insights</small></span>
          <span className="ym-dash-expand-label">Explore insights</span>
          <ChevronDown className="ym-dash-detail-chevron" size={20} aria-hidden="true" />
        </summary>
        <div className="ym-dash-details-body">
          <div className="ym-dash-section-title"><div><h2>Consistency &amp; edge</h2></div></div>
          <div className="ym-dash-average-win">
            <StatCard label="Average winning trade" value={mixedCurrencyView ? 'By currency' : formatCurrency(stats.avgWin)}
              icon={<TrendingUp size={19} />}
              sublabel={mixedCurrencyView ? 'Select a single currency for averages' : 'Average loss: ' + formatCurrency(stats.avgLoss)}
              accent="emerald" />
          </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
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
          label="Net R coverage"
          value={String(trades.filter(t=>t.status==='closed' && getExecutionMetrics(t).realized_r!=null).length) + ' / ' + stats.totalTrades}
          icon={<Star size={20} className="text-amber-500" />}
          accent="amber"
        />
      </div>

          <div className="ym-dash-section-title"><div><h2>Trade calculator</h2></div></div>
      {/* Trade Calculator */}
      <div className="mb-6">
        <TradeCalculator trades={liveTrades} adjustments={adjustments} />
      </div>

          <div className="ym-dash-section-title"><div><h2>Patterns &amp; behavior</h2></div></div>
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

        </div>
      </details>

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
                  : formatAccountMoney(selectedTrade.pnl, tradeCurrency(selectedTrade, accounts))}
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
            <ExecutionMetricsPanel trade={selectedTrade} />
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
    <div className="rounded-xl border border-themed bg-secondary p-3">
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

