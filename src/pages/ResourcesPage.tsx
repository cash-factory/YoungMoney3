import { Select } from '@/components/Select';
import { useState, useMemo } from 'react';
import { BookOpen, Plus, Trash2, Save, Search, ExternalLink, Bookmark } from 'lucide-react';
import { ScreenshotUpload } from '@/components/ScreenshotUpload';
import { useResources } from '@/hooks/useData';
import { useAuth } from '@/context/AuthContext';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { LoadingSpinner, EmptyState } from '@/components/ui/Feedback';
import { Modal } from '@/components/ui/Modal';
import { StatCard } from '@/components/ui/StatCard';
import type { Resource, ResourceInput, ResourceCategory } from '@/lib/types';
import { format, parseISO } from 'date-fns';

const CATEGORIES: { value: ResourceCategory; label: string; icon: typeof BookOpen }[] = [
  { value: 'book', label: 'Books', icon: BookOpen },
  { value: 'video', label: 'Videos', icon: ExternalLink },
  { value: 'article', label: 'Articles', icon: Bookmark },
  { value: 'course', label: 'Courses', icon: BookOpen },
  { value: 'tool', label: 'Tools', icon: Bookmark },
  { value: 'podcast', label: 'Podcasts', icon: ExternalLink },
  { value: 'other', label: 'Other', icon: Bookmark },
];

const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(CATEGORIES.map(c => [c.value, c.label]));

export function ResourcesPage() {
  const { user } = useAuth();
  const { resources, loading, upsertResource, deleteResource } = useResources(user?.id);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Resource | null>(null);
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState('');

  const filtered = useMemo(() => resources.filter(r => {
    if (filterCat && r.category !== filterCat) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!r.title.toLowerCase().includes(q) && !r.tags.some(t => t.toLowerCase().includes(q)) && !r.description?.toLowerCase().includes(q)) return false;
    }
    return true;
  }), [resources, search, filterCat]);

  const handleSave = async (data: ResourceInput, id?: string) => {
    await upsertResource(data, id);
    setShowForm(false);
    setEditing(null);
  };

  const handleDelete = async (id: string) => {
    if (confirm('Delete this resource?')) await deleteResource(id);
  };

  if (loading) return <LoadingSpinner label="Loading resources..." />;

  return (
    <div>
      <SectionHeader
        title="Resources"
        subtitle="Your trading resource library — books, videos, courses, tools, and more"
        action={
          <button onClick={() => { setEditing(null); setShowForm(true); }} className="btn-primary">
            <Plus size={18} /> Add Resource
          </button>
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total" value={String(resources.length)} icon={<Bookmark size={20} />} accent="blue" />
        <StatCard label="Books" value={String(resources.filter(r => r.category === 'book').length)} icon={<BookOpen size={20} />} accent="emerald" />
        <StatCard label="Videos" value={String(resources.filter(r => r.category === 'video').length)} icon={<ExternalLink size={20} />} accent="amber" />
        <StatCard label="Courses" value={String(resources.filter(r => r.category === 'course').length)} icon={<BookOpen size={20} />} accent="rose" />
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input className="input-field pl-10" placeholder="Search by title or tag..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select className="input-field sm:w-48" value={filterCat} onChange={e => setFilterCat(e.target.value)}>
          <option value="">All Categories</option>
          {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </Select>
      </div>

      {filtered.length === 0 ? (
        <div className="card p-8">
          <EmptyState icon={<BookOpen size={40} />} title="No resources yet" message="Build your trading resource library by adding books, videos, articles, courses, and tools." />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(resource => (
            <ResourceCard key={resource.id} resource={resource} onEdit={() => { setEditing(resource); setShowForm(true); }} onDelete={() => handleDelete(resource.id)} />
          ))}
        </div>
      )}

      <Modal open={showForm} onClose={() => { setShowForm(false); setEditing(null); }} title={editing ? 'Edit Resource' : 'New Resource'} size="md">
        <ResourceForm initial={editing} onSave={handleSave} onCancel={() => { setShowForm(false); setEditing(null); }} />
      </Modal>
    </div>
  );
}

function ResourceCard({ resource, onEdit, onDelete }: { resource: Resource; onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="card p-4 card-hover flex flex-col">
      <div className="flex items-start justify-between mb-2">
        <span className="badge badge-brand">{CATEGORY_LABELS[resource.category] || resource.category}</span>
        <div className="flex gap-1">
          <button onClick={onEdit} className="btn-ghost p-1 text-xs">Edit</button>
          <button onClick={onDelete} className="btn-ghost p-1 text-error-500 hover:bg-error-500/10"><Trash2 size={14} /></button>
        </div>
      </div>
      <h3 className="text-sm font-bold mb-1">{resource.title}</h3>
      {resource.thumbnail_url && (
        <div className="mb-2 rounded-lg overflow-hidden border border-themed">
          <img src={resource.thumbnail_url} alt={resource.title} className="w-full max-h-32 object-cover" />
        </div>
      )}
      {resource.description && <p className="text-xs text-secondary mb-2 line-clamp-2">{resource.description}</p>}
      {resource.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {resource.tags.map(tag => <span key={tag} className="badge badge-neutral text-[10px]">{tag}</span>)}
        </div>
      )}
      <div className="mt-auto flex items-center justify-between">
        {resource.url ? (
          <a href={resource.url} target="_blank" rel="noopener noreferrer" className="text-xs text-brand-500 hover:underline flex items-center gap-1">
            <ExternalLink size={12} /> Open
          </a>
        ) : <span />}
        <span className="text-xs text-muted">{format(parseISO(resource.created_at), 'MMM d, yyyy')}</span>
      </div>
    </div>
  );
}

function ResourceForm({ initial, onSave, onCancel }: { initial: Resource | null; onSave: (data: ResourceInput, id?: string) => void; onCancel: () => void }) {
  const [title, setTitle] = useState(initial?.title || '');
  const [url, setUrl] = useState(initial?.url || '');
  const [category, setCategory] = useState(initial?.category || 'article');
  const [description, setDescription] = useState(initial?.description || '');
  const [tagsStr, setTagsStr] = useState(initial?.tags.join(', ') || '');
  const [thumbnailUrl, setThumbnailUrl] = useState(initial?.thumbnail_url || null);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    const tags = tagsStr.split(',').map(t => t.trim()).filter(Boolean);
    await onSave({
      title,
      url: url || null,
      category,
      description: description || null,
      tags,
      thumbnail_url: thumbnailUrl || null,
    }, initial?.id);
    setSaving(false);
  };

  const inputCls = 'input-field';
  const labelCls = 'block text-xs font-semibold text-secondary mb-1.5';

  return (
    <div className="space-y-4">
      <div>
        <label className={labelCls}>Title</label>
        <input className={inputCls} value={title} onChange={e => setTitle(e.target.value)} placeholder="Resource title" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Category</label>
          <Select className={inputCls} value={category} onChange={e => setCategory(e.target.value)}>
            {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </Select>
        </div>
        <div>
          <label className={labelCls}>URL</label>
          <input className={inputCls} value={url} onChange={e => setUrl(e.target.value)} placeholder="https://..." />
        </div>
      </div>
      <div>
        <label className={labelCls}>Description</label>
        <textarea className={inputCls} rows={2} value={description} onChange={e => setDescription(e.target.value)} placeholder="What is this resource about?" />
      </div>
      <div>
        <label className={labelCls}>Tags (comma-separated)</label>
        <input className={inputCls} value={tagsStr} onChange={e => setTagsStr(e.target.value)} placeholder="psychology, risk, price action" />
      </div>
      <div>
        <label className={labelCls}>Thumbnail Image</label>
        <ScreenshotUpload onUpload={setThumbnailUrl} existingUrl={thumbnailUrl} label="Upload thumbnail image" />
      </div>
      <div className="flex gap-3 pt-2">
        <button onClick={handleSave} disabled={saving || !title} className="btn-primary flex-1">
          <Save size={16} /> {saving ? 'Saving...' : 'Save Resource'}
        </button>
        <button onClick={onCancel} className="btn-secondary">Cancel</button>
      </div>
    </div>
  );
}
