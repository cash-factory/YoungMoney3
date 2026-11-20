import { Loader2 } from 'lucide-react';

export function LoadingSpinner({ label }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col items-center justify-center gap-3 py-20">
      <Loader2 aria-hidden="true" className="animate-spin text-brand-500" size={24} strokeWidth={1.6} />
      <p className="text-sm text-secondary">{label || 'Loading…'}</p>
    </div>
  );
}

export function EmptyState({ icon, title, message }: { icon?: React.ReactNode; title: string; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      {icon && (
        <div className="mb-4">
          <div className="p-3 rounded-xl bg-secondary border border-themed text-secondary">
            {icon}
          </div>
        </div>
      )}
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="mt-1.5 text-sm text-muted max-w-sm leading-relaxed">{message}</p>
    </div>
  );
}
