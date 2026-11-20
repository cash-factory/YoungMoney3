import type { ReactNode } from 'react';
import { usePageExperience } from '@/context/PageExperienceContext';

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}

/**
 * The real page title, supporting copy and actions stay in the document.
 * Artwork is decorative and fades into the shared page surface. Copy and
 * actions keep a reserved foreground area so the heading remains readable.
 */
export function SectionHeader({ title, subtitle, action }: SectionHeaderProps) {
  const experience = usePageExperience();
  return (
    <header className={`ym-section-header ${experience ? 'ym-page-heading' : 'flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-6'}`}>
      <div className="ym-page-heading-main">
        <div className="ym-page-heading-copy">
          {experience && <p className="ym-page-chapter">{experience.chapter.replace(/^(?:\d+\s*\/|Workspace\s*\/)\s*/, '')}</p>}
          <div className="flex items-center gap-3">
            <span className="ym-section-rule" aria-hidden="true" />
            <h1 className="text-[1.55rem] sm:text-[1.75rem] font-bold tracking-[-0.045em] leading-tight">{title}</h1>
          </div>
          {subtitle && <p className="mt-2 text-[13px] sm:text-sm text-secondary">{subtitle}</p>}
          {experience && !subtitle && <p className="ym-page-cue">{experience.cue}</p>}
        </div>
        {action && <div className="ym-page-heading-actions">{action}</div>}
      </div>
      {experience?.art && <div className="ym-page-art" aria-hidden="true">
        <img src={experience.art} alt="" loading="lazy" decoding="async" width="960" height="540" />
        <span className="ym-page-art-cut" aria-hidden="true" />
      </div>}
    </header>
  );
}
