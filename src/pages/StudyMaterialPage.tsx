import { useState, useMemo } from 'react';
import { GraduationCap, Plus, Trash2, Save, ExternalLink, BookOpen, Video, FileText, Headphones } from 'lucide-react';
import { ScreenshotUpload } from '@/components/ScreenshotUpload';
import { useStudyMaterials } from '@/hooks/useData';
import { useAuth } from '@/context/AuthContext';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { LoadingSpinner, EmptyState } from '@/components/ui/Feedback';
import { Modal } from '@/components/ui/Modal';
import { StatCard } from '@/components/ui/StatCard';
import type { StudyMaterial, StudyMaterialInput, StudyType, StudyStatus } from '@/lib/types';

const TYPES: { value: StudyType; label: string; icon: typeof BookOpen }[] = [
  { value: 'book', label: 'Book', icon: BookOpen },
  { value: 'course', label: 'Course', icon: GraduationCap },
  { value: 'video_series', label: 'Video Series', icon: Video },
  { value: 'article', label: 'Article', icon: FileText },
  { value: 'podcast', label: 'Podcast', icon: Headphones },
  { value: 'other', label: 'Other', icon: FileText },
];

const STATUSES: { value: StudyStatus; label: string; color: string }[] = [
  { value: 'not_started', label: 'Not Started', color: 'badge-neutral' },
  { value: 'in_progress', label: 'In Progress', color: 'badge-warning' },
  { value: 'completed', label: 'Completed', color: 'badge-success' },
];

const TYPE_LABELS: Record<string, string> = Object.fromEntries(TYPES.map(t => [t.value, t.label]));
const STATUS_LABELS: Record<string, string> = Object.fromEntries(STATUSES.map(s => [s.value, s.label]));
const STATUS_COLORS: Record<string, string> = Object.fromEntries(STATUSES.map(s => [s.value, s.color]));

export function StudyMaterialPage() {
  const { user } = useAuth();
  const { materials, loading, upsertMaterial, deleteMaterial } = useStudyMaterials(user?.id);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<StudyMaterial | null>(null);
  const [filterType, setFilterType] = useState('');

  const grouped = useMemo(() => {
    const filtered = filterType ? materials.filter(m => m.type === filterType) : materials;
    const groups: Record<string, StudyMaterial[]> = {};
    for (const m of filtered) {
      if (!groups[m.type]) groups[m.type] = [];
      groups[m.type].push(m);
    }
    return groups;
  }, [materials, filterType]);

  const completed = materials.filter(m => m.status === 'completed').length;
  const avgProgress = materials.length ? Math.round(materials.reduce((s, m) => s + m.progress, 0) / materials.length) : 0;

  const handleSave = async (data: StudyMaterialInput, id?: string) => {
    await upsertMaterial(data, id);
    setShowForm(false);
    setEditing(null);
  };

  const handleDelete = async (id: string) => {
    if (confirm('Delete this study item?')) await deleteMaterial(id);
  };

  if (loading) return <LoadingSpinner label="Loading study materials..." />;

  return (
    <div>
      <SectionHeader
        title="Study Material"
        subtitle="Track your learning progress across books, courses, videos, and more"
        action={
          <button onClick={() => { setEditing(null); setShowForm(true); }} className="btn-primary">
            <Plus size={18} /> Add Item
          </button>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <StatCard label="Total Items" value={String(materials.length)} icon={<GraduationCap size={20} />} accent="blue" />
        <StatCard label="Completed" value={String(completed)} icon={<BookOpen size={20} />} accent="emerald" />
        <StatCard label="Avg Progress" value={`${avgProgress}%`} icon={<Video size={20} />} accent="amber" />
      </div>

      <div className="flex gap-2 mb-5 flex-wrap">
        <button onClick={() => setFilterType('')} className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${filterType === '' ? 'bg-brand-500/10 text-brand-600 dark:text-brand-400 border-brand-500/20' : 'bg-secondary border-themed text-secondary hover:border-muted'}`}>All Types</button>
        {TYPES.map(t => (
          <button key={t.value} onClick={() => setFilterType(t.value)} className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${filterType === t.value ? 'bg-brand-500/10 text-brand-600 dark:text-brand-400 border-brand-500/20' : 'bg-secondary border-themed text-secondary hover:border-muted'}`}>{t.label}</button>
        ))}
      </div>

      {Object.keys(grouped).length === 0 ? (
        <div className="card p-8">
          <EmptyState icon={<GraduationCap size={40} />} title="No study materials yet" message="Add books, courses, video series, or articles to track your learning journey and progress." />
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([type, items]) => (
            <div key={type}>
              <h2 className="text-sm font-bold text-secondary mb-3 flex items-center gap-2">
                {TYPE_LABELS[type] || type} <span className="text-xs text-muted">({items.length})</span>
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {items.map(item => (
                  <StudyCard key={item.id} item={item} onEdit={() => { setEditing(item); setShowForm(true); }} onDelete={() => handleDelete(item.id)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={showForm} onClose={() => { setShowForm(false); setEditing(null); }} title={editing ? 'Edit Study Item' : 'New Study Item'} size="md">
        <StudyForm initial={editing} onSave={handleSave} onCancel={() => { setShowForm(false); setEditing(null); }} />
      </Modal>
    </div>
  );
}

function StudyCard({ item, onEdit, onDelete }: { item: StudyMaterial; onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="card p-4 card-hover">
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold">{item.title}</h3>
          <span className={`badge ${STATUS_COLORS[item.status]} mt-1`}>{STATUS_LABELS[item.status]}</span>
        </div>
        <div className="flex gap-1 ml-2">
          {item.url && <a href={item.url} target="_blank" rel="noopener noreferrer" className="btn-ghost p-1"><ExternalLink size={14} /></a>}
          <button onClick={onEdit} className="btn-ghost p-1 text-xs">Edit</button>
          <button onClick={onDelete} className="btn-ghost p-1 text-error-500 hover:bg-error-500/10"><Trash2 size={14} /></button>
        </div>
      </div>

      <div className="mt-2">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-muted">
            {item.total_units ? `${item.completed_units}/${item.total_units} units` : `${item.progress}%`}
          </span>
          <span className="text-xs font-semibold">{item.progress}%</span>
        </div>
        <div className="h-2 rounded-full bg-secondary overflow-hidden">
          <div className="h-full rounded-full bg-gradient-to-r from-orange-400 to-orange-600 transition-all duration-500" style={{ width: `${item.progress}%` }} />
        </div>
      </div>

      {item.notes && <p className="text-xs text-secondary mt-2 line-clamp-2">{item.notes}</p>}
      {item.cover_image_url && (
        <div className="mt-2 rounded-lg overflow-hidden border border-themed">
          <img src={item.cover_image_url} alt={item.title} className="w-full max-h-32 object-cover" />
        </div>
      )}
    </div>
  );
}

function StudyForm({ initial, onSave, onCancel }: { initial: StudyMaterial | null; onSave: (data: StudyMaterialInput, id?: string) => void; onCancel: () => void }) {
  const [title, setTitle] = useState(initial?.title || '');
  const [type, setType] = useState(initial?.type || 'book');
  const [status, setStatus] = useState(initial?.status || 'not_started');
  const [progress, setProgress] = useState(initial?.progress ?? 0);
  const [totalUnits, setTotalUnits] = useState(initial?.total_units?.toString() || '');
  const [completedUnits, setCompletedUnits] = useState(initial?.completed_units?.toString() || '');
  const [notes, setNotes] = useState(initial?.notes || '');
  const [url, setUrl] = useState(initial?.url || '');
  const [coverImageUrl, setCoverImageUrl] = useState(initial?.cover_image_url || null);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    const tu = totalUnits ? parseInt(totalUnits) : null;
    const cu = completedUnits ? parseInt(completedUnits) : 0;
    let prog = progress;
    if (tu && cu) prog = Math.min(100, Math.round((cu / tu) * 100));
    await onSave({
      title,
      type,
      status,
      progress: prog,
      total_units: tu,
      completed_units: cu,
      notes: notes || null,
      url: url || null,
      cover_image_url: coverImageUrl || null,
    }, initial?.id);
    setSaving(false);
  };

  const inputCls = 'input-field';
  const labelCls = 'block text-xs font-semibold text-secondary mb-1.5';

  return (
    <div className="space-y-4">
      <div>
        <label className={labelCls}>Title</label>
        <input className={inputCls} value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Trading in the Zone" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Type</label>
          <select className={inputCls} value={type} onChange={e => setType(e.target.value as StudyType)}>
            {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Status</label>
          <select className={inputCls} value={status} onChange={e => setStatus(e.target.value as StudyStatus)}>
            {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Total Units (chapters/lessons)</label>
          <input type="number" className={inputCls} value={totalUnits} onChange={e => setTotalUnits(e.target.value)} placeholder="e.g. 12" />
        </div>
        <div>
          <label className={labelCls}>Completed Units</label>
          <input type="number" className={inputCls} value={completedUnits} onChange={e => setCompletedUnits(e.target.value)} placeholder="e.g. 5" />
        </div>
      </div>
      <div>
        <label className={labelCls}>Progress: {progress}%</label>
        <input type="range" min={0} max={100} value={progress} onChange={e => setProgress(parseInt(e.target.value))} className="w-full accent-orange-500" />
      </div>
      <div>
        <label className={labelCls}>URL</label>
        <input className={inputCls} value={url} onChange={e => setUrl(e.target.value)} placeholder="https://..." />
      </div>
      <div>
        <label className={labelCls}>Cover Image</label>
        <ScreenshotUpload onUpload={setCoverImageUrl} existingUrl={coverImageUrl} label="Upload cover image" />
      </div>
      <div>
        <label className={labelCls}>Notes</label>
        <textarea className={inputCls} rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Key takeaways, notes..." />
      </div>
      <div className="flex gap-3 pt-2">
        <button onClick={handleSave} disabled={saving || !title} className="btn-primary flex-1">
          <Save size={16} /> {saving ? 'Saving...' : 'Save'}
        </button>
        <button onClick={onCancel} className="btn-secondary">Cancel</button>
      </div>
    </div>
  );
}
