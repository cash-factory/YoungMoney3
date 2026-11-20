import { useEffect, useRef, type RefObject } from 'react';

const scopes: HTMLElement[] = [];
let previousOverflow = '';
const focusableSelector = 'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function useDialogFocus(open: boolean, container: RefObject<HTMLElement>, onClose: () => void) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const element = container.current;
    if (!open || !element) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (scopes.length === 0) {
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    scopes.push(element);
    const candidates = () => Array.from(element.querySelectorAll<HTMLElement>(focusableSelector))
      .filter(item => item.getClientRects().length && !item.closest('[inert]'));
    const frame = requestAnimationFrame(() => {
      const first = element.querySelector<HTMLElement>('[data-autofocus]') || candidates()[0] || element;
      first.focus();
    });
    const handleKey = (event: KeyboardEvent) => {
      if (scopes[scopes.length - 1] !== element) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
      }
      if (event.key !== 'Tab') return;
      const items = candidates();
      if (!items.length) {
        event.preventDefault();
        element.focus();
        return;
      }
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || !element.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !element.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKey, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKey, true);
      const index = scopes.lastIndexOf(element);
      if (index >= 0) scopes.splice(index, 1);
      if (!scopes.length) document.body.style.overflow = previousOverflow;
      requestAnimationFrame(() => {
        const top = scopes[scopes.length - 1];
        if (trigger?.isConnected && !trigger.closest('[inert]') && (!top || top.contains(trigger))) trigger.focus();
      });
    };
  }, [open, container]);
}
