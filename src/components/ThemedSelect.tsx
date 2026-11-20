import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import '@/controls.css';

export interface ThemedSelectOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}
export interface ThemedSelectProps {
  value: string;
  options: ThemedSelectOption[];
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  required?: boolean;
  describedBy?: string;
}

/** A viewport-positioned listbox, portalled out of scroll containers and dialogs. */
export function ThemedSelect({ value, options, onChange, label, placeholder = 'Choose an option', disabled = false, className = '', id: triggerId, required, describedBy }: ThemedSelectProps) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top?: number; bottom?: number; left: number; width: number; maxHeight: number } | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const search = useRef({ text: '', time: 0 });
  const selectedIndex = options.findIndex(option => option.value === value);
  const selected = options[selectedIndex];
  const firstEnabled = options.findIndex(option => !option.disabled);

  const positionList = useCallback(() => {
      const bounds = trigger.current?.getBoundingClientRect();
      if (!bounds || bounds.width <= 0 || bounds.height <= 0) return false;
      const viewport = window.visualViewport;
      const leftEdge = viewport?.offsetLeft ?? 0;
      const topEdge = viewport?.offsetTop ?? 0;
      const viewportWidth = viewport?.width ?? window.innerWidth;
      const bottomEdge = topEdge + (viewport?.height ?? window.innerHeight);
      if (bounds.bottom < topEdge || bounds.top > bottomEdge) { setOpen(false); return false; }
      const desired = Math.min(320, options.length * 44 + 16);
      const below = Math.max(0, bottomEdge - bounds.bottom - 14);
      const above = Math.max(0, bounds.top - topEdge - 14);
      const up = below < desired && above > below;
      const maxHeight = Math.min(desired, up ? above : below);
      const width = Math.min(Math.max(bounds.width, 180), viewportWidth - 24);
      setPosition({
        left: Math.max(leftEdge + 12, Math.min(bounds.left, leftEdge + viewportWidth - width - 12)),
        top: up ? undefined : bounds.bottom + 6,
        bottom: up ? window.innerHeight - bounds.top + 6 : undefined,
        width,
        maxHeight,
      });
      return true;
  }, [options.length]);

  useLayoutEffect(() => {
    if (!open) return;
    positionList();
    window.addEventListener('resize', positionList);
    document.addEventListener('scroll', positionList, true);
    window.visualViewport?.addEventListener('resize', positionList);
    window.visualViewport?.addEventListener('scroll', positionList);
    return () => {
      window.removeEventListener('resize', positionList);
      document.removeEventListener('scroll', positionList, true);
      window.visualViewport?.removeEventListener('resize', positionList);
      window.visualViewport?.removeEventListener('scroll', positionList);
    };
  }, [open, positionList]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      const target = event.target as Node;
      if (!trigger.current?.contains(target) && !list.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', outside);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const element = document.getElementById(`${id}-option-${activeIndex}`);
    const menu = list.current;
    if (!element || !menu) return;
    const optionBox = element.getBoundingClientRect();
    const listBox = menu.getBoundingClientRect();
    if (optionBox.top < listBox.top) menu.scrollTop -= listBox.top - optionBox.top + 4;
    else if (optionBox.bottom > listBox.bottom) menu.scrollTop += optionBox.bottom - listBox.bottom + 4;
  }, [open, activeIndex, position?.maxHeight, id]);

  const openList = () => {
    if (disabled || firstEnabled < 0 || !positionList()) return;
    // Measure before mounting the portal so its first visible frame is usable.
    setActiveIndex(selectedIndex >= 0 && !options[selectedIndex]?.disabled ? selectedIndex : firstEnabled);
    setOpen(true);
  };
  const commit = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    onChange(option.value);
    setOpen(false);
    trigger.current?.focus();
  };
  const move = (increment: number) => {
    setActiveIndex(current => {
      for (let attempt = 1; attempt <= options.length; attempt++) {
        const next = (current + increment * attempt + options.length * (attempt + 1)) % options.length;
        if (!options[next].disabled) return next;
      }
      return current;
    });
  };
  const handleKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); return; }
    if (event.key === 'Tab') { setOpen(false); return; }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (!open) openList(); else commit(activeIndex);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) openList(); else move(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      if (!open) openList();
      const enabled = options.map((option, index) => !option.disabled ? index : -1).filter(index => index >= 0);
      if (enabled.length) setActiveIndex(event.key === 'Home' ? enabled[0] : enabled[enabled.length - 1]);
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const now = Date.now();
      const text = (now - search.current.time < 700 ? search.current.text : '') + event.key.toLowerCase();
      search.current = { text, time: now };
      const query = /^(.)(\1)+$/.test(text) ? event.key.toLowerCase() : text;
      const start = open ? activeIndex + 1 : selectedIndex + 1;
      const order = [...options.keys()].map(index => (index + start + options.length) % options.length);
      const next = order.find(index => !options[index].disabled && options[index].label.toLowerCase().startsWith(query));
      if (next != null) {
        event.preventDefault();
        if (!open) openList();
        setActiveIndex(next);
      }
    }
  };

  return <div className={`ym-select ${className}`.trim()}>
    <button ref={trigger} id={triggerId} type="button" className="ym-select-trigger" role="combobox"
      aria-label={label} aria-required={required || undefined} aria-describedby={describedBy}
      aria-haspopup="listbox" aria-controls={open ? `${id}-listbox` : undefined} aria-expanded={open}
      aria-activedescendant={open ? `${id}-option-${activeIndex}` : undefined}
      disabled={disabled || firstEnabled < 0} onKeyDown={handleKey} onClick={() => open ? setOpen(false) : openList()}>
      <span className="ym-select-value">{selected?.label || placeholder}</span>
      <ChevronDown size={17} className="ym-select-arrow" aria-hidden="true" />
    </button>
    {open && position && createPortal(<div data-positioned="true" ref={list} className="ym-select-list ym-select-portal" style={position}
      id={`${id}-listbox`} role="listbox" aria-label={label}>
      {options.map((option, index) => <div id={`${id}-option-${index}`} key={`${option.value}-${index}`} role="option"
        aria-selected={option.value === value} aria-disabled={option.disabled || undefined} data-active={activeIndex === index}
        className="ym-select-option" onMouseEnter={() => { if (!option.disabled) setActiveIndex(index); }}
        onMouseDown={event => event.preventDefault()} onClick={() => commit(index)}>
        <span className="ym-select-check">{option.value === value && <Check size={15} aria-hidden="true" />}</span>
        <span className="ym-select-option-copy"><span>{option.label}</span>{option.description && <small>{option.description}</small>}</span>
      </div>)}
    </div>, document.body)}
  </div>;
}
