import { FloatingPanel } from './FloatingPanel';
import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronDown, Search, Star } from 'lucide-react';
import type { MarketInstrument } from '@/lib/types';

interface InstrumentPickerProps {
  value: string;
  instruments: MarketInstrument[];
  favoriteIds?: string[];
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onSelect: (instrument: MarketInstrument | null, symbol: string) => void;
  placeholder?: string;
}

export function InstrumentPicker({ value, instruments, favoriteIds = [], loading = false, error = null, onRetry, onSelect, placeholder = 'Search instruments or type a custom symbol' }: InstrumentPickerProps) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const listId = useId();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase();
    const matches = instruments.filter(item => !search || `${item.symbol} ${item.display_name} ${item.asset_class}`.toLowerCase().includes(search));
    return [...matches].sort((a, b) => {
      const aFavorite = favoriteIds.includes(a.id) ? 0 : 1;
      const bFavorite = favoriteIds.includes(b.id) ? 0 : 1;
      return aFavorite - bFavorite || a.symbol.localeCompare(b.symbol);
    });
  }, [instruments, favoriteIds, query]);

  const select = (instrument: MarketInstrument | null, symbol: string) => {
    onSelect(instrument, symbol);
    setQuery('');
    setOpen(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); setActiveIndex(index => open ? Math.min(index + 1, Math.max(0, filtered.length - 1)) : 0); }
    if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex(index => Math.max(0, index - 1)); }
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); setQuery(''); }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (open && filtered[activeIndex]) select(filtered[activeIndex], filtered[activeIndex].symbol);
      else if (query.trim()) {
        const exact = instruments.find(item => item.symbol.toLowerCase() === query.trim().toLowerCase());
        select(exact || null, exact?.symbol || query.trim().toUpperCase());
      }
    }
  };

  return <div ref={anchor} className="relative">
    <div className="relative">
      <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
      <input role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={open ? listId : undefined} aria-activedescendant={open && filtered[activeIndex] ? `${listId}-${activeIndex}` : undefined} aria-label="Instrument" autoComplete="off" className="input-field pl-9 pr-9" value={open ? query : value} placeholder={placeholder} onFocus={() => { setQuery(''); setOpen(true); }} onClick={() => setOpen(true)} onKeyDown={onKeyDown} onChange={event => { setQuery(event.target.value); setActiveIndex(0); setOpen(true); }} />
      <button type="button" aria-label={open ? 'Close instrument list' : 'Open instrument list'} onClick={() => { setOpen(value => !value); setQuery(''); }} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted hover:text-primary"><ChevronDown size={16} /></button>
    </div>
    {open && <FloatingPanel anchor={anchor} onDismiss={() => setOpen(false)} id={listId} role="listbox" aria-label="Instruments" className="rounded-xl border border-themed bg-primary shadow-xl">
      {loading && <p className="px-3 py-2 text-xs text-muted">Loading your instrument catalog…</p>}
      {!loading && error && <div className="px-3 py-2 text-xs text-amber-700"><p>{instruments.length ? 'Catalog sync is unavailable. Built-in example instruments are still available below.' : 'Could not load the instrument catalog.'}</p><p className="mt-1 text-[10px] opacity-80">{error}</p>{onRetry && <button type="button" onClick={onRetry} className="mt-1 underline">Retry catalog sync</button>}</div>}
      {!loading && filtered.length === 0 && <p className="px-3 py-2 text-xs text-muted">{instruments.length ? 'No matching instruments.' : 'No catalog instruments loaded. Enter a custom symbol below.'}</p>}
      {filtered.map((instrument, index) => <button id={`${listId}-${index}`} tabIndex={-1} onMouseDown={event => event.preventDefault()} role="option" aria-selected={index === activeIndex} key={instrument.id} type="button" onMouseEnter={() => setActiveIndex(index)} onClick={() => select(instrument, instrument.symbol)} className={`w-full px-3 py-2 text-left hover:bg-secondary ${index === activeIndex ? 'bg-secondary' : ''}`}>
        <span className="flex items-center justify-between gap-3"><span><strong className="text-sm">{instrument.symbol}</strong><span className="ml-2 text-xs text-muted">{instrument.display_name}</span></span>{favoriteIds.includes(instrument.id) && <Star size={13} className="fill-amber-400 text-amber-400" />}</span>
        <span className="block mt-0.5 text-[10px] uppercase text-muted">{instrument.asset_class} · {instrument.quantity_unit} · example {instrument.example_price ?? 'not set'}</span>
      </button>)}
      {!loading && query.trim() && !instruments.some(item => item.symbol.toLowerCase() === query.trim().toLowerCase()) && <button role="option" aria-selected={false} tabIndex={-1} onMouseDown={event => event.preventDefault()} type="button" onClick={() => select(null, query.trim().toUpperCase())} className="w-full border-t border-themed px-3 py-2 text-left text-xs text-orange-600 hover:bg-secondary">Use “{query.trim().toUpperCase()}” as a custom instrument</button>}
    </FloatingPanel>}
  </div>;
}
