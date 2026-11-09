import { useEffect, useState, type ReactNode } from 'react';
import { LayoutDashboard, CandlestickChart, Calendar, BarChart3, BookOpen, Sparkles, Menu, X, TrendingUp, Plus, LogOut, ChevronDown, ChevronRight, ClipboardList, Target, FlaskConical, Shield, CalendarClock, LayoutTemplate, BookMarked, StickyNote, GraduationCap, CreditCard, ClipboardCheck, MoreHorizontal, Archive, Settings, Search, Monitor } from 'lucide-react';
import { CommandPalette } from '@/components/CommandPalette';
import { ColorPaletteControl } from '@/components/ColorPaletteControl';
import { DataBackupModal } from '@/components/DataBackupModal';
import { DataRecoveryNotice } from '@/components/ui/DataRecoveryNotice';
import { useAuth } from '@/context/AuthContext';

export type PageId = 'dashboard' | 'trades' | 'calendar' | 'analytics' | 'journal' | 'ai' | 'trading-plan' | 'goals' | 'risk-management' | 'market-sessions' | 'setups' | 'strategy-testing' | 'strategies' | 'resources' | 'notes' | 'study-material' | 'brokers-charting' | 'weekly-reviews' | 'account-settings' | 'admin-operations' | 'mt5' | 'workspace-setup';

interface LayoutProps {
  current: PageId;
  onNavigate: (page: PageId) => void;
  onQuickAdd: () => void;
  children: ReactNode;
}

const NAV_SECTIONS: { id: string; label: string; icon: typeof LayoutDashboard; items: { id: PageId; label: string; icon: typeof LayoutDashboard }[] }[] = [
  { id: 'home', label: 'Home', icon: LayoutDashboard, items: [
    { id: 'workspace-setup', label: 'Workspace setup', icon: ClipboardList },
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  ] },
  { id: 'journal', label: 'Journal', icon: BookOpen, items: [
    { id: 'trades', label: 'Trades', icon: CandlestickChart },
    { id: 'journal', label: 'Journal', icon: BookOpen },
    { id: 'calendar', label: 'Calendar', icon: Calendar },
    { id: 'weekly-reviews', label: 'Weekly Reviews', icon: ClipboardCheck },
  ] },
  { id: 'playbook', label: 'Playbook', icon: ClipboardList, items: [
    { id: 'trading-plan', label: 'Trading Plan', icon: ClipboardList },
    { id: 'strategies', label: 'Strategy Library', icon: Target },
    { id: 'setups', label: 'Setups', icon: LayoutTemplate },
    { id: 'risk-management', label: 'Risk Management', icon: Shield },
    { id: 'goals', label: 'Goals', icon: Target },
    { id: 'market-sessions', label: 'Market Sessions', icon: CalendarClock },
  ] },
  { id: 'testing', label: 'Testing', icon: FlaskConical, items: [
    { id: 'strategy-testing', label: 'Testing Workspace', icon: FlaskConical },
  ] },
  { id: 'accounts', label: 'Accounts', icon: CreditCard, items: [
    { id: 'brokers-charting', label: 'Brokers & Charting', icon: CreditCard },
  ] },
  { id: 'insights', label: 'Insights', icon: BarChart3, items: [
    { id: 'analytics', label: 'Analytics', icon: BarChart3 },
    { id: 'ai', label: 'AI Insights', icon: Sparkles },
  ] },
  { id: 'more', label: 'More', icon: MoreHorizontal, items: [
    { id: 'resources', label: 'Resources', icon: BookMarked },
    { id: 'notes', label: 'Notes', icon: StickyNote },
    { id: 'study-material', label: 'Study Material', icon: GraduationCap },
  ] },
];

export function Layout({ current, onNavigate, onQuickAdd, children }: LayoutProps) {
  const { profile, signOut } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(open => !open);
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);
  const activeGroup = NAV_SECTIONS.find(section => section.items.some(item => item.id === current));
  const currentSection = activeGroup?.id || 'home';
  const currentSectionLabel = activeGroup?.label || 'Workspace';
  const pageTitle = activeGroup?.items.find(item => item.id === current)?.label
    || ({ 'account-settings': 'Account Settings', 'admin-operations': 'Admin Operations', mt5: 'MT5 Connections' } as Partial<Record<PageId, string>>)[current]
    || 'Workspace';
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ home: true });

  useEffect(() => {
    setExpanded(previous => previous[currentSection] ? previous : { ...previous, [currentSection]: true });
  }, [currentSection]);

  const toggleSection = (id: string) => setExpanded(previous => ({ ...previous, [id]: !previous[id] }));

  useEffect(() => {
    if (!mobileOpen) return;
    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false);
    };
    window.addEventListener('keydown', onEscape);
    return () => {
      document.body.style.overflow = priorOverflow;
      window.removeEventListener('keydown', onEscape);
    };
  }, [mobileOpen]);

  const handleNav = (page: PageId) => {
    onNavigate(page);
    setMobileOpen(false);
    setProfileMenuOpen(false);
  };

  const displayName = profile?.display_name || 'Trader';
  const initials = displayName.charAt(0).toUpperCase();

  return (
    <div className="ym-workspace min-h-screen bg-primary flex">
      <aside
        className={`ym-sidebar fixed lg:sticky top-0 left-0 h-[100dvh] w-[270px] bg-card border-r border-themed z-40 flex flex-col transition-transform duration-300 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div className="ym-sidebar-brand relative flex items-center gap-3 px-5 py-5 border-b border-themed">
          <div className="ym-brand-mark relative flex items-center justify-center text-white">
            <TrendingUp size={22} />
            <span className="absolute -top-0.5 -right-0.5">
              <span className="relative flex h-2 w-2">
                <span className="relative inline-flex w-2 h-2 rounded-full bg-amber-400 ring-2 ring-card" />
              </span>
            </span>
          </div>
          <div>
            <h1 className="font-bold text-[13px] tracking-[-0.025em]">Young-Money-Fx</h1>
            <p className="ym-brand-caption">THE TRADING WORKSPACE</p>
          </div>
          <button type="button" aria-label="Close navigation" onClick={() => setMobileOpen(false)} className="ml-auto lg:hidden btn-ghost p-1">
            <X size={18} />
          </button>
        </div>

        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          className="ym-quick-find mx-3 mt-3 flex items-center gap-2.5 rounded-xl border border-themed bg-secondary px-3 py-2.5 text-xs text-secondary transition-colors hover:text-primary"
          aria-label="Quick find — search pages and actions"
        >
          <Search size={15} />
          <span className="flex-1 text-left">Quick find</span>
          <kbd className="rounded-md border border-themed px-1.5 py-0.5 text-[10px] text-muted">Ctrl K</kbd>
        </button>

        <nav aria-label="Main navigation" className="ym-sidebar-nav relative flex-1 px-3 py-4 overflow-y-auto">
          <div className="space-y-1">
            <button type="button" data-active={current === 'account-settings'}
              aria-current={current === 'account-settings' ? 'page' : undefined}
              onClick={() => handleNav('account-settings')}
              className="ym-nav-item w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium">
              <Settings size={18} /> Account Settings
            </button>
            {profile?.role === 'admin' && profile.account_status === 'active' && <button type="button"
              aria-current={current === 'admin-operations' ? 'page' : undefined}
              onClick={() => handleNav('admin-operations')}
              data-active={current === 'admin-operations'} className="ym-nav-item w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium">
              <Shield size={18} /> Admin Operations
            </button>}
            <button type="button" aria-current={current === 'mt5' ? 'page' : undefined}
              onClick={() => handleNav('mt5')}
              data-active={current === 'mt5'} className="ym-nav-item w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium">
              <Monitor size={18} /> MT5 Connections
            </button>
            {NAV_SECTIONS.map(section => {
              const isExpanded = !!expanded[section.id];
              const containsCurrent = section.id === currentSection;
              const GroupIcon = section.icon;
              return (
              <section key={section.id} className="ym-nav-section rounded-xl">
                <button
                  type="button"
                  aria-expanded={isExpanded}
                  aria-controls={`nav-group-${section.id}`}
                  onClick={() => toggleSection(section.id)}
                  data-current-group={containsCurrent}
                  className="ym-nav-group w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-semibold tracking-wide"
                >
                  <GroupIcon size={16} className="ym-nav-group-icon" />
                  <span className="flex-1 text-left">{section.label}</span>
                  
                  <ChevronRight size={14} className={`transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} />
                </button>
                <div id={`nav-group-${section.id}`} hidden={!isExpanded} className="nav-group-content ml-2 mt-0.5 space-y-0.5 border-l border-themed pl-2 pb-1">
                  {section.items.map(item => {
                    const Icon = item.icon;
                    const active = current === item.id;
                    return (
                      <button key={item.id} type="button" data-active={active}
                        aria-current={active ? 'page' : undefined}
                        onClick={() => handleNav(item.id)}
                        className="ym-nav-item ym-nav-subitem w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium">
                        <Icon size={17} />
                        <span className="truncate">{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            )})}
          </div>
          <div className="sticky bottom-0 left-0 right-0 h-8 -mx-3 -mb-4 pointer-events-none bg-gradient-to-t from-card via-card/90 to-transparent" />
        </nav>

        <div className="px-3 py-3 border-t border-themed">
          <div className="relative">
            <button
              onClick={() => setProfileMenuOpen(o => !o)}
              type="button" aria-expanded={profileMenuOpen}
              className="ym-profile-trigger w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-secondary transition-colors"
            >
              {profile?.avatar_url ? (
                <img src={profile.avatar_url} alt={displayName} className="w-8 h-8 rounded-full object-cover ring-2 ring-orange-500/20" />
              ) : (
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-orange-500 to-orange-700 flex items-center justify-center text-white text-xs font-bold shadow-sm">
                  {initials}
                </div>
              )}
              <span className="truncate flex-1 text-left">{displayName}</span>
              <ChevronDown size={16} className={`transition-transform duration-200 ${profileMenuOpen ? 'rotate-180' : ''}`} />
            </button>
            {profileMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setProfileMenuOpen(false)} />
                <div className="absolute bottom-full left-0 right-0 mb-2 card border border-themed rounded-xl shadow-xl z-50 animate-scale-in">
                  <div className="border-t border-themed p-3"><ColorPaletteControl /></div>
                  <div className="border-t border-themed" />
                  <button onClick={() => { handleNav('account-settings'); setProfileMenuOpen(false); }} className="w-full flex items-center gap-3 px-4 py-3 text-sm text-secondary hover:bg-secondary hover:text-primary transition-colors">
                    <Settings size={16} /> Account Settings
                  </button>
                  {profile?.role === 'admin' && profile.account_status === 'active' && <button onClick={() => { handleNav('admin-operations'); setProfileMenuOpen(false); }} className="w-full flex items-center gap-3 px-4 py-3 text-sm text-secondary hover:bg-secondary hover:text-primary transition-colors"><Shield size={16} /> Admin Operations</button>}
                  <button onClick={() => { setBackupOpen(true); setProfileMenuOpen(false); }} className="w-full flex items-center gap-3 px-4 py-3 text-sm text-secondary hover:bg-secondary hover:text-primary transition-colors">
                    <Archive size={16} /> Data Backup & Restore
                  </button>
                  <button onClick={() => { signOut(); }} className="w-full flex items-center gap-3 px-4 py-3 text-sm text-error-500 hover:bg-error-500/10 transition-colors">
                    <LogOut size={16} /> Sign Out
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </aside>

      {mobileOpen && <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-30 lg:hidden" onClick={() => setMobileOpen(false)} />}

      <div className="ym-workspace-stage flex-1 min-w-0">
        <header className="ym-workspace-topbar hidden lg:flex items-center justify-between gap-4 px-7 xl:px-10">
          <div className="min-w-0">
            <p className="ym-topbar-eyebrow">YOUNGMONEY3 / THE DESK</p>
            <div className="flex items-center gap-2 text-[13px]">
              <span className="text-muted">{currentSectionLabel}</span>
              <ChevronRight size={13} className="text-muted" />
              <strong className="font-semibold tracking-tight truncate">{pageTitle}</strong>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="ym-workspace-note hidden 2xl:inline">Keep the process. Review the outcome.</span>
            <button type="button" onClick={() => setSearchOpen(true)} aria-label="Search workspace (Ctrl K)" className="ym-topbar-search">
              <Search size={16} /><span>Find anything</span><kbd>Ctrl K</kbd>
            </button>
            <ColorPaletteControl compact />
          </div>
        </header>
        <div className="ym-mobile-topbar lg:hidden sticky top-0 z-20 flex items-center justify-between px-4 py-3 bg-card/90 backdrop-blur-md border-b border-themed">
          <button type="button" onClick={() => setMobileOpen(true)} aria-label="Open navigation menu" aria-expanded={mobileOpen} className="btn-ghost p-1.5">
            <Menu size={20} />
          </button>
          <div className="flex items-center gap-2">
            <TrendingUp size={18} className="ym-mobile-logo-icon" />
            <span className="font-bold text-sm tracking-tight">YoungMoney3</span>
          </div>
          <button type="button" onClick={() => setSearchOpen(true)} className="btn-ghost p-1.5" aria-label="Search workspace">
            <Search size={20} />
          </button>
        </div>

        <main id="workspace-content" className="ym-main-content p-4 sm:p-6 lg:p-8 xl:px-10 max-w-[1480px] mx-auto animate-fade-in pb-32 lg:pb-12">
          <DataRecoveryNotice />
          {children}
        </main>

        <button
          onClick={onQuickAdd}
          className="ym-desktop-quick-add fixed bottom-7 right-7 z-30 w-14 h-14 rounded-xl text-white shadow-lg hidden lg:flex items-center justify-center transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          title="Quick Add"
          aria-label="Quick Add"
        >
          <Plus size={26} />
        </button>
      </div>
      <nav aria-label="Mobile workspace navigation" className="ym-mobile-dock lg:hidden">
        <button type="button" className="ym-dock-item" data-active={current === 'dashboard'} aria-current={current === 'dashboard' ? 'page' : undefined} onClick={() => handleNav('dashboard')}><LayoutDashboard size={20} /><span>Home</span></button>
        <button type="button" className="ym-dock-item" data-active={current === 'trades'} aria-current={current === 'trades' ? 'page' : undefined} onClick={() => handleNav('trades')}><CandlestickChart size={20} /><span>Trades</span></button>
        <button type="button" className="ym-dock-item ym-dock-add" aria-label="Quick add trade" onClick={onQuickAdd}><Plus size={22} /><span>Add</span></button>
        <button type="button" className="ym-dock-item" data-active={current === 'journal'} aria-current={current === 'journal' ? 'page' : undefined} onClick={() => handleNav('journal')}><BookOpen size={20} /><span>Journal</span></button>
        <button type="button" className="ym-dock-item" data-active={current === 'analytics'} aria-current={current === 'analytics' ? 'page' : undefined} onClick={() => handleNav('analytics')}><BarChart3 size={20} /><span>Insights</span></button>
      </nav>
      <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} onNavigate={handleNav} onQuickAdd={onQuickAdd} />
      <DataBackupModal open={backupOpen} onClose={() => setBackupOpen(false)} />
    </div>
  );
}
