import type { ReactNode } from 'react';
import { ExperienceContext, type Experience } from '@/context/PageExperienceContext';
import type { PageId } from './Layout';

const experiences: Record<PageId, Experience> = {
  dashboard: { chapter: 'The desk', cue: 'One focus at a time', variant: 'desk' },
  trades: { chapter: '01 / Execution ledger', cue: 'Capture · manage · close', variant: 'ledger' },
  journal: { chapter: '02 / Reflection room', cue: 'Observe. Reflect. Improve.', variant: 'journal', art: 'studio-journal.svg' },
  calendar: { chapter: '03 / Session calendar', cue: 'Your trading rhythm', variant: 'calendar' },
  'weekly-reviews': { chapter: '04 / Weekly debrief', cue: 'Turn experience into a better process', variant: 'review', art: 'studio-journal.svg' },
  'trading-plan': { chapter: '05 / The blueprint', cue: 'Intent before execution', variant: 'blueprint', art: 'studio-intelligence.svg' },
  strategies: { chapter: '06 / Strategy workshop', cue: 'Plan → strategy → entry → checklist', variant: 'workshop' },
  setups: { chapter: '07 / Setup collection', cue: 'Recognise your best opportunities', variant: 'gallery', art: 'studio-intelligence.svg' },
  'risk-management': { chapter: '08 / Risk control', cue: 'Protect the account. Respect the limits.', variant: 'risk' },
  goals: { chapter: '09 / Progress board', cue: 'Small actions. Measurable progress.', variant: 'progress' },
  'market-sessions': { chapter: '10 / Session clock', cue: 'Stay in sync with the market', variant: 'sessions' },
  'strategy-testing': { chapter: '11 / Research lab', cue: 'Hypothesis → evidence → decision', variant: 'lab', art: 'studio-intelligence.svg' },
  'brokers-charting': { chapter: '12 / Account centre', cue: 'Connections, balances and context', variant: 'accounts' },
  analytics: { chapter: '13 / Performance studio', cue: 'Find the signal in your results', variant: 'analysis', art: 'studio-intelligence.svg' },
  ai: { chapter: '14 / Insight room', cue: 'Patterns worth a closer look', variant: 'insight', art: 'studio-intelligence.svg' },
  media: { chapter: '15 / Media archive', cue: 'Every capture has a story', variant: 'media', art: 'media-still-life.png' },
  resources: { chapter: '16 / Reference shelf', cue: 'Keep useful knowledge close', variant: 'reference', art: 'studio-journal.svg' },
  notes: { chapter: '17 / Field notes', cue: 'Make room for your next idea', variant: 'notes' },
  'study-material': { chapter: '18 / Learning space', cue: 'Build a deeper understanding', variant: 'study', art: 'studio-journal.svg' },
  'account-settings': { chapter: 'Workspace / Preferences', cue: 'Make this space yours', variant: 'settings' },
  'admin-operations': { chapter: 'Workspace / Administration', cue: 'Workspace access and operations', variant: 'operations' },
  mt5: { chapter: 'Workspace / Connection bridge', cue: 'Bring execution into focus', variant: 'connections' },
  'workspace-setup': { chapter: 'Workspace / Getting started', cue: 'Build your trading foundation', variant: 'setup', art: 'studio-intelligence.svg' },
};

export function PageExperience({ page, children }: { page: PageId; children: ReactNode }) {
  const experience = experiences[page];
  return <ExperienceContext.Provider value={experience}>
    <div data-workspace-page={page} data-page-style={experience.variant} className="ym-page-experience">{children}</div>
  </ExperienceContext.Provider>;
}
