import { useEffect, useRef } from 'react';
import { Check, Moon, Palette, Sun } from 'lucide-react';
import { COLOR_PALETTES, useTheme } from '@/context/ThemeContext';

/** A shared palette picker used on the welcome page and inside the workspace. */
export function ColorPaletteControl({ compact = false }: { compact?: boolean }) {
  const { theme, palette, toggle, setPalette } = useTheme();
  const controlRef = useRef<HTMLDetailsElement>(null);
  const activePalette = COLOR_PALETTES.find(option => option.id === palette) || COLOR_PALETTES[0];

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
        {compact && <span className="ym-mini-palette inline-flex h-4 w-7 overflow-hidden rounded-sm" aria-hidden="true">{activePalette.accents?.map((color, index) => <i key={index} className="flex-1" style={{ background: color }} />)}</span>}
      </summary>
      <div className={`${compact ? 'right-0 top-full mt-2' : 'bottom-full left-0 right-0 mb-2'} ym-palette-panel absolute z-[70] w-[340px] max-w-[calc(100vw-2rem)] max-h-[min(75vh,560px)] overflow-y-auto rounded-xl border border-themed bg-card p-3 shadow-2xl`}>
        <div className="mb-3 px-2 pt-1">
          <p className="text-sm font-semibold tracking-tight">Your visual workspace</p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted">Eleven considered palettes. One familiar trading desk.</p>
        </div>
        <div role="group" aria-label="Display mode" className="ym-appearance-modes mb-3 grid grid-cols-2 gap-1 rounded-lg bg-secondary p-1">
          <button type="button" aria-pressed={theme === 'light'} onClick={() => { if (theme !== 'light') toggle(); }} className="ym-mode-choice flex items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-semibold"><Sun size={15} /> Light</button>
          <button type="button" aria-pressed={theme === 'dark'} onClick={() => { if (theme !== 'dark') toggle(); }} className="ym-mode-choice flex items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-semibold"><Moon size={15} /> Dark</button>
        </div>
        <p className="border-t border-themed px-2 pb-1 pt-3 text-xs font-semibold text-secondary">Colour collection</p>
        <p className="px-2 pb-3 text-[11px] leading-relaxed text-muted">Your choice is saved on this device and applies to the entire site.</p>
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
                  className={`ym-palette-choice flex items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors ${palette === option.id ? 'bg-secondary' : ''}`}
                >
                  <span aria-hidden="true" className="ym-palette-sample flex h-9 w-14 shrink-0 items-center overflow-hidden rounded-md border border-themed">
                    {(option.accents || [option.swatch, option.swatch, option.swatch]).map((color, index) => <span key={index} className="h-full flex-1" style={{ background: color }} />)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-semibold leading-tight">{option.name}</span>
                    <span className="block truncate text-[10px] text-muted">{option.detail}</span>
                  </span>
                  {palette === option.id && <Check size={16} className="shrink-0" style={{ color: 'var(--brand)' }} aria-label="Selected" />}
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </details>
  );
}
