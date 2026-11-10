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
  const isNumeric = /^-?\d+(?:\.\d+)?$/.test(value.trim());
  const numericValue = isNumeric ? Number(value) : 0;
  const decimals = isNumeric && value.includes('.') ? value.split('.')[1].length : 0;

  return (
    <section aria-label={label} className="ym-stat-card card relative overflow-hidden p-4 sm:p-5" data-accent={accent}>
      <div className="flex items-start justify-between relative">
        <div className="min-w-0">
          <p className="ym-stat-label text-xs font-medium text-secondary">{label}</p>
          <p className="ym-stat-value mt-3 text-[clamp(1.35rem,2.7vw,2rem)] font-semibold tracking-tight tabular-nums break-words">
            {isNumeric ? <AnimatedCounter value={numericValue} format={v => decimals ? v.toFixed(decimals) : Math.round(v).toLocaleString()} /> : value}
          </p>
          {sublabel && <p className="mt-2 text-[11px] leading-relaxed text-muted break-words">{sublabel}</p>}
        </div>
        {icon && (
          <div className="relative">
            <div className={`ym-stat-icon p-2 rounded-lg icon-bg-${accent}`}>
              {icon}
            </div>
          </div>
        )}
      </div>
      {trend && trendValue && (
        <div className="mt-4 flex items-center gap-1.5 relative border-t border-themed pt-3">
          <span className={`text-xs font-semibold ${trend === 'up' ? 'text-success-500' : trend === 'down' ? 'text-error-500' : 'text-muted'}`}>
            {trend === 'up' ? '↑' : trend === 'down' ? '↓' : '—'} {trendValue}
          </span>
        </div>
      )}
    </section>
  );
}
