import {useEffect, useState, type ReactNode} from 'react';
import {ThemeContext,isPalette,type Theme,type ColorPalette} from './ThemeContext';
import { readPreference, savePreference } from '@/lib/browserPreferences';
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = readPreference('journal-theme');
    return saved === 'dark' || saved === 'light' ? saved : 'dark';
  });
  const [palette, setPalette] = useState<ColorPalette>(() => {
    const saved = readPreference('journal-palette');
    return isPalette(saved) ? saved : 'original';
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.dataset.palette = palette;
    savePreference('journal-theme', theme);
    savePreference('journal-palette', palette);
  }, [theme, palette]);

  const toggle = () => setTheme(t => (t === 'dark' ? 'light' : 'dark'));

  return <ThemeContext.Provider value={{ theme, palette, toggle, setPalette }}>{children}</ThemeContext.Provider>;
}

