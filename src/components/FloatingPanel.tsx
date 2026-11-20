import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject, type HTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import '@/controls.css';

/** An anchored menu that stays inside the viewport, regardless of its scroll parent. */
export function FloatingPanel({ anchor, onDismiss, children, maxHeight = 300, minWidth = 180, className = '', ...props }: HTMLAttributes<HTMLDivElement> & {
  anchor: RefObject<HTMLElement>; onDismiss: () => void; children: ReactNode; maxHeight?: number; minWidth?: number;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  const [position, setPosition] = useState<{ top?: number; bottom?: number; left: number; width: number; maxHeight: number }>({ top: 0, left: 0, width: 0, maxHeight });
  useLayoutEffect(() => {
    const update = () => {
      const box = anchor.current?.getBoundingClientRect();
      if (!box) return;
      const view = window.visualViewport;
      const top = view?.offsetTop ?? 0;
      const left = view?.offsetLeft ?? 0;
      const height = view?.height ?? window.innerHeight;
      const width = view?.width ?? window.innerWidth;
      if (box.bottom < top || box.top > top + height) { dismiss.current(); return; }
      const above = Math.max(0, box.top - top - 14);
      const below = Math.max(0, top + height - box.bottom - 14);
      const up = below < maxHeight && above > below;
      const size = Math.min(maxHeight, up ? above : below);
      const panelWidth = Math.min(Math.max(box.width, minWidth), width - 24);
      setPosition({ top: up ? undefined : box.bottom + 6, bottom: up ? window.innerHeight - box.top + 6 : undefined, left: Math.max(left + 12, Math.min(box.left, left + width - panelWidth - 12)), width: panelWidth, maxHeight: size });
    };
    const outside = (event: Event) => {
      const target = event.target as Node;
      if (!anchor.current?.contains(target) && !panel.current?.contains(target)) dismiss.current();
    };
    update();
    document.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    return () => {
      document.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', outside);
    };
  }, [anchor, maxHeight, minWidth]);
  return createPortal(<div {...props} ref={panel} data-positioned={position.width > 0 ? "true" : undefined} className={`ym-floating-panel ${className}`} style={{ ...position, visibility: position.width > 0 ? 'visible' : 'hidden', pointerEvents: position.width > 0 ? 'auto' : 'none' }}>{children}</div>, document.body);
}
