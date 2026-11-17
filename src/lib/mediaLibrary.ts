export type LibraryKind = 'image' | 'audio';
export type LibraryPhase = 'entry' | 'closure' | 'general';
export interface MediaReference {
  id: string;
  table: string;
  title: string;
  page: string;
  phase: LibraryPhase;
  date: string | null;
  tradeIds: string[];
}
export interface LibraryAsset {
  source: string;
  name: string;
  kind: LibraryKind;
  date: string | null;
  references: MediaReference[];
}
export interface LibraryFile { name: string; metadata?: { mimetype?: string }; created_at?: string }
export const MEDIA_RECORD_SOURCES = [
  { table: 'trades', label: 'Trade', page: 'trades' },
  { table: 'journal_entries', label: 'Journal entry', page: 'journal' },
  { table: 'trading_plans', label: 'Trading plan', page: 'trading-plan' },
  { table: 'trading_setups', label: 'Setup', page: 'setups' },
  { table: 'strategy_test_sessions', label: 'Test session', page: 'strategy-testing' },
  { table: 'strategy_test_trades', label: 'Test trade', page: 'strategy-testing' },
  { table: 'backtest_results', label: 'Backtest', page: 'strategy-testing' },
  { table: 'forward_trades', label: 'Forward test', page: 'strategy-testing' },
  { table: 'notes', label: 'Note', page: 'notes' },
  { table: 'weekly_reviews', label: 'Weekly review', page: 'weekly-reviews' },
  { table: 'resources', label: 'Resource', page: 'resources' },
] as const;
const MEDIA_FIELDS: [string, LibraryKind, LibraryPhase][] = [
  ['entry_screenshot_url', 'image', 'entry'], ['entry_voice_note_url', 'audio', 'entry'],
  ['closure_screenshot_url', 'image', 'closure'], ['closure_voice_note_url', 'audio', 'closure'],
  ['screenshot_url', 'image', 'general'], ['voice_note_url', 'audio', 'general'],
  ['thumbnail_url', 'image', 'general'],
];
function text(row: Record<string, unknown>, ...fields: string[]) {
  return fields.map(field => row[field]).find(value => typeof value === 'string' && value.trim()) as string | undefined;
}
function kindFor(file: LibraryFile): LibraryKind | null {
  const mime = file.metadata?.mimetype || '';
  if (mime.startsWith('image/') || /\.(avif|gif|jpe?g|png|webp)$/i.test(file.name)) return 'image';
  if (mime.startsWith('audio/') || /\.(aac|m4a|mp3|mp4|ogg|wav|webm)$/i.test(file.name)) return 'audio';
  return null;
}
function validPath(path: string) {
  return !!path && !path.split('/').some(part => !part || part === '..' || part === '.' || part.includes('\\'));
}
/** The owner check is deliberate: an attachment never acquires another account's references. */
export function buildMediaLibrary(owner: string, records: Record<string, Record<string, unknown>[]>, files: LibraryFile[] = []): LibraryAsset[] {
  const assets = new Map<string, LibraryAsset>();
  for (const file of files) {
    const kind = kindFor(file);
    if (!kind || !validPath(file.name)) continue;
    const source = `private-media://trading-media/${owner}/${file.name}`;
    if (!assets.has(source)) assets.set(source, { source, name: file.name.split('/').pop() || file.name, kind, date: file.created_at || null, references: [] });
  }
  for (const spec of MEDIA_RECORD_SOURCES) {
    for (const row of records[spec.table] || []) {
      if (row.user_id !== owner || typeof row.id !== 'string') continue;
      const seen = new Set<string>();
      for (const [field, kind, phase] of MEDIA_FIELDS) {
        const source = row[field];
        if (typeof source !== 'string' || !source.trim() || seen.has(source)) continue;
        // A generic screenshot field often aliases the entry field; keep the more specific phase.
        seen.add(source);
        if (source.startsWith('private-media://')) {
          const root = `private-media://trading-media/${owner}/`;
          if (!source.startsWith(root) || !validPath(source.slice(root.length))) continue;
        }
        const date = text(row, phase === 'closure' ? 'exit_time' : 'entry_time', 'entry_date', 'created_at') || null;
        const title = text(row, 'pair', 'instrument', 'title', 'name') || spec.label;
        const reference: MediaReference = { id: row.id, table: spec.table, title, page: spec.page, phase, date,
          tradeIds: spec.table === 'trades' ? [row.id] : Array.isArray(row.linked_trade_ids) ? row.linked_trade_ids.filter((id): id is string => typeof id === 'string') : [] };
        const asset = assets.get(source) || { source, name: `${title} · ${kind === 'image' ? 'Screenshot' : 'Voice note'}`, kind, date, references: [] };
        asset.references.push(reference);
        if (date && (!asset.date || date > asset.date)) asset.date = date;
        assets.set(source, asset);
      }
    }
  }
  return [...assets.values()].sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.name.localeCompare(b.name));
}
