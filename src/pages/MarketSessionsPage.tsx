import { sessionsAt } from '@/lib/executionMetrics';
import { useEffect, useState } from 'react';
import { CalendarClock, Plus, Trash2, Save, AlertOctagon, Clock, Newspaper, Mic, Ban } from 'lucide-react';
import { useMarketEvents } from '@/hooks/useData';
import { useAuth } from '@/context/AuthContext';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { LoadingSpinner, EmptyState } from '@/components/ui/Feedback';
import { Modal } from '@/components/ui/Modal';
import { StatCard } from '@/components/ui/StatCard';
import type { MarketEvent, MarketEventInput, MarketEventType, MarketImpact, TradeSession } from '@/lib/types';
import { format, parseISO, isAfter, isBefore } from 'date-fns';

const EVENT_TYPES: MarketEventType[] = ['news', 'speech', 'data', 'holiday', 'session_open', 'session_close'];
const IMPACTS: MarketImpact[] = ['high', 'medium', 'low'];
const SESSIONS: TradeSession[] = ['asian', 'london', 'new_york', 'overlap', 'sydney'];

const TYPE_CONFIG: Record<MarketEventType, { label: string; icon: typeof Newspaper }> = {
  news: { label: 'News', icon: Newspaper },
  speech: { label: 'Speech', icon: Mic },
  data: { label: 'Data', icon: AlertOctagon },
  holiday: { label: 'Holiday', icon: Ban },
  session_open: { label: 'Session Open', icon: Clock },
  session_close: { label: 'Session Close', icon: Clock },
};

const IMPACT_COLORS: Record<MarketImpact, string> = {
  high: 'badge-error',
  medium: 'badge-warning',
  low: 'badge-neutral',
};

const SESSION_LABELS: Record<TradeSession, string> = {
  asian: 'Asian', london: 'London', new_york: 'New York', overlap: 'Overlap', sydney: 'Sydney',
};

export function MarketSessionsPage() {
  const { user } = useAuth();
  const { events, loading, addEvent, deleteEvent } = useMarketEvents(user?.id);
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState<'upcoming' | 'past' | 'all'>('upcoming');

  const now = new Date();
  const [sessionClock,setSessionClock]=useState(Date.now);
  useEffect(()=>{const timer=setInterval(()=>setSessionClock(Date.now()),60000);return ()=>clearInterval(timer);},[]);
  const activeSessions=sessionsAt(sessionClock);
  const upcoming = events.filter(e => isAfter(parseISO(e.event_date), now));
  const past = events.filter(e => isBefore(parseISO(e.event_date), now));
  const filtered = filter === 'upcoming' ? upcoming : filter === 'past' ? past : events;

  const highImpact = upcoming.filter(e => e.impact === 'high').length;
  const noTrade = upcoming.filter(e => e.is_no_trade).length;

  const handleDelete = async (id: string) => {
    if (confirm('Delete this event?')) await deleteEvent(id);
  };

  if (loading) return <LoadingSpinner label="Loading market events..." />;

  return (
    <div>
      <SectionHeader
        title="Market Sessions"
        subtitle="Track economic events, news releases, and session hours to manage your trading schedule"
        action={
          <button onClick={() => setShowForm(true)} className="btn-primary">
            <Plus size={18} /> New Event
          </button>
        }
      />

      <div className="card p-4 mb-5"><h2 className="text-sm font-semibold">Forex sessions now</h2><p className="mt-1 text-sm text-secondary">{activeSessions.length ? activeSessions.join(' / ') : 'Outside the defined weekday sessions'}</p><p className="mt-1 text-xs text-muted">Sydney 08:00–17:00 · Tokyo 09:00–18:00 · London 08:00–17:00 · New York 08:00–17:00, in each market’s local time. Trade analytics use these same daylight-saving-aware windows.</p></div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <StatCard label="Upcoming" value={String(upcoming.length)} icon={<CalendarClock size={20} />} accent="blue" />
        <StatCard label="High Impact" value={String(highImpact)} icon={<AlertOctagon size={20} />} accent="rose" />
        <StatCard label="No-Trade Events" value={String(noTrade)} icon={<Ban size={20} />} accent="amber" />
      </div>

      <div className="flex gap-2 mb-4">
        {(['upcoming', 'past', 'all'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all capitalize ${filter === f ? 'bg-brand-500/10 text-brand-600 dark:text-brand-400 border-brand-500/20' : 'bg-secondary border-themed text-secondary hover:border-muted'}`}
          >
            {f}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="card p-8">
          <EmptyState icon={<CalendarClock size={40} />} title="No market events" message="Add economic events, news releases, or session times to plan around high-impact periods." />
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(event => (
            <EventRow key={event.id} event={event} onDelete={() => handleDelete(event.id)} />
          ))}
        </div>
      )}

      <Modal open={showForm} onClose={() => setShowForm(false)} title="New Market Event" size="md">
        <EventForm onSave={async (data) => { await addEvent(data); setShowForm(false); }} onCancel={() => setShowForm(false)} />
      </Modal>
    </div>
  );
}

function EventRow({ event, onDelete }: { event: MarketEvent; onDelete: () => void }) {
  const typeConfig = TYPE_CONFIG[event.event_type];
  const Icon = typeConfig.icon;
  const isPast = isBefore(parseISO(event.event_date), new Date());

  return (
    <div className={`card p-3 flex items-center gap-3 card-hover ${isPast ? 'opacity-60' : ''} ${event.is_no_trade ? 'border-error-500/20' : ''}`}>
      <div className={`p-2 rounded-lg ${event.impact === 'high' ? 'bg-error-500/10 text-error-500' : event.impact === 'medium' ? 'bg-warning-500/10 text-warning-500' : 'bg-secondary text-muted'}`}>
        <Icon size={16} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{event.event_name}</span>
          <span className={`badge ${IMPACT_COLORS[event.impact]} text-[10px]`}>{event.impact}</span>
          <span className="badge badge-neutral text-[10px]">{typeConfig.label}</span>
          {event.is_no_trade && <span className="badge badge-error text-[10px]">No-Trade</span>}
        </div>
        <p className="text-xs text-muted mt-0.5 flex items-center gap-2">
          <Clock size={11} /> {format(parseISO(event.event_date), 'MMM d, yyyy · h:mm a')}
          {event.session && <span className="text-secondary">· {SESSION_LABELS[event.session]}</span>}
        </p>
        {event.notes && <p className="text-xs text-secondary mt-1">{event.notes}</p>}
      </div>
      <button onClick={onDelete} className="btn-ghost p-1.5 text-error-500 hover:bg-error-500/10"><Trash2 size={14} /></button>
    </div>
  );
}

function EventForm({ onSave, onCancel }: { onSave: (data: MarketEventInput) => void; onCancel: () => void }) {
  const [eventName, setEventName] = useState('');
  const [eventDate, setEventDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [eventTime, setEventTime] = useState('08:30');
  const [eventType, setEventType] = useState<MarketEventType>('news');
  const [impact, setImpact] = useState<MarketImpact>('high');
  const [session, setSession] = useState<TradeSession | ''>('');
  const [isNoTrade, setIsNoTrade] = useState(false);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    const datetime = new Date(`${eventDate}T${eventTime}`).toISOString();
    await onSave({
      event_name: eventName,
      event_date: datetime,
      event_type: eventType,
      impact,
      session: session || null,
      is_no_trade: isNoTrade,
      notes: notes || null,
    });
    setSaving(false);
  };

  const inputCls = 'input-field';
  const labelCls = 'block text-xs font-semibold text-secondary mb-1.5';

  return (
    <div className="space-y-4">
      <div>
        <label className={labelCls}>Event Name</label>
        <input className={inputCls} value={eventName} onChange={e => setEventName(e.target.value)} placeholder="e.g. NFP Release, FOMC Meeting" autoFocus />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Date</label>
          <input type="date" className={inputCls} value={eventDate} onChange={e => setEventDate(e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>Time</label>
          <input type="time" className={inputCls} value={eventTime} onChange={e => setEventTime(e.target.value)} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Event Type</label>
          <select className={inputCls} value={eventType} onChange={e => setEventType(e.target.value as MarketEventType)}>
            {EVENT_TYPES.map(t => <option key={t} value={t}>{TYPE_CONFIG[t].label}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Impact</label>
          <select className={inputCls} value={impact} onChange={e => setImpact(e.target.value as MarketImpact)}>
            {IMPACTS.map(i => <option key={i} value={i} className="capitalize">{i}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label className={labelCls}>Trading Session</label>
        <select className={inputCls} value={session} onChange={e => setSession(e.target.value as TradeSession | '')}>
          <option value="">Any</option>
          {SESSIONS.map(s => <option key={s} value={s}>{SESSION_LABELS[s]}</option>)}
        </select>
      </div>

      <div>
        <label className={labelCls}>Notes</label>
        <textarea className={inputCls} rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Additional details..." />
      </div>

      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={isNoTrade} onChange={e => setIsNoTrade(e.target.checked)} className="w-4 h-4 rounded" />
        <span className="text-sm flex items-center gap-1"><Ban size={14} className="text-error-500" /> Mark as no-trade event</span>
      </label>

      <div className="flex gap-3 pt-2">
        <button onClick={handleSave} disabled={saving || !eventName} className="btn-primary flex-1">
          <Save size={16} /> {saving ? 'Saving...' : 'Add Event'}
        </button>
        <button onClick={onCancel} className="btn-secondary">Cancel</button>
      </div>
    </div>
  );
}
