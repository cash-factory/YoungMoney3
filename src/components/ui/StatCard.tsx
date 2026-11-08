import { type ReactNode } from 'react';
import { AnimatedCounter } from '@/components/ui/AnimatedCounter';

interface StatCardProps {
  label: string;
  value: string;
  sublabel?: string;
  icon?: ReactNode;
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
  accent?: 'blue' | 'emerald' | 'amber' | 'rose';
}

export function StatCard({ label, value, sublabel, icon, trend, trendValue, accent = 'blue' }: StatCardProps) {
  const numericValue = parseFloat(value);
  const isNumeric = !Number.isNaN(numericValue) && Number.isFinite(numericValue);

  return (
    <div className={`card premium-stat-card metric-accent-${accent} relative overflow-hidden p-5`}>
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-muted">{label}</p>
          <p className="mt-3 break-words font-mono text-2xl font-bold tracking-tight tabular-nums sm:text-[1.75rem]">
            {isNumeric ? <AnimatedCounter value={numericValue} /> : value}
          </p>
          {sublabel && <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted">{sublabel}</p>}
        </div>
        {icon && <div className="premium-stat-icon grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-themed">
          {icon}
        </div>}
      </div>
      {trend && trendValue && <div className="relative mt-4 flex items-center gap-2 border-t border-themed pt-3">
        <span className={`text-xs font-semibold ${trend === 'up' ? 'text-success-500' : trend === 'down' ? 'text-error-500' : 'text-muted'}`}>
          {trend === 'up' ? '↑' : trend === 'down' ? '↓' : '—'} {trendValue}
        </span>
      </div>}
    </div>
  );
}
