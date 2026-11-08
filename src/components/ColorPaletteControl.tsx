import { useEffect, useRef } from 'react';
import { Moon, Palette, Sun } from 'lucide-react';
import { COLOR_PALETTES, useTheme } from '@/context/ThemeContext';

/** A shared palette picker used on the welcome page and inside the workspace. */
export function ColorPaletteControl({ compact = false }: { compact?: boolean }) {
  const { theme, palette, toggle, setPalette } = useTheme();
  const controlRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const closeOnOutsideInteraction = (event: PointerEvent) => {
      if (event.target instanceof Node && !controlRef.current?.contains(event.target)) {
        if (controlRef.current) controlRef.current.open = false;
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && controlRef.current?.open) {
        controlRef.current.open = false;
      }
    };
    document.addEventListener('pointerdown', closeOnOutsideInteraction);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideInteraction);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  return (
    <details ref={controlRef} className="palette-control relative">
      <summary className={`btn-secondary cursor-pointer list-none ${compact ? 'px-3 py-2 text-xs' : 'w-full justify-between'}`} aria-label="Appearance settings">
        <span className="inline-flex items-center gap-2"><Palette size={compact ? 15 : 16} />{compact ? <span className="hidden sm:inline">Appearance</span> : 'Appearance'}</span>
        {compact && <span className="h-3 w-3 rounded-full ring-1 ring-black/10" style={{ background: COLOR_PALETTES.find(item => item.id === palette)?.swatch }} />}
      </summary>
      <div className={`${compact ? 'right-0 top-full mt-2' : 'bottom-full left-0 right-0 mb-2'} absolute z-[70] w-80 max-w-[calc(100vw-2rem)] max-h-[min(75vh,520px)] overflow-y-auto rounded-2xl border border-themed bg-card p-3 shadow-2xl`}>
        <button type="button" onClick={() => {
          toggle();
          if (controlRef.current) controlRef.current.open = false;
        }} className="mb-2 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-secondary">
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          Switch to {theme === 'dark' ? 'light' : 'dark'} mode
        </button>
        <p className="border-t border-themed px-2 pb-2 pt-3 text-xs font-semibold text-secondary">Choose your colours</p>
        <p className="px-2 pb-3 text-[11px] leading-relaxed text-muted">Every palette works in light and dark mode. Your selection is saved on this device.</p>
        {[
          { title: 'Original collection', options: COLOR_PALETTES.filter(option => ['original', 'true-pink', 'tiffany', 'charcoal-violet', 'cyprus', 'turmeric'].includes(option.id)) },
          { title: 'Signature collection', options: COLOR_PALETTES.filter(option => !['original', 'true-pink', 'tiffany', 'charcoal-violet', 'cyprus', 'turmeric'].includes(option.id)) },
        ].map(group => (
          <section key={group.title} className="mb-2">
            <p className="px-2 py-2 text-[10px] font-bold uppercase tracking-wider text-muted">{group.title}</p>
            <div className="grid gap-0.5">
              {group.options.map(option => (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={palette === option.id}
                  onClick={() => {
                    setPalette(option.id);
                    if (controlRef.current) controlRef.current.open = false;
                  }}
                  className={`flex items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors ${palette === option.id ? 'bg-secondary' : 'hover:bg-secondary'}`}
                >
                  <span aria-hidden="true" className="flex h-7 w-12 shrink-0 items-center overflow-hidden rounded-md border border-themed shadow-sm">
                    {(option.accents || [option.swatch, option.swatch, option.swatch]).map((color, index) => <span key={index} className="h-full flex-1" style={{ background: color }} />)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-semibold leading-tight">{option.name}</span>
                    <span className="block truncate text-[10px] text-muted">{option.detail}</span>
                  </span>
                  {palette === option.id && <span className="text-[10px] font-semibold" style={{ color: 'var(--brand-text)' }}>Active</span>}
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </details>
  );
}
