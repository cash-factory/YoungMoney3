import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, ArrowRight, Plus, Command, X } from 'lucide-react';
import type { PageId } from './Layout';

interface Destination {
  id: PageId;
  label: string;
  section: string;
  keywords?: string;
}
const destinations: Destination[] = [
  { id: 'workspace-setup', label: 'Workspace setup', section: 'Workspace', keywords: 'new signup strategy risk onboarding' },
  { id: 'mt5', label: 'MT5 Connections', section: 'Workspace', keywords: 'pair PC MetaTrader broker login' },
  { id: 'dashboard', label: 'Overview', section: 'Workspace', keywords: 'home performance' },
  { id: 'trades', label: 'Trade ledger', section: 'Journal', keywords: 'transactions capture' },
  { id: 'journal', label: 'Journal', section: 'Journal', keywords: 'reflection' },
  { id: 'calendar', label: 'Trading calendar', section: 'Journal' },
  { id: 'weekly-reviews', label: 'Weekly reviews', section: 'Journal' },
  { id: 'trading-plan', label: 'Trading plan', section: 'Playbook' },
  { id: 'strategies', label: 'Strategy library', section: 'Playbook' },
  { id: 'setups', label: 'Setups', section: 'Playbook' },
  { id: 'risk-management', label: 'Risk management', section: 'Playbook' },
  { id: 'goals', label: 'Goals', section: 'Playbook' },
  { id: 'market-sessions', label: 'Market sessions', section: 'Playbook' },
  { id: 'strategy-testing', label: 'Testing workspace', section: 'Testing' },
  { id: 'brokers-charting', label: 'Brokers & charting', section: 'Accounts' },
  { id: 'analytics', label: 'Analytics', section: 'Insights' },
  { id: 'ai', label: 'Trading insights', section: 'Insights' },
  { id: 'resources', label: 'Resources', section: 'Library' },
  { id: 'notes', label: 'Notes', section: 'Library' },
  { id: 'study-material', label: 'Study material', section: 'Library' },
  { id: 'account-settings', label: 'Account settings', section: 'Workspace' },
];

interface Props {
  open: boolean;
  onClose: () => void;
  onNavigate: (id: PageId) => void;
  onQuickAdd: () => void;
}

export function CommandPalette({ open, onClose, onNavigate, onQuickAdd }: Props) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const results = useMemo(() => {
    const normalized = query.toLocaleLowerCase().trim();
    return normalized
      ? destinations.filter(item => `${item.label} ${item.section} ${item.keywords || ''}`.toLocaleLowerCase().includes(normalized))
      : destinations.slice(0, 7);
  }, [query]);
  const showQuickAdd = !query || 'new trade add trade quick capture'.includes(query.toLowerCase().trim());
  const count = results.length + (showQuickAdd ? 1 : 0);

  useEffect(() => {
    if (!open) { setQuery(''); setSelected(0); return; }
    inputRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [open]);

  useEffect(() => { setSelected(0); }, [query]);

  if (!open) return null;
  const activate = (index: number) => {
    if (showQuickAdd && index === 0) { onClose(); onQuickAdd(); return; }
    const item = results[index - (showQuickAdd ? 1 : 0)];
    if (item) { onNavigate(item.id); onClose(); }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center px-4 pt-[12vh] sm:pt-[16vh]" role="presentation">
      <button className="absolute inset-0 bg-black/65 backdrop-blur-sm" onClick={onClose} aria-label="Close quick navigation" />
      <section role="dialog" aria-modal="true" aria-label="Quick navigation" className="command-palette relative z-10 w-full max-w-xl overflow-hidden rounded-2xl border border-themed bg-card shadow-2xl">
        <div className="flex items-center gap-3 border-b border-themed px-4 py-4">
          <Search size={20} className="text-muted shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') { e.preventDefault(); onClose(); }
              if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(v => Math.min(v + 1, Math.max(0, count - 1))); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(v => Math.max(0, v - 1)); }
              if (e.key === 'Enter') { e.preventDefault(); activate(selected); }
            }}
            placeholder="Find a page, tool, or action..."
            aria-label="Search workspace"
            className="min-w-0 flex-1 bg-transparent text-sm text-primary placeholder:text-muted outline-none"
          />
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-secondary" aria-label="Close search"><X size={17} /></button>
        </div>
        <div className="max-h-[min(55vh,440px)] overflow-y-auto p-2" role="listbox" aria-label="Navigation results">
          {showQuickAdd && (
            <button type="button" role="option" aria-selected={selected === 0} onMouseEnter={() => setSelected(0)} onClick={() => activate(0)} className="command-result w-full flex items-center gap-3 rounded-xl px-3 py-3 text-left" data-selected={selected === 0}>
              <span className="command-result-icon"><Plus size={18} /></span>
              <span className="flex-1"><span className="block text-sm font-semibold">Capture a trade</span><span className="block text-xs text-muted">Quick action</span></span>
              <ArrowRight size={16} className="text-muted" />
            </button>
          )}
          {results.map((item, index) => {
            const position = index + (showQuickAdd ? 1 : 0);
            return <button type="button" key={item.id} role="option" aria-selected={selected === position} onMouseEnter={() => setSelected(position)} onClick={() => activate(position)} className="command-result w-full flex items-center gap-3 rounded-xl px-3 py-3 text-left" data-selected={selected === position}>
              <span className="command-result-icon"><ArrowRight size={16} /></span>
              <span className="flex-1"><span className="block text-sm font-medium">{item.label}</span><span className="block text-xs text-muted">{item.section}</span></span>
              <ArrowRight size={16} className="text-muted" />
            </button>;
          })}
          {!count && <p className="px-4 py-8 text-center text-sm text-muted">No matching destinations. Try “risk”, “journal”, or “analytics”.</p>}
        </div>
        <div className="flex items-center justify-between border-t border-themed px-4 py-3 text-[11px] text-muted">
          <span>↑ ↓ Navigate · Enter Open · Esc Close</span>
          <span className="flex items-center gap-1"><Command size={12} /> K</span>
        </div>
      </section>
    </div>
  );
}
