import { supabase } from '@/lib/supabase';

const REF_PREFIX = 'private-media://';
const FILE_EXTENSION_BY_TYPE: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'image/avif': 'avif',
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'audio/aac': 'aac',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/webm': 'webm',
  'audio/x-wav': 'wav',
};

export function privateMediaRef(bucket: string, path: string): string {
  return `${REF_PREFIX}${bucket}/${path}`;
}

export function parsePrivateMediaRef(value: string): { bucket: string; path: string } | null {
  if (!value.startsWith(REF_PREFIX)) return null;
  const remainder = value.slice(REF_PREFIX.length);
  const slash = remainder.indexOf('/');
  if (slash < 1) return null;
  return { bucket: remainder.slice(0, slash), path: remainder.slice(slash + 1) };
}

export async function resolveMediaUrl(value: string): Promise<string> {
  const ref = parsePrivateMediaRef(value);
  if (!ref) return value;
  const { data, error } = await supabase.storage.from(ref.bucket).createSignedUrl(ref.path, 3600);
  if (error || !data?.signedUrl) throw error || new Error('Could not create media link');
  return data.signedUrl;
}

export async function uploadPrivateMedia(file: File | Blob, kind: 'image' | 'audio' | 'document'): Promise<string> {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) throw new Error('Sign in before uploading media.');
  const contentType = file.type.split(';', 1)[0].trim().toLowerCase() || (kind === 'audio' ? 'audio/webm' : '');
  const extension = FILE_EXTENSION_BY_TYPE[contentType];
  if (!extension || !(kind === 'document' ? ['pdf','docx'].includes(extension) : contentType.startsWith(`${kind}/`))) {
    throw new Error(kind === 'image'
      ? 'Use a PNG, JPEG, WebP, GIF, or AVIF image.'
      : kind === 'document' ? 'Choose a PDF or DOCX document.' : 'Use a supported AAC, MP4, MPEG, OGG, WAV, or WebM voice note.');
  }
  if (file.size > 15 * 1024 * 1024) throw new Error('Attachments must be 15 MB or smaller.');
  if (!file.size) throw new Error('The attachment is empty.');
  const filename = kind === 'document' && file instanceof File ? file.name.replace(/[^a-zA-Z0-9_.-]/g,'_').replace(/\.[^.]+$/,'').slice(0,100) : '';
  const path = `${authData.user.id}/${crypto.randomUUID()}${filename ? '_'+filename : ''}.${extension}`;
  const { error } = await supabase.storage.from('trading-media').upload(path, file, { contentType, upsert: false });
  if (error) {
    throw new Error(typeof error.message === 'string' ? error.message : 'Failed to upload attachment. Please try again.');
  }
  return privateMediaRef('trading-media', path);
}

export function privateDocumentDownload(source: string): string | null {
  const ref = parsePrivateMediaRef(source);
  if (!ref || ref.bucket !== 'trading-media' || !/\.(pdf|docx)$/i.test(ref.path)) return null;
  return '/api/media/download?' + new URLSearchParams({path:ref.path});
}
