import { SampleReplay } from '@/components/DecisionReplay';
import { useEffect, useRef, useState } from 'react';
import {
  TrendingUp, BarChart3, BookOpen, ArrowUpRight, ArrowDownRight, Sparkles, Calendar, Target,
  Flame, Shield, ArrowRight, Zap, Award,
  CheckCircle2, ChevronRight, Activity, PenLine, Brain,
  ClipboardList, FlaskConical, ArrowRightCircle, ScrollText,
  CalendarClock, LayoutTemplate, Beaker, BookMarked, StickyNote,
  GraduationCap, CreditCard, ClipboardCheck, CandlestickChart,
  Gauge, PieChart, LayoutDashboard,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { ColorPaletteControl } from '@/components/ColorPaletteControl';
import { BrandLogo } from '@/components/BrandLogo';
import { LandingIcon } from '@/components/LandingIcon';

function useScrollReveal() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const targets = el.querySelectorAll('[data-reveal]');
    if (!('IntersectionObserver' in window)) {
      targets.forEach(target => target.classList.add('is-visible'));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1, rootMargin: '0px 0px -50px 0px' }
    );
    targets.forEach(child => observer.observe(child));
    return () => observer.disconnect();
  }, []);
  return ref;
}

export function LandingPage({ onEnter }: { onEnter: () => void }) {
  const { session } = useAuth();
  const [sampleReplay,setSampleReplay]=useState(false);
  const [showcaseAvailable,setShowcaseAvailable]=useState(false);
  useEffect(()=>{
    let active=true;
    void fetch('/api/demo/available').then(response=>response.ok?response.json():null)
      .then(value=>{if(active) setShowcaseAvailable(value?.enabled===true);})
      .catch(()=>{});
    return()=>{active=false;};
  },[]);
  const [scrollY, setScrollY] = useState(0);
  const pageRef = useScrollReveal();

  useEffect(() => {
    let frame = 0;
    const handler = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setScrollY(window.scrollY));
    };
    window.addEventListener('scroll', handler, { passive: true });
    return () => { cancelAnimationFrame(frame); window.removeEventListener('scroll', handler); };
  }, []);

  const workflowSteps = [
    { value: '01', label: 'Plan' },
    { value: '02', label: 'Capture' },
    { value: '03', label: 'Test' },
    { value: '04', label: 'Review' },
  ];

  const platformSections = [
    {
      label: 'Journal',
      icon: TrendingUp,
      items: [
        { icon: LayoutDashboard, title: 'Dashboard', desc: 'Net P&L, win rate, profit factor, expectancy, streaks, equity curve, 7-day P&L, and strategy edge scores — all on one screen.' },
        { icon: CandlestickChart, title: 'Trades', desc: '5-step trade entry wizard with auto-calculated pips, P&L, R:R, and outcome. Attach screenshots, voice notes, and pre-trade checklists.' },
        { icon: Calendar, title: 'Calendar', desc: 'Monthly heatmap of daily P&L and trade count. Spot overtrading days and gaps in your routine at a glance.' },
        { icon: BookOpen, title: 'Journal', desc: 'Daily, weekly, and monthly journal entries with pre-market checklists, post-session reviews, mood tracking, and review prompts.' },
        { icon: ClipboardCheck, title: 'Weekly Reviews', desc: 'Structured weekly reflections: what went well, what went wrong, lessons learned, and focus for next week.' },
      ],
    },
    {
      label: 'Playbook',
      icon: ClipboardList,
      items: [
        { icon: ClipboardList, title: 'Trading Plan', desc: 'Document your philosophy, HTF selection, LTF execution, trade management, risk rules, and entry models. Track adherence over time.' },
        { icon: Target, title: 'Strategy Library', desc: 'Keep strategies, entry models, and checklists consistent across trade capture and testing.' },
        { icon: LayoutTemplate, title: 'Setups', desc: 'Document your trading setups by category with entry/exit criteria, market conditions, and timeframes.' },
        { icon: Target, title: 'Goals', desc: 'Set trading and personal goals with categories, deadlines, progress tracking, and priority levels. Mark complete or pause anytime.' },
        { icon: ScrollText, title: 'Plan Rules & Checklists', desc: 'Keep discipline and risk rules inside each trading plan, with entry checklists attached to strategies and models.' },
        { icon: Shield, title: 'Risk Management', desc: 'Configure daily loss limits, max risk per trade, max drawdown, and max daily trades. Live Risk Guardian shows where you stand.' },
        { icon: CalendarClock, title: 'Market Sessions', desc: 'Track economic events by impact level and session. Flag no-trade windows so you never trade into high-impact news blindly.' },
      ],
    },
    {
      label: 'Testing',
      icon: FlaskConical,
      items: [
        { icon: FlaskConical, title: 'Backtesting', desc: 'Record backtest results with equity curves, monthly performance, win rate, profit factor, max drawdown, and Sharpe ratio.' },
        { icon: ArrowRightCircle, title: 'Forward Testing', desc: 'Paper-trade in real time with entry, stop loss, take profit, and position size. Track open and closed forward trades.' },
        { icon: Beaker, title: 'Strategy Testing', desc: 'Run structured test sessions per strategy. Log individual test trades, auto-calculate stats, and visualize equity curves.' },
      ],
    },
    {
      label: 'More',
      icon: GraduationCap,
      items: [
        { icon: BookMarked, title: 'Resources', desc: 'Build a curated library of books, videos, articles, courses, tools, and podcasts. Tag and search everything.' },
        { icon: StickyNote, title: 'Notes', desc: 'Freeform notes with tags and pinning. Capture ideas, observations, and reflections outside of formal journal entries.' },
        { icon: GraduationCap, title: 'Study Material', desc: 'Track your study progress across books, courses, video series, and articles. Monitor completion percentage and units.' },
      ],
    },
    {
      label: 'Accounts',
      icon: CreditCard,
      items: [
        { icon: CreditCard, title: 'Brokers & Charting', desc: 'Manage broker accounts with leverage, commission, spread, and funding details. Track charting tool subscriptions and renewal dates.' },
      ],
    },
    {
      label: 'Insights',
      icon: BarChart3,
      items: [
        { icon: BarChart3, title: 'Analytics', desc: 'Break down performance by instrument, day, direction, session, and strategy.' },
        { icon: Sparkles, title: 'AI Insights', desc: 'Review patterns in your trading history alongside the records they are based on.' },
      ],
    },
  ];

  const processFeatures = [
    { icon: Shield, title: 'Private workspace', desc: 'Your trades, plans, notes, and attachments stay scoped to your account.' },
    { icon: PenLine, title: 'Consistent reflection', desc: 'Capture the context behind a trade and review the decisions that shaped it.' },
    { icon: Brain, title: 'Evidence-led learning', desc: 'Use your own recorded history to spot patterns and refine your process.' },
    { icon: Target, title: 'Process over outcomes', desc: 'Track adherence and setup quality alongside results, not instead of them.' },
  ];

  const featureHighlights = [
    { icon: Gauge, title: 'Risk Guardian', desc: 'Live daily loss meter with threshold markers, drawdown tracking, and automatic stop-trading alerts when limits are hit.' },
    { icon: Zap, title: 'Trade Calculator', desc: 'Calculate pips, P&L, risk-to-reward, and risk percentage before entering. Supports FX, JPY pairs, metals, crypto, and indices.' },
    { icon: Award, title: 'Strategy Edge Scores', desc: 'Each strategy gets a 0-100 score with letter grade and edge rating (elite, strong, developing, weak) based on win rate, profit factor, expectancy, and consistency.' },
    { icon: Flame, title: 'Streak Tracking', desc: 'Monitor current and max consecutive win/loss streaks. Build discipline through visible momentum.' },
    { icon: Activity, title: 'Activity Heatmap', desc: 'GitHub-style trading activity calendar. See your most active days and identify patterns in your trading frequency.' },
    { icon: PieChart, title: 'Multi-Dimensional Analytics', desc: 'Performance broken down by pair, day of week, direction, session, and strategy — with radar, pie, and bar visualizations.' },
  ];

  return (
    <div ref={pageRef} className="ym-studio-landing min-h-screen bg-primary overflow-x-hidden">
      {/* ─── NAV ─── */}
      <nav className="fixed top-0 left-0 right-0 z-50 px-4 sm:px-6 py-3 transition-all duration-300"
        style={{
          backgroundColor: scrollY > 40 ? 'var(--glass-bg)' : 'transparent',
          backdropFilter: scrollY > 40 ? 'blur(20px) saturate(180%)' : 'none',
          borderBottom: scrollY > 40 ? '1px solid var(--border)' : '1px solid transparent',
        }}
      >
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <BrandLogo />
            <span className="font-bold text-base tracking-tight hidden sm:inline">Young-Money-Fx</span><span className="font-bold text-sm tracking-tight sm:hidden">YM / FX</span>
          </div>
          <div className="ym-studio-landing-nav hidden md:flex items-center gap-1">
            <a href="#platform" className="btn-ghost text-sm">Platform</a>
            <a href="#features" className="btn-ghost text-sm">Features</a>
            <a href="#practice" className="btn-ghost text-sm">Private practice</a>
            <a href="#how" className="btn-ghost text-sm">How It Works</a>
          </div>
          <div className="flex items-center gap-2">
            <ColorPaletteControl compact />
            <button onClick={onEnter} className="btn-primary text-sm">
              <span className="hidden sm:inline">{session ? 'Open Dashboard' : 'Get Started'}</span>
              <span className="sm:hidden">{session ? 'Open' : 'Enter'}</span>
              <ArrowRight size={16} />
            </button>
          </div>
        </div>
      </nav>

      {/* ─── HERO ─── */}
      <section className="relative min-h-screen flex items-center justify-center pt-24 pb-16 px-4">
        {/* Animated background orbs */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] rounded-full bg-orange-500/10 blur-[120px] animate-drift" />
          <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] rounded-full bg-amber-500/8 blur-[100px] animate-float-slow" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-red-500/5 blur-[140px] animate-pulse-glow" />
        </div>

        {/* Compositional artwork remains separate from editable headline text. */}
        <img className="ym-landing-hero-art" src="/assets/page-art/welcome.svg" alt="" aria-hidden="true" decoding="async" width="960" height="540" />
        {/* Grid pattern */}
        <div className="absolute inset-0 opacity-[0.04] pointer-events-none" style={{
          backgroundImage: 'linear-gradient(currentColor 1px, transparent 1px), linear-gradient(90deg, currentColor 1px, transparent 1px)',
          backgroundSize: '60px 60px',
          color: 'var(--text-primary)',
        }} />

        <div className="relative z-10 max-w-6xl mx-auto grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="text-center lg:text-left">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-orange-500/10 border border-orange-500/20 mb-7 animate-slide-up">
            <span className="w-2 h-2 rounded-full bg-orange-500" />
            <span className="text-xs font-semibold text-orange-700 dark:text-orange-300">A calmer way to trade with intention</span>
          </div>

          {/* Headline */}
          <h1 className="text-[2.75rem] sm:text-6xl lg:text-[4.5rem] font-extrabold tracking-[-0.05em] leading-[1.04] animate-slide-up" style={{ animationDelay: '0.05s' }}>
            Make every trade
            <br />
            <span className="text-gradient animate-gradient-shift" style={{ backgroundSize: '200% auto' }}>teach you something.</span>
          </h1>

          {/* Subheadline */}
          <p className="mt-6 text-lg text-secondary max-w-2xl mx-auto lg:mx-0 leading-relaxed animate-slide-up" style={{ animationDelay: '0.1s' }}>
            Plan a setup, capture the decision, test your edge, and review the result in one connected workspace. Keep the process clear and the journaling lightweight.
          </p>

          {/* CTAs */}
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-3 animate-slide-up" style={{ animationDelay: '0.15s' }}>
            <button onClick={onEnter} className="btn-primary text-base px-6 py-3">
              {session ? 'Open Your Journal' : 'Start Journaling'}
              <ArrowRight size={18} />
            </button>
            {sampleReplay && <SampleReplay onClose={()=>setSampleReplay(false)}/>}
            {showcaseAvailable && <button type="button" onClick={onEnter} className="btn-secondary text-base px-6 py-3">
              Explore sample workspace
              <ArrowRight size={16} />
            </button>}
            <button type="button" className="btn-ghost text-sm px-3 py-3" onClick={()=>setSampleReplay(true)}>
              <BookOpen size={16} /> Replay a trade
              <ChevronRight size={16} />
            </button>
          </div>

          {/* Trust line */}
          <div className="mt-7 flex flex-wrap items-center justify-center lg:justify-start gap-x-5 gap-y-2 text-xs text-muted animate-fade-in" style={{ animationDelay: '0.3s' }}>
            <span className="flex items-center gap-1.5"><ClipboardList size={14} /> Plans and playbooks</span>
            <span className="flex items-center gap-1.5"><CandlestickChart size={14} /> Live and test logs</span>
            <span className="flex items-center gap-1.5"><Brain size={14} /> Guided reflection</span>
          </div>

          <div className="mt-10 grid grid-cols-4 max-w-lg mx-auto lg:mx-0 border-y border-themed py-4 animate-fade-in" style={{ animationDelay: '0.4s' }}>
            {workflowSteps.map((step, index) => <div key={step.label} className="relative text-center lg:text-left">
              <p className="text-[10px] font-mono text-orange-500">{step.value}</p>
              <p className="mt-1 text-xs font-semibold">{step.label}</p>
              {index < workflowSteps.length - 1 && <ArrowRight size={12} className="absolute right-0 top-3 text-muted" />}
            </div>)}
          </div>
          </div>

          <div className="relative mx-auto w-full max-w-xl animate-hero-panel" aria-label="Illustrative journal dashboard preview">
            <div className="absolute -inset-4 rounded-[2rem] bg-orange-500/10 blur-3xl animate-orbit-glow" />
            <div className="ym-landing-showcase relative overflow-hidden rounded-3xl border border-themed bg-card/90 p-5 sm:p-7 shadow-2xl backdrop-blur-xl">
              <div className="flex items-center justify-between gap-4">
                <div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">Weekly performance</p><p className="mt-1 text-lg font-bold">Review your process</p></div>
                <span className="rounded-full border border-orange-500/20 bg-orange-500/10 px-2.5 py-1 text-[10px] font-semibold text-orange-700 dark:text-orange-300">DEMO VIEW</span>
              </div>
              <div className="mt-6 grid grid-cols-3 gap-3">
                {[['Trades', '12'], ['Plan followed', '83%'], ['Review notes', '4']].map(([label, value], i) => <div key={label} className={`rounded-2xl border border-themed bg-secondary/60 p-3 animate-hero-card-${i + 1}`}><p className="text-[10px] text-muted">{label}</p><p className="mt-1 font-mono text-lg font-bold">{value}</p></div>)}
              </div>
              <div className="mt-5 rounded-2xl border border-themed bg-primary/70 p-4">
                <div className="flex items-center justify-between"><span className="text-xs font-semibold">Execution consistency</span><span className="text-[10px] text-muted">Illustrative only · no live prices</span></div>
                <svg viewBox="0 0 520 180" role="img" aria-label="Illustrative upward and downward chart line" className="mt-3 h-36 w-full overflow-visible">
                  <defs><linearGradient id="heroArea" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="var(--brand)" stopOpacity=".24" /><stop offset="1" stopColor="var(--brand)" stopOpacity="0" /></linearGradient></defs>
                  {[40, 85, 130].map(y => <line key={y} x1="0" x2="520" y1={y} y2={y} stroke="currentColor" strokeOpacity=".08" strokeDasharray="4 8" />)}
                  <path d="M0 130 C36 122 42 106 78 114 S126 138 163 101 S212 90 247 103 S292 82 326 88 S370 111 405 72 S453 53 485 65 S505 46 520 42 L520 180 L0 180Z" fill="url(#heroArea)" />
                  <path d="M0 130 C36 122 42 106 78 114 S126 138 163 101 S212 90 247 103 S292 82 326 88 S370 111 405 72 S453 53 485 65 S505 46 520 42" fill="none" stroke="var(--brand)" strokeWidth="3" strokeLinecap="round" className="hero-chart-line" />
                  <circle cx="520" cy="42" r="5" fill="var(--brand)" className="hero-chart-dot" />
                </svg>
                <div className="mt-2 flex justify-between text-[10px] text-muted"><span>Plan</span><span>Execute</span><span>Reflect</span><span>Adjust</span></div>
              </div>
              <div className="ym-landing-market" aria-label="Illustrative trade results">
                <p className="ym-preview-eyebrow">RECENT TRADES <span className="font-sans font-normal normal-case tracking-normal">/ fictional examples</span></p>
                <div className="ym-landing-market-row">
                  <div className="min-w-0"><strong>EURUSD <span className="ym-direction-tag ml-1" data-side="long">LONG</span></strong><small>London sweep · Plan followed</small></div>
                  <span className="ym-market-value ym-market-positive">+$82.40</span>
                </div>
                <div className="ym-landing-market-row">
                  <div className="min-w-0"><strong>XAUUSD <span className="ym-direction-tag ml-1" data-side="short">SHORT</span></strong><small>New York retest · Planned stop</small></div>
                  <span className="ym-market-value ym-market-negative">−$34.20</span>
                </div>
                <div className="ym-landing-sltp" aria-label="Example trade protection and targets">
                  <span>Trade levels</span>
                  <span className="ym-market-sl"><ArrowDownRight size={13}/> SL · 1.15200</span>
                  <span className="ym-market-tp"><ArrowUpRight size={13}/> TP · 1.15700</span>
                </div>
                <div className="flex items-center justify-between gap-3 pt-2">
                  <span className="text-[10px] text-secondary">Every result has a reason, a risk level and a review.</span>
                  <BookOpen size={15} className="text-secondary shrink-0" />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-float">
          <div className="w-6 h-10 rounded-full border-2 border-muted/30 flex items-start justify-center p-1.5">
            <div className="w-1 h-2 rounded-full bg-orange-500 animate-pulse" />
          </div>
        </div>
      </section>

      {/* ─── WORKFLOW DIVIDER ─── */}
      <section className="ym-studio-landing-ticker relative border-y border-themed bg-secondary/40 py-5" aria-label="Your trading workflow">
        <ol className="ym-workflow-ribbon">
          {workflowSteps.map(step => (
            <li key={step.value}>
              <span className="ym-workflow-ribbon-number" aria-hidden="true">{step.value}</span>
              <span className="ym-workflow-ribbon-label">{step.label}</span>
            </li>
          ))}
        </ol>
      </section>

      {/* ─── PLATFORM OVERVIEW ─── */}
      <section id="platform" className="py-20 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <p className="text-xs font-bold uppercase tracking-wider text-orange-500 mb-3">The full system</p>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">One process. Every decision.</h2>
            <p className="mt-3 text-secondary max-w-2xl mx-auto">
              Every aspect of your trading life in one place — from the moment you plan your day to the
              moment you review your week. No spreadsheets. No scattered notes. No excuses.
            </p>
          </div>

          <div className="space-y-12">
            {platformSections.map((section, si) => (
              <div key={si} data-reveal className="ym-platform-category">
                <div className="ym-platform-chapter">
                  <div className="ym-platform-chapter-number" aria-hidden="true">{String(si + 1).padStart(2, '0')}</div>
                  <div className="ym-platform-chapter-text">
                    <span className="ym-platform-chapter-kicker">AREA / {String(si + 1).padStart(2, '0')}</span>
                    <h3>{section.label}</h3>
                  </div>
                  <div className="ym-platform-chapter-rule" aria-hidden="true" />
                  <span className="ym-platform-chapter-count">{section.items.length} {section.items.length === 1 ? 'tool' : 'tools'}</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {section.items.map((item, ii) => (
                    <div
                      key={ii}
                      className="card card-hover p-5 group ym-platform-tool"
                    >
                      <div className="flex items-start gap-3">
                        <LandingIcon icon={item.icon} />
                        <div className="min-w-0">
                          <h4 className="font-bold text-sm mb-1">{item.title}</h4>
                          <p className="text-xs text-secondary leading-relaxed">{item.desc}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── FEATURE HIGHLIGHTS ─── */}
      <section id="features" className="py-20 px-4 relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/3 left-0 w-96 h-96 rounded-full bg-orange-500/5 blur-3xl" />
          <div className="absolute bottom-1/3 right-0 w-96 h-96 rounded-full bg-amber-500/5 blur-3xl" />
        </div>
        <div className="relative max-w-6xl mx-auto">
          <div className="ym-editorial-banner ym-intelligence-banner mb-10" data-reveal>
            <div className="ym-editorial-copy">
              <p className="ym-editorial-eyebrow">What sets it apart <span aria-hidden="true">/ 02</span></p>
              <h2>Built for <em>serious traders.</em></h2>
              <p>Not just a trade log — your decisions, risk and patterns, brought together in a clear trading intelligence system.</p>
              <div className="ym-editorial-rule" aria-hidden="true"><span /></div>
              <span className="ym-editorial-caption">PROCESS / PRECISION / PERSPECTIVE</span>
            </div>
            <div className="ym-editorial-media">
              <img src="/visuals/studio-intelligence.svg" alt="Illustration of trading analytics with a chart, risk gauge and strategy data" loading="lazy" width="1200" height="680" />
            </div>
          </div>
          <div className="ym-feature-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {featureHighlights.map((f, i) => (
              <div
                key={i}
                data-reveal
                className="ym-feature-tile card card-hover p-6 group"
              >
                <LandingIcon icon={f.icon} size="lg" className="mb-4" />
                <h3 className="font-bold text-base mb-2">{f.title}</h3>
                <p className="text-sm text-secondary leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── PRIVATE PRACTICE ─── */}
      <section id="practice" className="py-20 px-4 relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0 left-0 w-96 h-96 rounded-full bg-orange-500/5 blur-3xl" />
          <div className="absolute bottom-0 right-0 w-96 h-96 rounded-full bg-amber-500/5 blur-3xl" />
        </div>
        <div className="relative max-w-5xl mx-auto" data-reveal>
          <div className="ym-editorial-banner ym-practice-banner mb-10">
            <div className="ym-editorial-copy">
              <p className="ym-editorial-eyebrow"><Shield size={14} aria-hidden="true" /> A private trading practice <span aria-hidden="true">/ 03</span></p>
              <h2>Build consistency with <em>honest records.</em></h2>
              <p>Keep your journal private and your review process structured. Capture decisions, not just outcomes, to understand your own evidence.</p>
              <div className="ym-editorial-rule" aria-hidden="true"><span /></div>
              <span className="ym-editorial-caption">YOUR PROCESS / YOUR EVIDENCE</span>
            </div>
            <div className="ym-editorial-media">
              <img src="/visuals/studio-journal.svg" alt="Illustration of a secure trading journal and review checklists" loading="lazy" width="1200" height="680" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {processFeatures.map((f, i) => (
              <div key={i} data-reveal className="card card-hover p-6 flex gap-4">
                <LandingIcon icon={f.icon} />
                <div>
                  <h3 className="font-bold text-sm mb-1.5">{f.title}</h3>
                  <p className="text-sm text-secondary leading-relaxed">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Quote card */}
          <div className="mt-10 card-gradient p-8 sm:p-10 text-center relative overflow-hidden">
            <div className="absolute top-4 left-4 text-6xl font-serif text-orange-500/20">"</div>
            <div className="absolute bottom-4 right-4 text-6xl font-serif text-orange-500/20 rotate-180">"</div>
            <p className="text-xl sm:text-2xl font-semibold leading-relaxed max-w-2xl mx-auto">
              The goal isn't to chase a number. The goal is to improve
              <span className="text-gradient"> one recorded decision at a time.</span>
            </p>
          </div>
        </div>
      </section>

      {/* ─── HOW IT WORKS ─── */}
      <section id="how" className="py-20 px-4">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-14">
            <p className="text-xs font-bold uppercase tracking-wider text-orange-500 mb-3">Simple workflow</p>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">How it works</h2>
          </div>
          <div className="ym-process-stack">
            {[
              { step: '01', icon: PenLine, title: 'Log your trades', desc: '5-step wizard: pick strategy, enter trade details with live auto-calc, add context (emotion, setup quality, mistakes), attach screenshots and voice notes, then close with a review.' },
              { step: '02', icon: BookOpen, title: 'Journal every decision', desc: 'Daily, weekly, and monthly journal entries with pre-market checklists, post-session reviews, mood tracking, and guided review prompts.' },
              { step: '03', icon: Sparkles, title: 'Get AI insights', desc: 'Automatic pattern detection highlights your edge, your leaks, emotional blind spots, recurring mistakes, and best sessions — with period-over-period comparison.' },
              { step: '04', icon: Shield, title: 'Manage your risk', desc: 'Risk Guardian monitors daily loss, drawdown, and trade count in real time. Set your limits and get automatic stop-trading alerts.' },
              { step: '05', icon: FlaskConical, title: 'Test and learn', desc: 'Backtest strategies, forward-test in real time, document setups, track study progress, and build a resource library.' },
              { step: '06', icon: Target, title: 'Review your process', desc: 'Compare your plan with the decisions you recorded, identify recurring patterns, and choose one improvement to test.' },
            ].map((s, i) => (
              <div key={i} data-reveal className="ym-process-step card p-5 flex items-center gap-5 group" style={{ '--step-index': i } as React.CSSProperties}>
                <span className="landing-step-number" aria-label={`Step ${s.step}`}>{s.step}</span>
                <LandingIcon icon={s.icon} className="landing-icon--desktop" />
                <div>
                  <h3 className="font-bold text-base">{s.title}</h3>
                  <p className="text-sm text-secondary mt-1">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── CTA ─── */}
      <section className="py-20 px-4">
        <div className="max-w-3xl mx-auto" data-reveal>
          <div className="relative card-gradient p-10 sm:p-14 text-center overflow-hidden">
            {/* Glow */}
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-64 h-64 rounded-full bg-orange-500/15 blur-3xl animate-pulse-glow" />
            </div>
            <div className="relative z-10">
              <LandingIcon icon={TrendingUp} size="lg" variant="solid" className="mb-6 mx-auto" />
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
                Ready to trade with <span className="text-gradient">intention?</span>
              </h2>
              <p className="mt-4 text-secondary max-w-md mx-auto">
                Start your journal today. Plan, capture, test, and review your decisions in one connected workspace.
              </p>
              <button onClick={onEnter} className="btn-primary text-base px-8 py-3 mt-8">
                {session ? 'Open Your Dashboard' : 'Create Your Free Account'}
                <ArrowRight size={18} />
              </button>
              <div className="mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-muted">
                <span className="flex items-center gap-1"><CheckCircle2 size={14} className="text-success-500" /> No credit card</span>
                <span className="flex items-center gap-1"><CheckCircle2 size={14} className="text-success-500" /> Free forever</span>
                <span className="flex items-center gap-1"><CheckCircle2 size={14} className="text-success-500" /> One connected workflow</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── FOOTER ─── */}
      <footer className="ym-studio-footer py-12 px-4 border-t border-themed">
        <img className="ym-footer-art" src="/visuals/studio-wave.svg" alt="" aria-hidden="true" loading="lazy" width="1800" height="550" />
        <div className="ym-footer-content max-w-6xl mx-auto">
          <div className="ym-footer-head flex flex-col sm:flex-row items-center justify-between gap-4 mb-6">
            <div className="flex items-center gap-2.5">
              <BrandLogo />
              <span className="ym-footer-wordmark font-bold text-sm">YM-Fx <small> / THE TRADING DESK</small></span>
            </div>
            <p className="ym-footer-promise text-xs">Built for accountability. Designed for growth.</p>
            <div className="ym-footer-signoff">PROCESS <span>•</span> PRECISION <span>•</span> DISCIPLINE</div>
          </div>
          <div className="ym-footer-links flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs">
            <a href="#platform">The platform</a><a href="#features">Features</a><a href="#practice">Our approach</a><a href="#how">How it works</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
