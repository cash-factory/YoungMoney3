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
    <div className={`card editorial-stat metric-accent-${accent} relative p-5`}>
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold tracking-[0.025em] text-secondary">{label}</p>
          <p className="mt-3 break-words font-mono text-2xl font-semibold tracking-tight tabular-nums sm:text-[1.65rem]">
            {isNumeric ? <AnimatedCounter value={numericValue} /> : value}
          </p>
          {sublabel && <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted">{sublabel}</p>}
        </div>
        {icon && <div className="editorial-stat-icon grid h-9 w-9 shrink-0 place-items-center rounded-md">
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
