import { privateDocumentDownload } from '@/lib/media';
import { Select } from '@/components/Select';
import { useState, useMemo } from 'react';
import { BookOpen, Plus, Trash2, Save, Search, ExternalLink, Bookmark } from 'lucide-react';
import { ScreenshotUpload } from '@/components/ScreenshotUpload';
import { useResources } from '@/hooks/useData';
import { useAuth } from '@/context/AuthContext';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { LoadingSpinner, EmptyState } from '@/components/ui/Feedback';
import { Modal } from '@/components/ui/Modal';
import { MediaImage } from '@/components/MediaPreview';
import '@/page-results.css';
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

      <div className="ym-resource-catalogue-meta"><Bookmark size={17} /><strong>{resources.length}</strong><span>saved sources</span><span>Keep the references that support your process.</span></div>
      <nav className="ym-resource-collections" aria-label="Resource collections"><button type="button" aria-pressed={!filterCat} onClick={() => setFilterCat('')}>All sources <span>{resources.length}</span></button>{CATEGORIES.filter(category => resources.some(resource => resource.category === category.value)).map(category => <button type="button" key={category.value} aria-pressed={filterCat === category.value} onClick={() => setFilterCat(category.value)}>{category.label}<span>{resources.filter(resource => resource.category === category.value).length}</span></button>)}</nav>

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
          <EmptyState icon={<BookOpen size={40} />} title={resources.length ? 'No matching sources' : 'Build your reference shelf'} message={resources.length ? 'Choose another collection or search term.' : 'Keep useful books, videos, articles and tools together with notes on why they matter.'} />
        </div>
      ) : (
        <div className="ym-resource-catalogue" aria-label="Saved resource catalogue">
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
  const Icon = CATEGORIES.find(category => category.value === resource.category)?.icon || BookOpen;
  return <article className="ym-resource-row">
    <div className="ym-resource-cover">{resource.thumbnail_url ? <MediaImage source={resource.thumbnail_url} alt={`${resource.title} thumbnail`} className="ym-resource-thumbnail" /> : <Icon size={26} />}</div>
    <div className="ym-resource-copy"><p className="ym-output-eyebrow">{CATEGORY_LABELS[resource.category] || resource.category}</p><h2>{resource.title}</h2>{resource.description && <p>{resource.description}</p>}{resource.tags.length > 0 && <div className="ym-resource-tags">{resource.tags.map(tag => <span key={tag}>#{tag}</span>)}</div>}<small>Saved {format(parseISO(resource.created_at), 'MMM d, yyyy')}</small></div>
    <div className="ym-resource-row-actions">{resource.url && <a href={privateDocumentDownload(resource.url) || resource.url} target="_blank" rel="noopener noreferrer" className="btn-secondary" aria-label={`Open ${resource.title}`}>{privateDocumentDownload(resource.url) ? "Download document" : "Open source"} <ExternalLink size={14} /></a>}<div><button type="button" aria-label={`Edit ${resource.title}`} onClick={onEdit} className="btn-ghost text-xs">Edit</button><button type="button" aria-label={`Delete ${resource.title}`} onClick={onDelete} className="btn-ghost text-error-500"><Trash2 size={14} /></button></div></div>
  </article>;
}

function ResourceForm({ initial, onSave, onCancel }: { initial: Resource | null; onSave: (data: ResourceInput, id?: string) => void; onCancel: () => void }) {
  const [title, setTitle] = useState(initial?.title || '');
  const [url, setUrl] = useState(initial?.url || '');
  const [category, setCategory] = useState(initial?.category || 'article');
  const [description, setDescription] = useState(initial?.description || '');
  const [tagsStr, setTagsStr] = useState(initial?.tags.join(', ') || '');
  const [thumbnailUrl, setThumbnailUrl] = useState(initial?.thumbnail_url || null);
  const [uploading, setUploading] = useState(false);
  const [uploadingDoc, setUploadingDoc] = useState(false);
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
        {privateDocumentDownload(url) ? null : (<input className={inputCls} value={url} onChange={e => setUrl(e.target.value)} placeholder="https://..." />)}
        <ScreenshotUpload key={privateDocumentDownload(url) ? url : 'document'} documentsOnly onUploadingChange={setUploadingDoc} existingUrl={privateDocumentDownload(url) ? url : null} onUpload={setUrl} label="Upload source document" />
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
        <ScreenshotUpload onUploadingChange={setUploading} onUpload={setThumbnailUrl} existingUrl={thumbnailUrl} label="Upload thumbnail image" />
      </div>
      <div className="flex gap-3 pt-2">
        <button onClick={handleSave} disabled={saving || uploading || uploadingDoc || !title} className="btn-primary flex-1">
          <Save size={16} /> {saving ? 'Saving...' : 'Save Resource'}
        </button>
        <button onClick={onCancel} className="btn-secondary">Cancel</button>
      </div>
    </div>
  );
}
