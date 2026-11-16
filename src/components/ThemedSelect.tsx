import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Check, ChevronDown } from 'lucide-react';

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
}

/**
 * A keyboard-accessible, palette-aware single-select listbox. Unlike styling
 * native <option> elements, the popup retains the same visual treatment in
 * Chromium, Firefox and Safari. Existing native selects remain accessible.
 */
export function ThemedSelect({
  value,
  options,
  onChange,
  label,
  placeholder = 'Choose an option',
  disabled = false,
  className = '',
}: ThemedSelectProps) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const selectedIndex = options.findIndex(option => option.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !ref.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const element = document.getElementById(`${id}-option-${activeIndex}`);
    const list = ref.current?.querySelector<HTMLElement>('.ym-select-list');
    if (!element || !list) return;
    // Never scroll the entire document when a long themed menu opens.
    const optionBox = element.getBoundingClientRect();
    const listBox = list.getBoundingClientRect();
    if (optionBox.top < listBox.top) list.scrollTop -= listBox.top - optionBox.top + 4;
    else if (optionBox.bottom > listBox.bottom) list.scrollTop += optionBox.bottom - listBox.bottom + 4;
  }, [open, activeIndex, id]);

  const firstEnabled = options.findIndex(option => !option.disabled);
  const openList = () => {
    if (disabled || !options.length) return;
    const bounds = trigger.current?.getBoundingClientRect();
    const below = bounds ? window.innerHeight - bounds.bottom : 300;
    const above = bounds?.top ?? 0;
    setOpenUp(below < 230 && above > below && above > 210);
    setActiveIndex(selectedIndex >= 0 && !options[selectedIndex]?.disabled ? selectedIndex : Math.max(0, firstEnabled));
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
    if (!options.some(option => !option.disabled)) return;
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
    if (event.key === 'Escape') {
      if (open) { event.preventDefault(); setOpen(false); }
      return;
    }
    if (event.key === 'Tab') { setOpen(false); return; }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (!open) openList();
      else commit(activeIndex);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) openList();
      else move(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      if (!open) openList();
      else {
        const enabled = options.map((option, index) => !option.disabled ? index : -1).filter(index => index >= 0);
        if (enabled.length) setActiveIndex(event.key === 'Home' ? enabled[0] : enabled[enabled.length - 1]);
      }
      return;
    }
    if (event.key.length === 1 && /[a-z0-9]/i.test(event.key)) {
      const start = activeIndex + 1;
      const next = options.findIndex((option, index) =>
        index >= start && !option.disabled && option.label.toLowerCase().startsWith(event.key.toLowerCase()));
      const wrap = options.findIndex(option => !option.disabled && option.label.toLowerCase().startsWith(event.key.toLowerCase()));
      if (next >= 0 || wrap >= 0) {
        event.preventDefault();
        if (!open) openList();
        setActiveIndex(next >= 0 ? next : wrap);
      }
    }
  };

  return (
    <div ref={ref} className={`ym-select ${className}`.trim()}>
      <button
        ref={trigger}
        type="button"
        className="ym-select-trigger"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-controls={open ? `${id}-listbox` : undefined}
        aria-expanded={open}
        aria-activedescendant={open ? `${id}-option-${activeIndex}` : undefined}
        disabled={disabled || !options.length}
        onKeyDown={handleKey}
        onClick={() => open ? setOpen(false) : openList()}
      >
        <span className="ym-select-value">{selected?.label || placeholder}</span>
        <ChevronDown size={17} className="ym-select-arrow" aria-hidden="true" />
      </button>
      {open && (
        <div className={`ym-select-list ${openUp ? 'ym-select-list--up' : ''}`} id={`${id}-listbox`} role="listbox" aria-label={label}>
          {options.length === 0 && <div className="ym-select-empty">No options</div>}
          {options.map((option, index) => (
            <button
              id={`${id}-option-${index}`}
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              aria-disabled={option.disabled || undefined}
              data-active={activeIndex === index}
              disabled={option.disabled}
              className="ym-select-option"
              onMouseEnter={() => { if (!option.disabled) setActiveIndex(index); }}
              onMouseDown={event => event.preventDefault()}
              onClick={() => commit(index)}
            >
              <span className="ym-select-option-copy">
                <span>{option.label}</span>
                {option.description && <small>{option.description}</small>}
              </span>
              {option.value === value && <Check size={16} aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
