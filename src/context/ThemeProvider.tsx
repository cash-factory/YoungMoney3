import {useEffect, useState, type ReactNode} from 'react';
import {ThemeContext,isPalette,type Theme,type ColorPalette} from './ThemeContext';
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

