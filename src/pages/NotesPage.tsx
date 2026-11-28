import '@/page-results.css';
import { useState, useMemo } from 'react';
import { StickyNote, Plus, Trash2, Save, Search, Pin } from 'lucide-react';
import { ScreenshotUpload } from '@/components/ScreenshotUpload';
import { useNotes } from '@/hooks/useData';
import { useAuth } from '@/context/AuthContext';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { MediaImage } from '@/components/MediaPreview';
import { LoadingSpinner, EmptyState } from '@/components/ui/Feedback';
import { Modal } from '@/components/ui/Modal';
import type { Note, NoteInput } from '@/lib/types';
import { format, parseISO } from 'date-fns';

export function NotesPage() {
  const { user } = useAuth();
  const { notes, loading, upsertNote, deleteNote, togglePin } = useNotes(user?.id);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Note | null>(null);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState('');

  const filtered = useMemo(() => notes.filter(n => {
    if (search) {
      const q = search.toLowerCase();
      if (!n.title.toLowerCase().includes(q) && !n.content?.toLowerCase().includes(q) && !n.tags.some(t => t.toLowerCase().includes(q))) return false;
    }
    return true;
  }).sort((a, b) => Number(b.is_pinned) - Number(a.is_pinned) || b.updated_at.localeCompare(a.updated_at)), [notes, search]);
  const selected = filtered.find(note => note.id === selectedId) || filtered[0];

  const handleSave = async (data: NoteInput, id?: string) => {
    await upsertNote(data, id);
    setShowForm(false);
    setEditing(null);
  };

  const handleDelete = async (id: string) => {
    if (confirm('Delete this note?')) await deleteNote(id);
  };

  if (loading) return <LoadingSpinner label="Loading notes..." />;

  return (
    <div>
      <SectionHeader
        title="My Notes"
        subtitle="Freeform notes — jot down ideas, observations, and reminders"
        action={
          <button onClick={() => { setEditing(null); setShowForm(true); }} className="btn-primary">
            <Plus size={18} /> New Note
          </button>
        }
      />

      <div className="relative mb-5">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input className="input-field pl-10" placeholder="Search notes by title, content, or tag..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {filtered.length === 0 ? (
        <div className="card p-8">
          <EmptyState icon={<StickyNote size={40} />} title={notes.length ? 'No matching notes' : 'Your notebook starts here'} message={notes.length ? 'Try another title, phrase or tag.' : 'Capture an observation, a useful lesson or your next trading idea. Pin the notes you want to keep close.'} />
        </div>
      ) : (
        <div className="ym-notebook">
          <nav className="ym-notebook-index" aria-label="Saved notes"><p className="ym-output-eyebrow">{filtered.length} NOTES / {filtered.filter(note => note.is_pinned).length} PINNED</p>{filtered.map(note => <button type="button" key={note.id} aria-pressed={note.id === selected.id} onClick={() => setSelectedId(note.id)}><span className="ym-notebook-index-title">{note.is_pinned && <Pin size={12} />}<strong>{note.title}</strong></span><span>{note.content || 'Image or reference note'}</span><small>{format(parseISO(note.updated_at), 'MMM d, yyyy')}</small></button>)}</nav>
          <div className="ym-notebook-reader"><NoteCard key={selected.id} note={selected} onEdit={() => { setEditing(selected); setShowForm(true); }} onDelete={() => handleDelete(selected.id)} onPin={() => togglePin(selected)} /></div>
        </div>
      )}

      <Modal open={showForm} onClose={() => { setShowForm(false); setEditing(null); }} title={editing ? 'Edit Note' : 'New Note'} size="md">
        <NoteForm initial={editing} onSave={handleSave} onCancel={() => { setShowForm(false); setEditing(null); }} />
      </Modal>
    </div>
  );
}

function NoteCard({ note, onEdit, onDelete, onPin }: { note: Note; onEdit: () => void; onDelete: () => void; onPin: () => void }) {
  return (
    <div className={`ym-note-card card p-4 flex flex-col ${note.is_pinned ? 'ring-1 ring-brand-500/20' : ''}`}>
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          {note.is_pinned && <Pin size={14} className="text-brand-500 fill-current" />}
          <h3 className="text-sm font-bold">{note.title}</h3>
        </div>
        <div className="flex gap-1">
          <button type="button" aria-label={note.is_pinned ? `Unpin ${note.title}` : `Pin ${note.title}`} onClick={onPin} className="btn-ghost p-1" title={note.is_pinned ? 'Unpin' : 'Pin'}>
            <Pin size={14} className={note.is_pinned ? 'text-brand-500 fill-current' : ''} />
          </button>
          <button type="button" aria-label={`Edit ${note.title}`} onClick={onEdit} className="btn-ghost p-1 text-xs">Edit</button>
          <button type="button" aria-label={`Delete ${note.title}`} onClick={onDelete} className="btn-ghost p-1 text-error-500 hover:bg-error-500/10"><Trash2 size={14} /></button>
        </div>
      </div>
      {note.content && <p className="ym-note-content text-sm text-secondary whitespace-pre-wrap mb-2 flex-1">{note.content}</p>}
      {note.screenshot_url && (
        <div className="rounded-lg overflow-hidden border border-themed mb-2">
          <MediaImage source={note.screenshot_url} alt={note.title} className="w-full max-h-40 object-cover" />
        </div>
      )}
      {note.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {note.tags.map(tag => <span key={tag} className="badge badge-neutral text-[10px]">{tag}</span>)}
        </div>
      )}
      <p className="text-xs text-muted">{format(parseISO(note.updated_at), 'MMM d, yyyy · h:mm a')}</p>
    </div>
  );
}

function NoteForm({ initial, onSave, onCancel }: { initial: Note | null; onSave: (data: NoteInput, id?: string) => void; onCancel: () => void }) {
  const [title, setTitle] = useState(initial?.title || '');
  const [content, setContent] = useState(initial?.content || '');
  const [tagsStr, setTagsStr] = useState(initial?.tags.join(', ') || '');
  const [isPinned, setIsPinned] = useState(initial?.is_pinned ?? false);
  const [screenshotUrl, setScreenshotUrl] = useState(initial?.screenshot_url || null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    const tags = tagsStr.split(',').map(t => t.trim()).filter(Boolean);
    await onSave({ title, content: content || null, tags, is_pinned: isPinned, screenshot_url: screenshotUrl || null }, initial?.id);
    setSaving(false);
  };

  const inputCls = 'input-field';
  const labelCls = 'block text-xs font-semibold text-secondary mb-1.5';

  return (
    <div className="space-y-4">
      <div>
        <label className={labelCls}>Title</label>
        <input className={inputCls} value={title} onChange={e => setTitle(e.target.value)} placeholder="Note title" />
      </div>
      <div>
        <label className={labelCls}>Content</label>
        <textarea className={inputCls} rows={8} value={content} onChange={e => setContent(e.target.value)} placeholder="Write your note here..." />
      </div>
      <div>
        <label className={labelCls}>Tags (comma-separated)</label>
        <input className={inputCls} value={tagsStr} onChange={e => setTagsStr(e.target.value)} placeholder="idea, psychology, watchlist" />
      </div>
      <div>
        <label className={labelCls}>Image</label>
        <ScreenshotUpload allowDocuments onUploadingChange={setUploading} onUpload={setScreenshotUrl} existingUrl={screenshotUrl} label="Upload chart or document" />
      </div>
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={isPinned} onChange={e => setIsPinned(e.target.checked)} className="w-4 h-4 rounded border-themed" />
        <span className="text-sm">Pin to top</span>
      </label>
      <div className="flex gap-3 pt-2">
        <button onClick={handleSave} disabled={saving || uploading || !title} className="btn-primary flex-1">
          <Save size={16} /> {saving ? 'Saving...' : 'Save Note'}
        </button>
        <button onClick={onCancel} className="btn-secondary">Cancel</button>
      </div>
    </div>
  );
}
