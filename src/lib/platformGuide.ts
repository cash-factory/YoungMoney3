import type { PageId } from '@/components/Layout';

export type GuideCategory = 'Start here' | 'Journal' | 'Playbook' | 'Practice' | 'Connections' | 'Insights' | 'Workspace';

export interface GuideStop {
  id: string;
  label: string;
  title: string;
  eyebrow: string;
  detail: string;
  takeaway: string;
  page: PageId;
  targets: string[];
  category: GuideCategory;
  icon: string;
}

/** Every stop uses a real page and real DOM target, not a simulated app screen. */
export const GUIDE_STOPS: GuideStop[] = [
  { id: 'desk', label: 'The Desk', title: 'Your trading command centre', eyebrow: '01 / FIND YOUR RHYTHM', detail: 'See the big picture without getting buried in widgets. Your performance, risk, and next decisions begin here.', takeaway: 'The dashboard is your daily starting point.', page: 'dashboard', targets: ['#ym-overview'], category: 'Start here', icon: 'layout-dashboard' },
  { id: 'filters', label: 'Focus modes', title: 'Make the numbers yours', eyebrow: 'PERSONALISE YOUR VIEW', detail: 'Switch between recorded trades and practice results, filter by trading account, and compare the evidence that actually matters to you.', takeaway: 'Filters change the view, not your saved records.', page: 'dashboard', targets: ['.ym-dash-controls'], category: 'Start here', icon: 'sliders-horizontal' },
  { id: 'capture', label: 'Quick capture', title: 'A trade is more than an entry', eyebrow: 'CAPTURE THE DECISION', detail: 'Use Add trade to record the setup, risk, execution, emotion, and your review. No need to memorise a giant form right now.', takeaway: 'This tour never submits or edits trades.', page: 'dashboard', targets: ['.ym-dash-new-trade', '[aria-label="Quick Add"]'], category: 'Start here', icon: 'plus-circle' },
  { id: 'journal', label: 'Trading Journal', title: 'Give every decision a story', eyebrow: 'REFLECT / IMPROVE', detail: 'Write what you noticed, how you felt, and whether your plan held up. Good journaling connects behaviour to results.', takeaway: 'Capture the reasoning, not just the outcome.', page: 'journal', targets: ['.ym-page-heading'], category: 'Journal', icon: 'book-open' },
  { id: 'calendar', label: 'Trade Calendar', title: 'Spot your trading rhythm', eyebrow: 'REVIEW YOUR ROUTINE', detail: 'See activity across days and sessions. A calendar helps reveal patterns that get lost in a long trade list.', takeaway: 'Look for repeatable habits, not isolated wins.', page: 'calendar', targets: ['.ym-page-heading'], category: 'Journal', icon: 'calendar-days' },
  { id: 'reviews', label: 'Weekly Reviews', title: 'Turn weeks into lessons', eyebrow: 'REFLECTION LOOP', detail: 'Bring your notes and trading results together in a deliberate weekly debrief.', takeaway: 'A regular review keeps the learning cycle alive.', page: 'weekly-reviews', targets: ['.ym-page-heading'], category: 'Journal', icon: 'clipboard-check' },
  { id: 'plan', label: 'Trading Plan', title: 'Give your process a blueprint', eyebrow: 'PROCESS BEFORE PROFIT', detail: 'Document your trading approach, session rules, and what a valid decision should look like before you act.', takeaway: 'Make the plan visible before testing it.', page: 'trading-plan', targets: ['.ym-page-heading'], category: 'Playbook', icon: 'clipboard-list' },
  { id: 'strategies', label: 'Strategies', title: 'Build your own playbook', eyebrow: 'DEFINE YOUR EDGE', detail: 'Organise approaches, entry criteria, and checklists in a strategy library you can actually follow.', takeaway: 'Your strategies can evolve with your evidence.', page: 'strategies', targets: ['.ym-page-heading'], category: 'Playbook', icon: 'layers' },
  { id: 'setups', label: 'Setups', title: 'Recognise the patterns you trade', eyebrow: 'COLLECT YOUR BEST IDEAS', detail: 'Save and review recurring opportunities, so the next entry has context instead of guesswork.', takeaway: 'Identify patterns before treating them as an edge.', page: 'setups', targets: ['.ym-page-heading'], category: 'Playbook', icon: 'target' },
  { id: 'risk', label: 'Risk Control', title: 'Protect the next opportunity', eyebrow: 'STAY IN THE GAME', detail: 'Review your per-trade rules, daily limits, and the safeguards that shape your decisions.', takeaway: 'Risk tools support discipline; they do not place orders.', page: 'risk-management', targets: ['.ym-page-heading'], category: 'Playbook', icon: 'shield-check' },
  { id: 'goals', label: 'Goals', title: 'Make progress measurable', eyebrow: 'BUILD CONSISTENCY', detail: 'Set trading and process goals worth tracking, not just a profit target.', takeaway: 'Small process improvements compound.', page: 'goals', targets: ['.ym-page-heading'], category: 'Playbook', icon: 'flag' },
  { id: 'sessions', label: 'Market Sessions', title: 'Know when you perform', eyebrow: 'TIME IS CONTEXT', detail: 'Review session timing and overlaps as part of your trading routine.', takeaway: 'Context matters as much as the trade itself.', page: 'market-sessions', targets: ['.ym-page-heading'], category: 'Playbook', icon: 'clock' },
  { id: 'testing', label: 'Testing Lab', title: 'Prove it before you trust it', eyebrow: 'THE RESEARCH DESK', detail: 'Explore the strategy-testing workspace to examine a thesis, log examples, and review outcomes.', takeaway: 'Practice records stay separate from live trades.', page: 'strategy-testing', targets: ['.ym-page-heading'], category: 'Practice', icon: 'flask-conical' },
  { id: 'accounts', label: 'Broker Accounts', title: 'Keep every account in context', eyebrow: 'ONE DESK / MANY ACCOUNTS', detail: 'Manage how your trading accounts and charting tools fit into the journal.', takeaway: 'Account and currency context stay explicit.', page: 'brokers-charting', targets: ['.ym-page-heading'], category: 'Connections', icon: 'wallet' },
  { id: 'mt5', label: 'MT5 Connector', title: 'Let execution find your journal', eyebrow: 'READ-ONLY CAPTURE', detail: 'Pair a Windows connector and review broker trade capture. Each concurrently captured MT5 account uses its own terminal session.', takeaway: 'Pairing and capture are opt-in; no trading commands are sent.', page: 'mt5', targets: ['.ym-page-heading'], category: 'Connections', icon: 'monitor' },
  { id: 'analytics', label: 'Analytics', title: 'Find the signal in your data', eyebrow: 'LOOK BEYOND WIN RATE', detail: 'Review performance patterns, comparisons, and the evidence behind your strategies.', takeaway: 'Always consider sample size and account context.', page: 'analytics', targets: ['.ym-page-heading'], category: 'Insights', icon: 'bar-chart-3' },
  { id: 'insights', label: 'AI Insights', title: 'Another lens on the pattern', eyebrow: 'REFLECT WITH CONTEXT', detail: 'Explore guided observations derived from the trading data you have recorded. Treat suggestions as review prompts, not trading instructions.', takeaway: 'The final decision remains yours.', page: 'ai', targets: ['.ym-page-heading'], category: 'Insights', icon: 'sparkles' },
  { id: 'media', label: 'Media Library', title: 'Keep the evidence close', eyebrow: 'THE VISUAL ARCHIVE', detail: 'Charts, screenshots, and voice notes collected during trade reviews stay connected to their records.', takeaway: 'Attachments stay in your private workspace.', page: 'media', targets: ['.ym-library-hero'], category: 'Journal', icon: 'images' },
  { id: 'notes', label: 'Field Notes', title: 'Catch the idea before it leaves', eyebrow: 'THINK ON THE PAGE', detail: 'Keep trading observations and research fragments available outside a specific trade.', takeaway: 'Capture a thought even when you are not trading.', page: 'notes', targets: ['.ym-page-heading'], category: 'Workspace', icon: 'sticky-note' },
  { id: 'resources', label: 'Resources', title: 'Build your reference shelf', eyebrow: 'LEARN ON PURPOSE', detail: 'Keep reference material and learning resources together so the study supports your process.', takeaway: 'Use the shelf to revisit useful material.', page: 'resources', targets: ['.ym-page-heading'], category: 'Workspace', icon: 'book-marked' },
  { id: 'appearance', label: 'Appearance', title: 'Make the desk feel like yours', eyebrow: 'YOUR SPACE / YOUR STYLE', detail: 'Switch between the curated colour palettes and light or dark mode. Your layout and features stay in place.', takeaway: 'Find the look that keeps you focused.', page: 'dashboard', targets: ['.ym-topbar button', '.ym-mobile-topbar'], category: 'Workspace', icon: 'palette' },
  { id: 'search', label: 'Quick Find', title: 'Jump around like a pro', eyebrow: 'LESS CLICKING / MORE DOING', detail: 'Find pages and commands with Quick Find. You can also use Ctrl K or Command K to open search.', takeaway: 'Navigation should never slow down the work.', page: 'dashboard', targets: ['.ym-topbar-search', '.ym-mobile-topbar button[aria-label="Search workspace"]'], category: 'Workspace', icon: 'search' },
];

export const GUIDE_CATEGORIES: GuideCategory[] = ['Start here','Journal','Playbook','Practice','Connections','Insights','Workspace'];
export const GUIDE_EXPRESS_ROUTE = ['desk','filters','capture','journal','plan','testing','mt5','analytics','appearance'] as const;
export const GUIDE_STATE_PREFIX = 'ymfx:platform-guide:v1:';

export type GuideStatus = 'pending' | 'dismissed' | 'completed';
export interface SavedGuideState { status: GuideStatus; visited: string[]; lastStop?: string; }

export function readGuideState(userId: string): SavedGuideState | null {
  try {
    const raw = localStorage.getItem(GUIDE_STATE_PREFIX + userId);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const value = parsed as Record<string, unknown>;
    if (!['pending','dismissed','completed'].includes(String(value.status))) return null;
    return {
      status: value.status as GuideStatus,
      visited: Array.isArray(value.visited) ? value.visited.filter((id): id is string => typeof id === 'string' && GUIDE_STOPS.some(stop => stop.id === id)) : [],
      lastStop: typeof value.lastStop === 'string' ? value.lastStop : undefined,
    };
  } catch {
    return null;
  }
}
export function writeGuideState(userId: string, status: GuideStatus, visited: string[], lastStop?: string) {
  try {
    localStorage.setItem(GUIDE_STATE_PREFIX + userId,
      JSON.stringify({ status, visited: [...new Set(visited)], lastStop }));
  } catch { /* Private storage is optional: skipping remains possible for this session. */ }
}
export function guideShouldWelcome(userId: string, createdAt?: string | null): boolean {
  const saved = readGuideState(userId);
  if (saved) return saved.status === 'pending';
  if (!createdAt) return false;
  const age = Date.now() - Date.parse(createdAt);
  return Number.isFinite(age) && age >= 0 && age < 12 * 60 * 60 * 1000;
}
