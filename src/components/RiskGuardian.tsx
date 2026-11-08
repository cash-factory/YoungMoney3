import { useMemo } from 'react';
import { Shield, AlertTriangle, TrendingDown, Activity, Gauge, Target, Zap, AlertOctagon } from 'lucide-react';
import type { Trade, RiskSettings, TradingAccount, TradingPlan } from '@/lib/types';
import { formatPercent } from '@/lib/utils';
import { calculateRiskMetrics } from '@/lib/riskMetrics';

interface RiskGuardianProps {
  trades: Trade[];
  settings: RiskSettings | null;
  account: TradingAccount | null;
  plan: TradingPlan | null;
  onConfigure: () => void;
}

export function RiskGuardian({ trades, settings, account, plan, onConfigure }: RiskGuardianProps) {
  const riskData = useMemo(() => {
    if (!account) return null;
    const strictest = (values: (number | null | undefined)[], fallback: number) => {
      const configured = values.filter((value): value is number => value != null && Number.isFinite(value) && value > 0);
      return configured.length ? Math.min(...configured) : fallback;
    };
    const maxDailyLossPct = strictest([account.daily_loss_limit_pct, plan?.max_daily_loss_pct, settings?.max_daily_loss_pct], 3);
    const maxRiskPerTradePct = strictest([account.risk_per_trade_pct, plan?.max_risk_per_trade_pct, settings?.max_risk_per_trade_pct], 1);
    const maxDrawdownPct = strictest([account.max_loss_limit_pct, plan?.max_drawdown_pct, settings?.max_drawdown_pct], 10);
    const maxDailyLossAmount = account.base_currency === 'USD' ? settings?.daily_loss_limit_amount : null;
    return calculateRiskMetrics(trades, {
      accountId: account.id,
      accountBalance: account.balance,
      timeZone: account.challenge_reset_timezone || 'UTC',
      maxDailyLossPct,
      maxDailyLossAmount,
      maxDailyTrades: settings?.max_daily_trades ?? 5,
      maxRiskPerTradePct,
      maxDrawdownPct,
    });
  }, [trades, settings, account, plan]);

  const formatMoney = (value: number) => new Intl.NumberFormat(undefined, {
    style: 'currency', currency: account?.base_currency || 'USD', maximumFractionDigits: 2,
  }).format(value);

  if (!account || !riskData) {
    return <div className="card p-5 text-sm text-secondary">Select a single account to view account-specific risk metrics.</div>;
  }

  const statusConfig = {
    safe: {
      color: 'text-success-500',
      bg: 'bg-success-500/5',
      border: 'border-success-500/20',
      barColor: 'bg-success-500',
      icon: Shield,
      label: 'Within Limits',
    },
    warning: {
      color: 'text-warning-500',
      bg: 'bg-warning-500/5',
      border: 'border-warning-500/20',
      barColor: 'bg-warning-500',
      icon: AlertTriangle,
      label: 'Approaching Limits',
    },
    danger: {
      color: 'text-error-500',
      bg: 'bg-error-500/5',
      border: 'border-error-500/20',
      barColor: 'bg-error-500',
      icon: AlertOctagon,
      label: 'Limit Reached — Review Before Next Entry',
    },
  };

  const cfg = statusConfig[riskData.status];
  const StatusIcon = cfg.icon;

  return (
    <div className={`card p-5 border ${cfg.border} ${cfg.bg}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2.5">
          <div className={`p-2 rounded-xl ${cfg.bg} ${cfg.border} border`}>
            <Shield size={18} className={cfg.color} />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Risk Guardian</h3>
            <p className="text-[11px] text-muted">Daily loss limits & drawdown protection</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`badge ${riskData.status === 'safe' ? 'badge-success' : riskData.status === 'warning' ? 'badge-warning' : 'badge-error'}`}>
            <StatusIcon size={12} />
            {cfg.label}
          </span>
          <button onClick={onConfigure} className="btn-ghost text-xs px-2 py-1">
            <Gauge size={14} /> Settings
          </button>
        </div>
      </div>

      {/* Danger alert */}
      {riskData.status === 'danger' && (
        <div className="mb-4 p-3 rounded-xl bg-error-500/10 border border-error-500/30 flex items-start gap-2.5 animate-slide-up">
          <AlertOctagon size={18} className="text-error-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-error-500">
              {riskData.dailyLossPctUsed >= 100
                ? 'Daily loss limit reached'
                : riskData.todayTradeCount >= riskData.maxDailyTrades
                  ? 'Daily entry limit reached'
                  : 'Maximum drawdown reached'}
            </p>
            <p className="text-xs text-secondary mt-0.5">
              This is an advisory based on recorded trades, not a broker-side lock. Review the account rules before considering another entry.
            </p>
          </div>
        </div>
      )}

      {/* Daily Loss Meter */}
      <div className="mb-5">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <TrendingDown size={15} className="text-muted" />
            <span className="text-xs font-semibold text-secondary uppercase tracking-wide">Daily Loss Limit</span>
          </div>
          <span className="text-xs font-mono font-bold">
            {formatMoney(riskData.dailyLossUsed)} / {formatMoney(riskData.dailyLossLimitAmount)}
          </span>
        </div>
        <div className="h-3 rounded-full bg-secondary overflow-hidden relative">
          <div
            className={`h-full rounded-full transition-all duration-700 ${cfg.barColor}`}
            style={{ width: `${Math.min(riskData.dailyLossPctUsed, 100)}%` }}
          />
          {/* Threshold markers */}
          <div className="absolute top-0 bottom-0 w-px bg-warning-500/40" style={{ left: '70%' }} />
          <div className="absolute top-0 bottom-0 w-px bg-error-500/40" style={{ left: '100%' }} />
        </div>
        <div className="flex items-center justify-between mt-1.5">
          <span className={`text-xs font-semibold ${riskData.dailyLossRemaining > 0 ? 'text-success-500' : 'text-error-500'}`}>
            {riskData.dailyLossRemaining > 0
              ? `${formatMoney(riskData.dailyLossRemaining)} remaining today`
              : 'Limit exceeded'}
          </span>
          <span className="text-xs text-muted">{formatPercent(riskData.dailyLossPctUsed)} used</span>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* Trades today */}
        <div className="p-3 rounded-xl bg-secondary border border-themed">
          <div className="flex items-center gap-1.5 mb-1">
            <Activity size={13} className="text-muted" />
            <span className="text-[10px] font-semibold text-muted uppercase">Trades Today</span>
          </div>
          <p className="text-lg font-bold font-mono">
            {riskData.todayTradeCount}
            <span className="text-xs text-muted"> / {riskData.maxDailyTrades}</span>
          </p>
          {riskData.undatedCloseCount > 0 && <p role="alert" className="text-xs text-warning-500">{riskData.undatedCloseCount} closed trades need an exit time before daily risk is complete.</p>}
          <p className="text-[10px] text-muted">{riskData.openTradeCount} currently open</p>
          <div className="h-1 rounded-full bg-secondary mt-2 overflow-hidden">
            <div
              className={`h-full rounded-full ${riskData.todayTradeCount >= riskData.maxDailyTrades ? 'bg-error-500' : riskData.todayTradeCount >= riskData.maxDailyTrades - 1 ? 'bg-warning-500' : 'bg-brand-500'}`}
              style={{ width: `${Math.min((riskData.todayTradeCount / riskData.maxDailyTrades) * 100, 100)}%` }}
            />
          </div>
        </div>

        {/* Today P&L */}
        <div className="p-3 rounded-xl bg-secondary border border-themed">
          <div className="flex items-center gap-1.5 mb-1">
            <Target size={13} className="text-muted" />
            <span className="text-[10px] font-semibold text-muted uppercase">Today P&L</span>
          </div>
          <p className={`text-lg font-bold font-mono ${riskData.todayPnl >= 0 ? 'text-success-500' : 'text-error-500'}`}>
            {formatMoney(riskData.todayPnl)}
          </p>
        </div>

        {/* Max risk per trade */}
        <div className="p-3 rounded-xl bg-secondary border border-themed">
          <div className="flex items-center gap-1.5 mb-1">
            <Zap size={13} className="text-muted" />
            <span className="text-[10px] font-semibold text-muted uppercase">Max Risk / Trade</span>
          </div>
          <p className="text-lg font-bold font-mono">
            {formatPercent(riskData.maxRiskPerTradePct)}
          </p>
          <p className={`text-[10px] mt-0.5 ${riskData.maxRiskUsedToday > riskData.maxRiskPerTradePct ? 'text-error-500 font-semibold' : 'text-muted'}`}>
            {riskData.maxRiskUsedToday > 0 ? `Today max: ${formatPercent(riskData.maxRiskUsedToday)}` : 'No risk data today'}
          </p>
        </div>

        {/* Current drawdown */}
        <div className="p-3 rounded-xl bg-secondary border border-themed">
          <div className="flex items-center gap-1.5 mb-1">
            <TrendingDown size={13} className="text-muted" />
            <span className="text-[10px] font-semibold text-muted uppercase">Drawdown</span>
          </div>
          <p className={`text-lg font-bold font-mono ${riskData.currentDrawdownPct >= riskData.maxDrawdownPctLimit * 0.8 ? 'text-error-500' : riskData.currentDrawdownPct > 0 ? 'text-warning-500' : 'text-success-500'}`}>
            {formatPercent(riskData.currentDrawdownPct)}
          </p>
          <p className="text-[10px] text-muted mt-0.5">
            Max: {formatPercent(riskData.maxDrawdownPct)} · Limit: {formatPercent(riskData.maxDrawdownPctLimit)}
          </p>
        </div>
      </div>

      {/* Today's date */}
      <p className="mt-4 text-[10px] text-muted text-center">{account.name} · {account.base_currency} · Reset timezone: {riskData.timeZone}</p>
    </div>
  );
}
