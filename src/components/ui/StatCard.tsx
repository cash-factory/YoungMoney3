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
  const isNumeric = !isNaN(numericValue) && isFinite(numericValue);

  return (
    <div
      className="card p-5 relative overflow-hidden"
    >
      <div className="flex items-start justify-between relative">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-muted uppercase tracking-wider">{label}</p>
          <p className="mt-2 text-2xl font-bold font-mono tracking-tight">
            {isNumeric ? <AnimatedCounter value={numericValue} /> : value}
          </p>
          {sublabel && <p className="mt-1 text-xs text-muted truncate">{sublabel}</p>}
        </div>
        {icon && (
          <div className="relative">
            <div className={`p-2.5 rounded-xl border border-themed icon-bg-${accent}`}>
              {icon}
            </div>
          </div>
        )}
      </div>
      {trend && trendValue && (
        <div className="mt-3 flex items-center gap-1.5 relative">
          <span className={`text-xs font-semibold ${trend === 'up' ? 'text-success-500' : trend === 'down' ? 'text-error-500' : 'text-muted'}`}>
            {trend === 'up' ? '↑' : trend === 'down' ? '↓' : '—'} {trendValue}
          </span>
        </div>
      )}
    </div>
  );
}
