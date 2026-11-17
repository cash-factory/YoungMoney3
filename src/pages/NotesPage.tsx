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

  const filtered = useMemo(() => notes.filter(n => {
    if (search) {
      const q = search.toLowerCase();
      if (!n.title.toLowerCase().includes(q) && !n.content?.toLowerCase().includes(q) && !n.tags.some(t => t.toLowerCase().includes(q))) return false;
    }
    return true;
  }), [notes, search]);

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
          <EmptyState icon={<StickyNote size={40} />} title="No notes yet" message="Create notes to jot down trading ideas, market observations, lessons, or reminders. Pin important ones to the top." />
        </div>
      ) : (
        <div className="ym-notes-board grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(note => (
            <NoteCard key={note.id} note={note} onEdit={() => { setEditing(note); setShowForm(true); }} onDelete={() => handleDelete(note.id)} onPin={() => togglePin(note)} />
          ))}
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
    <div className={`ym-note-card card p-4 card-hover flex flex-col ${note.is_pinned ? 'ring-1 ring-brand-500/20' : ''}`}>
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          {note.is_pinned && <Pin size={14} className="text-brand-500 fill-current" />}
          <h3 className="text-sm font-bold">{note.title}</h3>
        </div>
        <div className="flex gap-1">
          <button onClick={onPin} className="btn-ghost p-1" title={note.is_pinned ? 'Unpin' : 'Pin'}>
            <Pin size={14} className={note.is_pinned ? 'text-brand-500 fill-current' : ''} />
          </button>
          <button onClick={onEdit} className="btn-ghost p-1 text-xs">Edit</button>
          <button onClick={onDelete} className="btn-ghost p-1 text-error-500 hover:bg-error-500/10"><Trash2 size={14} /></button>
        </div>
      </div>
      {note.content && <p className="text-xs text-secondary whitespace-pre-wrap line-clamp-4 mb-2 flex-1">{note.content}</p>}
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
        <ScreenshotUpload onUpload={setScreenshotUrl} existingUrl={screenshotUrl} label="Upload chart markup or reference image" />
      </div>
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={isPinned} onChange={e => setIsPinned(e.target.checked)} className="w-4 h-4 rounded border-themed" />
        <span className="text-sm">Pin to top</span>
      </label>
      <div className="flex gap-3 pt-2">
        <button onClick={handleSave} disabled={saving || !title} className="btn-primary flex-1">
          <Save size={16} /> {saving ? 'Saving...' : 'Save Note'}
        </button>
        <button onClick={onCancel} className="btn-secondary">Cancel</button>
      </div>
    </div>
  );
}
