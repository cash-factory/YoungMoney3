import { useEffect, useState } from 'react';
import { ImageOff, MicOff, RefreshCw } from 'lucide-react';
import { privateDocumentDownload, resolveMediaUrl } from '@/lib/media';

function useResolvedSource(source: string | null | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    setUrl(null);
    setFailed(false);
    if (!source) { setFailed(true); return () => { active = false; }; }
    resolveMediaUrl(source).then(value => {
      if (active) {
        if (value.startsWith('blob:')) objectUrl = value;
        setUrl(value);
      } else if (value.startsWith('blob:')) URL.revokeObjectURL(value);
    }).catch(() => { if (active) setFailed(true); });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [source, attempt]);
  return { url, failed, markFailed: () => setFailed(true), retry: () => setAttempt(value => value + 1) };
}

export function MediaImage({ source, alt, className, onClick }: { source: string; alt: string; className?: string; onClick?: () => void }) {
  const documentUrl = privateDocumentDownload(source);
  const { url, failed, markFailed, retry } = useResolvedSource(documentUrl ? null : source);
  if (documentUrl) return <a className="btn-secondary" href={documentUrl}>Download {alt}</a>;
  if (failed) return <div role="status" className={`flex min-h-20 items-center justify-center gap-2 bg-secondary px-3 text-xs text-muted ${className || ''}`}><ImageOff size={15} /> Image unavailable <button type="button" onClick={retry} className="inline-flex items-center gap-1 text-orange-500"><RefreshCw size={12} /> Retry</button></div>;
  if (!url) return <div className={`flex min-h-20 items-center justify-center bg-secondary text-xs text-muted ${className || ''}`}>Loading attachment…</div>;
  return (
    <img
      src={url}
      alt={alt}
      className={className}
      onError={markFailed}
      onClick={onClick}
      onKeyDown={onClick ? event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick();
        }
      } : undefined}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    />
  );
}

export function MediaAudioPlayer({ source, className }: { source: string; className?: string }) {
  const { url, failed, markFailed, retry } = useResolvedSource(source);
  if (failed) return <span role="status" className="inline-flex items-center gap-2 text-xs text-muted"><MicOff size={14} /> Voice note unavailable <button type="button" onClick={retry} className="inline-flex items-center gap-1 text-orange-500"><RefreshCw size={12} /> Retry</button></span>;
  return url ? <audio controls src={url} className={className} onError={markFailed} /> : <span className="text-xs text-muted">Loading voice note…</span>;
}
