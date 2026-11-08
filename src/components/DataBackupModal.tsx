import { useMemo, useState } from 'react';
import { Archive, CheckCircle2, Download, FileUp, LoaderCircle, ShieldCheck } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { RESTORE_ORDER, WORKSPACE_TABLES } from '@/lib/workspaceTables';

const BACKUP_FORMAT = 'trade-journal-pro-backup';
const BACKUP_VERSION = 1;
const MAX_BACKUP_BYTES = 128 * 1024 * 1024;
const backupTooLarge = 'This backup exceeds the 128 MiB browser backup limit.';

const EXPORT_TABLES = WORKSPACE_TABLES;

interface BackupMedia {
  bucket: 'trading-media';
  path: string;
  contentType: string;
  base64: string;
}

interface TradingBackup {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  sourceProject: string;
  ownerId: string;
  data: Record<string, Record<string, unknown>[]>;
  media: BackupMedia[];
  unavailableTables: string[];
}

interface DataBackupModalProps { open: boolean; onClose: () => void }

function projectHost(): string {
  const configuredProject = import.meta.env.VITE_SUPABASE_URL;
  if (configuredProject) {
    try { return new URL(configuredProject).host; }
    catch { return 'invalid-project-url'; }
  }
  return window.location.host || 'local-workspace';
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
  }
  return btoa(binary);
}

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function downloadJson(payload: TradingBackup) {
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  if (blob.size > MAX_BACKUP_BYTES) throw new Error(backupTooLarge);
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = `trade-journal-backup-${payload.exportedAt.slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(href);
}

function isBackup(value: unknown): value is TradingBackup {
  if (!value || typeof value !== 'object') return false;
  const payload = value as Partial<TradingBackup>;
  return payload.format === BACKUP_FORMAT
    && payload.version === BACKUP_VERSION
    && typeof payload.ownerId === 'string'
    && typeof payload.sourceProject === 'string'
    && !!payload.data
    && typeof payload.data === 'object'
    && Object.values(payload.data).every(rows => Array.isArray(rows) && rows.every(row => !!row && typeof row === 'object'))
    && Array.isArray(payload.media)
    && payload.media.every(item => !!item && item.bucket === 'trading-media' && typeof item.path === 'string' && typeof item.contentType === 'string' && typeof item.base64 === 'string')
    && Array.isArray(payload.unavailableTables);
}

export function DataBackupModal({ open, onClose }: DataBackupModalProps) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [backup, setBackup] = useState<TradingBackup | null>(null);
  const [acceptPartialRestore, setAcceptPartialRestore] = useState(false);

  const currentProject = useMemo(projectHost, []);
  const sameOwner = !!user && backup?.ownerId === user.id;
  const sameProject = backup?.sourceProject === currentProject;
  const canRestore = !!backup && sameOwner && sameProject && !busy
    && (!backup.unavailableTables.length || acceptPartialRestore);
  const recordCount = backup ? Object.entries(backup.data).filter(([table]) => table !== 'profiles').reduce((count, [, rows]) => count + rows.length, 0) : 0;

  const handleExport = async () => {
    if (!user || busy) return;
    setBusy(true); setError(''); setMessage(''); setProgress('Preparing your records…');
    try {
      const data: TradingBackup['data'] = {};
      const unavailableTables: string[] = [];
      let strategyIds: string[] = [];
      for (let index = 0; index < EXPORT_TABLES.length; index += 1) {
        const table = EXPORT_TABLES[index];
        setProgress(`Reading ${table.replace(/_/g, ' ')} (${index + 1}/${EXPORT_TABLES.length})…`);
        if (table === 'strategy_checklist_items') {
          if (!strategyIds.length) { data[table] = []; continue; }
          const { data: rows, error: queryError } = await supabase.from(table).select('*').in('strategy_id', strategyIds);
          if (queryError) { data[table] = []; unavailableTables.push(table); }
          else data[table] = (rows || []) as Record<string, unknown>[];
          continue;
        }
        const { data: rows, error: queryError } = await supabase.from(table).select('*').eq('user_id', user.id);
        if (queryError) {
          data[table] = [];
          unavailableTables.push(table);
          continue;
        }
        data[table] = (rows || []) as Record<string, unknown>[];
        if (table === 'trader_strategies') strategyIds = data[table].map(row => String(row.id));
      }

      const { data: profileRows, error: profileError } = await supabase.from('profiles').select('*').eq('id', user.id);
      data.profiles = profileError ? [] : (profileRows || []) as Record<string, unknown>[];
      if (profileError) unavailableTables.push('profiles');

      const media: BackupMedia[] = [];
      const paths = new Set<string>();
      let estimatedBytes = new Blob([JSON.stringify(data)]).size;
      if (estimatedBytes > MAX_BACKUP_BYTES) throw new Error(backupTooLarge);
      const queue = [{provider:'supabase',folder:'',cursor:''},{provider:'r2',folder:'',cursor:''}];
      const visited=new Set<string>();
      const providerPaths=new Set<string>();
      while (queue.length) {
        const item=queue.shift()!;
        const params=new URLSearchParams(item).toString();
        if(visited.has(params)) throw new Error('Media listing stopped advancing.');
        visited.add(params);
        const reply=await fetch('/api/media/page?'+params);
        if(!reply.ok) throw new Error('Could not list private attachments.');
        const page=await reply.json() as {files:{id:string;name:string;metadata?:{mimetype?:string}}[];folders:string[];next:string|null};
        const files=page.files;
        if(page.next!==null) queue.push({...item,cursor:page.next});
        for(const folder of page.folders) queue.push({...item,folder,cursor:''});
        for (const file of files || []) {
          if (!file.id) continue;
          const path = `${user.id}/${file.name}`;
          const key=item.provider+'|'+path;
          if(providerPaths.has(key)) throw new Error('Attachment listing repeated a file. Retry the backup.');
          providerPaths.add(key);
          if(paths.has(path)) continue;
          paths.add(path);
          setProgress(`Backing up attachment ${media.length + 1}…`);
          const { data: blob, error: downloadError } = await supabase.storage.from('trading-media').download(path);
          if (downloadError || !blob) throw new Error(`Could not read an attachment (${file.name}): ${downloadError?.message || 'file unavailable'}`);
          estimatedBytes += 4 * Math.ceil(blob.size / 3);
          if (estimatedBytes > MAX_BACKUP_BYTES) throw new Error(backupTooLarge);
          media.push({ bucket: 'trading-media', path, contentType: blob.type || file.metadata?.mimetype || 'application/octet-stream', base64: encodeBase64(new Uint8Array(await blob.arrayBuffer())) });
        }

      }

      const payload: TradingBackup = {
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        exportedAt: new Date().toISOString(),
        sourceProject: currentProject,
        ownerId: user.id,
        data,
        media,
        unavailableTables,
      };
      downloadJson(payload);
      const records = Object.entries(data).filter(([table]) => table !== 'profiles').reduce((count, [, rows]) => count + rows.length, 0);
      setMessage(`Backup downloaded with ${records} records and ${media.length} private attachments.${unavailableTables.length ? ` Some tables were unavailable: ${unavailableTables.join(', ')}.` : ''}`);
      setProgress('');
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : 'Backup could not be completed.');
      setProgress('');
    } finally { setBusy(false); }
  };

  const handleFile = async (file?: File) => {
    setBackup(null); setError(''); setMessage('');
    setAcceptPartialRestore(false);
    if (!file) return;
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error(backupTooLarge);
      const parsed: unknown = JSON.parse(await file.text());
      if (!isBackup(parsed)) throw new Error('This file is not a supported Young-Money-Fx backup.');
      setBackup(parsed);
    } catch (fileError) {
      setError(fileError instanceof Error ? fileError.message : 'Could not read this backup file.');
    }
  };

  const handleRestore = async () => {
    if (!user || !backup || !canRestore) return;
    setBusy(true); setError(''); setMessage('');
    let restoredRows = 0;
    let skippedRows = 0;
    let restoredMedia = 0;
    let skippedMedia = 0;
    try {
      for (let index = 0; index < backup.media.length; index += 1) {
        const item = backup.media[index];
        if (item.bucket !== 'trading-media' || !item.path.startsWith(`${user.id}/`)) throw new Error('The backup contains a media path outside this account.');
        setProgress(`Restoring private attachment ${index + 1}/${backup.media.length}…`);
        const fileBytes = decodeBase64(item.base64);
        const { error: uploadError } = await supabase.storage.from(item.bucket).upload(item.path, new Blob([fileBytes.buffer as ArrayBuffer], { type: item.contentType }), { contentType: item.contentType, upsert: false });
        if (uploadError) {
          if (uploadError.message.toLowerCase().includes('already exists') || uploadError.message.toLowerCase().includes('duplicate')) skippedMedia += 1;
          else throw new Error(`Could not restore an attachment (${item.path.split('/').pop()}): ${uploadError.message}`);
        } else restoredMedia += 1;
      }

      const availableTables = RESTORE_ORDER.filter(table => Array.isArray(backup.data[table]) && backup.data[table].length > 0);
      for (let index = 0; index < availableTables.length; index += 1) {
        const table = availableTables[index];
        const rows = backup.data[table];
        if (rows.some(row => row.user_id !== undefined && row.user_id !== backup.ownerId)) throw new Error(`Backup ownership validation failed for ${table}.`);
        setProgress(`Restoring ${table.replace(/_/g, ' ')} (${index + 1}/${availableTables.length})…`);
        const conflictKey = table === 'instrument_favorites' ? 'user_id,instrument_id' : 'id';
        for (let offset = 0; offset < rows.length; offset += 100) {
          const chunk = rows.slice(offset, offset + 100);
          const resultField = table === 'instrument_favorites' ? 'instrument_id' : 'id';
          const { data: insertedRows, error: insertError } = await supabase.from(table).upsert(chunk, { onConflict: conflictKey, ignoreDuplicates: true }).select(resultField);
          if (insertError) throw new Error(`Could not restore ${table} after ${restoredRows} records: ${insertError.message}`);
          const insertedCount = insertedRows?.length || 0;
          restoredRows += insertedCount;
          skippedRows += chunk.length - insertedCount;
        }
      }

      const profile = backup.data.profiles?.[0];
      if (profile) {
        const { data: currentProfile, error: profileReadError } = await supabase.from('profiles').select('display_name,avatar_url,bio,trading_style').eq('id', user.id).maybeSingle();
        if (profileReadError) throw new Error(`Records restored, but profile details could not be checked: ${profileReadError.message}`);
        const updates: Record<string, unknown> = {};
        for (const key of ['display_name', 'avatar_url', 'bio', 'trading_style'] as const) {
          if (key in profile && (currentProfile?.[key] == null || currentProfile[key] === '')) updates[key] = profile[key];
        }
        if (Object.keys(updates).length) {
          const { error: profileUpdateError } = await supabase.from('profiles').update(updates).eq('id', user.id);
          if (profileUpdateError) throw new Error(`Records restored, but profile details could not be restored: ${profileUpdateError.message}`);
        }
      }

      const partial = backup.unavailableTables.length ? ` The original backup lacked tables: ${backup.unavailableTables.join(', ')}.` : '';
      setMessage(`Restore finished: ${restoredRows} record rows added, ${skippedRows} already existed, ${restoredMedia} attachments restored, and ${skippedMedia} already existed.${partial}`);
      setProgress('');
    } catch (restoreError) {
      setError(`${restoreError instanceof Error ? restoreError.message : 'Restore could not be completed.'} You can retry this file; existing rows are skipped, so the restore is resumable.`);
      setProgress('');
    } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Data Backup & Restore" size="lg">
      <div className="space-y-5">
        <div className="flex gap-3 rounded-xl border border-themed bg-secondary/40 p-4">
          <ShieldCheck size={19} className="mt-0.5 shrink-0 text-emerald-500" />
          <p className="text-xs leading-relaxed text-secondary">Backups stay on your device until you choose where to save them. They include your records and private image/voice attachments, but never your password or sign-in session. Restore works only for this same account and database and adds missing records without replacing existing records.</p>
        </div>

        {error && <p role="alert" className="rounded-lg border border-error-500/25 bg-error-500/10 p-3 text-sm text-error-500">{error}</p>}
        {message && <p role="status" className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 p-3 text-sm text-emerald-600">{message}</p>}
        {progress && <p role="status" className="flex items-center gap-2 text-xs text-secondary"><LoaderCircle size={14} className="animate-spin" />{progress}</p>}

        <section className="rounded-xl border border-themed p-4">
          <h3 className="text-sm font-bold">Create a backup</h3>
          <p className="mt-1 text-xs text-muted">Exports your plans, rules, strategies, trades, accounts, tests, reviews, notes, profile, and uploaded media into one versioned JSON file.</p>
          <button type="button" onClick={handleExport} disabled={busy || !user} className="btn-primary mt-3"><Download size={15} /> Download backup</button>
        </section>

        <section className="rounded-xl border border-themed p-4">
          <h3 className="text-sm font-bold">Restore a backup</h3>
          <p className="mt-1 text-xs text-muted">Choose a backup file to inspect its account, database, record count, and included attachments before restoring.</p>
          <label className="btn-secondary mt-3 inline-flex cursor-pointer"><FileUp size={15} /> Choose backup file<input type="file" accept="application/json,.json" className="sr-only" onChange={event => { void handleFile(event.target.files?.[0]); event.currentTarget.value = ''; }} /></label>
          {backup && <div className="mt-4 rounded-lg bg-secondary/50 p-3 text-xs">
            <p className="font-semibold">Backup from {new Date(backup.exportedAt).toLocaleString()}</p>
            <p className="mt-1 text-secondary">{recordCount} records · {backup.media.length} private attachments</p>
            {!sameOwner && <p className="mt-2 text-amber-600">This backup belongs to a different sign-in. Sign into its original account to restore it.</p>}
            {!sameProject && <p className="mt-1 text-amber-600">This backup came from a different database and cannot safely restore linked records here.</p>}
            {!!backup.unavailableTables.length && <div className="mt-2 space-y-2 text-amber-600"><p>Partial backup: unavailable collections will remain missing after restore.</p><label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={acceptPartialRestore} onChange={event => setAcceptPartialRestore(event.target.checked)} /><span>I understand this backup is incomplete and want to restore its available data.</span></label></div>}
            {canRestore && <button type="button" onClick={handleRestore} className="btn-primary mt-3" disabled={busy}><Archive size={15} /> Restore missing records</button>}
          </div>}
        </section>

        <p className="flex items-start gap-2 text-[11px] leading-relaxed text-muted"><CheckCircle2 size={14} className="mt-0.5 shrink-0" />Keep a copy somewhere separate from this computer. Backups can contain private journal notes, account identifiers, and media.</p>
      </div>
    </Modal>
  );
}
