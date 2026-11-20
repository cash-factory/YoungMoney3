import type { ReactNode } from 'react';

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}

export function SectionHeader({ title, subtitle, action }: SectionHeaderProps) {
  return (
    <div className="ym-section-header flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-6">
      <div className="min-w-0">
        <div className="flex items-center gap-3">
          <h1 className="ym-section-title text-[1.6rem] sm:text-[1.9rem] font-semibold tracking-[-0.045em] leading-tight">{title}</h1>
        </div>
        {subtitle && <p className="ym-section-subtitle mt-2 max-w-2xl text-[13px] sm:text-sm text-secondary leading-relaxed">{subtitle}</p>}
      </div>
      {action && <div className="ym-section-actions flex flex-wrap items-center gap-2 shrink-0">{action}</div>}
    </div>
  );
}
