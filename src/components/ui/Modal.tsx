import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './modal-system.css';

const openDialogs: HTMLDivElement[] = [];
let previousOverflow = '';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

export function Modal({ open, onClose, title, children, size = 'md' }: ModalProps) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  const titleId = useId();
  useEffect(() => { close.current = onClose; }, [onClose]);
  useEffect(() => {
    const dialog = panel.current;
    if (!open || !dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!openDialogs.length) {
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    openDialogs.push(dialog);
    dialog.focus({ preventScroll: true });
    function handleKey(event: KeyboardEvent) {
      if (event.defaultPrevented || !dialog || openDialogs[openDialogs.length - 1] !== dialog) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        close.current();
      } else if (event.key === 'Tab') {
        const focusable = [...dialog.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, summary, [tabindex]')]
          .filter(node => node.tabIndex >= 0 && !node.matches(':disabled') && node.getClientRects().length);
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
          event.preventDefault();
          (last || dialog).focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          (first || dialog).focus();
        }
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('keydown', handleKey);
      const wasTop = openDialogs[openDialogs.length - 1] === dialog;
      openDialogs.splice(openDialogs.indexOf(dialog), 1);
      if (!openDialogs.length) document.body.style.overflow = previousOverflow;
      if (wasTop && opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;

  const sizeClass = {
    sm: 'max-w-md',
    md: 'max-w-2xl',
    lg: 'max-w-4xl',
    xl: 'max-w-6xl',
  }[size];

  return createPortal(
    <div onClick={event => event.stopPropagation()} className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-2 [padding-bottom:env(safe-area-inset-bottom)] sm:p-6">
      <div className="fixed inset-0 bg-black/70 backdrop-blur-md animate-fade-in" onClick={onClose} />
      <div className={`relative w-full ${sizeClass} my-1 sm:my-8`}>
        <div className="ym-modal-aura absolute -inset-2 rounded-3xl blur-2xl pointer-events-none" />
        <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="ym-modal-panel relative card card-glass shadow-2xl max-h-[calc(100dvh-0.5rem)] sm:max-h-[85dvh] flex flex-col rounded-xl sm:rounded-2xl">
          <div className="ym-modal-accent absolute inset-x-0 top-0 h-0.5 rounded-t-2xl" />
          <div className="flex items-center justify-between border-b border-themed px-4 py-3 sm:px-6 sm:py-4 shrink-0">
            <h2 id={titleId} className="text-lg font-bold tracking-tight">{title}</h2>
            <button type="button" aria-label="Close dialog" onClick={onClose} className="ym-modal-close btn-ghost p-1.5 rounded-lg">
              <X size={20} />
            </button>
          </div>
          <div className="p-4 sm:p-6 overflow-y-auto overscroll-contain">{children}</div>
        </div>
      </div>
    </div>, document.body
  );
}
