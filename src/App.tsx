import { useState, useEffect } from 'react';
import { ThemeProvider } from '@/context/ThemeProvider';
import { AuthProvider } from '@/context/AuthProvider';
import { useAuth } from '@/context/AuthContext';
import { Layout, type PageId } from '@/components/Layout';
import { DashboardPage } from '@/pages/DashboardPage';
import { TradesPage } from '@/pages/TradesPage';
import { CalendarPage } from '@/pages/CalendarPage';
import { AnalyticsPage } from '@/pages/AnalyticsPage';
import { JournalPage } from '@/pages/JournalPage';
import { AIInsightsPage } from '@/pages/AIInsightsPage';
import { AuthPage } from '@/pages/AuthPage';
import { LandingPage } from '@/pages/LandingPage';
import { OnboardingPage } from '@/pages/OnboardingPage';
import { TradingPlanPage } from '@/pages/TradingPlanPage';
import { GoalsPage } from '@/pages/GoalsPage';
import { RiskManagementPage } from '@/pages/RiskManagementPage';
import { MarketSessionsPage } from '@/pages/MarketSessionsPage';
import { SetupsPage } from '@/pages/SetupsPage';
import { StrategyTestingPage } from '@/pages/StrategyTestingPage';
import { ResourcesPage } from '@/pages/ResourcesPage';
import { NotesPage } from '@/pages/NotesPage';
import { StudyMaterialPage } from '@/pages/StudyMaterialPage';
import { BrokersChartingPage } from '@/pages/BrokersChartingPage';
import { WeeklyReviewsPage } from '@/pages/WeeklyReviewsPage';
import { StrategyLibraryPage } from '@/pages/StrategyLibraryPage';
import { AccountSettingsPage } from '@/pages/AccountSettingsPage';
import { LoadingSpinner } from '@/components/ui/Feedback';
import { supabase } from '@/lib/supabase';
import { QuickCaptureModal } from '@/components/QuickCaptureModal';
import { AppErrorBoundary } from '@/components/AppErrorBoundary';
import { reportDataError } from '@/lib/recovery';
import { Mt5Connections } from '@/components/Mt5Connections';
import { RefreshCw } from 'lucide-react';

const PAGE_IDS: PageId[] = [
  'dashboard', 'trades', 'calendar', 'analytics', 'journal', 'ai',
  'trading-plan', 'goals', 'risk-management', 'market-sessions', 'setups', 'strategy-testing',
  'strategies', 'resources', 'notes', 'study-material', 'brokers-charting', 'weekly-reviews',
  'account-settings',
];

function pageFromLocation(): PageId {
  const candidate = window.location.hash.slice(1);
  return PAGE_IDS.includes(candidate as PageId) ? candidate as PageId : 'dashboard';
}

function AppContent() {
  const { session, loading, profile, signOut } = useAuth();
  const [page, setPage] = useState<PageId>(pageFromLocation);
  const [quickAdd, setQuickAdd] = useState(false);
  const [showLanding, setShowLanding] = useState(true);
  const [onboardingNeeded, setOnboardingNeeded] = useState<boolean | null>(null);
  const [onboardingError, setOnboardingError] = useState('');
  const [onboardingAttempt, setOnboardingAttempt] = useState(0);

  useEffect(() => {
    const restorePageFromLocation = () => setPage(pageFromLocation());
    window.addEventListener('popstate', restorePageFromLocation);
    window.addEventListener('hashchange', restorePageFromLocation);
    return () => {
      window.removeEventListener('popstate', restorePageFromLocation);
      window.removeEventListener('hashchange', restorePageFromLocation);
    };
  }, []);

  const navigateToPage = (nextPage: PageId) => {
    if (nextPage !== page) {
      window.history.pushState({}, '', `#${nextPage}`);
      setPage(nextPage);
    }
  };

  useEffect(() => {
    if (!session?.user) {
      setOnboardingNeeded(null);
      setOnboardingError('');
      return;
    }
    let cancelled = false;
    setOnboardingNeeded(null);
    setOnboardingError('');
    (async () => {
      const { count, error } = await supabase
        .from('trader_strategies')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', session.user.id);
      if (cancelled) return;
      if (error) {
        reportDataError('account setup', error);
        setOnboardingError(error.message);
      } else {
        setOnboardingNeeded(count === 0);
      }
    })();
    return () => { cancelled = true; };
  }, [session, onboardingAttempt]);

  if (loading) {
    return (
      <div className="min-h-screen bg-primary flex items-center justify-center">
        <LoadingSpinner label="Loading..." />
      </div>
    );
  }

  if (showLanding && !session) {
    return <LandingPage onEnter={() => setShowLanding(false)} />;
  }

  if (!session) {
    return <AuthPage onBack={() => setShowLanding(true)} />;
  }

  if (profile?.account_status === 'suspended') {
    return <div className="min-h-screen bg-primary flex items-center justify-center p-5"><section role="alert" className="card max-w-lg p-6 text-center"><h1 className="text-lg font-bold">Account suspended</h1><p className="mt-2 text-sm text-secondary">This account is temporarily unavailable. Contact your administrator if you believe this is an error.</p><button className="btn-primary mt-5" onClick={() => signOut()}>Sign out</button></section></div>;
  }

  if (onboardingError) {
    return <div className="min-h-screen bg-primary flex items-center justify-center p-5"><section role="alert" className="card max-w-lg p-6"><h1 className="text-lg font-bold">Could not prepare your workspace</h1><p className="mt-2 text-sm text-secondary">The app could not check whether your playbook is ready. Your records have not been changed. Check your connection or database setup, then retry.</p><p className="mt-3 break-all rounded-lg bg-secondary p-3 text-xs text-muted">{onboardingError}</p><button className="btn-primary mt-4" onClick={() => setOnboardingAttempt(value => value + 1)}><RefreshCw size={15} /> Retry</button></section></div>;
  }

  if (onboardingNeeded === null) {
    return (
      <div className="min-h-screen bg-primary flex items-center justify-center">
        <LoadingSpinner label="Preparing your journal..." />
      </div>
    );
  }

  if (onboardingNeeded) {
    return <OnboardingPage onComplete={() => setOnboardingNeeded(false)} />;
  }

  return (
    <Layout current={page} onNavigate={navigateToPage} onQuickAdd={() => setQuickAdd(true)}>
      <div key={page} className="animate-fade-in">
        {page === 'dashboard' && <DashboardPage />}
        {page === 'trades' && <TradesPage />}
        {page === 'calendar' && <CalendarPage />}
        {page === 'analytics' && <AnalyticsPage />}
        {page === 'journal' && <JournalPage />}
        {page === 'ai' && <AIInsightsPage />}
        {page === 'trading-plan' && <TradingPlanPage />}
        {page === 'goals' && <GoalsPage />}
        {page === 'risk-management' && <RiskManagementPage />}
        {page === 'market-sessions' && <MarketSessionsPage />}
        {page === 'setups' && <SetupsPage />}
        {page === 'strategy-testing' && <StrategyTestingPage />}
        {page === 'strategies' && <StrategyLibraryPage />}
        {page === 'resources' && <ResourcesPage />}
        {page === 'notes' && <NotesPage />}
        {page === 'study-material' && <StudyMaterialPage />}
        {page === 'brokers-charting' && <BrokersChartingPage />}
        {page === 'weekly-reviews' && <WeeklyReviewsPage />}
        {page === 'account-settings' && <><AccountSettingsPage /><Mt5Connections /></>}
      </div>
      {quickAdd && <QuickCaptureModal open onClose={() => setQuickAdd(false)} />}
    </Layout>
  );
}

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AppErrorBoundary>
          <AppContent />
        </AppErrorBoundary>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;


