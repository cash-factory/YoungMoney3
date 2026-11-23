import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowRight, BookOpen, Clock3, Compass, CornerDownLeft, Plus, Search, X } from 'lucide-react';
import type { PageId } from './Layout';

type Destination = {
  id: PageId;
  label: string;
  section: string;
  keywords?: string;
};
type Command = {
  id: string;
  label: string;
  description: string;
  group: string;
  kind: 'page' | 'capture' | 'guide';
  page?: PageId;
};

const STORAGE_KEY = 'ymfx:workspace-recent-pages:v1';
const destinations: Destination[] = [
  { id: 'dashboard', label: 'Trading overview', section: 'Today', keywords: 'home dashboard account performance' },
  { id: 'workspace-setup', label: 'Workspace setup', section: 'Today', keywords: 'onboarding new signup strategy risk configure' },
  { id: 'trades', label: 'Trade ledger', section: 'Journal', keywords: 'capture position execution transactions' },
  { id: 'journal', label: 'Trading journal', section: 'Journal', keywords: 'psychology emotions reflection' },
  { id: 'calendar', label: 'Trading calendar', section: 'Journal', keywords: 'day week session dates' },
  { id: 'media', label: 'Media library', section: 'Journal', keywords: 'screenshots charts audio voice attachments recordings' },
  { id: 'weekly-reviews', label: 'Weekly reviews', section: 'Review', keywords: 'debrief reflections summary' },
  { id: 'trading-plan', label: 'Trading plan', section: 'Playbook', keywords: 'rules checklist blueprint' },
  { id: 'strategies', label: 'Strategy library', section: 'Playbook', keywords: 'setups methods edge' },
  { id: 'setups', label: 'Trade setups', section: 'Playbook', keywords: 'patterns entry models' },
  { id: 'risk-management', label: 'Risk management', section: 'Playbook', keywords: 'drawdown exposure stop loss capital limits' },
  { id: 'goals', label: 'Goals', section: 'Playbook', keywords: 'targets progress' },
  { id: 'market-sessions', label: 'Market sessions', section: 'Playbook', keywords: 'london new york tokyo time' },
  { id: 'strategy-testing', label: 'Testing workspace', section: 'Playbook', keywords: 'backtest forwardtest study research' },
  { id: 'brokers-charting', label: 'Brokers & charting', section: 'Accounts', keywords: 'broker charts account management' },
  { id: 'mt5', label: 'MT5 connections', section: 'Accounts', keywords: 'metatrader connector pair pc devices sync login' },
  { id: 'copy-studio', label: 'Copy Studio', section: 'Accounts', keywords: 'copy simulation demo source follower position size guardrails' },
  { id: 'analytics', label: 'Trading analytics', section: 'Review', keywords: 'reports pnl performance charts' },
  { id: 'ai', label: 'AI insights', section: 'Review', keywords: 'patterns intelligence analysis' },
  { id: 'resources', label: 'Resource library', section: 'Library', keywords: 'reference templates' },
  { id: 'notes', label: 'Notes', section: 'Library', keywords: 'ideas thoughts' },
  { id: 'study-material', label: 'Study material', section: 'Library', keywords: 'learning education' },
  { id: 'account-settings', label: 'Account settings', section: 'Workspace', keywords: 'profile theme preferences password' },
];

const destinationIds = new Set(destinations.map(item => item.id));
const suggestedPages: PageId[] = ['dashboard', 'trades', 'journal', 'analytics', 'mt5', 'strategies'];

export function readRecentWorkspacePages(): PageId[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(value)
      ? [...new Set(value.filter((id): id is PageId => typeof id === 'string' && destinationIds.has(id as PageId)))].slice(0, 5)
      : [];
  } catch { return []; }
}

export function rememberWorkspaceDestination(page: PageId) {
  if (!destinationIds.has(page)) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([page, ...readRecentWorkspacePages().filter(id => id !== page)].slice(0, 5)));
  } catch { /* Private browsing and storage-disabled sessions still get navigation. */ }
}

interface Props {
  open: boolean;
  onClose: () => void;
  onNavigate: (page: PageId) => void;
  onQuickAdd: () => void;
  onOpenGuide: () => void;
  captureEnabled: boolean;
}

const asCommand = (item: Destination, group: string): Command => ({
  id: 'page-' + item.id, label: item.label, description: item.section,
  group, kind: 'page', page: item.id,
});

export function CommandPalette({ open, onClose, onNavigate, onQuickAdd, onOpenGuide, captureEnabled }: Props) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const [recent, setRecent] = useState<PageId[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const commands = useMemo<Command[]>(() => {
    const search = query.trim().toLowerCase();
    const actions: Command[] = [
      ...(captureEnabled ? [{ id: 'action-capture', label: 'Capture a trade', description: 'Start a new trade record', group: 'Quick actions', kind: 'capture' as const }] : []),
      { id: 'action-guide', label: 'Explore the field guide', description: 'Learn an area of the platform', group: 'Quick actions', kind: 'guide' },
    ] as Command[];
    if (search) {
      const tokens = search.split(/\s+/).filter(Boolean);
      const score = (item: Command) => {
        const text = (item.label + ' ' + item.description + ' ' +
          (item.page ? destinations.find(destination => destination.id === item.page)?.keywords || '' : '')).toLowerCase();
        if (!tokens.every(token => text.includes(token))) return -1;
        const name = item.label.toLowerCase();
        if (name === search) return 0;
        if (name.startsWith(search)) return 1;
        if (name.includes(search)) return 2;
        return 3;
      };
      return [...actions, ...destinations.map(item => asCommand(item, 'Pages'))]
        .map((item, position) => ({ item, rank: score(item), position }))
        .filter(row => row.rank >= 0)
        .sort((a, b) => a.rank - b.rank || a.position - b.position)
        .slice(0, 14).map(row => row.item);
    }
    const last = recent.map(id => destinations.find(item => item.id === id)).filter((item): item is Destination => Boolean(item));
    const suggestions = suggestedPages.filter(id => !recent.includes(id))
      .map(id => destinations.find(item => item.id === id)).filter((item): item is Destination => Boolean(item)).slice(0, 6);
    return [...actions, ...last.map(item => asCommand(item, 'Recently visited')),
      ...suggestions.map(item => asCommand(item, 'Explore your desk'))];
  }, [query, recent, captureEnabled]);

  const active = commands.length ? Math.min(selected, commands.length - 1) : -1;

  useEffect(() => {
    if (!open) {
      setQuery('');
      setSelected(0);
      return;
    }
    setRecent(readRecentWorkspacePages());
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [open]);

  useEffect(() => { setSelected(0); }, [query]);

  useEffect(() => {
    if (!open || active < 0) return;
    listRef.current?.querySelector<HTMLElement>('[data-command-id="' + commands[active].id + '"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [active, commands, open]);

  if (!open) return null;

  const activate = (command?: Command) => {
    if (!command) return;
    if (command.kind === 'page' && command.page) {
      rememberWorkspaceDestination(command.page);
      onClose();
      onNavigate(command.page);
    } else if (command.kind === 'capture' && captureEnabled) {
      onClose();
      onQuickAdd();
    } else if (command.kind === 'guide') {
      onClose();
      onOpenGuide();
    }
  };

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
    if (event.key !== 'Tab') return;
    // Results are controlled with the input arrow keys. Keep only search and close in the tab order.
    if (event.shiftKey && document.activeElement === inputRef.current) {
      event.preventDefault(); closeRef.current?.focus();
    } else if (!event.shiftKey && document.activeElement === closeRef.current) {
      event.preventDefault(); inputRef.current?.focus();
    }
  };

  return (
    <div className="ym-command-overlay fixed inset-0 z-[100] flex items-start justify-center px-3 pt-[9dvh] sm:px-5 sm:pt-[12dvh]"
      role="presentation" onKeyDown={handleDialogKeyDown}>
      <button type="button" tabIndex={-1} className="absolute inset-0 bg-black/65 backdrop-blur-sm"
        onClick={onClose} aria-label="Dismiss quick navigation" />
      <section role="dialog" aria-modal="true" aria-label="Quick navigation"
        className="command-palette ym-command-centre relative z-10 w-full max-w-2xl overflow-hidden rounded-2xl border border-themed bg-card shadow-2xl">
        <div className="ym-command-topline">
          <span className="ym-command-kicker"><Compass size={14} aria-hidden="true" /> YOUNGMONEY3 / COMMAND CENTRE</span>
          <span className="ym-command-desktop-hint">Find a tool. Continue your process.</span>
        </div>
        <div className="ym-command-search-row">
          <Search size={20} className="text-muted shrink-0" aria-hidden="true" />
          <input ref={inputRef} type="search" role="combobox"
            value={query} onChange={event => setQuery(event.target.value)}
            aria-expanded="true" aria-controls="ym-command-results"
            aria-autocomplete="list" aria-activedescendant={active >= 0 ? 'ym-command-option-' + commands[active].id : undefined}
            aria-label="Search workspace" aria-describedby="ym-command-hint"
            onKeyDown={event => {
              if (event.key === 'ArrowDown') { event.preventDefault(); setSelected(index => Math.min(index + 1, Math.max(commands.length - 1, 0))); }
              if (event.key === 'ArrowUp') { event.preventDefault(); setSelected(index => Math.max(index - 1, 0)); }
              if (event.key === 'Home' && commands.length) { event.preventDefault(); setSelected(0); }
              if (event.key === 'End' && commands.length) { event.preventDefault(); setSelected(commands.length - 1); }
              if (event.key === 'Enter') { event.preventDefault(); activate(commands[active]); }
            }}
            placeholder="Search pages, accounts, tools, actions…"
            className="ym-command-input min-w-0 flex-1 bg-transparent text-sm text-primary outline-none placeholder:text-muted" />
          <button ref={closeRef} type="button" onClick={onClose} className="ym-command-close"
            aria-label="Close quick navigation"><X size={18} /></button>
        </div>
        <div className="ym-command-body">
          <div className="ym-command-results-heading">
            <span>{query.trim() ? 'Matching destinations' : 'Your workspace shortcuts'}</span>
            <span role="status" aria-live="polite">{commands.length} {commands.length === 1 ? 'result' : 'results'}</span>
          </div>
          <div id="ym-command-results" ref={listRef} role="listbox" aria-label="Navigation results"
            className="ym-command-results">
            {commands.map((item, index) => (
              <div key={item.id}>
                {(index === 0 || commands[index - 1].group !== item.group) &&
                  <div role="presentation" className="ym-command-group">{query.trim() ? 'Results' : item.group}</div>}
                <button type="button" role="option" id={'ym-command-option-' + item.id} data-command-id={item.id}
                  tabIndex={-1} aria-selected={active === index}
                  data-selected={active === index} onMouseEnter={() => setSelected(index)}
                  onClick={() => activate(item)}
                  className="command-result ym-command-option w-full flex items-center gap-3 text-left">
                  <span className="command-result-icon" aria-hidden="true">{item.kind === 'capture' ? <Plus size={17} />
                    : item.kind === 'guide' ? <Compass size={17} />
                    : item.group === 'Recently visited' ? <Clock3 size={17} />
                    : <BookOpen size={17} />}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{item.label}</span>
                    <span className="block truncate text-xs text-muted">{item.description}</span>
                  </span>
                  {active === index ? <CornerDownLeft size={17} className="text-secondary" aria-hidden="true" />
                    : <ArrowRight size={16} className="text-muted" aria-hidden="true" />}
                </button>
              </div>
            ))}
            {!commands.length && (
              <div className="ym-command-empty" role="status">
                <Search size={23} aria-hidden="true" />
                <strong>No matching destinations</strong>
                <span>Try “journal”, “risk”, “MT5”, or “analytics”.</span>
                <button type="button" tabIndex={-1} onClick={() => { setQuery(''); inputRef.current?.focus(); }}>
                  Clear search
                </button>
              </div>
            )}
          </div>
        </div>
        <div id="ym-command-hint" className="ym-command-footer">
          <span><kbd>↑</kbd> <kbd>↓</kbd> Move <kbd>↵</kbd> Open <kbd>Esc</kbd> Close</span>
          <span>Ctrl / ⌘ + K</span>
        </div>
      </section>
    </div>
  );
}
