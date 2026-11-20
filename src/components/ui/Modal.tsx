import { useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useDialogFocus } from '@/hooks/useDialogFocus';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

export function Modal({ open, onClose, title, children, size = 'md' }: ModalProps) {
  const titleId = useId();
  const surfaceRef = useRef<HTMLDivElement>(null);
  useDialogFocus(open, surfaceRef, onClose);
  if (!open) return null;

  const sizeClass = { sm: 'max-w-md', md: 'max-w-2xl', lg: 'max-w-4xl', xl: 'max-w-6xl' }[size];
  return createPortal(
    <div className="ym-modal-layer fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-2 [padding-bottom:env(safe-area-inset-bottom)] sm:p-6">
      <div className="ym-modal-backdrop fixed inset-0" onMouseDown={onClose} aria-hidden="true" />
      <div ref={surfaceRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
        className={`ym-modal-surface relative w-full ${sizeClass} my-1 sm:my-8 card max-h-[calc(100dvh-0.5rem)] sm:max-h-[85dvh] flex flex-col rounded-xl sm:rounded-2xl outline-none`}>
        <header className="ym-modal-header flex items-center justify-between gap-4 border-b border-themed px-4 py-4 sm:px-6 shrink-0">
          <h2 id={titleId} className="text-base sm:text-lg font-semibold tracking-tight">{title}</h2>
          <button type="button" aria-label="Close dialog" onClick={onClose} className="ym-icon-button btn-ghost p-2 rounded-lg">
            <X size={19} />
          </button>
        </header>
        <div className="ym-modal-body p-4 sm:p-6 overflow-y-auto overscroll-contain">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
