import { useId } from 'react';
import { Activity, ArrowRight, BookOpenCheck, Compass, Flame, LockKeyhole,
  PenLine, Pin, PinOff, ShieldCheck, Sparkles } from 'lucide-react';
import type { FastCapture } from './DecisionDesk';
import '@/adaptive-desk.css';

export type DeskMode = 'prepare' | 'capture' | 'review' | 'analyze';
export const modeDestination: Record<DeskMode, 'risk' | 'overview' | 'recent' | 'deep-dive'> = {
  prepare: 'risk', capture: 'overview', review: 'recent', analyze: 'deep-dive',
};
export const modeFromSection = (section: string): DeskMode => section === 'risk' ? 'prepare'
  : section === 'recent' ? 'review' : section === 'performance' || section === 'deep-dive' ? 'analyze' : 'capture';
const modes = [
  { id: 'prepare', title: 'Prepare', eyebrow: '01', icon: ShieldCheck,
    short: 'Know your limits before acting.' },
  { id: 'capture', title: 'Capture', eyebrow: '02', icon: PenLine,
    short: 'Document the decision, not just the trade.' },
  { id: 'review', title: 'Review', eyebrow: '03', icon: BookOpenCheck,
    short: 'Examine what happened and why.' },
  { id: 'analyze', title: 'Understand', eyebrow: '04', icon: Activity,
    short: 'Discover documented patterns.' },
] as const;

interface Props {
  mode: DeskMode;
  preferred: DeskMode | null;
  suggested: DeskMode;
  suggestionReason: string;
  onSelect: (mode: DeskMode) => void;
  onPin: (mode: DeskMode | null) => void;
  onCapture: (mode: FastCapture) => void;
  onOpenGuide: () => void;
  onOpenWeekly: () => void;
  onOpenRisk: () => void;
  pendingReviews: number;
  accountName: string;
  tradesRecorded: number;
}
export function AdaptiveTradingDesk({
  mode, preferred, suggested, suggestionReason, onSelect, onPin, onCapture,
  onOpenGuide, onOpenWeekly, onOpenRisk, pendingReviews, accountName, tradesRecorded,
}: Props) {
  const headlineId = useId();
  const modeInfo: Record<DeskMode, { headline: string; detail: string; supporting: string }> = {
    prepare: {
      headline: 'Start with your rules.',
      detail: 'Review exposure, protective limits, and the trading plan before taking another position.',
      supporting: 'Your risk guardian and active limits are just below.',
    },
    capture: {
      headline: 'Record what matters, while it matters.',
      detail: 'Document a trade, an observation, or a deliberate decision not to trade.',
      supporting: tradesRecorded ? tradesRecorded + ' journal trades available in this view.' : 'Your first record builds the foundation.',
    },
    review: {
      headline: pendingReviews ? 'There are decisions worth revisiting.' : 'Reflect without chasing the outcome.',
      detail: 'Use Decision Replay to judge the entry before revealing the financial result.',
      supporting: pendingReviews ? pendingReviews + ' entries are waiting for review.' : 'Your recorded decisions are available in the recent-trades section.',
    },
    analyze: {
      headline: 'Look for evidence, not explanations.',
      detail: 'Compare documented habits, original checklists and consistent behavior over time.',
      supporting: 'Personal patterns follow the existing journal evidence; missing samples are marked.',
    },
  };

  return <section className="ym-adaptive-desk" aria-label="Adaptive Trading Desk">
    <div className="ym-adaptive-header">
      <div>
        <p className="ym-adaptive-kicker"><Compass size={14} /> THE ADAPTIVE DESK / {accountName.toUpperCase()}</p>
        <h2>What are you here to do?</h2>
        <p>Choose your intent. Your current dashboard reorganizes around the task—without changing or hiding your underlying records.</p>
      </div>
      <button type="button" className="ym-adaptive-suggestion"
        onClick={() => onSelect(suggested)} aria-label={'Use suggested focus: ' + modes.find(m => m.id === suggested)?.title}>
        <Sparkles size={16}/><span><strong>Suggested focus</strong><small>{suggestionReason}</small></span><ArrowRight size={15}/>
      </button>
    </div>
    <div className="ym-adaptive-modes" role="group" aria-label="Trading desk modes">
      {modes.map(item => {
        const Icon = item.icon;
        const selected = mode === item.id;
        return <button type="button" key={item.id} className="ym-adaptive-mode"
          aria-pressed={selected} data-selected={selected}
          onClick={() => onSelect(item.id)} aria-describedby={headlineId}>
          <span className="ym-adaptive-mode-icon"><Icon size={19} aria-hidden="true"/></span>
          <span className="ym-adaptive-mode-label"><small>{item.eyebrow} / INTENT</small><strong>{item.title}</strong>
            <span>{item.short}</span></span>
          {selected && <span className="ym-adaptive-active-marker" aria-hidden="true"/>}
        </button>;
      })}
    </div>
    <div className="ym-adaptive-focus" data-mode={mode}>
      <div className="ym-adaptive-focus-copy">
        <span className="ym-adaptive-focus-eyebrow"><Flame size={14}/> YOUR CURRENT FOCUS</span>
        <h3 id={headlineId}>{modeInfo[mode].headline}</h3>
        <p>{modeInfo[mode].detail}</p>
        <small>{modeInfo[mode].supporting}</small>
      </div>
      <div className="ym-adaptive-focus-actions">
        {mode === 'prepare' && <>
          <button type="button" className="btn-primary" onClick={onOpenRisk}><ShieldCheck size={16}/> Configure limits</button>
          <button type="button" className="btn-secondary" onClick={() => { window.location.hash = 'trading-plan'; }}>Open trading plan</button>
        </>}
        {mode === 'capture' && <>
          <button type="button" className="btn-primary" onClick={() => onCapture('manual')}><PenLine size={16}/> Capture trade</button>
          <button type="button" className="btn-secondary" onClick={() => onCapture('pass')}>Record a deliberate pass</button>
        </>}
        {mode === 'review' && <>
          <button type="button" className="btn-primary" onClick={() => onSelect('review')}><BookOpenCheck size={16}/> Review recent trades</button>
          <button type="button" className="btn-secondary" onClick={onOpenWeekly}>Weekly reflection</button>
        </>}
        {mode === 'analyze' && <>
          <button type="button" className="btn-primary" onClick={() => onSelect('analyze')}><Activity size={16}/> Explore personal patterns</button>
          <button type="button" className="btn-secondary" onClick={() => { window.location.hash = 'strategy-testing'; }}>Open testing workspace</button>
        </>}
      </div>
      <div className="ym-adaptive-utility">
        <button type="button" aria-pressed={preferred === mode}
          onClick={() => onPin(preferred === mode ? null : mode)}
          title="This preference is stored only in this browser">
          {preferred === mode ? <PinOff size={15} aria-hidden="true"/> : <Pin size={15} aria-hidden="true"/>}
          {preferred === mode ? 'Unpin opening focus' : 'Make this my opening focus'}
        </button>
        <button type="button" onClick={onOpenGuide}><Compass size={15}/> Explore the platform</button>
      </div>
    </div>
    <p className="ym-adaptive-storage"><LockKeyhole size={12}/> Opening-focus preference is saved on this device only. You can switch modes at any time.</p>
  </section>;
}
