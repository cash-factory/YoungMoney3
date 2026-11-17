import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, FolderOpen, Image, LayoutGrid, List, Mic, RefreshCw, Search, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { buildMediaLibrary, MEDIA_RECORD_SOURCES, type LibraryAsset, type LibraryFile, type LibraryKind, type LibraryPhase } from '@/lib/mediaLibrary';
import { MediaAudioPlayer, MediaImage } from '@/components/MediaPreview';
import '@/library-studio.css';

async function listPrivateUploads(signal: AbortSignal): Promise<LibraryFile[]> {
  const queue = [{ provider: 'supabase', folder: '', cursor: '' }, { provider: 'r2', folder: '', cursor: '' }];
  const visited = new Set<string>();
  const files = new Map<string, LibraryFile>();
  while (queue.length) {
    const item = queue.shift()!;
    const query = new URLSearchParams(item).toString();
    if (visited.has(query)) throw new Error('The attachment list stopped advancing. Please refresh.');
    visited.add(query);
    const response = await fetch('/api/media/page?' + query, { signal, credentials: 'same-origin' });
    if (!response.ok) throw new Error('Uploaded files could not be listed. Linked attachments are still shown.');
    const page = await response.json() as { files: LibraryFile[]; folders: string[]; next: string | null };
    if (!Array.isArray(page.files) || !Array.isArray(page.folders)) throw new Error('The attachment list was incomplete. Please refresh.');
    for (const file of page.files) if (typeof file.name === 'string') files.set(file.name, file);
    for (const folder of page.folders) queue.push({ ...item, folder, cursor: '' });
    if (page.next !== null) queue.push({ ...item, cursor: page.next });
  }
  return [...files.values()];
}

function dateLabel(value: string | null) {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'Date unavailable';
}
function recordHref(page: string, tradeId?: string) {
  const url = new URL(window.location.href);
  url.searchParams.delete('trade');
  if (tradeId) url.searchParams.set('trade', tradeId);
  url.hash = page;
  return url.pathname + url.search + url.hash;
}
function AssetReferences({ asset }: { asset: LibraryAsset }) {
  return <div className="ym-library-references">
    {asset.references.length ? asset.references.map(reference => <div key={reference.table + ':' + reference.id + ':' + reference.phase}>
      <a href={recordHref(reference.page, reference.table === 'trades' ? reference.id : undefined)}>
        <span>{reference.title}</span><ArrowUpRight size={14} aria-hidden="true" />
      </a>
      <small>{MEDIA_RECORD_SOURCES.find(source => source.table === reference.table)?.label} · {reference.phase === 'general' ? 'Attachment' : reference.phase === 'entry' ? 'Entry capture' : 'Closure review'}</small>
      {reference.table !== 'trades' && reference.tradeIds.map(id => <a key={id} className="ym-library-related-trade" href={recordHref('trades', id)}>View linked trade <ArrowUpRight size={13} /></a>)}
    </div>) : <p className="text-muted text-xs">No saved record references this upload.</p>}
  </div>;
}
function AssetPreview({ asset, onClose }: { asset: LibraryAsset; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current;
    if (node && !node.open) node.showModal();
    // Removing a dialog closes it. Calling close() from effect cleanup would
    // dispatch onClose during React Strict Mode's effect replay.
  }, []);
  return <dialog ref={dialog} className="ym-library-lightbox" onCancel={onClose} onClose={onClose} aria-label="Attachment preview">
    <div className="ym-library-lightbox-header"><div><small>{asset.kind === 'image' ? 'Image preview' : 'Voice note'}</small><h2>{asset.references[0]?.title || asset.name}</h2></div><button type="button" className="btn-ghost" onClick={onClose} aria-label="Close attachment preview"><X size={22} /></button></div>
    <div className="ym-library-preview-body">{asset.kind === 'image' ? <MediaImage source={asset.source} alt={asset.references[0]?.title || asset.name} className="ym-library-full-image" /> : <div className="ym-library-audio-preview"><Mic size={44} /><MediaAudioPlayer source={asset.source} /></div>}</div>
    <div className="ym-library-preview-context"><p className="text-xs text-muted mb-3">Captured {dateLabel(asset.date)}</p><AssetReferences asset={asset} /></div>
  </dialog>;
}

export function MediaLibraryPage() {
  const { user } = useAuth();
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<LibraryKind | 'all'>('all');
  const [phase, setPhase] = useState<LibraryPhase | 'all' | 'unlinked'>('all');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [oldest, setOldest] = useState(false);
  const [shown, setShown] = useState(24);
  const [preview, setPreview] = useState<LibraryAsset | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setAssets([]); setPreview(null); setWarnings([]); setLoading(true);
    if (!user?.id) { setLoading(false); return () => controller.abort(); }
    const owner = user.id;
    void (async () => {
      const queries = MEDIA_RECORD_SOURCES.map(async source => {
        const result = await supabase.from(source.table).select('*').eq('user_id', owner);
        if (result.error) throw new Error(source.label);
        return { table: source.table, rows: (result.data || []) as Record<string, unknown>[] };
      });
      const results = await Promise.allSettled([listPrivateUploads(controller.signal), ...queries]);
      if (!active) return;
      const records: Record<string, Record<string, unknown>[]> = {};
      const notices: string[] = [];
      let files: LibraryFile[] = [];
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          notices.push(index === 0 ? 'Uploaded files could not be listed. Linked attachments are still shown.' : `${MEDIA_RECORD_SOURCES[index - 1].label} references could not be loaded.`);
        } else if (index === 0) files = result.value as LibraryFile[];
        else {
          const value = result.value as { table: string; rows: Record<string, unknown>[] };
          records[value.table] = value.rows;
        }
      });
      setAssets(buildMediaLibrary(owner, records, files));
      setWarnings(notices); setLoading(false);
    })();
    return () => { active = false; controller.abort(); };
  }, [user?.id, attempt]);

  const images = assets.filter(asset => asset.kind === 'image').length;
  const audio = assets.length - images;
  const linkedTrades = new Set(assets.flatMap(asset => asset.references.flatMap(reference => reference.tradeIds))).size;
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const result = assets.filter(asset => (kind === 'all' || kind === asset.kind)
      && (phase === 'all' || (phase === 'unlinked' ? !asset.references.length : asset.references.some(reference => reference.phase === phase)))
      && (!query || [asset.name, ...asset.references.flatMap(reference => [reference.title, reference.phase, reference.table, ...reference.tradeIds])].join(' ').toLowerCase().includes(query)));
    return oldest ? [...result].reverse() : result;
  }, [assets, kind, phase, search, oldest]);
  useEffect(() => { setShown(24); }, [kind, phase, search, oldest]);

  return <div className="ym-library">
    <header className="ym-library-hero">
      <div><p className="ym-library-kicker">THE ARCHIVE / YOUR TRADING STORY</p><h1>Media <span>Library</span></h1><p>Every chart. Every reflection. One place to revisit the decisions behind your trades.</p><div className="ym-library-hero-stats"><span><strong>{images}</strong> images</span><span><strong>{audio}</strong> voice notes</span><span><strong>{linkedTrades}</strong> linked trades</span></div></div>
      <div className="ym-library-art" aria-hidden="true"><img src="/visuals/media-still-life.png" alt="" /><span>CAPTURE / REFLECT / REVISIT</span></div>
    </header>
    <div className="ym-library-workbench">
      <aside className="ym-library-sidebar" aria-label="Library collections">
        <p className="ym-library-kicker">COLLECTIONS</p>
        {([{ id: 'all', label: 'All media', count: assets.length, Icon: FolderOpen }, { id: 'image', label: 'Images', count: images, Icon: Image }, { id: 'audio', label: 'Voice notes', count: audio, Icon: Mic }] as const).map(({ id, label, count, Icon }) => <button key={id} type="button" aria-pressed={kind === id} onClick={() => setKind(id)}><Icon size={17} /><span>{label}</span><small>{count}</small></button>)}
        <div className="ym-library-side-note"><span>CONNECTED TO YOUR WORK</span><p>Open any attachment to see its entry, closure review, or saved workspace record.</p></div>
      </aside>
      <section className="ym-library-results" aria-label="Media files">
        <div className="ym-library-toolbar"><label className="ym-library-search"><Search size={17} /><span className="sr-only">Search media or linked trade</span><input className="input-field" placeholder="Search media, instrument or trade…" value={search} onChange={event => setSearch(event.target.value)} /></label><button type="button" className="btn-secondary" disabled={loading} onClick={() => setAttempt(value => value + 1)} aria-label="Refresh media library"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button><div className="ym-library-view"><button type="button" aria-label="Grid view" aria-pressed={view === 'grid'} onClick={() => setView('grid')}><LayoutGrid size={17} /></button><button type="button" aria-label="List view" aria-pressed={view === 'list'} onClick={() => setView('list')}><List size={17} /></button></div></div>
        <div className="ym-library-filter-row"><div aria-label="Capture phase" className="ym-library-phase">{([{ id: 'all', label: 'All captures' }, { id: 'entry', label: 'Entry' }, { id: 'closure', label: 'Closure' }, { id: 'unlinked', label: 'Unlinked' }] as const).map(option => <button type="button" key={option.id} aria-pressed={phase === option.id} onClick={() => setPhase(option.id)}>{option.label}</button>)}</div><button type="button" className="ym-library-sort" onClick={() => setOldest(value => !value)}>{oldest ? 'Oldest first' : 'Newest first'} ↕</button></div>
        {!!warnings.length && <div role="alert" className="ym-library-warning"><p>{warnings.join(' ')}</p><button type="button" onClick={() => setAttempt(value => value + 1)}>Retry loading</button></div>}
        <p className="ym-library-result-count" role="status">{loading ? 'Loading your private archive…' : `${filtered.length} ${filtered.length === 1 ? 'attachment' : 'attachments'}`}</p>
        {loading ? <div className="ym-library-grid" aria-busy="true">{[1, 2, 3].map(number => <div key={number} className="ym-library-skeleton" />)}</div> : !filtered.length ? <div className="ym-library-empty"><FolderOpen size={38} /><h2>{assets.length ? 'No matching captures' : warnings.length ? 'Your archive could not be fully loaded' : 'Your story starts with a capture'}</h2><p>{assets.length ? 'Try another instrument, file type, or capture phase.' : 'Screenshots and voice notes uploaded in trades, journals, plans and tests will appear here automatically.'}</p>{!!assets.length && <button type="button" className="btn-secondary" onClick={() => { setSearch(''); setKind('all'); setPhase('all'); }}>Clear filters</button>}</div> : <div className={view === 'grid' ? 'ym-library-grid' : 'ym-library-list'}>
          {filtered.slice(0, shown).map(asset => <article key={asset.source} className="ym-library-card">
            <div className="ym-library-thumbnail">{asset.kind === 'image' ? <MediaImage source={asset.source} alt={asset.references[0]?.title || 'Uploaded screenshot'} className="ym-library-thumb-image" onClick={() => setPreview(asset)} /> : <><button type="button" className="ym-library-audio-cover" onClick={() => setPreview(asset)} aria-label={`Preview ${asset.references[0]?.title || 'voice note'}`}><Mic size={30} /><span className="ym-library-wave" aria-hidden="true">{[12, 24, 18, 34, 22, 42, 28, 18, 32, 16, 24, 12].map((height, i) => <i key={i} style={{ height }} />)}</span></button><MediaAudioPlayer source={asset.source} className="ym-library-audio-player" /></>}<span className="ym-library-type">{asset.kind === 'image' ? 'IMAGE' : 'VOICE NOTE'}</span></div>
            <div className="ym-library-card-content"><div className="ym-library-card-heading"><div><h2>{asset.references[0]?.title || asset.name}</h2><p>{dateLabel(asset.date)}</p></div><button type="button" className="ym-library-open" aria-label="Open attachment details" onClick={() => setPreview(asset)}><ArrowUpRight size={19} /></button></div><AssetReferences asset={{ ...asset, references: asset.references.slice(0, 1) }} />{asset.references.length > 1 && <button type="button" className="ym-library-more-refs" onClick={() => setPreview(asset)}>+{asset.references.length - 1} more {asset.references.length === 2 ? 'reference' : 'references'}</button>}</div>
          </article>)}
        </div>}
        {!loading && filtered.length > shown && <button type="button" className="btn-secondary ym-library-load-more" onClick={() => setShown(value => value + 24)}>Show more attachments ({filtered.length - shown} remaining)</button>}
      </section>
    </div>
    {preview && <AssetPreview asset={preview} onClose={() => setPreview(null)} />}
  </div>;
}
