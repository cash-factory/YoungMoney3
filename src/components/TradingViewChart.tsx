import { useEffect, useRef, useState } from 'react';

export function TradingViewChart({ symbol, height = 360 }: { symbol?: string | null; height?: number }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [failed, setFailed] = useState(false);
  const [visible, setVisible] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const details = rootRef.current?.closest('details');
    if (!details) { setVisible(true); return; }
    const sync = () => setVisible(details.open);
    sync();
    details.addEventListener('toggle', sync);
    return () => details.removeEventListener('toggle', sync);
  }, []);
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !visible) return;
    root.replaceChildren();
    setFailed(false);
    if (!symbol) { setFailed(true); return; }
    const widget = document.createElement('div');
    widget.className = 'tradingview-widget-container__widget';
    widget.style.width = '100%';
    widget.style.height = `${height}px`;
    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.async = true;
    script.text = JSON.stringify({
      autosize: true, symbol, interval: '15', timezone: 'Etc/UTC', theme: 'dark', style: '1', locale: 'en',
      allow_symbol_change: true, hide_top_toolbar: false, hide_legend: false, save_image: false,
      calendar: false, support_host: 'https://www.tradingview.com',
    });
    script.onerror = () => setFailed(true);
    root.append(widget, script);
    return () => { script.onerror = null; root.replaceChildren(); };
  }, [symbol, height, visible, attempt]);

  return <>
    <div ref={rootRef} className="tradingview-widget-container w-full overflow-hidden rounded-xl border border-themed" style={{ minHeight: failed ? 0 : height }} />
    {failed && <div role="status" className="rounded-xl border border-themed p-4 text-xs">
      Chart preview unavailable. <button type="button" className="btn-secondary" onClick={() => setAttempt(n => n + 1)}>Retry chart</button>
    </div>}
  </>;
}
