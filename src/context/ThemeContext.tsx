import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

type Theme = 'dark' | 'light';
export type ColorPalette = 'obsidian' | 'sapphire-night' | 'black-opal' | 'royal-amethyst' | 'champagne-noir' | 'original' | 'true-pink' | 'tiffany' | 'charcoal-violet' | 'cyprus' | 'turmeric';
export const COLOR_PALETTES: { id: ColorPalette; name: string; detail: string; swatch: string; accents?: [string, string, string] }[] = [
  { id: 'original', name: 'Original Ember', detail: 'The original YoungMoney3 look · ember · gold', swatch: '#f97316', accents: ['#0a0807','#f97316','#facc15'] },
  { id: 'true-pink', name: 'True Pink', detail: 'Blush · graphite · orchid', swatch: '#e74791', accents: ['#242228','#ed6bab','#c696e0'] },
  { id: 'tiffany', name: 'Tiffany', detail: 'Lagoon · graphite · aqua', swatch: '#0ab7b2', accents: ['#202627','#32d0ca','#65c8c3'] },
  { id: 'charcoal-violet', name: 'Charcoal Violet', detail: 'Violet · cyber lime', swatch: '#9174f5', accents: ['#242331','#a28afa','#b7ef35'] },
  { id: 'cyprus', name: 'Cyprus', detail: 'Forest teal · sand', swatch: '#247c69', accents: ['#172522','#6bc2a3','#d5bd8e'] },
  { id: 'turmeric', name: 'Turmeric', detail: 'Saffron · malt · bronze', swatch: '#d99d18', accents: ['#29241c','#efbd4d','#c39a68'] },
  { id: 'obsidian', name: 'Obsidian Terminal', detail: 'Petrol black · spectral teal · ice blue', swatch: '#2dd4bf', accents: ['#08141d','#2dd4bf','#79b8ff'] },
  { id: 'sapphire-night', name: 'Sapphire Night', detail: 'Deep cobalt · cornflower · frost', swatch: '#648bfa', accents: ['#0b1434','#648bfa','#afd5ff'] },
  { id: 'black-opal', name: 'Black Opal', detail: 'Ink · jade · antique brass', swatch: '#69c6a1', accents: ['#101d1a','#69c6a1','#dfbc78'] },
  { id: 'royal-amethyst', name: 'Royal Amethyst', detail: 'Aubergine · lilac · glacier', swatch: '#bb9cfb', accents: ['#21172e','#bb9cfb','#96d9e9'] },
  { id: 'champagne-noir', name: 'Champagne Noir', detail: 'Onyx · champagne · rose quartz', swatch: '#dfbd86', accents: ['#201b1c','#dfbd86','#e9aeb3'] },
];
interface ThemeCtx { theme: Theme; palette: ColorPalette; toggle: () => void; setPalette: (palette: ColorPalette) => void; }

const ThemeContext = createContext<ThemeCtx>({ theme: 'dark', palette: 'original', toggle: () => {}, setPalette: () => {} });

const isPalette = (value: string | null): value is ColorPalette => COLOR_PALETTES.some(palette => palette.id === value);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem('journal-theme') as Theme | null;
    return saved || 'dark';
  });
  const [palette, setPalette] = useState<ColorPalette>(() => {
    const saved = localStorage.getItem('journal-palette');
    return isPalette(saved) ? saved : 'original';
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.dataset.palette = palette;
    localStorage.setItem('journal-theme', theme);
    localStorage.setItem('journal-palette', palette);
  }, [theme, palette]);

  const toggle = () => setTheme(t => (t === 'dark' ? 'light' : 'dark'));

  return <ThemeContext.Provider value={{ theme, palette, toggle, setPalette }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
