import { useRef, useState } from 'react';
import { X, Image as ImageIcon, Loader2 } from 'lucide-react';
import { privateDocumentDownload, uploadPrivateMedia } from '@/lib/media';
import { MediaImage } from './MediaPreview';

interface ScreenshotUploadProps {
  allowDocuments?: boolean;
  documentsOnly?: boolean;
  onUpload: (url: string) => void;
  existingUrl?: string | null;
  label?: string;
  onUploadingChange?: (uploading: boolean) => void;
}

export function ScreenshotUpload({ onUpload, existingUrl, label, onUploadingChange, allowDocuments = false, documentsOnly = false }: ScreenshotUploadProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(existingUrl || null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleFile = async (file: File) => {
    if (uploading) return;
    setError(null);
    const isDocument = ['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(file.type);
    if (documentsOnly && !isDocument) { setError('Choose a PDF or DOCX document.'); return; }
    if (isDocument && !allowDocuments && !documentsOnly) { setError('Choose an image.'); return; }
    setUploading(true);
    onUploadingChange?.(true);
    try {
      const ref = await uploadPrivateMedia(file, isDocument ? 'document' : 'image');
      setImageUrl(ref);
      onUpload(ref);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Failed to upload screenshot. Please try again.');
    } finally {
      setUploading(false);
      onUploadingChange?.(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const removeImage = () => {
    setImageUrl(null);
    onUpload('');
    if (inputRef.current) inputRef.current.value = '';
  };

  if (imageUrl) {
    const download = privateDocumentDownload(imageUrl);
    return (
      <div className="relative group rounded-xl overflow-hidden border border-themed">
        {download ? <a className="btn-secondary" href={download}>Download document</a> : <MediaImage source={imageUrl} alt="Trade screenshot" className="w-full max-h-64 object-contain bg-secondary" />}
        <button
          type="button"
          aria-label="Remove attachment"
          onClick={removeImage}
          disabled={uploading}
          className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/80"
        >
          <X size={16} />
        </button>
      </div>
    );
  }

  return (
    <div>
      <div
        role="button" tabIndex={0} aria-label={label || "Upload image"}
        onKeyDown={e => { if (!uploading && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); inputRef.current?.click(); } }}
        onClick={() => { if (!uploading) inputRef.current?.click(); }}
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        className="flex flex-col items-center justify-center gap-2 p-8 rounded-xl border-2 border-dashed border-themed cursor-pointer hover:border-brand-500 transition-colors"
      >
        {uploading ? (
          <Loader2 size={24} className="animate-spin text-muted" />
        ) : (
          <>
            <ImageIcon size={24} className="text-muted" />
            <p className="text-sm text-secondary">{label || 'Click or drag to upload a screenshot'}</p>
            <p className="text-xs text-muted">Private to your account · {documentsOnly ? "PDF, DOCX" : allowDocuments ? "Images, PDF, DOCX" : "PNG, JPG, WebP"} · up to 15 MB</p>
          </>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={[...(documentsOnly ? [] : ["image/png","image/jpeg","image/webp","image/gif","image/avif"]),...(allowDocuments || documentsOnly ? [".pdf",".docx"] : [])].join(",")}
        className="hidden"
        disabled={uploading}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />
      {error && <p className="mt-2 text-xs text-error-500">{error}</p>}
    </div>
  );
}
