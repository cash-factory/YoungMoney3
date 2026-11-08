import { useState } from 'react';
import { Shield, Save, AlertTriangle, TrendingDown, Wallet, Percent, Gauge } from 'lucide-react';
import { useRiskSettings, useTrades } from '@/hooks/useData';
import { useAuth } from '@/context/AuthContext';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { LoadingSpinner, EmptyState } from '@/components/ui/Feedback';
import { StatCard } from '@/components/ui/StatCard';
import type { RiskSettingsInput } from '@/lib/types';
import { formatCurrency } from '@/lib/utils';
import { format, parseISO, subDays, isAfter } from 'date-fns';

export function RiskManagementPage() {
  const { user } = useAuth();
  const { settings, loading, saveSettings } = useRiskSettings(user?.id);
  const { trades } = useTrades(user?.id);
  const [form, setForm] = useState<RiskSettingsInput | null>(null);
  const [saving, setSaving] = useState(false);

  if (loading) return <LoadingSpinner label="Loading risk settings..." />;

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

  // Today's P&L and risk metrics
  const today = format(new Date(), 'yyyy-MM-dd');
  const todayTrades = trades.filter(t => t.status === 'closed' && format(parseISO(t.entry_time), 'yyyy-MM-dd') === today);
  const todayPnl = todayTrades.reduce((s, t) => s + t.pnl, 0);
  const todayLoss = -Math.min(0, todayPnl);
  const dailyLossLimit = current.daily_loss_limit_amount || (current.account_balance * current.max_daily_loss_pct / 100);
  const dailyLossPct = dailyLossLimit > 0 ? (todayLoss / dailyLossLimit) * 100 : 0;

  // 7-day rolling stats
  const sevenDaysAgo = subDays(new Date(), 7);
  const weekTrades = trades.filter(t => t.status === 'closed' && isAfter(parseISO(t.entry_time), sevenDaysAgo));
  const weekPnl = weekTrades.reduce((s, t) => s + t.pnl, 0);
  const weekLosses = weekTrades.filter(t => t.outcome === 'loss');
  const avgLoss = weekLosses.length ? Math.abs(weekLosses.reduce((s, t) => s + t.pnl, 0) / weekLosses.length) : 0;

  // Max drawdown calc
  let peak = 0, maxDD = 0, running = 0;
  const sortedClosed = [...trades].filter(t => t.status === 'closed').sort((a, b) => new Date(a.entry_time).getTime() - new Date(b.entry_time).getTime());
  sortedClosed.forEach(t => {
    running += t.pnl;
    if (running > peak) peak = running;
    const dd = peak - running;
    if (dd > maxDD) maxDD = dd;
  });

  const handleSave = async () => {
    setSaving(true);
    await saveSettings(current);
    setForm(null);
    setSaving(false);
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

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Today's P&L" value={formatCurrency(todayPnl)} icon={<Wallet size={20} />} accent={todayPnl >= 0 ? 'emerald' : 'rose'} trend={todayPnl >= 0 ? 'up' : 'down'} trendValue={formatCurrency(Math.abs(todayPnl))} />
        <StatCard label="Daily Loss Used" value={`${dailyLossPct.toFixed(1)}%`} icon={<AlertTriangle size={20} />} accent={dailyLossPct > 80 ? 'rose' : 'amber'} sublabel={`Limit: ${formatCurrency(dailyLossLimit)}`} />
        <StatCard label="Max Drawdown" value={formatCurrency(maxDD)} icon={<TrendingDown size={20} />} accent="rose" sublabel={`Limit: ${current.max_drawdown_pct}%`} />
        <StatCard label="7-Day P&L" value={formatCurrency(weekPnl)} icon={<Gauge size={20} />} accent={weekPnl >= 0 ? 'emerald' : 'amber'} sublabel={`${weekTrades.length} trades`} />
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
              {formatCurrency(todayLoss)} / {formatCurrency(dailyLossLimit)}
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

      {/* Risk Settings Form */}
      <div className="card p-6">
        <h2 className="text-base font-bold mb-4 flex items-center gap-2"><Shield size={18} className="text-brand-500" /> Risk Parameters</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <label className={labelCls}>Account Balance ($)</label>
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
            <label className={labelCls}>Daily Loss Limit ($)</label>
            <input type="number" className={inputCls} value={current.daily_loss_limit_amount ?? ''} onChange={e => update('daily_loss_limit_amount', e.target.value ? parseFloat(e.target.value) : null)} placeholder="Optional override" />
          </div>
        </div>

        {/* Calculated values */}
        <div className="mt-6 pt-4 border-t border-themed grid grid-cols-2 md:grid-cols-4 gap-4">
          <CalcBox label="Risk per Trade ($)" value={formatCurrency(current.account_balance * current.max_risk_per_trade_pct / 100)} icon={<Percent size={14} />} />
          <CalcBox label="Daily Loss Limit ($)" value={formatCurrency(current.daily_loss_limit_amount || current.account_balance * current.max_daily_loss_pct / 100)} icon={<AlertTriangle size={14} />} />
          <CalcBox label="Max Drawdown ($)" value={formatCurrency(current.account_balance * current.max_drawdown_pct / 100)} icon={<TrendingDown size={14} />} />
          <CalcBox label="Avg Loss (7d)" value={formatCurrency(avgLoss)} icon={<Gauge size={14} />} />
        </div>
      </div>

      {trades.length === 0 && (
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
