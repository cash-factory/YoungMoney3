import type { ReactNode } from 'react';
import { usePageExperience } from '@/context/PageExperienceContext';

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}

export function SectionHeader({ title, subtitle, action }: SectionHeaderProps) {
  const experience = usePageExperience();
  return (
    <div className={`ym-section-header flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-6 ${experience ? 'ym-page-heading' : ''}`}>
      <div className="min-w-0">
        {experience && <p className="ym-page-chapter">{experience.chapter}</p>}
        <div className="flex items-center gap-3">
          <span className="ym-section-rule" aria-hidden="true" />
          <h1 className="text-[1.55rem] sm:text-[1.75rem] font-bold tracking-[-0.045em] leading-tight">{title}</h1>
        </div>
        {subtitle && <p className="mt-2 text-[13px] sm:text-sm text-secondary">{subtitle}</p>}
        {experience && <p className="ym-page-cue">{experience.cue}</p>}
      </div>
      {experience?.art && <div className="ym-page-art" aria-hidden="true"><img src={`/visuals/${experience.art}`} alt="" /></div>}
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
