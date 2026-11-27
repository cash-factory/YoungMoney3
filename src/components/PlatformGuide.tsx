import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft, ArrowRight, BarChart3, BookMarked, BookOpen, CalendarDays, Check,
  CheckCircle2, ChevronRight, ClipboardCheck, ClipboardList, Clock, Compass,
  Flag, FlaskConical, Images, Layers, LayoutDashboard, Map as MapIcon,
  Monitor, Palette, Play, PlusCircle, RotateCcw, Search, ShieldCheck,
  SkipForward, SlidersHorizontal, Sparkles, StickyNote, Target, Wallet, X,
  type LucideIcon,
} from 'lucide-react';
import type { PageId } from './Layout';
import {
  GUIDE_CATEGORIES, GUIDE_EXPRESS_ROUTE, GUIDE_STOPS, type GuideCategory,
  type GuideStop, readGuideState,
} from '@/lib/platformGuide';
import '@/platform-guide.css';

const ICONS: Record<string, LucideIcon> = {
  'layout-dashboard': LayoutDashboard, 'sliders-horizontal': SlidersHorizontal,
  'plus-circle': PlusCircle, 'book-open': BookOpen, 'calendar-days': CalendarDays,
  'clipboard-check': ClipboardCheck, 'clipboard-list': ClipboardList, layers: Layers,
  target: Target, 'shield-check': ShieldCheck, flag: Flag, clock: Clock,
  'flask-conical': FlaskConical, wallet: Wallet, monitor: Monitor, 'bar-chart-3': BarChart3,
  sparkles: Sparkles, images: Images, 'sticky-note': StickyNote, 'book-marked': BookMarked,
  palette: Palette, search: Search,
};

type Spot = { top: number; left: number; width: number; height: number };
type Placement = { top: number; left: number };
type View = 'hub' | 'tour';
type CategoryFilter = GuideCategory | 'All areas';

/** Short, task-based routes through the real product; no tour step performs a trading action. */
const GUIDE_PATHS = [
  { id: 'connect', title: 'Connect MetaTrader', subtitle: 'Pair · identify · verify capture', icon: Monitor, stops: ['mt5', 'accounts', 'filters'] },
  { id: 'review', title: 'Review a trade', subtitle: 'Record · reflect · improve', icon: BookOpen, stops: ['capture', 'journal', 'calendar', 'reviews'] },
  { id: 'process', title: 'Build your playbook', subtitle: 'Plan · manage risk · test', icon: Target, stops: ['plan', 'strategies', 'risk', 'testing'] },
  { id: 'evidence', title: 'Read your results', subtitle: 'Filter · analyse · interpret', icon: BarChart3, stops: ['filters', 'analytics', 'insights'] },
] as const;

interface PlatformGuideProps {
  onSample:()=>void;
  open: boolean;
  userId: string;
  currentPage: PageId;
  onNavigate: (page: PageId) => void;
  onDismiss: (completed: boolean, visited: string[]) => void;
}

function pickTarget(stop: GuideStop): HTMLElement | null {
  for (const selector of stop.targets) {
    const candidates = document.querySelectorAll<HTMLElement>(selector);
    for (const candidate of candidates) {
      const box = candidate.getBoundingClientRect();
      const display = window.getComputedStyle(candidate);
      if (box.width > 25 && box.height > 17 && box.right > 0 && box.left < window.innerWidth && box.bottom > 0 && box.top < window.innerHeight && display.display !== 'none'
          && display.visibility !== 'hidden') return candidate;
    }
  }
  return document.querySelector<HTMLElement>('.ym-page-heading, .ym-library-hero, #workspace-content');
}

export function PlatformGuide({ open, userId, currentPage, onNavigate, onDismiss, onSample }: PlatformGuideProps) {
  const [view, setView] = useState<View>('hub');
  const [route, setRoute] = useState<string[]>([...GUIDE_EXPRESS_ROUTE]);
  const [index, setIndex] = useState(0);
  const [visited, setVisited] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<CategoryFilter>('All areas');
  const [spot, setSpot] = useState<Spot | null>(null);
  const [placement, setPlacement] = useState<Placement>({ top: 100, left: 40 });
  const titleRef = useRef<HTMLHeadingElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  const stop = GUIDE_STOPS.find(item => item.id === route[index]);
  const filtered = useMemo(() => GUIDE_STOPS.filter(item =>
    (category === 'All areas' || item.category === category) &&
    (!query.trim() || [item.label, item.title, item.detail, item.category]
      .join(' ').toLowerCase().includes(query.trim().toLowerCase()))),
  [category, query]);

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setView('hub');
    setRoute([...GUIDE_EXPRESS_ROUTE]);
    setIndex(0);
    setCategory('All areas');
    setQuery('');
    setVisited(readGuideState(userId)?.visited || []);
    setSpot(null);
    return () => { previousFocus.current?.focus(); };
  }, [open, userId]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => titleRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open, view, index]);

  useEffect(() => {
    if (!open || view !== 'tour' || !stop) return;
    setVisited(previous => previous.includes(stop.id) ? previous : [...previous, stop.id]);
  }, [open, view, stop?.id]);

  useEffect(() => {
    if (!open || view !== 'tour' || !stop || currentPage !== stop.page) {
      setSpot(null);
      return;
    }
    let cancelled = false;
    let raf = 0;
    let hasScrolled = false;
    const update = () => {
      if (cancelled) return;
      const target = pickTarget(stop);
      if (!target) { setSpot(null); return; }
      if (!hasScrolled) {
        hasScrolled = true;
        target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      }
      const r = target.getBoundingClientRect();
      const inset = 7;
      const top = Math.max(5, r.top - inset);
      const left = Math.max(5, r.left - inset);
      const width = Math.min(window.innerWidth - left - 5, r.width + 2 * inset);
      const height = Math.min(window.innerHeight - top - 5, r.height + 2 * inset);
      if (width <= 0 || height <= 0) { setSpot(null); return; }
      setSpot(old => old && Math.abs(old.top - top) < 1 && Math.abs(old.left - left) < 1
        && Math.abs(old.width - width) < 1 && Math.abs(old.height - height) < 1
        ? old : { top, left, width, height });
      const cardW = Math.min(410, window.innerWidth - 32);
      const cardH = Math.min(424, window.innerHeight - 36);
      let cardLeft = left + width + 18;
      if (cardLeft + cardW > window.innerWidth - 16) cardLeft = left - cardW - 18;
      if (cardLeft < 16) cardLeft = window.innerWidth - cardW - 18;
      const cardTop = Math.min(window.innerHeight - cardH - 18, Math.max(18, top));
      setPlacement(old => Math.abs(old.left - cardLeft) < 1 && Math.abs(old.top - cardTop) < 1
        ? old : { left: cardLeft, top: cardTop });
    };
    const schedule = () => { window.cancelAnimationFrame(raf); raf = window.requestAnimationFrame(update); };
    const first = window.setTimeout(schedule, 45);
    const second = window.setTimeout(schedule, 240);
    const third = window.setTimeout(schedule, 620);
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    return () => {
      cancelled = true;
      window.clearTimeout(first);
      window.clearTimeout(second);
      window.clearTimeout(third);
      window.cancelAnimationFrame(raf);
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
    };
  }, [open, view, stop?.id, stop?.page, currentPage]);

  if (!open) return null;

  const begin = (ids: string[], position = 0) => {
    const next = GUIDE_STOPS.find(item => item.id === ids[position]);
    if (!next) return;
    setRoute(ids);
    setIndex(position);
    setSpot(null);
    setView('tour');
    onNavigate(next.page);
  };
  const go = (position: number) => {
    if (position < 0 || position >= route.length) return;
    const next = GUIDE_STOPS.find(item => item.id === route[position]);
    if (!next) return;
    setIndex(position);
    setSpot(null);
    onNavigate(next.page);
  };
  const finish = (completed: boolean) => {
    const seen = [...new Set([...visited, ...(view === 'tour' && stop ? [stop.id] : [])])];
    onDismiss(completed, seen);
  };
  const next = () => {
    if (index >= route.length - 1) finish(true);
    else go(index + 1);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); finish(false); return; }
    if (event.key !== 'Tab') return;
    const dialog = event.currentTarget.querySelector<HTMLElement>('[role="dialog"]');
    if (!dialog) return;
    const controls = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex="0"]')]
      .filter(el => el.getClientRects().length > 0);
    if (!controls.length) return;
    if (event.shiftKey && (document.activeElement === controls[0] || document.activeElement === titleRef.current)) {
      event.preventDefault(); controls[controls.length - 1].focus();
    } else if (!event.shiftKey && document.activeElement === controls[controls.length - 1]) {
      event.preventDefault(); controls[0].focus();
    }
  };

  return createPortal(
    <div className="ym-guide-layer" data-guide-view={view} data-guide-stop={view === 'tour' ? stop?.id : undefined}
      data-spotlight={view === 'tour' && spot ? 'active' : 'none'} onKeyDown={handleKeyDown}>
      <div className="ym-guide-backdrop" aria-hidden="true" />
      {view === 'tour' && spot && <div className="ym-guide-spotlight" aria-hidden="true"
        style={{ top: spot.top, left: spot.left, width: spot.width, height: spot.height }} />}
      {view === 'hub' ? (
        <section className="ym-guide-hub" role="dialog" aria-modal="true" aria-labelledby="ym-guide-hub-title"
          aria-describedby="ym-guide-hub-description">
          <div className="ym-guide-hub-top">
            <div className="ym-guide-kicker"><Compass size={16} /> YOUNGMONEY3 / FIELD GUIDE <span>VOL. 01</span></div>
            <button type="button" className="ym-guide-icon-button" aria-label="Skip platform tour" onClick={() => finish(false)}><X size={19} /></button>
          </div>
          <div className="ym-guide-hub-intro">
            <div className="ym-guide-intro-copy">
              <span className="ym-guide-pill"><span className="ym-guide-live-dot" /> YOUR WORKSPACE AWAITS</span>
              <h2 ref={titleRef} tabIndex={-1} id="ym-guide-hub-title">Make yourself <em>at home.</em></h2>
              <p id="ym-guide-hub-description">Your edge takes time. Learning your desk shouldn't. Follow the highlights, or jump straight to the feature you're curious about.</p>
              <div className="ym-guide-hub-actions">
                <button type="button" className="ym-guide-primary" onClick={() => begin([...GUIDE_EXPRESS_ROUTE])}>
                  <Play size={16} fill="currentColor" /> Take the grand tour <ArrowRight size={17} />
                </button>
                <button type="button" className="ym-guide-quiet" onClick={() => finish(false)}>
                  Skip the tutorial <SkipForward size={15} />
                </button>
              </div>
              <div className="ym-desk-quick" aria-label="Choose your starting point"><button onClick={()=>begin(['mt5'])}>Connect MT5</button><button onClick={()=>begin(['capture'])}>Log manually</button><button onClick={()=>{finish(false);onSample();}}>Explore a sample</button></div>
              <div className="ym-guide-time"><CheckCircle2 size={15} /> 9 guided highlights · You stay in control</div>
            </div>
            <div className="ym-guide-orbit" aria-hidden="true">
              <div className="ym-guide-orbit-ring"><span className="ym-guide-orbit-core"><Compass size={38} strokeWidth={1.5} /></span><i/><b/></div>
              <div className="ym-guide-orbit-caption">EXPLORE / EXPERIMENT / EVOLVE</div>
            </div>
          </div>
          <div className="ym-guide-directory">
            <div className="ym-guide-directory-heading">
              <div><span className="ym-guide-kicker">YOUR DESTINATIONS / 22 PLACES</span><h3>Or skip to any area.</h3></div>
              <label className="ym-guide-search"><Search size={16} />
                <span className="sr-only">Search guide destinations</span>
                <input aria-label="Search guide destinations" placeholder="Search a feature..." value={query} onChange={e => setQuery(e.target.value)} />
              </label>
            </div>
            <div className="ym-guide-journey-heading">
              <span className="ym-guide-kicker">LEARN BY DOING / CHOOSE A PATH</span>
              <span>{visited.length} of {GUIDE_STOPS.length} areas explored</span>
            </div>
            <div className="ym-guide-journeys" role="group" aria-label="Choose a guided learning path">
              {GUIDE_PATHS.map(path => {
                const Icon = path.icon;
                return <button type="button" key={path.id} aria-label={`Guided path: ${path.title}`}
                  onClick={() => begin([...path.stops])}>
                  <span className="ym-guide-journey-icon"><Icon size={17} /></span>
                  <span><strong>{path.title}</strong><small>{path.subtitle}</small></span>
                  <ArrowRight size={14} className="ym-guide-journey-arrow" />
                </button>;
              })}
            </div>
            <div className="ym-guide-category-tabs" aria-label="Guide areas">
              {(['All areas',...GUIDE_CATEGORIES] as CategoryFilter[]).map(item => <button type="button" key={item}
                aria-pressed={category === item} onClick={() => setCategory(item)}>{item}</button>)}
            </div>
            <div className="ym-guide-destinations">
              {filtered.map((item) => {
                const Icon = ICONS[item.icon] || Compass;
                return <button type="button" className="ym-guide-destination" key={item.id}
                    onClick={() => begin(GUIDE_STOPS.map(s => s.id), GUIDE_STOPS.findIndex(s => s.id === item.id))}
                    aria-label={`Go to ${item.label}`}>
                  <span className="ym-guide-destination-icon"><Icon size={19} /></span>
                  <span className="ym-guide-destination-copy"><strong>{item.label}</strong><small>{item.category}</small></span>
                  {visited.includes(item.id) ? <Check size={16} className="ym-guide-seen" aria-label="Previously explored" /> : <ArrowRight size={15} className="ym-guide-arr" />}
                </button>;
              })}
              {!filtered.length && <p className="ym-guide-no-results">No matching feature. Try another search or area.</p>}
            </div>
          </div>
          <div className="ym-guide-hub-footer"><span>01—22 / EXPLORE AT YOUR OWN PACE</span><span>Revisit anytime from the dashboard <RotateCcw size={13} /></span></div>
        </section>
      ) : stop ? (
        <section className="ym-guide-tour-card" style={placement as CSSProperties} role="dialog"
          aria-modal="true" aria-labelledby="ym-guide-step-title" aria-describedby="ym-guide-step-description">
          <div className="ym-guide-step-top">
            <span className="ym-guide-kicker"><MapIcon size={15} /> GUIDED EXPLORATION <b>/{String(index + 1).padStart(2,'0')}</b></span>
            <button type="button" className="ym-guide-icon-button" aria-label="Skip tutorial" onClick={() => finish(false)}><X size={19} /></button>
          </div>
          <div className="ym-guide-progress-track" role="progressbar" aria-label="Tour progress" aria-valuemin={0}
            aria-valuemax={route.length} aria-valuenow={index + 1}>
            <div style={{ width: `${(index + 1) / route.length * 100}%` }} />
          </div>
          <div className="ym-guide-step-scroll" tabIndex={0} aria-label="Current field guide instruction">
          <div className="ym-guide-step-icon">{(() => { const Icon = ICONS[stop.icon] || Compass; return <Icon size={26} strokeWidth={1.65} />; })()}</div>
          <p className="ym-guide-step-eyebrow">{stop.eyebrow}</p>
          <h2 ref={titleRef} tabIndex={-1} id="ym-guide-step-title">{stop.title}</h2>
          <p id="ym-guide-step-description" className="ym-guide-step-description">{stop.detail}</p>
          <div className="ym-guide-takeaway"><Sparkles size={17} /><span>{stop.takeaway}</span></div>
          {stop.steps && <div className="ym-guide-howto">
            <strong>HOW TO USE THIS FEATURE</strong>
            <ol>{stop.steps.map((instruction, stepNumber) => <li key={stepNumber}>{instruction}</li>)}</ol>
          </div>}
          <button type="button" className="ym-guide-try-feature" onClick={() => finish(false)}>
            <CheckCircle2 size={15} /> Explore this page myself <ChevronRight size={14} />
          </button>
          </div>
          <div className="ym-guide-step-controls">
            <button type="button" className="ym-guide-secondary" onClick={() => setView('hub')}><Compass size={15} /> Skip to...</button>
            <div className="ym-guide-step-navigation">
              <button type="button" className="ym-guide-secondary ym-guide-back" disabled={index === 0} onClick={() => go(index - 1)} aria-label="Previous guide stop"><ArrowLeft size={17} /></button>
              <button type="button" className="ym-guide-primary" onClick={next}>
                {index === route.length - 1 ? 'Finish tour' : 'Next stop'}
                {index === route.length - 1 ? <Check size={17} /> : <ArrowRight size={17} />}
              </button>
            </div>
          </div>
          <div className="ym-guide-step-footer">
            <span>{index + 1} / {route.length} HIGHLIGHTS</span>
            <button type="button" onClick={() => finish(false)}>Explore on my own <ChevronRight size={13} /></button>
          </div>
        </section>
      ) : null}
    </div>,
    document.body,
  );
}
