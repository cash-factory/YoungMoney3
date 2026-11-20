import type { ReactNode } from 'react';
import { ExperienceContext, type Experience } from '@/context/PageExperienceContext';
import type { PageId } from './Layout';

const experiences: Record<PageId, Experience> = {
  dashboard: { chapter: 'The desk', cue: 'One focus at a time', variant: 'desk', art: '/assets/page-art/dashboard.svg' },
  trades: { chapter: '01 / Execution ledger', cue: 'Capture · manage · close', variant: 'ledger', art: '/assets/page-art/trades.svg' },
  journal: { chapter: '02 / Reflection room', cue: 'Observe. Reflect. Improve.', variant: 'journal', art: '/assets/page-art/journal.svg' },
  calendar: { chapter: '03 / Session calendar', cue: 'Your trading rhythm', variant: 'calendar', art: '/assets/page-art/calendar.svg' },
  'weekly-reviews': { chapter: '04 / Weekly debrief', cue: 'Turn experience into a better process', variant: 'review', art: '/assets/page-art/weekly-reviews.svg' },
  'trading-plan': { chapter: '05 / The blueprint', cue: 'Intent before execution', variant: 'blueprint', art: '/assets/page-art/trading-plan.svg' },
  strategies: { chapter: '06 / Strategy workshop', cue: 'Plan → strategy → entry → checklist', variant: 'workshop', art: '/assets/page-art/strategies.svg' },
  setups: { chapter: '07 / Setup collection', cue: 'Recognise your best opportunities', variant: 'gallery', art: '/assets/page-art/setups.svg' },
  'risk-management': { chapter: '08 / Risk control', cue: 'Protect the account. Respect the limits.', variant: 'risk', art: '/assets/page-art/risk-management.svg' },
  goals: { chapter: '09 / Progress board', cue: 'Small actions. Measurable progress.', variant: 'progress', art: '/assets/page-art/goals.svg' },
  'market-sessions': { chapter: '10 / Session clock', cue: 'Stay in sync with the market', variant: 'sessions', art: '/assets/page-art/market-sessions.svg' },
  'strategy-testing': { chapter: '11 / Research lab', cue: 'Hypothesis → evidence → decision', variant: 'lab', art: '/assets/page-art/strategy-testing.svg' },
  'brokers-charting': { chapter: '12 / Account centre', cue: 'Connections, balances and context', variant: 'accounts', art: '/assets/page-art/brokers-charting.svg' },
  analytics: { chapter: '13 / Performance studio', cue: 'Find the signal in your results', variant: 'analysis', art: '/assets/page-art/analytics.svg' },
  ai: { chapter: '14 / Insight room', cue: 'Patterns worth a closer look', variant: 'insight', art: '/assets/page-art/ai.svg' },
  media: { chapter: '15 / Media archive', cue: 'Every capture has a story', variant: 'media', art: '/assets/page-art/media.svg' },
  resources: { chapter: '16 / Reference shelf', cue: 'Keep useful knowledge close', variant: 'reference', art: '/assets/page-art/resources.svg' },
  notes: { chapter: '17 / Field notes', cue: 'Make room for your next idea', variant: 'notes', art: '/assets/page-art/notes.svg' },
  'study-material': { chapter: '18 / Learning space', cue: 'Build a deeper understanding', variant: 'study', art: '/assets/page-art/study-material.svg' },
  'account-settings': { chapter: 'Workspace / Preferences', cue: 'Make this space yours', variant: 'settings', art: '/assets/page-art/account-settings.svg' },
  'admin-operations': { chapter: 'Workspace / Administration', cue: 'Workspace access and operations', variant: 'operations', art: '/assets/page-art/admin-operations.svg' },
  mt5: { chapter: 'Workspace / Connection bridge', cue: 'Bring execution into focus', variant: 'connections', art: '/assets/page-art/mt5.svg' },
  'workspace-setup': { chapter: 'Workspace / Getting started', cue: 'Build your trading foundation', variant: 'setup', art: '/assets/page-art/workspace-setup.svg' },
};

export function PageExperience({ page, children }: { page: PageId; children: ReactNode }) {
  const experience = experiences[page];
  return <ExperienceContext.Provider value={experience}>
    <div data-workspace-page={page} data-page-style={experience.variant} className="ym-page-experience">{children}</div>
  </ExperienceContext.Provider>;
}
