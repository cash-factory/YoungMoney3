import { useEffect, useRef, useState } from 'react';

interface AnimatedCounterProps {
  value: number;
  format?: (v: number) => string;
  duration?: number;
}

export function AnimatedCounter({ value, format, duration = 0 }: AnimatedCounterProps) {
  const [display, setDisplay] = useState(value);
  const startRef = useRef<number | null>(null);
  const fromRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    // Intermediate numerical states can be mistaken for actual financial figures.
    // Default to a truthful, stable value. Explicit animations respect user preferences.
    if (duration <= 0 || window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.hidden) {
      setDisplay(value);
      return;
    }
    fromRef.current = display;
    startRef.current = null;

    const animate = (ts: number) => {
      if (startRef.current === null) startRef.current = ts;
      const elapsed = ts - startRef.current;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = fromRef.current + (value - fromRef.current) * eased;
      setDisplay(current);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate);
      } else {
        setDisplay(value);
      }
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration]);

  const fmt = format || ((v: number) => v.toFixed(2));
  return <span>{fmt(duration <= 0 ? value : display)}</span>;
}
