import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

export function Modal({ open, onClose, title, children, size = 'md' }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handler);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  const sizeClass = {
    sm: 'max-w-md',
    md: 'max-w-2xl',
    lg: 'max-w-4xl',
    xl: 'max-w-6xl',
  }[size];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-2 [padding-bottom:env(safe-area-inset-bottom)] sm:p-6">
      <div className="fixed inset-0 bg-black/70 backdrop-blur-md animate-fade-in" onClick={onClose} />
      <div className={`relative w-full ${sizeClass} my-1 sm:my-8`}>
        <div className="absolute -inset-2 rounded-3xl bg-gradient-to-br from-orange-500/15 via-amber-500/10 to-orange-500/15 blur-2xl animate-fade-in pointer-events-none" />
        <div className="relative card card-glass animate-modal-enter shadow-2xl ring-1 ring-orange-500/5 max-h-[calc(100dvh-0.5rem)] sm:max-h-[85dvh] flex flex-col rounded-xl sm:rounded-2xl">
          <div className="absolute inset-x-0 top-0 h-0.5 rounded-t-2xl bg-gradient-to-r from-orange-400 via-orange-500 to-amber-500" />
          <div className="flex items-center justify-between border-b border-themed px-4 py-3 sm:px-6 sm:py-4 shrink-0">
            <h2 className="text-lg font-bold tracking-tight">{title}</h2>
            <button type="button" aria-label="Close dialog" onClick={onClose} className="btn-ghost p-1.5 rounded-lg transition-transform duration-300 hover:rotate-90">
              <X size={20} />
            </button>
          </div>
          <div className="p-4 sm:p-6 overflow-y-auto overscroll-contain">{children}</div>
        </div>
      </div>
    </div>
  );
}
