import { Select } from '@/components/Select';
import { useState } from 'react';
import { Building2, Monitor, Plus, Trash2, Save, ExternalLink, Calendar, Wallet } from 'lucide-react';
import { useBrokers, useChartingTools, useTradingAccounts, useStrategies, useTradingPlans, useTradingAccountAdjustments, useTrades, useProviderCatalog } from '@/hooks/useData';
import { useAuth } from '@/context/AuthContext';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { LoadingSpinner, EmptyState } from '@/components/ui/Feedback';
import { Modal } from '@/components/ui/Modal';
import { StatCard } from '@/components/ui/StatCard';
import { PROVIDER_CATALOG_RESEARCH_DATE } from '@/data/providerCatalog';
import type { Broker, BrokerInput, ChartingTool, ChartingToolInput, TradingAccount, TradingAccountInput, ProviderCatalogEntry, ProviderOffering, PropFirmRuleVersion } from '@/lib/types';
import { format, parseISO, differenceInDays } from 'date-fns';

export function BrokersChartingPage() {
  const { user } = useAuth();
  const { brokers, loading: brokersLoading, upsertBroker, deleteBroker } = useBrokers(user?.id);
  const { tools, loading: toolsLoading, upsertTool, deleteTool } = useChartingTools(user?.id);
  const { accounts, loading: accountsLoading, upsertAccount, deleteAccount } = useTradingAccounts(user?.id);
  const { adjustments, addAdjustment } = useTradingAccountAdjustments(user?.id);
  const { trades } = useTrades(user?.id);
  const { strategies } = useStrategies(user?.id);
  const { plans } = useTradingPlans(user?.id);
  const { providers, offerings, ruleVersions, changeReviews } = useProviderCatalog();
  const [showBrokerForm, setShowBrokerForm] = useState(false);
  const [editingBroker, setEditingBroker] = useState<Broker | null>(null);
  const [showToolForm, setShowToolForm] = useState(false);
  const [editingTool, setEditingTool] = useState<ChartingTool | null>(null);
  const [showAccountForm, setShowAccountForm] = useState(false);
  const [editingAccount, setEditingAccount] = useState<TradingAccount | null>(null);
  const [providerSearch, setProviderSearch] = useState('');

  const loading = brokersLoading || toolsLoading || accountsLoading;

  const handleBrokerSave = async (data: BrokerInput, id?: string) => {
    await upsertBroker(data, id);
    setShowBrokerForm(false);
    setEditingBroker(null);
  };

  const handleToolSave = async (data: ChartingToolInput, id?: string) => {
    await upsertTool(data, id);
    setShowToolForm(false);
    setEditingTool(null);
  };

  const handleAccountSave = async (data: TradingAccountInput, id?: string) => {
    await upsertAccount(data, id);
    setShowAccountForm(false);
    setEditingAccount(null);
  };

  if (loading) return <LoadingSpinner label="Loading..." />;

  const upcomingRenewals = tools.filter(t => {
    if (!t.renewal_date) return false;
    const days = differenceInDays(parseISO(t.renewal_date), new Date());
    return days >= 0 && days <= 30;
  }).length;

  return (
    <div>
      <SectionHeader
        title="Brokers & Charting"
        subtitle="Manage your broker accounts and charting tool subscriptions"
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <StatCard label="Active Brokers" value={String(brokers.filter(b => b.is_active).length)} icon={<Building2 size={20} />} accent="blue" />
        <StatCard label="Charting Tools" value={String(tools.length)} icon={<Monitor size={20} />} accent="emerald" />
        <StatCard label="Upcoming Renewals" value={String(upcomingRenewals)} icon={<Calendar size={20} />} accent="amber" />
      </div>

      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold flex items-center gap-2"><Wallet size={18} /> Trading Accounts</h2>
          <button onClick={() => { setEditingAccount(null); setShowAccountForm(true); }} className="btn-primary text-xs"><Plus size={16} /> Add Account</button>
        </div>
        {accounts.length === 0 ? (
          <div className="card p-6 text-sm text-secondary">Add an account to save its balance, currency, and risk defaults for quick sizing.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {accounts.map(account => {
              const broker = brokers.find(b => b.id === account.broker_id);
              const brokerName = broker?.name || providers.find(p => p.id === account.broker_provider_id)?.name || account.broker_name || 'No broker';
              const closedPnl = trades.filter(t => t.account_id === account.id && t.status === 'closed').reduce((sum, t) => sum + t.pnl, 0);
              const adjustmentTotal = adjustments.filter(a => a.account_id === account.id).reduce((sum, a) => sum + a.amount, 0);
              const currentBalance = account.balance + closedPnl + adjustmentTotal;
              return <div key={account.id} className="card ym-tone-panel ym-broker-account-card p-4 space-y-3">
                <div className="flex items-start justify-between gap-3"><div><h3 className="ym-account-card-title text-sm font-bold">{account.name}</h3><p className="ym-account-card-details text-xs mt-1">{brokerName} · {account.account_type || 'Account'} · {account.base_currency}</p><p className="ym-account-card-risk text-xs text-secondary mt-2">Current balance <strong className="ym-account-balance font-mono">{currentBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {account.base_currency}</strong> · Risk {account.risk_per_trade_pct}% per trade</p>{account.account_type === 'propfirm' && account.challenge_target_pct != null && <p className="text-xs text-muted mt-1">Challenge target {account.challenge_target_pct}% · Daily limit {account.daily_loss_limit_pct ?? '—'}% · Max loss {account.max_loss_limit_pct ?? '—'}%</p>}</div>
                  <div className="flex gap-1"><button onClick={() => { setEditingAccount(account); setShowAccountForm(true); }} className="btn-ghost p-1.5 text-xs">Edit</button><button onClick={() => { if (confirm('Delete this account? Existing trades will be kept without an account link.')) deleteAccount(account.id); }} className="btn-ghost p-1.5 text-error-500"><Trash2 size={14} /></button></div>
                </div>
                <AccountAdjustmentForm accountId={account.id} onAdd={addAdjustment} />
              </div>;
            })}
          </div>
        )}
      </div>

      <section className="mb-8" aria-labelledby="provider-directory-title">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-4">
          <div><h2 id="provider-directory-title" className="text-sm font-bold flex items-center gap-2"><Building2 size={18} /> Provider Directory</h2><p className="text-xs text-muted mt-1">Catalog terms are regional; verify the selected account with the provider before relying on its rules.</p></div>
          <input className="input-field sm:max-w-xs" value={providerSearch} onChange={e => setProviderSearch(e.target.value)} placeholder="Search brokers and prop firms" aria-label="Search provider directory" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {providers.filter(p => `${p.name} ${p.provider_kind} ${p.market_group || ''}`.toLowerCase().includes(providerSearch.toLowerCase())).map(provider => {
            const providerOfferings = offerings.filter(o => o.provider_id === provider.id);
            return <article key={provider.id} className="card p-4 min-w-0">
              <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="text-sm font-semibold truncate">{provider.name}</h3><p className="text-[11px] text-muted mt-1">{provider.provider_kind === 'broker' ? 'Broker' : 'Prop firm'} · {provider.market_group?.replace('_', ' ') || 'Trading'}</p></div><a href={provider.website_url} target="_blank" rel="noopener noreferrer" className="btn-ghost p-1.5" aria-label={`Open ${provider.name} official website`}><ExternalLink size={14} /></a></div>
              <div className="mt-3 flex flex-wrap gap-1.5">{(['ZA','ZW'] as const).map(region => <span key={region} className={`badge ${provider.availability?.[region] === 'available' ? 'badge-success' : provider.availability?.[region] === 'unavailable' ? 'badge-error' : 'badge-warning'}`}>{region}: {provider.availability?.[region] || 'unknown'}</span>)}</div>
              {providerOfferings.length ? <div className="mt-3 space-y-1">{providerOfferings.map(o => <p key={o.id} className="text-[11px] text-secondary"><a className="underline" href={o.source_url || provider.website_url} target="_blank" rel="noopener noreferrer">{o.name}</a> · {o.source_status === 'verified' ? `source checked ${o.verified_at || PROVIDER_CATALOG_RESEARCH_DATE}` : 'details need verification'}</p>)}</div> : <p className="mt-3 text-[11px] text-muted">Official homepage checked {PROVIDER_CATALOG_RESEARCH_DATE}; legal entity, account types, and regional availability still need confirmation.</p>}
            </article>;
          })}
        </div>
        {!providers.length && <p className="card p-4 text-sm text-muted">The provider directory is not loaded. Apply the latest Supabase migrations to enable it.</p>}
        <details className="mt-3 card p-4">
          <summary className="cursor-pointer text-xs font-semibold">Rule-change review queue</summary>
          <p className="mt-2 text-xs text-muted">Weekly monitoring requires the Supabase source-check function to be deployed and scheduled. Source changes do not update active account rules automatically.</p>
          {changeReviews.length > 0 && <div className="mt-3 space-y-2">{changeReviews.map(review => <div key={review.id} className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs"><p className="font-semibold">{review.provider_catalog?.name || 'Provider'} source page changed</p><p className="text-muted mt-1">Detected {new Date(review.detected_at).toLocaleString()}</p>{review.provider_source_watches?.source_url && <a className="mt-1 inline-flex text-orange-600 underline" href={review.provider_source_watches.source_url} target="_blank" rel="noopener noreferrer">Review official source</a>}</div>)}</div>}
          {!changeReviews.length && <p className="mt-2 text-xs text-muted">No pending source changes.</p>}
          {ruleVersions.length === 0 && <p className="mt-2 text-xs text-muted">No verified prop-firm rule versions are loaded yet. User-entered limits remain editable on each account.</p>}
        </details>
      </section>

      {/* Brokers Section */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold flex items-center gap-2"><Building2 size={18} /> Brokers</h2>
          <button onClick={() => { setEditingBroker(null); setShowBrokerForm(true); }} className="btn-primary text-xs">
            <Plus size={16} /> Add Broker
          </button>
        </div>

        {brokers.length === 0 ? (
          <div className="card p-8">
            <EmptyState icon={<Building2 size={40} />} title="No brokers added" message="Add your broker accounts to track account types, leverage, commissions, and login links." />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {brokers.map(broker => (
              <BrokerCard key={broker.id} broker={broker} onEdit={() => { setEditingBroker(broker); setShowBrokerForm(true); }} onDelete={() => { if (confirm('Delete this broker?')) deleteBroker(broker.id); }} />
            ))}
          </div>
        )}
      </div>

      {/* Charting Tools Section */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold flex items-center gap-2"><Monitor size={18} /> Charting Tools</h2>
          <button onClick={() => { setEditingTool(null); setShowToolForm(true); }} className="btn-primary text-xs">
            <Plus size={16} /> Add Tool
          </button>
        </div>

        {tools.length === 0 ? (
          <div className="card p-8">
            <EmptyState icon={<Monitor size={40} />} title="No charting tools added" message="Track your charting platform subscriptions, renewal dates, and features." />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {tools.map(tool => (
              <ToolCard key={tool.id} tool={tool} onEdit={() => { setEditingTool(tool); setShowToolForm(true); }} onDelete={() => { if (confirm('Delete this tool?')) deleteTool(tool.id); }} />
            ))}
          </div>
        )}
      </div>

      <Modal open={showBrokerForm} onClose={() => { setShowBrokerForm(false); setEditingBroker(null); }} title={editingBroker ? 'Edit Broker' : 'New Broker'} size="md">
        <BrokerForm initial={editingBroker} providers={providers.filter(p => p.provider_kind === 'broker')} offerings={offerings} onSave={handleBrokerSave} onCancel={() => { setShowBrokerForm(false); setEditingBroker(null); }} />
      </Modal>

      <Modal open={showToolForm} onClose={() => { setShowToolForm(false); setEditingTool(null); }} title={editingTool ? 'Edit Charting Tool' : 'New Charting Tool'} size="md">
        <ToolForm initial={editingTool} onSave={handleToolSave} onCancel={() => { setShowToolForm(false); setEditingTool(null); }} />
      </Modal>
      <Modal open={showAccountForm} onClose={() => { setShowAccountForm(false); setEditingAccount(null); }} title={editingAccount ? 'Edit Trading Account' : 'New Trading Account'} size="md">
        <TradingAccountForm initial={editingAccount} brokers={brokers} strategies={strategies} plans={plans} providers={providers} offerings={offerings} ruleVersions={ruleVersions} onSave={handleAccountSave} onCancel={() => { setShowAccountForm(false); setEditingAccount(null); }} />
      </Modal>
    </div>
  );
}

function maskAccount(num: string | null): string {
  if (!num) return '—';
  if (num.length <= 4) return num;
  return '••••' + num.slice(-4);
}

function BrokerCard({ broker, onEdit, onDelete }: { broker: Broker; onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="card p-4 card-hover">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="text-sm font-bold">{broker.name}</h3>
          {broker.account_type && <span className="badge badge-neutral mt-1">{broker.account_type}</span>}
        </div>
        <div className="flex gap-1">
          {broker.login_url && <a href={broker.login_url} target="_blank" rel="noopener noreferrer" className="btn-ghost p-1"><ExternalLink size={14} /></a>}
          <button onClick={onEdit} className="btn-ghost p-1 text-xs">Edit</button>
          <button onClick={onDelete} className="btn-ghost p-1 text-error-500 hover:bg-error-500/10"><Trash2 size={14} /></button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div><span className="text-muted">Account #</span> <span className="font-mono">{maskAccount(broker.account_number)}</span></div>
        <div><span className="text-muted">Leverage</span> <span>{broker.leverage || '—'}</span></div>
        <div><span className="text-muted">Commission</span> <span>{broker.commission || '—'}</span></div>
        <div><span className="text-muted">Spread</span> <span>{broker.spread || '—'}</span></div>
        <div><span className="text-muted">Funding</span> <span>{broker.funding_method || '—'}</span></div>
        <div><span className="text-muted">Status</span> <span className={broker.is_active ? 'text-success-500' : 'text-muted'}>{broker.is_active ? 'Active' : 'Inactive'}</span></div>
      </div>
      {broker.notes && <p className="text-xs text-secondary mt-2 pt-2 border-t border-themed">{broker.notes}</p>}
    </div>
  );
}

function ToolCard({ tool, onEdit, onDelete }: { tool: ChartingTool; onEdit: () => void; onDelete: () => void }) {
  const daysToRenewal = tool.renewal_date ? differenceInDays(parseISO(tool.renewal_date), new Date()) : null;
  return (
    <div className="card p-4 card-hover">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="text-sm font-bold">{tool.name}</h3>
          <span className={`badge mt-1 ${tool.subscription_status === 'active' ? 'badge-success' : 'badge-neutral'}`}>{tool.subscription_status}</span>
        </div>
        <div className="flex gap-1">
          {tool.url && <a href={tool.url} target="_blank" rel="noopener noreferrer" className="btn-ghost p-1"><ExternalLink size={14} /></a>}
          <button onClick={onEdit} className="btn-ghost p-1 text-xs">Edit</button>
          <button onClick={onDelete} className="btn-ghost p-1 text-error-500 hover:bg-error-500/10"><Trash2 size={14} /></button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div><span className="text-muted">Renewal</span> <span>{tool.renewal_date ? format(parseISO(tool.renewal_date), 'MMM d, yyyy') : '—'}</span></div>
        <div><span className="text-muted">Price</span> <span>{tool.price != null ? `$${tool.price}` : '—'}</span></div>
      </div>
      {daysToRenewal != null && daysToRenewal >= 0 && daysToRenewal <= 30 && (
        <div className="mt-2">
          <span className="badge badge-warning">{daysToRenewal} days to renewal</span>
        </div>
      )}
      {tool.features && <p className="text-xs text-secondary mt-2 pt-2 border-t border-themed">{tool.features}</p>}
    </div>
  );
}

function BrokerForm({ initial, providers, offerings, onSave, onCancel }: { initial: Broker | null; providers: ProviderCatalogEntry[]; offerings: ProviderOffering[]; onSave: (data: BrokerInput, id?: string) => void; onCancel: () => void }) {
  const [name, setName] = useState(initial?.name || '');
  const [providerId, setProviderId] = useState(initial?.provider_id || '');
  const [accountType, setAccountType] = useState(initial?.account_type || '');
  const [accountNumber, setAccountNumber] = useState(initial?.account_number || '');
  const [leverage, setLeverage] = useState(initial?.leverage || '');
  const [commission, setCommission] = useState(initial?.commission || '');
  const [spread, setSpread] = useState(initial?.spread || '');
  const [fundingMethod, setFundingMethod] = useState(initial?.funding_method || '');
  const [loginUrl, setLoginUrl] = useState(initial?.login_url || '');
  const [notes, setNotes] = useState(initial?.notes || '');
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    await onSave({
      name, account_type: accountType || null, account_number: accountNumber || null,
      leverage: leverage || null, commission: commission || null, spread: spread || null,
      funding_method: fundingMethod || null, login_url: loginUrl || null,
      notes: notes || null, is_active: isActive, provider_id: providerId || null,
    }, initial?.id);
    setSaving(false);
  };

  const inputCls = 'input-field';
  const labelCls = 'block text-xs font-semibold text-secondary mb-1.5';
  const providerOfferings = offerings.filter(o => o.provider_id === providerId && o.offering_kind === 'broker_account_type' && o.source_status === 'verified');

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div><label className={labelCls}>Provider catalog</label><Select className={inputCls} value={providerId} onChange={e => { const id = e.target.value; setProviderId(id); const selected = providers.find(p => p.id === id); if (selected) { setName(selected.name); setLoginUrl(selected.website_url); setAccountType(''); } }}><option value="">Other / custom</option>{providers.map(provider => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</Select></div>
        <div><label className={labelCls}>Broker name</label><input className={inputCls} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. IC Markets" /></div>
        <div><label className={labelCls}>Account Type</label>{providerOfferings.length ? <Select className={inputCls} value={accountType} onChange={e => setAccountType(e.target.value)}><option value="">Choose type (or enter custom)</option>{providerOfferings.map(o => <option key={o.id} value={o.name}>{o.name}</option>)}</Select> : <input className={inputCls} value={accountType} onChange={e => setAccountType(e.target.value)} placeholder="Not verified · enter actual type" />}</div>
        {providerId && <p className="sm:col-span-2 text-[11px] text-muted">Offerings shown only when verified from an official source. Confirm your account’s legal entity and region before relying on these terms.</p>}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div><label className={labelCls}>Account Number</label><input className={inputCls} value={accountNumber} onChange={e => setAccountNumber(e.target.value)} placeholder="12345678" /></div>
        <div><label className={labelCls}>Leverage</label><input className={inputCls} value={leverage} onChange={e => setLeverage(e.target.value)} placeholder="e.g. 1:500" /></div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div><label className={labelCls}>Commission</label><input className={inputCls} value={commission} onChange={e => setCommission(e.target.value)} placeholder="e.g. $3.5/lot" /></div>
        <div><label className={labelCls}>Spread</label><input className={inputCls} value={spread} onChange={e => setSpread(e.target.value)} placeholder="e.g. From 0.0 pips" /></div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div><label className={labelCls}>Funding Method</label><input className={inputCls} value={fundingMethod} onChange={e => setFundingMethod(e.target.value)} placeholder="e.g. Bank transfer, Crypto" /></div>
        <div><label className={labelCls}>Login URL</label><input className={inputCls} value={loginUrl} onChange={e => setLoginUrl(e.target.value)} placeholder="https://..." /></div>
      </div>
      <div><label className={labelCls}>Notes</label><textarea className={inputCls} rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Additional notes..." /></div>
      <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} className="w-4 h-4 rounded border-themed" /><span className="text-sm">Active</span></label>
      <div className="flex gap-3 pt-2"><button onClick={handleSave} disabled={saving || !name} className="btn-primary flex-1"><Save size={16} /> {saving ? 'Saving...' : 'Save'}</button><button onClick={onCancel} className="btn-secondary">Cancel</button></div>
    </div>
  );
}

function TradingAccountForm({ initial, brokers, strategies, plans, providers, offerings, ruleVersions, onSave, onCancel }: { initial: TradingAccount | null; brokers: Broker[]; strategies: {id:string;name:string;plan_id?:string|null}[]; plans: {id:string;title:string}[]; providers: ProviderCatalogEntry[]; offerings: ProviderOffering[]; ruleVersions: PropFirmRuleVersion[]; onSave: (data: TradingAccountInput, id?: string) => void; onCancel: () => void }) {
  const [name, setName] = useState(initial?.name || '');
  const [brokerSelection, setBrokerSelection] = useState(initial?.broker_id ? `record:${initial.broker_id}` : initial?.broker_provider_id ? `catalog:${initial.broker_provider_id}` : initial?.broker_name ? 'manual' : '');
  const [manualBrokerName, setManualBrokerName] = useState(initial?.broker_name || '');
  const [brokerAccountType, setBrokerAccountType] = useState(initial?.broker_account_type || '');
  const [propFirmId, setPropFirmId] = useState(initial?.prop_firm_id || '');
  const [propProgramId, setPropProgramId] = useState(initial?.prop_program_id || '');
  const [propPhase, setPropPhase] = useState(initial?.prop_phase || '');
  const [providerRegion, setProviderRegion] = useState(initial?.provider_region || 'other');
  const [purchaseDate, setPurchaseDate] = useState(String(initial?.prop_rule_snapshot?.purchase_date || ''));
  const [propProgramName, setPropProgramName] = useState(String(initial?.prop_rule_snapshot?.program_name || ''));
  const [manualRuleSnapshot] = useState<Record<string, unknown>>(initial?.prop_rule_snapshot || {});
  const [accountNumber, setAccountNumber] = useState(initial?.account_number || '');
  const [accountType, setAccountType] = useState(initial?.account_type || 'personal');
  const [currency, setCurrency] = useState(initial?.base_currency || 'USD');
  const [balance, setBalance] = useState(String(initial?.balance ?? 10000));
  const [risk, setRisk] = useState(String(initial?.risk_per_trade_pct ?? 1));
  const [defaultStrategyId, setDefaultStrategyId] = useState(initial?.default_strategy_id || '');
  const [defaultPlanId, setDefaultPlanId] = useState(initial?.default_plan_id || '');
  const [challengeTarget, setChallengeTarget] = useState(initial?.challenge_target_pct?.toString() || '');
  const [dailyLimit, setDailyLimit] = useState(initial?.daily_loss_limit_pct?.toString() || '');
  const [maxLimit, setMaxLimit] = useState(initial?.max_loss_limit_pct?.toString() || '');
  const [resetTimezone, setResetTimezone] = useState(initial?.challenge_reset_timezone || 'UTC');
  const [active, setActive] = useState(initial?.is_active ?? true);
  const [saving, setSaving] = useState(false);
  const inputCls = 'input-field';
  const labelCls = 'block text-xs font-semibold text-secondary mb-1.5';
  const propPrograms = offerings.filter(o => o.provider_id === propFirmId && o.offering_kind === 'prop_program');
  const selectedPropRules = ruleVersions.filter(rule => propPrograms.some(offering => offering.id === rule.offering_id) && rule.rule_status === 'verified');
  const selectedRuleVersion = selectedPropRules.find(rule => rule.phase === propPhase);
  const selectedCatalogBrokerId = brokerSelection.startsWith('catalog:') ? brokerSelection.slice('catalog:'.length) : '';
  const selectedBrokerRecordId = brokerSelection.startsWith('record:') ? brokerSelection.slice('record:'.length) : '';
  const brokerProviderId = selectedCatalogBrokerId || brokers.find(b => b.id === selectedBrokerRecordId)?.provider_id;
  const brokerTypes = offerings.filter(o => o.provider_id === brokerProviderId && o.offering_kind === 'broker_account_type' && o.source_status === 'verified');
  const planStrategies = strategies.filter(s => s.plan_id === defaultPlanId || s.id === initial?.default_strategy_id);
  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({ broker_id: selectedBrokerRecordId || null, broker_provider_id: selectedCatalogBrokerId || null, broker_name: brokerSelection === 'manual' ? manualBrokerName.trim() || null : providers.find(provider => provider.id === selectedCatalogBrokerId)?.name || null, name: name.trim(), account_number: accountNumber || null,
        account_type: accountType || null, base_currency: currency.trim().toUpperCase(), balance: Number(balance),
        risk_per_trade_pct: Number(risk), is_active: active,
        default_strategy_id: defaultStrategyId || null, default_plan_id: defaultPlanId || null,
        broker_account_type: brokerAccountType || null,
        prop_firm_id: accountType === 'propfirm' ? (propFirmId || null) : null,
        prop_program_id: accountType === 'propfirm' ? (propProgramId || null) : null,
        prop_phase: accountType === 'propfirm' ? (propPhase || null) : null,
        rule_version_id: selectedRuleVersion?.id || null,
        provider_region: accountType === 'propfirm' ? providerRegion : null,
        prop_rule_snapshot: accountType === 'propfirm' ? { ...manualRuleSnapshot, program_name: propProgramName, phase: propPhase, provider_region: providerRegion, purchase_date: purchaseDate || null, challenge_target_pct: challengeTarget ? Number(challengeTarget) : null, daily_loss_limit_pct: dailyLimit ? Number(dailyLimit) : null, max_loss_limit_pct: maxLimit ? Number(maxLimit) : null, reset_timezone: resetTimezone, catalog_rule_version_id: selectedRuleVersion?.id || null, catalog_rule_verified_at: selectedRuleVersion?.verified_at || null, catalog_rule_sources: selectedRuleVersion?.source_urls || [], catalog_rule_summary: selectedRuleVersion?.rules || null } : {},
        challenge_target_pct: challengeTarget ? Number(challengeTarget) : null,
        daily_loss_limit_pct: dailyLimit ? Number(dailyLimit) : null,
        max_loss_limit_pct: maxLimit ? Number(maxLimit) : null,
        challenge_reset_timezone: resetTimezone || null }, initial?.id);
    } finally { setSaving(false); }
  };
  return <div className="space-y-4">
    <div><label className={labelCls}>Account name</label><input className={inputCls} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. FTMO 100K challenge" /></div>
    <div className="grid grid-cols-2 gap-3">
    <div><label className={labelCls}>Broker</label><Select className={inputCls} value={brokerSelection} onChange={e => { setBrokerSelection(e.target.value); setBrokerAccountType(''); }}><option value="">No broker</option><optgroup label="Saved brokers">{brokers.map(b => <option key={b.id} value={`record:${b.id}`}>{b.name}</option>)}</optgroup><optgroup label="Preloaded broker directory">{providers.filter(p => p.provider_kind === 'broker').map(p => <option key={p.id} value={`catalog:${p.id}`}>{p.name}</option>)}</optgroup><option value="manual">Enter broker manually</option></Select></div>
      <div><label className={labelCls}>Account type</label><Select className={inputCls} value={accountType} onChange={e => setAccountType(e.target.value)}><option value="personal">Personal</option><option value="propfirm">Prop firm</option><option value="demo">Demo</option><option value="funded">Funded</option></Select></div>
      <div><label className={labelCls}>Base currency</label><input className={inputCls} maxLength={8} value={currency} onChange={e => setCurrency(e.target.value)} placeholder="USD, ZAR, EUR" /></div>
      <div><label className={labelCls}>Account number (optional)</label><input className={inputCls} value={accountNumber} onChange={e => setAccountNumber(e.target.value)} /></div>
      <div><label className={labelCls}>Opening balance</label><input type="number" min="0" className={inputCls} value={balance} onChange={e => setBalance(e.target.value)} /></div>
      <div><label className={labelCls}>Risk per trade (%)</label><input type="number" min="0.01" max="100" step="0.1" className={inputCls} value={risk} onChange={e => setRisk(e.target.value)} /></div>
    </div>
    {brokerSelection === 'manual' && <div><label className={labelCls}>Broker name</label><input className={inputCls} value={manualBrokerName} onChange={e => setManualBrokerName(e.target.value)} placeholder="Enter broker name" /></div>}
    {accountType !== 'propfirm' && brokerSelection && <div><label className={labelCls}>Broker account type</label>{brokerTypes.length ? <Select className={inputCls} value={brokerAccountType} onChange={e => setBrokerAccountType(e.target.value)}><option value="">Select verified type</option>{brokerTypes.map(o => <option key={o.id} value={o.name}>{o.name}</option>)}</Select> : <input className={inputCls} value={brokerAccountType} onChange={e => setBrokerAccountType(e.target.value)} placeholder="Enter your actual account type" />}<p className="mt-1 text-[11px] text-muted">Broker-specific account types are not confirmed in the catalogue; enter the exact type shown in your broker portal.</p></div>}
    {accountType === 'propfirm' && <div className="rounded-xl border border-themed p-3 space-y-3">
      <p className="text-xs text-muted">Directory rule summaries are dated reference material. Confirm the exact program, entity, and region against your account terms.</p>
      <div><label className={labelCls}>Prop firm</label><Select className={inputCls} value={propFirmId} onChange={e => { setPropFirmId(e.target.value); setPropProgramId(''); setPropPhase(''); setPropProgramName(''); const firm = providers.find(p => p.id === e.target.value); if (firm && (!name || name === initial?.name)) setName(`${firm.name} account`); }}><option value="">Select firm</option>{providers.filter(p => p.provider_kind === 'prop_firm').map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></div>
      {propPrograms.length ? <div><label className={labelCls}>Program</label><Select className={inputCls} value={propProgramId} onChange={e => { setPropProgramId(e.target.value); setPropPhase(''); const selected = propPrograms.find(o => o.id === e.target.value); setPropProgramName(selected?.name || ''); }}><option value="">Select a listed program</option>{propPrograms.map(o => <option key={o.id} value={o.id}>{o.name}{o.source_status !== 'verified' ? ' · needs verification' : ''}</option>)}</Select></div> : <div><label className={labelCls}>Program / account type</label><input className={inputCls} value={propProgramName} onChange={e => setPropProgramName(e.target.value)} placeholder="Enter the program from your purchase" /><p className="mt-1 text-[11px] text-muted">No verified program template is available yet; enter the account’s actual rules below.</p></div>}
      {propProgramId && selectedPropRules.length > 0 && <div><label className={labelCls}>Phase</label><Select className={inputCls} value={propPhase} onChange={e => { setPropPhase(e.target.value); const rule = selectedPropRules.find(v => v.phase === e.target.value); const r = rule?.rules || {}; if (typeof r.profit_target_pct === 'number') setChallengeTarget(String(r.profit_target_pct)); if (typeof r.daily_loss_pct === 'number') setDailyLimit(String(r.daily_loss_pct)); if (typeof r.max_loss_pct === 'number') setMaxLimit(String(r.max_loss_pct)); if (typeof r.reset_timezone === 'string') setResetTimezone(r.reset_timezone); }}><option value="">Select phase</option>{[...new Set(selectedPropRules.map(r => r.phase))].map(phase => <option key={phase} value={phase}>{phase}</option>)}</Select><p className="mt-1 text-[11px] text-muted">{selectedRuleVersion ? <>Official-source snapshot checked {selectedRuleVersion.verified_at}. <a className="underline" href={selectedRuleVersion.source_urls[0]} target="_blank" rel="noopener noreferrer">View source</a></> : 'No verified rule snapshot for this phase; use the manual limits below.'}</p></div>}
      {propProgramId && selectedPropRules.length === 0 && <p className="text-[11px] text-amber-600">This directory entry does not have a verified rule version. Confirm your actual account terms and enter the limits manually below.</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3"><div><label className={labelCls}>Availability region</label><Select className={inputCls} value={providerRegion} onChange={e => setProviderRegion(e.target.value)}><option value="ZA">South Africa</option><option value="ZW">Zimbabwe</option><option value="other">Other / confirm</option></Select></div><div><label className={labelCls}>Purchase date</label><input type="date" className={inputCls} value={purchaseDate} onChange={e => setPurchaseDate(e.target.value)} /></div></div>
    </div>}
    <div className="border-t border-themed pt-4 space-y-3">
      <p className="text-xs font-semibold text-secondary">Quick defaults</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div><label className={labelCls}>Default trading plan</label><Select className={inputCls} value={defaultPlanId} onChange={e => { const id = e.target.value; setDefaultPlanId(id); if (defaultStrategyId && strategies.find(s => s.id === defaultStrategyId)?.plan_id !== id) setDefaultStrategyId(''); }}><option value="">No default</option>{plans.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</Select></div>
        <div><label className={labelCls}>Default strategy</label><Select className={inputCls} value={defaultStrategyId} onChange={e => setDefaultStrategyId(e.target.value)}><option value="">Choose when capturing</option>{planStrategies.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></div>
      </div>
      {accountType === 'propfirm' && <>
        <p className="text-xs font-semibold text-secondary pt-1">Challenge limits (% of starting balance)</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div><label className={labelCls}>Profit target</label><input type="number" min="0" className={inputCls} value={challengeTarget} onChange={e => setChallengeTarget(e.target.value)} placeholder="10" /></div>
          <div><label className={labelCls}>Daily loss</label><input type="number" min="0" className={inputCls} value={dailyLimit} onChange={e => setDailyLimit(e.target.value)} placeholder="5" /></div>
          <div><label className={labelCls}>Max loss</label><input type="number" min="0" className={inputCls} value={maxLimit} onChange={e => setMaxLimit(e.target.value)} placeholder="10" /></div>
          <div><label className={labelCls}>Reset timezone</label><input className={inputCls} value={resetTimezone} onChange={e => setResetTimezone(e.target.value)} placeholder="UTC" /></div>
        </div>
      </>}
    </div>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} /> Active account</label>
    <div className="flex gap-3"><button disabled={saving || !name.trim() || !currency.trim() || !(Number(balance) >= 0) || !(Number(risk) > 0)} onClick={handleSave} className="btn-primary flex-1"><Save size={16} />{saving ? 'Saving…' : 'Save account'}</button><button onClick={onCancel} className="btn-secondary">Cancel</button></div>
  </div>;
}

function AccountAdjustmentForm({ accountId, onAdd }: { accountId: string; onAdd: (input: { account_id: string; amount: number; reason: string }) => Promise<void> }) {
  const [kind, setKind] = useState<'deposit' | 'withdrawal'>('deposit');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const handleAdd = async () => {
    setError(''); setSaving(true);
    try {
      await onAdd({ account_id: accountId, amount: (kind === 'deposit' ? 1 : -1) * Number(amount), reason: reason.trim() || kind });
      setAmount(''); setReason('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save adjustment.'); }
    finally { setSaving(false); }
  };
  return <details className="border-t border-themed pt-2">
    <summary className="cursor-pointer text-xs text-secondary">Record deposit or withdrawal</summary>
    <div className="mt-3 grid grid-cols-1 sm:grid-cols-[130px_1fr_1fr_auto] gap-2 items-end">
      <Select className="input-field text-xs" value={kind} onChange={e => setKind(e.target.value as 'deposit'|'withdrawal')}><option value="deposit">Deposit</option><option value="withdrawal">Withdrawal</option></Select>
      <input type="number" min="0.01" step="0.01" className="input-field text-xs" placeholder="Amount" value={amount} onChange={e => setAmount(e.target.value)} />
      <input className="input-field text-xs" placeholder="Note (optional)" value={reason} onChange={e => setReason(e.target.value)} />
      <button type="button" className="btn-secondary text-xs" disabled={saving || Number(amount) <= 0} onClick={handleAdd}>{saving ? 'Saving…' : 'Save'}</button>
    </div>
    {error && <p className="text-xs text-error-500 mt-1">{error}</p>}
  </details>;
}

function ToolForm({ initial, onSave, onCancel }: { initial: ChartingTool | null; onSave: (data: ChartingToolInput, id?: string) => void; onCancel: () => void }) {
  const [name, setName] = useState(initial?.name || '');
  const [subscriptionStatus, setSubscriptionStatus] = useState(initial?.subscription_status || 'active');
  const [renewalDate, setRenewalDate] = useState(initial?.renewal_date || '');
  const [price, setPrice] = useState(initial?.price?.toString() || '');
  const [features, setFeatures] = useState(initial?.features || '');
  const [url, setUrl] = useState(initial?.url || '');
  const [notes, setNotes] = useState(initial?.notes || '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    await onSave({
      name, subscription_status: subscriptionStatus, renewal_date: renewalDate || null,
      price: price ? parseFloat(price) : null, features: features || null,
      url: url || null, notes: notes || null,
    }, initial?.id);
    setSaving(false);
  };

  const inputCls = 'input-field';
  const labelCls = 'block text-xs font-semibold text-secondary mb-1.5';

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div><label className={labelCls}>Tool Name</label><input className={inputCls} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. TradingView Premium" /></div>
        <div><label className={labelCls}>Subscription Status</label><Select className={inputCls} value={subscriptionStatus} onChange={e => setSubscriptionStatus(e.target.value)}><option value="active">Active</option><option value="expired">Expired</option><option value="cancelled">Cancelled</option><option value="free">Free</option></Select></div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div><label className={labelCls}>Renewal Date</label><input type="date" className={inputCls} value={renewalDate} onChange={e => setRenewalDate(e.target.value)} /></div>
        <div><label className={labelCls}>Price</label><input type="number" className={inputCls} value={price} onChange={e => setPrice(e.target.value)} placeholder="e.g. 14.95" /></div>
      </div>
      <div><label className={labelCls}>URL</label><input className={inputCls} value={url} onChange={e => setUrl(e.target.value)} placeholder="https://..." /></div>
      <div><label className={labelCls}>Features Used</label><textarea className={inputCls} rows={2} value={features} onChange={e => setFeatures(e.target.value)} placeholder="e.g. Multi-chart, alerts, custom indicators" /></div>
      <div><label className={labelCls}>Notes</label><textarea className={inputCls} rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Additional notes..." /></div>
      <div className="flex gap-3 pt-2"><button onClick={handleSave} disabled={saving || !name} className="btn-primary flex-1"><Save size={16} /> {saving ? 'Saving...' : 'Save'}</button><button onClick={onCancel} className="btn-secondary">Cancel</button></div>
    </div>
  );
}
