import { createContext, useContext,  } from 'react';

export type Theme = 'dark' | 'light';
export type ColorPalette = 'original' | 'true-pink' | 'tiffany' | 'charcoal-violet' | 'cyprus' | 'turmeric';
export const COLOR_PALETTES: { id: ColorPalette; name: string; detail: string; swatch: string }[] = [
  { id: 'original', name: 'Original Ember', detail: 'Orange · gold', swatch: '#f97316' },
  { id: 'true-pink', name: 'True Pink', detail: 'Chill white · dark gray', swatch: '#e74791' },
  { id: 'tiffany', name: 'Tiffany', detail: 'Tiffany blue · dark gray', swatch: '#0ab7b2' },
  { id: 'charcoal-violet', name: 'Charcoal Violet', detail: 'Violet · cyber lime', swatch: '#9174f5' },
  { id: 'cyprus', name: 'Cyprus', detail: 'Deep teal · sand', swatch: '#247c69' },
  { id: 'turmeric', name: 'Turmeric', detail: 'Turmeric · malt', swatch: '#d99d18' },
];
interface ThemeCtx { theme: Theme; palette: ColorPalette; toggle: () => void; setPalette: (palette: ColorPalette) => void; }

export const ThemeContext = createContext<ThemeCtx>({ theme: 'dark', palette: 'original', toggle: () => {}, setPalette: () => {} });

export const isPalette = (value: string | null): value is ColorPalette => COLOR_PALETTES.some(palette => palette.id === value);

export function useTheme() {
  return useContext(ThemeContext);
}
