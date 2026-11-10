import { useMemo, useState } from 'react';
import Decimal from 'decimal.js-light';
import { Shield, Save, AlertTriangle, TrendingDown, Wallet, Percent, Gauge } from 'lucide-react';
import { useRiskSettings, useTrades, useTradingAccounts, useTradingPlans } from '@/hooks/useData';
import { useAuth } from '@/context/AuthContext';
import { useMt5Lifecycles } from '@/hooks/useMt5Lifecycles';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { LoadingSpinner, EmptyState } from '@/components/ui/Feedback';
import { StatCard } from '@/components/ui/StatCard';
import type { RiskSettingsInput } from '@/lib/types';
import { formatCurrency } from '@/lib/utils';
import { accountRiskOptions } from '@/lib/riskPolicy';
import { calculateRiskMetrics } from '@/lib/riskMetrics';
import { parseISO, subDays, isAfter } from 'date-fns';

export function RiskManagementPage() {
  const { user } = useAuth();
  const { settings, loading, saveSettings } = useRiskSettings(user?.id);
  const { trades } = useTrades(user?.id);
  const { positions } = useMt5Lifecycles(user?.id);
  // Open broker exposure must never be masked by a journal source filter.
  const brokerExposure = useMemo(() => {
    const open = positions.filter(item=>item.summary.status==='open');
    return open.map(item=>{
      const amount=item.summary.current_stop_exposure_account;
      const initial=item.summary.initial_risk_account;
      const currency=item.summary.settlement_currency || 'Unknown';
      const valid=(x:string|null|undefined) => {
        if(x==null || !/^-?\d+(?:\.\d+)?$/.test(x))return null;
        return new Decimal(x);
      };
      return {...item,
        currentExposure:valid(amount), initialRisk:valid(initial), currency};
    });
  },[positions]);
  const riskByAccount = useMemo(()=>{
    const rows=new Map<string,{currency:string;total:Decimal;initial:Decimal;unknown:number;open:number}>();
    for(const entry of brokerExposure){
      const key=entry.account_id+'|'+entry.currency;
      const prior=rows.get(key)||{currency:entry.currency,total:new Decimal(0),initial:new Decimal(0),unknown:0,open:0};
      prior.open++;
      if(entry.currentExposure===null)prior.unknown++;
      else prior.total=prior.total.plus(entry.currentExposure);
      if(entry.initialRisk!==null)prior.initial=prior.initial.plus(entry.initialRisk);
      rows.set(key,prior);
    }
    return [...rows.entries()].map(([key,record])=>({accountId:key.split('|')[0],...record}));
  },[brokerExposure]);
  const { accounts, loading: accountsLoading } = useTradingAccounts(user?.id);
  const { plans } = useTradingPlans(user?.id);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [form, setForm] = useState<RiskSettingsInput | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  if (loading || accountsLoading) return <LoadingSpinner label="Loading risk settings..." />;

  const current = form || (settings ? {
    max_daily_loss_pct: settings.max_daily_loss_pct,
    max_daily_trades: settings.max_daily_trades,
    max_risk_per_trade_pct: settings.max_risk_per_trade_pct,
    account_balance: settings.account_balance,
    max_drawdown_pct: settings.max_drawdown_pct,
    daily_loss_limit_amount: settings.daily_loss_limit_amount,
  } : {
    max_daily_loss_pct: 5,
    max_daily_trades: 5,
    max_risk_per_trade_pct: 2,
    account_balance: 10000,
    max_drawdown_pct: 20,
    daily_loss_limit_amount: null,
  });

  // Use the same account limits, close-date and reset-timezone rules as Risk Guardian.
  // Portfolio-wide totals are intentionally not combined across settlement currencies.
  const account = accounts.find(item => item.id === selectedAccountId) || accounts[0] || null;
  const plan = plans.find(item => item.id === account?.default_plan_id) || null;
  const metrics = account ? calculateRiskMetrics(trades, accountRiskOptions(account, current, plan)) : null;
  const accountTrades = account ? trades.filter(trade => trade.account_id === account.id) : [];
  const todayPnl = metrics?.todayPnl ?? 0;
  const todayLoss = metrics?.dailyLossUsed ?? 0;
  const dailyLossLimit = metrics?.dailyLossLimitAmount ?? 0;
  const dailyLossPct = metrics?.dailyLossPctUsed ?? 0;
  const maxDD = metrics?.maxDrawdown ?? 0;
  const formatMoney = (value: number) => new Intl.NumberFormat(undefined, {
    style: 'currency', currency: account?.base_currency || 'USD', maximumFractionDigits: 2,
  }).format(value);

  const sevenDaysAgo = subDays(new Date(), 7);
  const weekTrades = accountTrades.filter(trade => trade.status === 'closed'
    && !!trade.exit_time && isAfter(parseISO(trade.exit_time), sevenDaysAgo));
  const weekPnl = weekTrades.reduce((sum, trade) => sum + trade.pnl, 0);
  const weekLosses = weekTrades.filter(trade => trade.outcome === 'loss');
  const avgLoss = weekLosses.length ? Math.abs(weekLosses.reduce((sum, trade) => sum + trade.pnl, 0) / weekLosses.length) : 0;

  const handleSave = async () => {
    setSaving(true);
    setSaveError('');
    try {
      await saveSettings(current);
      setForm(null);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Could not save risk settings.');
    } finally {
      setSaving(false);
    }
  };

  const update = (field: keyof RiskSettingsInput, value: number | null) => {
    setForm({ ...current, [field]: value });
  };

  const inputCls = 'input-field';
  const labelCls = 'block text-xs font-semibold text-secondary mb-1.5';

  return (
    <div>
      <SectionHeader
        title="Risk Management"
        subtitle="Configure your risk parameters and monitor your daily exposure"
        action={
          <button onClick={handleSave} disabled={saving} className="btn-primary">
            <Save size={18} /> {saving ? 'Saving...' : 'Save Settings'}
          </button>
        }
      />

      <div className="card p-4 mb-6">
        <label className="block max-w-sm text-xs font-semibold text-secondary">Risk view by account
          <select className="input-field mt-1.5" value={account?.id || ''} onChange={event => setSelectedAccountId(event.target.value)}>
            {accounts.length === 0 && <option value="">No accounts configured</option>}
            {accounts.map(item => <option key={item.id} value={item.id}>{item.name} · {item.base_currency}</option>)}
          </select>
        </label>
        <p className="mt-2 text-xs text-muted">Realized results use the selected account's close date and reset timezone. Global settings are defaults; account and plan limits can be stricter.</p>
      </div>
      {riskByAccount.length > 0 && <section className="card p-4 sm:p-5 mb-6" aria-label="Account-wide broker stop exposure">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-bold">Open broker positions &amp; stop exposure</h2>
          <span className="badge badge-neutral">All open MT5 lifecycles, independent of journal source filters</span>
        </div>
        <p className="text-xs text-muted mt-2 mb-4">These are account-specific stop-risk estimates calculated from frozen entry tranches and last observed stops. An unknown stop or tick value remains unavailable. No currencies are combined.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {riskByAccount.map(group=><div key={group.accountId+'-'+group.currency} className="rounded-xl bg-secondary border border-themed p-3">
            <p className="text-xs text-secondary">{accounts.find(a=>a.id===group.accountId)?.name || 'Broker account'} · {group.currency}</p>
            <p className="font-mono text-xl font-bold mt-2">{group.total.toDecimalPlaces(2).toFixed(2)}</p>
            <p className="text-xs text-muted">Known current exposure · {group.open} open lifecycles</p>
            <p className="text-xs text-muted mt-2">Original risk (known positions): {group.initial.toDecimalPlaces(2).toFixed(2)}</p>
            {group.unknown>0 && <p role="status" className="text-xs text-error-500 mt-2">{group.unknown} open lifecycles with unavailable current stop risk — displayed total is incomplete.</p>}
          </div>)}
        </div>
      </section>}
      {saveError && <p className="mb-4 text-sm text-error-500" role="alert">{saveError}</p>
      {account ? <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Today's P&L" value={formatMoney(todayPnl)} icon={<Wallet size={20} />} accent={todayPnl >= 0 ? 'emerald' : 'rose'} trend={todayPnl >= 0 ? 'up' : 'down'} trendValue={formatMoney(Math.abs(todayPnl))} />
        <StatCard label="Daily Loss Used" value={`${dailyLossPct.toFixed(1)}%`} icon={<AlertTriangle size={20} />} accent={dailyLossPct > 80 ? 'rose' : 'amber'} sublabel={`Limit: ${formatMoney(dailyLossLimit)}`} />
        <StatCard label="Max Drawdown" value={formatMoney(maxDD)} icon={<TrendingDown size={20} />} accent="rose" sublabel={`Limit: ${current.max_drawdown_pct}%`} />
        <StatCard label="7-Day P&L" value={formatMoney(weekPnl)} icon={<Gauge size={20} />} accent={weekPnl >= 0 ? 'emerald' : 'amber'} sublabel={`${weekTrades.length} trades`} />
      </div>

      {/* Daily loss progress bar */}
      {dailyLossPct > 0 && (
        <div className="card p-4 mb-6">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold flex items-center gap-2">
              <AlertTriangle size={16} className={dailyLossPct > 80 ? 'text-error-500' : 'text-warning-500'} />
              Daily Loss Limit
            </p>
            <span className={`text-sm font-mono ${dailyLossPct > 80 ? 'text-error-500' : 'text-secondary'}`}>
              {formatMoney(todayLoss)} / {formatMoney(dailyLossLimit)}
            </span>
          </div>
          <div className="h-3 rounded-full bg-secondary overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${dailyLossPct > 80 ? 'bg-gradient-to-r from-error-500 to-error-600' : 'bg-gradient-to-r from-warning-400 to-warning-500'}`}
              style={{ width: `${Math.min(100, dailyLossPct)}%` }}
            />
          </div>
          {dailyLossPct > 80 && (
            <p className="mt-2 text-xs text-error-500 font-semibold">You are approaching your daily loss limit. Consider stopping for the day.</p>
          )}
        </div>
      )}

      </> : <div className="card p-4 mb-6 text-sm text-secondary">Add a trading account to see currency-specific daily loss and drawdown metrics.</div>}

      {/* Risk Settings Form */}
      <div className="card p-6">
        <h2 className="text-base font-bold mb-4 flex items-center gap-2"><Shield size={18} className="text-brand-500" /> Workspace Risk Defaults</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <label className={labelCls}>Reference Balance (USD)</label>
            <input type="number" className={inputCls} value={current.account_balance} onChange={e => update('account_balance', parseFloat(e.target.value) || 0)} />
          </div>
          <div>
            <label className={labelCls}>Max Risk Per Trade (%)</label>
            <input type="number" step="0.1" className={inputCls} value={current.max_risk_per_trade_pct} onChange={e => update('max_risk_per_trade_pct', parseFloat(e.target.value) || 0)} />
          </div>
          <div>
            <label className={labelCls}>Max Daily Loss (%)</label>
            <input type="number" step="0.1" className={inputCls} value={current.max_daily_loss_pct} onChange={e => update('max_daily_loss_pct', parseFloat(e.target.value) || 0)} />
          </div>
          <div>
            <label className={labelCls}>Max Daily Trades</label>
            <input type="number" className={inputCls} value={current.max_daily_trades} onChange={e => update('max_daily_trades', parseInt(e.target.value) || 0)} />
          </div>
          <div>
            <label className={labelCls}>Max Drawdown (%)</label>
            <input type="number" step="0.1" className={inputCls} value={current.max_drawdown_pct} onChange={e => update('max_drawdown_pct', parseFloat(e.target.value) || 0)} />
          </div>
          <div>
            <label className={labelCls}>Daily Loss Limit (USD)</label>
            <input type="number" className={inputCls} value={current.daily_loss_limit_amount ?? ''} onChange={e => update('daily_loss_limit_amount', e.target.value ? parseFloat(e.target.value) : null)} placeholder="Optional override" />
          </div>
        </div>

        <p className="mt-3 text-xs text-muted">Reference balance and USD amount are workspace-level settings; the selected account's actual balance, currency, and stricter limits determine its risk readout.</p>
        <div className="mt-6 pt-4 border-t border-themed grid grid-cols-2 md:grid-cols-4 gap-4">
          <CalcBox label="Risk per Trade" value={account && metrics ? formatMoney(account.balance * metrics.maxRiskPerTradePct / 100) : formatCurrency(current.account_balance * current.max_risk_per_trade_pct / 100)} icon={<Percent size={14} />} />
          <CalcBox label="Daily Loss Limit" value={account ? formatMoney(dailyLossLimit) : formatCurrency(current.daily_loss_limit_amount ?? current.account_balance * current.max_daily_loss_pct / 100)} icon={<AlertTriangle size={14} />} />
          <CalcBox label="Max Drawdown Limit" value={account && metrics ? formatMoney(account.balance * metrics.maxDrawdownPctLimit / 100) : formatCurrency(current.account_balance * current.max_drawdown_pct / 100)} icon={<TrendingDown size={14} />} />
          <CalcBox label="Avg Loss (7d)" value={account ? formatMoney(avgLoss) : 'Select account'} icon={<Gauge size={14} />} />
        </div>
      </div>

      {account && accountTrades.length === 0 && (
        <div className="mt-6">
          <div className="card p-6">
            <EmptyState icon={<Wallet size={36} />} title="No trade data yet" message="Once you start logging trades, your risk dashboard will show daily exposure, drawdown, and loss tracking." />
          </div>
        </div>
      )}
    </div>
  );
}

function CalcBox({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="p-3 rounded-lg bg-secondary/50">
      <p className="text-[10px] text-muted uppercase tracking-wider flex items-center gap-1">{icon} {label}</p>
      <p className="text-base font-bold font-mono mt-1">{value}</p>
    </div>
  );
}
