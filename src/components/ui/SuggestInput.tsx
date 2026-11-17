import { useState, useRef, useId, type KeyboardEvent } from 'react';
import { Lightbulb, X } from 'lucide-react';
import { FloatingPanel } from '../FloatingPanel';

interface SuggestInputProps {
  value: string;
  onChange: (val: string) => void;
  placeholder: string;
  suggestions: string[];
  multiline?: boolean;
  rows?: number;
  className?: string;
}
export function SuggestInput({ value, onChange, placeholder, suggestions, multiline, rows, className }: SuggestInputProps) {
  const [showSuggest, setShowSuggest] = useState(false);
  const [active, setActive] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const id = useId();
  const filtered = suggestions.filter(s => s.toLowerCase().includes(value.toLowerCase()) && s.toLowerCase() !== value.toLowerCase()).slice(0, 4);
  const shown = showSuggest && filtered.length > 0;
  const handleKey = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (event.key === 'Escape' && shown) { event.preventDefault(); event.stopPropagation(); setShowSuggest(false); }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!filtered.length) return;
      event.preventDefault();
      setShowSuggest(true);
      setActive(index => (index + (event.key === 'ArrowDown' ? 1 : -1) + filtered.length) % filtered.length);
    }
    if (event.key === 'Enter' && shown && filtered[active]) { event.preventDefault(); onChange(filtered[active]); setShowSuggest(false); }
    if (event.key === 'Tab') setShowSuggest(false);
  };
  const baseCls = className || 'input-field';
  const aria = { 'aria-label': placeholder, 'aria-expanded': shown, 'aria-controls': shown ? id : undefined, 'aria-activedescendant': shown ? `${id}-${active}` : undefined, 'aria-autocomplete': 'list' as const };
  return <div ref={containerRef} className="relative">
    {multiline ? <textarea {...aria} role="combobox" className={baseCls} rows={rows || 2} placeholder={placeholder} value={value}
      onKeyDown={handleKey} onChange={e => { onChange(e.target.value); setActive(0); setShowSuggest(true); }} onFocus={() => setShowSuggest(true)} />
      : <input {...aria} role="combobox" className={baseCls} placeholder={placeholder} value={value}
        onKeyDown={handleKey} onChange={e => { onChange(e.target.value.toUpperCase()); setActive(0); setShowSuggest(true); }} onFocus={() => setShowSuggest(true)} />}
    {shown && <FloatingPanel anchor={containerRef} onDismiss={() => setShowSuggest(false)} id={id} role="listbox" aria-label="Suggestions" maxHeight={220} className="border border-themed rounded-xl shadow-lg">
      {filtered.map((s, index) => <div id={`${id}-${index}`} key={s} role="option" aria-selected={active === index}
        onMouseDown={event => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => { onChange(s); setShowSuggest(false); }}
        className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm cursor-pointer border-b border-themed/50 last:border-0 ${active === index ? 'bg-secondary' : ''}`}>
        <Lightbulb size={14} className="text-accent-500 flex-shrink-0" /><span>{s}</span>
      </div>)}
    </FloatingPanel>}
    {value && !multiline && <button type="button" aria-label="Clear value" onClick={() => { onChange(''); setShowSuggest(false); }}
      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted hover:text-primary transition-colors"><X size={14} /></button>}
  </div>;
}
