import { Select } from '@/components/Select';
import { pnlTone, signedMoney } from '@/lib/tradingTone';
import { Monitor, Link2, X, ChevronDown, CheckCircle2, AlertTriangle, CircleHelp, RefreshCw, Wallet, Clock3, History, Laptop, ArrowRight } from 'lucide-react';
import { announceAction } from '@/lib/actionFeedback';
import { CashFlowPanel } from '@/components/CashFlowPanel';
import { EvidenceConflictPanel } from '@/components/EvidenceConflictPanel';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useTrades } from '@/hooks/useData';

import { mt5Action as action, monitoringStatus, pcOnline, pairedPcName, type Device, type Link } from '@/lib/mt5Monitor';

type PositionSummary = {
  lifecycle_id:string;position_id:string;symbol:string;direction:string;status:string;
  first_entry_at:string;final_exit_at?:string|null;initial_entry_price?:string|null;
  net_realized_profit?:string|null;realized_r?:string|null;final_realized_r?:string|null;
  initial_risk_account?:string|null;initial_sl?:string|null;initial_stop_provenance?:string;
  initial_sl_provenance?:string;initial_sl_observed_at?:string|null;initial_tp?:string|null;
  current_sl?:string|null;current_tp?:string|null;remaining_volume?:string|null;
  movement?:string|null;movement_unit?:string;holding_seconds?:string|null;
  weighted_holding_seconds?:string|null;entries?:Record<string,unknown>[];exits?:Record<string,unknown>[];
  sessions?:{status:string;sessions?:string[];overlaps?:string[];reason?:string};
  capture_completeness?:{original_risk?:string;risk_reason?:string;session_status?:string};
  capital_at_entry?:{value?:string|null;source?:string;observed_at?:string|null};
};
type PositionRow = {link:string;account_id:string;lifecycle_id:string;version:number;recorded_at:string;summary:PositionSummary};
type DeviceDiscovery = {
  device:string; slot:string; login:string; server:string; account_name:string;
  company:string; currency:string; trade_mode:number; last_seen:number;
  link?:string|null; link_status?:string|null;
};
type DeviceScan = { device:string; requested_at:number; completed_at:number|null; request_id:string };
type HistoryScan = { link: string; request: string };
type SelectedScan = HistoryScan & { name: string; brokerAccount: string };
type HistoryPage = HistoryScan & { rows: Record<string,unknown>[]; more: boolean; nextOffset: number };
export function Mt5Connections() {
  const { user } = useAuth();
  const { trades, fetchTrades } = useTrades(user?.id);
  const [devices,setDevices] = useState<Device[]>([]);
  const [editingPc,setEditingPc] = useState<string | null>(null);
  const [pcNameDraft,setPcNameDraft] = useState('');
  const [links,setLinks] = useState<Link[]>([]);
  const [discoveries,setDiscoveries] = useState<DeviceDiscovery[]>([]);
  const [deviceScans,setDeviceScans] = useState<DeviceScan[]>([]);
  const dialog = useRef<HTMLDialogElement>(null);
  const [device,setDevice] = useState('');
  const [selectedPcId,setSelectedPcId] = useState<string|null>(null);
  const [selectedAccountId,setSelectedAccountId] = useState<string|null>(null);
  const [accountPanel,setAccountPanel] = useState<'overview'|'history'|'timezone'|'cash'>('overview');
  const [busyAction,setBusyAction] = useState<string|null>(null);
  const [feedback,setFeedback] = useState<{kind:'success'|'error'|'info';message:string}|null>(null);
  const [requestedPc,setRequestedPc] = useState(()=>new URLSearchParams(window.location.search).get('addAccount'));
  const [capturePaused,setCapturePaused] = useState(false);
  const openLogin = useCallback((id:string) => {
    setDevice(id);
    setRequestedPc(null);
    const url = new URL(window.location.href);
    if (url.searchParams.has('addAccount')) {
      url.searchParams.delete('addAccount');
      window.history.replaceState(null,'',url);
    }
    if (!dialog.current?.open) dialog.current?.showModal();
  }, []);
  useEffect(()=>{
    if (!requestedPc || capturePaused) return;
    const target = requestedPc==='1' ? (devices.length===1?devices[0]:undefined) : devices.find(d=>d.id===requestedPc);
    if (target && pcOnline(target) && target.setup_state!=='install') openLogin(target.id);
  },[devices,requestedPc,openLogin,capturePaused]);
  const [accountNames,setAccountNames]=useState<Record<string,string>>({});
  const [loaded,setLoaded] = useState(false);
  const [code,setCode] = useState('');
  const [error,setError] = useState('');
  const [setupHint,setSetupHint] = useState('');
  const [,setDemo] = useState(true);
  const [imported,setImported] = useState('');
  const [historyScan, setHistoryScan] = useState<SelectedScan | null>(null);
  const latestRefresh = useRef(0);
  const [historyDays,setHistoryDays]=useState('30');
  const [historyCustomDays,setHistoryCustomDays]=useState('');
  const [historyMode,setHistoryMode]=useState('days');
  const [historyFromDate,setHistoryFromDate]=useState('');
  const [positions,setPositions]=useState<PositionRow[]>([]);
  const [positionsMore,setPositionsMore]=useState(false);
  const [timezoneDraft,setTimezoneDraft]=useState<Record<string,string>>({});
  const [timezoneProof,setTimezoneProof]=useState<Record<string,boolean>>({});
  const [manual,setManual] = useState('');
  const refresh = useCallback(async () => {
    const revision = ++latestRefresh.current;
    const [data,rich]=await Promise.all([action('status'),action('positions').catch(()=>({rows:[],more:false}))]);
    if (revision !== latestRefresh.current) return;
    setAccountNames(Object.fromEntries((data.accounts||[]).map((a:{id:string;name:string})=>[a.id,a.name])));
    setDevices(data.devices); setLinks(data.links);
    setDiscoveries(Array.isArray(data.discoveries)?data.discoveries:[]);
    setDeviceScans(Array.isArray(data.scans)?data.scans:[]);
    setDemo(data.demoOnly); setCapturePaused(Boolean(data.capturePaused)); setLoaded(true);
    setPositions(rich.rows || []);setPositionsMore(Boolean(rich.more));
  }, []);
  useEffect(() => {
    const read = () => { if (!document.hidden) void refresh().catch(e=>setError(e.message)); };
    read(); const timer = window.setInterval(read,15000); return () => clearInterval(timer);
  }, [refresh]);
  async function run(operation: () => Promise<void>, success='Action completed.', actionKey='request') {
    if(busyAction) return;
    setBusyAction(actionKey);
    setFeedback({kind:'info',message:'Working on your request…'});
    try {
      setError('');
      await operation();
      setFeedback({kind:'success',message:success});
      announceAction('success',success);
      try { await refresh(); } catch {
        setFeedback({kind:'info',message:'Change saved, but account details could not refresh. Retry shortly.'});
        announceAction('warning','Change saved; the latest account details could not be fetched.');
      }
    } catch (e) {
      const message=e instanceof Error?e.message:'Request failed. Please try again.';
      setError(message);
      setFeedback({kind:'error',message});
      announceAction('error',message);
    } finally {
      setBusyAction(null);
    }
  }
  function startAccountSetup() {
    setSetupHint('Open Signal Desk on your Windows PC, choose My Accounts → Add MT5 Account, then sign in inside the new MT5 window. Return here and choose Scan for accounts on that PC. Your account is not monitored until you select it.');
  }
  function scanDevice(deviceId:string) {
    void run(async()=>{
      await action('scan-local-accounts',{device:deviceId});
      setSelectedPcId(deviceId);
    },'Scan requested. Keep Signal Desk and MT5 open; verified accounts will appear here shortly.','scan-'+deviceId);
  }
  function monitorDiscovered(account:DeviceDiscovery) {
    if(!window.confirm('Enable read-only journal monitoring for '+account.login+' on '+pairedPcName(devices.find(d=>d.id===account.device))+'? This does not authorize trade copying.'))return;
    void run(async()=>{
      await action('monitor-discovered-account',{device:account.device,slot:account.slot,monitor:true});
      setSelectedPcId(account.device);
    },'Account selected. Waiting for Signal Desk to reverify this MT5 login; monitoring is not confirmed yet.','monitor-'+account.slot);
  }
  const source = (t: typeof trades[number]) => (t as {trade_source?:string}).trade_source;
  const historyAccount = links.find(link => link.id === historyScan?.link);
  const failedLinks = links.filter(link => ['failed','expired'].includes(link.status));
  const activeLinks = links.filter(link => !['failed','expired'].includes(link.status));
  const outdatedCapturePc = activeLinks.some(link => link.status==='connected' && devices.some(pc=>pc.id===link.device && pc.connector_version!=='0.5.7-rc1'));
  const visibleLinks = selectedPcId ? activeLinks.filter(link=>link.device===selectedPcId):activeLinks;
  const selectedPc=devices.find(pc=>pc.id===selectedPcId);
  const selected = trades.find(t=>t.id===imported);
  const matches = trades.filter(t=>selected && source(t)!=='mt5' && selected.pair===t.pair && t.account_id===selected.account_id && t.direction===selected.direction);
  return <main className="ym-connection-hub space-y-5">
    <SectionHeader title="MT5 Connections" subtitle="Your connected computers and broker accounts — one place to manage them." />
    <div className="ym-connection-summary" aria-label="Connection overview">
      <div><Monitor size={17}/><span><strong>{devices.length}</strong><small>Paired PCs</small></span></div>
      <div><Link2 size={17}/><span><strong>{activeLinks.filter(l=>l.status==='connected').length}</strong><small>Linked accounts</small></span></div>
      <div><AlertTriangle size={17}/><span><strong>{activeLinks.filter(l=>monitoringStatus(l,devices.find(d=>d.id===l.device),capturePaused)!=='Monitoring').length}</strong><small>Need attention</small></span></div>
    </div>
    {feedback && <div role={feedback.kind==='error'?'alert':'status'} className="ym-action-feedback" data-kind={feedback.kind}>
      {feedback.kind==='success'?<CheckCircle2 size={19}/>:feedback.kind==='error'?<AlertTriangle size={19}/>:<RefreshCw className="animate-spin" size={17}/>}
      <span>{feedback.message}</span>
      <button type="button" aria-label="Dismiss notification" onClick={()=>setFeedback(null)}><X size={16}/></button>
    </div>}
    {setupHint && <div className="ym-action-feedback" data-kind="info" role="status"><CircleHelp size={17}/><span>{setupHint}</span><button type="button" aria-label="Dismiss" onClick={()=>setSetupHint('')}><X size={16}/></button></div>}
    {error && !feedback && <div className="ym-action-feedback" data-kind="error" role="alert"><AlertTriangle size={16}/>{error}</div>}
    {capturePaused && <div className="ym-action-feedback" data-kind="warning" role="alert"><AlertTriangle size={17}/>Capture paused by your staging administrator.</div>}
    {outdatedCapturePc && <div className="ym-action-feedback" data-kind="warning" role="status"><AlertTriangle size={17}/><span>A newer connector may be available for your linked MT5 account. Check the latest published version and checksum before updating; retain the same Windows user to preserve pairing and pending capture records. Do not unpair or remove the account. <a href="/connector-download.html" rel="noopener noreferrer" className="underline font-semibold">View latest connector</a>.</span></div>}

    <section className="card ym-connection-section ym-account-discovery" aria-labelledby="mt5-discovery-title">
      <header className="ym-connection-heading">
        <div><p className="ym-connection-eyebrow">01 / ACCOUNT DISCOVERY</p><h2 id="mt5-discovery-title">Find accounts from Signal Desk</h2>
          <p className="ym-discovery-intro">Create an account in the Windows connector, sign in to MT5, then scan the selected PC here. You choose which verified account to monitor; copying requires separate approval.</p>
        </div>
        <button type="button" className="btn-secondary" onClick={startAccountSetup}><Laptop size={16}/> How to add an account</button>
      </header>
      {devices.length===0&&<div className="ym-connection-empty"><Monitor size={25}/><strong>No paired computer yet</strong><p>Pair the Windows connector before scanning for MT5 accounts.</p></div>}
      <div className="ym-discovery-devices">
        {devices.map(pc=>{
          const available=discoveries.filter(a=>a.device===pc.id);
          const online=pcOnline(pc),scan=deviceScans.find(x=>x.device===pc.id);
          const pending=!!scan && !scan.completed_at && Date.now()-scan.requested_at<10*60*1000;
          return <div key={pc.id} className="ym-discovery-device">
            <div className="ym-discovery-device-head">
              <span className="ym-discovery-device-title"><Monitor size={17}/><strong>{pairedPcName(pc)}</strong>
                <small>{online?'Online':'Offline'}</small></span>
              <button type="button" className="btn-primary" disabled={!online||!!busyAction||capturePaused}
                onClick={()=>scanDevice(pc.id)}><RefreshCw size={15} className={pending?'animate-spin':''}/> {pending?'Scan requested · Rescan':'Scan for accounts'}</button>
            </div>
            {pending&&<p role="status" className="ym-discovery-status">Waiting for the paired connector to check authenticated MT5 terminals. No broker account will be added automatically.</p>}
            {available.length===0
              ?<p className="ym-discovery-empty">{scan?.completed_at?'No logged-in MT5 accounts were verified on this PC. Open the account’s MT5 terminal and try again.':'No discovered accounts yet. Scan after logging in to MT5 from Signal Desk.'}</p>
              :<div className="ym-discovery-accounts">{available.map(account=>{
                const linked=account.link_status==='connected';
                const verifying=account.link_status==='verifying';
                const fresh=Date.now()-account.last_seen<5*60*1000;
                const mode=account.trade_mode===2?'Real':account.trade_mode===1?'Contest':'Demo';
                return <div className="ym-discovery-account" key={pc.id+'-'+account.slot}>
                  <div className="ym-discovery-identity"><strong>{account.account_name||account.company||'MT5 account'} <span>#{account.login}</span></strong>
                    <small>{account.server} · {mode} · {account.currency}</small></div>
                  <div className="ym-discovery-account-actions">
                    <span className="ym-connection-badge" data-tone={linked?'success':fresh?'neutral':'warning'}>{linked?'Linked':verifying?'Awaiting verification':fresh?'Ready to select':'Rescan required'}</span>
                    <button type="button" className="btn-secondary" disabled={!online||!!busyAction||linked||verifying||!fresh||capturePaused}
                      onClick={()=>monitorDiscovered(account)}>{linked?'Linked':verifying?'Verifying':'Monitor account'}</button>
                  </div>
                </div>;
              })}</div>}
          </div>;
        })}
      </div>
      <p className="ym-discovery-safety"><CircleHelp size={16}/> Scanning reads broker identity only. No passwords, orders, or open positions are imported by discovery. Monitoring requires owner selection and a fresh MT5 identity check; copying requires its own authorizations.</p>
    </section>
    <section className="card ym-connection-section" aria-labelledby="paired-pc-title">
      <header className="ym-connection-heading">
        <div><p className="ym-connection-eyebrow">02 / YOUR DEVICES</p><h2 id="paired-pc-title">Paired PCs</h2></div>
        <div className="ym-connection-actions">
          <button type="button" className="btn-primary" disabled={capturePaused||!!busyAction} onClick={startAccountSetup}>Add in connector <ArrowRight size={15}/></button>
          <button type="button" className="btn-secondary" disabled={capturePaused||!!busyAction} onClick={()=>{
            if(devices.length && !window.confirm('Pair a different computer? If it is this same PC, reopen its existing connector instead.'))return;
            void run(async()=>setCode((await action('pair')).code),'Pairing code created. Enter it in the connector within five minutes.','pair');
          }}>Pair another PC</button>
        </div>
      </header>
      {code && <div className="ym-connection-code" role="status"><span>Enter this code in your connector within five minutes</span><strong className="select-all">{code}</strong><button type="button" className="btn-secondary" onClick={()=>{void navigator.clipboard.writeText(code).then(()=>announceAction('success','Pairing code copied.')).catch(()=>announceAction('error','Clipboard unavailable. Select and copy the code manually.'));}}>Copy code</button></div>}
      {loaded && !devices.length && <div className="ym-connection-empty"><Laptop size={27}/><strong>No paired computers yet</strong><p>Install the connector, then pair this computer once.</p></div>}
      <div className="ym-selectable-stack" role="list" aria-label="Select a paired PC">
        {devices.map(d=>{
          const online=pcOnline(d);
          const deviceLinks=activeLinks.filter(l=>l.device===d.id);
          const count=deviceLinks.filter(l=>l.status==='connected').length;
          const expanded=selectedPcId===d.id;
          return <div key={d.id} role="listitem" className="ym-selectable-card" data-selected={expanded}>
            <button type="button" aria-expanded={expanded} aria-controls={'ym-pc-details-'+d.id} className="ym-selectable-trigger" onClick={()=>{setSelectedPcId(expanded?null:d.id);setSelectedAccountId(null);setEditingPc(null);}}>
              <span className="ym-selection-icon"><Monitor size={20}/></span>
              <span className="ym-selection-primary"><strong>{pairedPcName(d)}</strong><small>PC {d.id.slice(0,8)} · {count} {count===1?'account':'accounts'}</small></span>
              <span className="ym-connection-badge" data-tone={online?'success':'neutral'}>{online?'Online':'Offline'}</span>
              <ChevronDown className="ym-selectable-chevron" size={18} aria-hidden="true"/>
            </button>
            {expanded && <div className="ym-selection-details" id={'ym-pc-details-'+d.id}>
              <div className="ym-detail-grid">
                <div><span>Connector</span><strong>{d.connector_version||'Version unknown'}</strong></div>
                <div><span>Last check-in</span><strong>{d.last_seen?new Date(d.last_seen).toLocaleString():'Never'}</strong></div>
                <div><span>MetaTrader setup</span><strong>{d.setup_state==='ready'?'Ready':d.setup_state==='install'?'Install MT5':'Unknown'}</strong></div>
                <div><span>Connected accounts</span><strong>{count}</strong></div>
              </div>
              {editingPc===d.id ? <div className="ym-edit-row"><label>Computer name<input className="input-field" maxLength={48} value={pcNameDraft} onChange={e=>setPcNameDraft(e.target.value)} placeholder="Trading Laptop"/></label><button type="button" className="btn-primary" disabled={pcNameDraft.trim().length<2||!!busyAction} onClick={()=>void run(async()=>{await action('rename-pc',{device:d.id,name:pcNameDraft.trim()});setEditingPc(null);},'PC renamed. The connector will display the new name at its next check-in.','rename-pc')}>{busyAction==='rename-pc'?'Saving…':'Save name'}</button><button type="button" className="btn-secondary" onClick={()=>setEditingPc(null)}>Cancel</button></div> :
                <div className="ym-connection-actions">
                  <button type="button" className="btn-primary" disabled={!online||d.setup_state==='install'||capturePaused} onClick={()=>scanDevice(d.id)}><RefreshCw size={15}/> Scan accounts</button>
                  <button type="button" className="btn-secondary" onClick={()=>{setEditingPc(d.id);setPcNameDraft(pairedPcName(d));}}>Rename PC</button>
                  <button type="button" className="btn-secondary" onClick={()=>{if(window.confirm('Unpair '+pairedPcName(d)+'? This revokes its connected broker sessions. Do not unpair the PC currently capturing your trades.'))void run(()=>action('revoke',{device:d.id}),'PC unpaired. Historical trade evidence was retained.','revoke-pc');}}>Unpair PC</button>
                </div>}
              <details className="ym-context-help"><summary><CircleHelp size={15}/>Connection and safety details</summary><p>Use Add broker account to connect more logins without pairing again. Unpairing revokes monitoring for accounts on this PC. An offline PC retains its saved pairing; reopen the Windows connector on that computer.</p><div className="ym-connection-actions"><a href="/connector-download.html" rel="noopener noreferrer">Download latest connector</a><a href="https://github.com/cash-factory/YoungMoney3/releases" rel="noopener noreferrer">Published versions and checksums</a></div></details>
              <div className="ym-pc-accounts">
                <div className="ym-pc-accounts-header"><strong>Accounts on this PC</strong><span className="ym-section-count">{deviceLinks.length}</span></div>
                {deviceLinks.length?deviceLinks.map(link=>{
                  const accountStatus=monitoringStatus(link,d,capturePaused);
                  return <button type="button" className="ym-pc-account-link" key={link.id}
                    onClick={()=>{
                      setSelectedAccountId(link.id);setAccountPanel('overview');
                      window.requestAnimationFrame(()=>document.getElementById('ym-linked-accounts')?.scrollIntoView({behavior:'smooth',block:'start'}));
                    }}>
                    <span><strong>{accountNames[link.account_id||'']||link.company||link.server||'Broker account'}</strong>
                      <small>{link.server||'Server pending'} · {link.login||'Login pending'}</small></span>
                    <span className="ym-connection-badge" data-tone={accountStatus==='Monitoring'?'success':accountStatus.includes('attention')?'danger':'warning'}>{accountStatus}</span>
                    <ArrowRight size={15} className="text-muted"/>
                  </button>;
                }):<p className="ym-pc-accounts-empty">No linked accounts yet. Use Add broker account to connect a demo login.</p>}
              </div>
              {count>0 && <button type="button" className="ym-select-account-jump" onClick={()=>document.getElementById('ym-linked-accounts')?.scrollIntoView({behavior:'smooth',block:'start'})}>Open account manager <ArrowRight size={15}/></button>}
            </div>}
          </div>;
        })}
      </div>
      <details className="ym-context-help ym-connector-downloads"><summary><CircleHelp size={15}/>Connector downloads and setup</summary>
        <div className="ym-connection-actions">
          <a href="/connector-download.html" rel="noopener noreferrer">Download latest connector</a>
          <a href="/connector-download.html">Release details &amp; SHA-256</a>
          <a href="/mt5-connector.zip" download>Python source fallback</a>
        </div>
        <p>Use the Windows connector on the computer that runs MT5. Staging connector builds are unsigned. Trade copying requires account-specific authorization; real-money execution is independently disabled until the pilot is approved. Check the release checksum before opening the executable.</p>
      </details>
      {requestedPc && loaded && <p className="ym-context-short" role="status">{!devices.length?'Pair a PC once to continue.':requestedPc==='1'&&devices.length>1?'Select the PC to add this account to.':'Keep the connector open; the login will open when the selected PC is ready.'}</p>}
    </section>
    <section id="ym-linked-accounts" className="card ym-connection-section" aria-labelledby="linked-accounts-title">
      <header className="ym-connection-heading">
        <div><p className="ym-connection-eyebrow">02 / BROKER CONNECTIONS</p><h2 id="linked-accounts-title">Linked accounts <span className="ym-section-count">{visibleLinks.length}</span></h2></div>
        {selectedPc && <button type="button" className="btn-secondary" onClick={()=>{setSelectedPcId(null);setSelectedAccountId(null);}}>Show all PCs <X size={14}/></button>}
      </header>
      {selectedPc && <p className="ym-context-short">Showing accounts on <strong>{pairedPcName(selectedPc)}</strong>.</p>}
      {loaded && !visibleLinks.length && <div className="ym-connection-empty"><Link2 size={26}/><strong>No accounts in this view</strong><p>Select a different PC or add your first broker login.</p></div>}
      <div className="ym-selectable-stack" role="list" aria-label="Select a broker account">
        {visibleLinks.map(l=>{
          const pc=devices.find(d=>d.id===l.device),expanded=selectedAccountId===l.id;
          const status=monitoringStatus(l,pc,capturePaused),isGood=status==='Monitoring';
          return <div key={l.id} role="listitem" className="ym-selectable-card" data-selected={expanded}>
            <button type="button" className="ym-selectable-trigger" aria-expanded={expanded} aria-controls={'ym-account-details-'+l.id} onClick={()=>{setSelectedAccountId(expanded?null:l.id);setAccountPanel('overview');}}>
              <span className="ym-selection-icon"><Wallet size={20}/></span>
              <span className="ym-selection-primary"><strong>{accountNames[l.account_id||'']||l.company||l.server||'Pending broker account'}</strong><small>{l.server||'Server unknown'} · {l.login||'Login pending'} · {pairedPcName(pc)}</small></span>
              <span className="ym-connection-badge" data-tone={isGood?'success':status.toLowerCase().includes('attention')?'danger':'warning'}>{status}</span>
              <ChevronDown className="ym-selectable-chevron" size={18}/>
            </button>
            {expanded && <div className="ym-selection-details" id={'ym-account-details-'+l.id}>
              {l.status==='connected' ? <>
                <div className="ym-account-overview-figures">
                  <div><small>Broker balance</small><strong>{l.broker_balance==null?'—':l.broker_balance.toLocaleString()} <span>{l.currency}</span></strong></div>
                  <div><small>Broker equity</small><strong>{l.broker_equity==null?'—':l.broker_equity.toLocaleString()} <span>{l.currency}</span></strong></div>
                  <div><small>Decisions for review</small><strong>{l.pending_reviews||0}</strong></div>
                   {(l.evidence_conflicts_pending||0)>0&&<div><small>Evidence integrity reviews</small><strong>{l.evidence_conflicts_pending}</strong></div>}
                   {l.recovery?.state==='catching_up'&&<div><small>History recovery</small><strong>Scanning</strong></div>}
                   {(l.recovery?.unresolved_positions||0)>0&&<div><small>Waiting for broker records</small><strong>{l.recovery?.unresolved_positions}</strong></div>}
                </div>
                <div className="ym-account-tabs" role="tablist" aria-label="Account management"
                  onKeyDown={event=>{
                    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
                    const tabs=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
                    const current=tabs.indexOf(event.target as HTMLButtonElement);
                    if(current<0||!tabs.length) return;
                    event.preventDefault();
                    const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:
                      (current+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
                    tabs[next].focus();
                    tabs[next].click();
                  }}>
                  {([{id:'overview',label:'Overview',Icon:Monitor},{id:'history',label:'Trade history',Icon:History},{id:'cash',label:'Cash movements',Icon:Wallet},{id:'timezone',label:'Timezone',Icon:Clock3}] as const).map(({id,label,Icon})=>
                    <button type="button" key={id} id={'ym-account-tab-'+l.id+'-'+id}
                      role="tab" aria-selected={accountPanel===id} aria-controls={'ym-account-panel-'+l.id+'-'+id}
                      tabIndex={accountPanel===id?0:-1}
                      onClick={()=>setAccountPanel(id)}><Icon size={15}/>{label}</button>)}
                </div>
                {accountPanel==='overview'&&<div className="ym-account-pane" role="tabpanel" id={'ym-account-panel-'+l.id+'-overview'} aria-labelledby={'ym-account-tab-'+l.id+'-overview'} tabIndex={0}>
                  <div className="ym-detail-grid">
                    <div><span>Device</span><strong>{pairedPcName(pc)}</strong></div>
                    <div><span>Broker login</span><strong>{l.login||'—'}</strong></div>
                    <div><span>Last sync</span><strong>{l.last_sync?new Date(l.last_sync).toLocaleString():'Awaiting first sync'}</strong></div>
                    <div><span>Account class</span><strong>{l.trade_mode===0?'Demo':l.trade_mode===1?'Contest':l.trade_mode===2?'Real':'Unknown'}</strong></div>
                  </div>
                  {(l.evidence_conflicts_pending||0)>0&&<EvidenceConflictPanel link={l.id} count={l.evidence_conflicts_pending||0}/>}
                  {(l.connector_spec_artifacts||0)>0&&<div className="ym-action-feedback" data-kind="info" role="status">
                    <CheckCircle2 size={17}/><span><strong>{l.connector_spec_artifacts} historical connector specification-key aliases identified.</strong> These are preserved in the audit but no longer counted as broker-trade discrepancies. The corrected connector prevents new ones.</span>
                  </div>}
                  {l.recovery?.state==='catching_up'&&<div className="ym-action-feedback" data-kind="info" role="status">
                    <RefreshCw size={16} className="animate-spin"/><span>Rebuilding broker history through {new Date(l.recovery.scanned_through).toLocaleString()} toward {new Date(l.recovery.target_at).toLocaleString()}. Progress is checkpointed.</span>
                  </div>}
                  {(l.recovery?.unresolved_positions||0)>0&&<div className="ym-action-feedback" data-kind="warning" role="status">
                    <AlertTriangle size={16}/><span>{(l.recovery?.unresolved_positions||0)} previously observed {(l.recovery?.unresolved_positions||0)===1?'position':'positions'} cannot yet be confirmed closed from broker deals and orders. Their status remains unresolved.</span>
                  </div>}
                  {Boolean(l.recovery?.unobserved_stop_changes)&&<div className="ym-action-feedback" data-kind="info" role="status">
                    <CircleHelp size={16}/><span>An offline observation gap was detected. Executions can be recovered from history; SL/TP modifications made entirely offline may not be reconstructable.</span>
                  </div>}
                  {l.last_error && <div className="ym-action-feedback" data-kind="warning" role="alert"><AlertTriangle size={16}/><span>{l.last_error}</span></div>}
                  {Boolean(l.gap)&&<div className="ym-action-feedback" data-kind="warning">An offline interval may have left gaps in observed stop changes.</div>}
                  <div className="ym-connection-actions">
                    <button type="button" className="btn-secondary" disabled={!!busyAction} onClick={()=>void run(()=>action('set-monitoring',{link:l.id,paused:!l.monitoring_paused}),l.monitoring_paused?'Monitoring resumed.':'Monitoring paused.','monitoring')}>{busyAction==='monitoring'?'Updating…':l.monitoring_paused?'Resume monitoring':'Pause monitoring'}</button>
                    <button type="button" className="btn-secondary" disabled={!!l.retry_requested_at||!!l.monitoring_paused||capturePaused||!!busyAction} onClick={()=>void run(()=>action('retry-session',{link:l.id}),'Retry queued. The connector will retry this login.','retry')}>{busyAction==='retry'?'Queuing…':l.retry_requested_at?'Retry queued':'Retry account'}</button>
                  </div>
                  <details className="ym-context-help"><summary><CircleHelp size={15}/>Permissions and capture safety</summary><p>{l.access_level==='trading-enabled'?'The broker login has trading privileges, but this dashboard captures records only.':'This integration is capture-only.'} No orders are placed from YoungMoney3.</p></details>
                </div>}
                {accountPanel==='history'&&<div className="ym-account-pane" role="tabpanel" id={'ym-account-panel-'+l.id+'-history'} aria-labelledby={'ym-account-tab-'+l.id+'-history'} tabIndex={0}>
                  <div className="ym-account-pane-heading"><div><strong>Earlier trades</strong><span>Choose how far back to collect broker-available records.</span></div><History size={19}/></div>
                  <div className="ym-history-inputs">
                    <label>History starting point
                      <Select className="input-field" value={historyMode} onChange={e=>setHistoryMode(e.target.value)}>
                        <option value="days">Lookback duration</option><option value="from_date">From a date</option><option value="all">All broker-available history</option><option value="since_last_deposit">After latest balance credit</option><option value="since_first_deposit">After earliest balance credit</option>
                      </Select>
                    </label>
                    {historyMode==='days'&&<label>Lookback
                      <Select className="input-field" value={historyDays} onChange={e=>setHistoryDays(e.target.value)}>
                        {['7','14','30','60','90','180','365','730','1825'].map(days=><option key={days} value={days}>{days} days{days==='30'?' · default':''}</option>)}<option value="custom">Custom duration</option>
                      </Select>
                    </label>}
                    {historyMode==='days'&&historyDays==='custom'&&<label>Days<input type="number" className="input-field" min={1} max={36525} step={1} value={historyCustomDays} onChange={e=>setHistoryCustomDays(e.target.value)} placeholder="e.g. 240"/></label>}
                    {historyMode==='from_date'&&<label>Starting date (UTC)<input type="date" className="input-field" min="1970-01-01" max={new Date().toISOString().slice(0,10)} value={historyFromDate} onChange={e=>setHistoryFromDate(e.target.value)}/></label>}
                  </div>
                  <div className="ym-connection-actions">
                    <button className="btn-primary" disabled={!!busyAction||!!l.monitoring_paused||capturePaused||['requested','resolving'].includes(l.history_status||'')||(historyMode==='from_date'&&!historyFromDate)||(historyMode==='days'&&historyDays==='custom'&&!historyCustomDays)} onClick={()=>void run(async()=>{const payload:Record<string,unknown>={link:l.id,mode:historyMode};if(historyMode==='days')payload.days=Number(historyDays==='custom'?historyCustomDays:historyDays);if(historyMode==='from_date')payload.since=historyFromDate;await action('history-request',payload);},'History scan requested. Progress will appear here.','history')}>{busyAction==='history'?'Requesting…':'Find earlier trades'}</button>
                    {['requested','resolving'].includes(l.history_status||'')&&<button className="btn-secondary" disabled={!!busyAction} onClick={()=>void run(()=>action('history-decline',{link:l.id,request:l.history_id}),'History scan cancelled.','cancel-history')}>Cancel scan</button>}
                    {l.history_id&&['ready','imported'].includes(l.history_status||'')&&<button className="btn-secondary" onClick={()=>setHistoryScan({link:l.id,request:l.history_id!,brokerAccount:[l.server,l.login].filter(Boolean).join(' · '),name:accountNames[l.account_id||'']||l.company||'Linked account'})}>Review earlier trades</button>}
                  </div>
                  {['requested','resolving'].includes(l.history_status||'')&&<div className="ym-account-progress" role="status"><RefreshCw size={16} className="animate-spin"/><span>{l.history_status==='resolving'?'Finding the selected balance transaction…':'Scanning broker history…'}</span></div>}
                  {l.history_status==='no_deposit'&&<div className="ym-action-feedback" data-kind="warning" role="status">No qualifying balance credit was found in available broker history.</div>}
                  {l.history_anchor_at!=null&&<div className="ym-detail-grid"><div><span>Balance transaction</span><strong>{new Date(l.history_anchor_at).toLocaleString()}</strong></div><div><span>Broker deal ticket</span><strong>{l.history_anchor_ticket||'—'}</strong></div></div>}
                  {l.history_scanned_until!=null&&<p className="ym-context-short">Scanned through {new Date(l.history_scanned_until).toLocaleDateString()}.</p>}
                  <details className="ym-context-help"><summary><CircleHelp size={15}/>What can the connector recover?</summary><p>Only records retained by the broker. Some balance entries can be broker adjustments rather than actual deposits. Historical stop changes and original risk are shown only when supporting records exist. Review fills before importing.</p></details>
                </div>}
                {accountPanel==='cash'&&<div className="ym-account-pane" role="tabpanel" id={'ym-account-panel-'+l.id+'-cash'} aria-labelledby={'ym-account-tab-'+l.id+'-cash'} tabIndex={0}>
                  <CashFlowPanel key={l.id} link={l} />
                </div>}
                {accountPanel==='timezone'&&<div className="ym-account-pane" role="tabpanel" id={'ym-account-panel-'+l.id+'-timezone'} aria-labelledby={'ym-account-tab-'+l.id+'-timezone'} tabIndex={0}>
                  <div className="ym-account-pane-heading"><div><strong>Broker timezone</strong><span>Confirm the broker's statement time, not your current PC time.</span></div><Clock3 size={19}/></div>
                  <div className="ym-history-inputs"><label>IANA timezone
                    <input list="broker-timezones" className="input-field" placeholder="Europe/Athens" value={timezoneDraft[l.id]??l.broker_timezone??''} onChange={e=>setTimezoneDraft(old=>({...old,[l.id]:e.target.value}))}/>
                  </label></div>
                  <label className="ym-proof-check"><input type="checkbox" checked={Boolean(timezoneProof[l.id])} onChange={e=>setTimezoneProof(old=>({...old,[l.id]:e.target.checked}))}/>I verified a broker statement against raw MT5 timestamps.</label>
                  <div className="ym-connection-actions">
                    <button className="btn-primary" disabled={!!busyAction||!(timezoneDraft[l.id]??l.broker_timezone??'').trim()} onClick={()=>void run(async()=>{const zone=(timezoneDraft[l.id]??l.broker_timezone??'').trim();await action('timezone-confirm',{link:l.id,timezone:zone,confirm:true,utcEvidence:timezoneProof[l.id]?'broker_statement_checked':undefined});},'Timezone saved for this broker account. UTC evidence remains '+(timezoneProof[l.id]?'confirmed.':'unverified.'),'timezone')}>{busyAction==='timezone'?'Confirming…':'Confirm timezone'}</button>
                    {l.timezone_confirmed_at&&<span className="ym-confirmation-stamp" role="status"><CheckCircle2 size={15}/>Confirmed {new Date(l.timezone_confirmed_at).toLocaleString()}</span>}
                  </div>
                  <div className="ym-detail-grid"><div><span>Saved timezone</span><strong>{l.broker_timezone||'Unconfirmed'}</strong></div><div><span>UTC conversion</span><strong>{l.utc_conversion_status||'Not verified'}</strong></div></div>
                  <details className="ym-context-help"><summary><CircleHelp size={15}/>Why verify timezone?</summary><p>Incorrect offsets can mislabel sessions and distort the interpretation of historical trade timestamps. Confirm against the broker's statement before relying on session reports.</p></details>
                </div>}
              </> : <div className="ym-account-pane"><span className="ym-connection-badge" data-tone="warning">{status}</span>{l.last_error&&<p className="ym-context-short">{l.last_error}</p>}<div className="ym-connection-actions"><button className="btn-secondary" onClick={()=>void run(()=>action('retry-session',{link:l.id}),'Retry queued.','retry')}>Retry setup</button></div></div>}
            </div>}
          </div>;
        })}
      </div>
      {failedLinks.length>0&&<details className="ym-context-help ym-failed-archive"><summary><AlertTriangle size={15}/>Failed and expired attempts <span>{failedLinks.length}</span></summary>
        <p>Old unsuccessful attempts are kept apart from live accounts.</p>
        <button className="btn-secondary" onClick={()=>{if(window.confirm('Remove all failed attempts that have no broker evidence?'))void run(()=>action('clear-failed'),'Failed attempts cleared. Connected accounts were kept.','clear-failed');}}>Clear failed attempts</button>
        {failedLinks.map(l=><div key={l.id} className="ym-failed-row"><div><strong>{l.company||l.server||'Login attempt'}</strong><small>{l.server} · {l.login}</small></div><button type="button" className="btn-secondary" onClick={()=>{if(window.confirm('Remove this failed login attempt?'))void run(()=>action('remove-failed',{link:l.id}),'Failed attempt removed.','remove-failed');}}>Remove</button></div>)}
      </details>}
    </section>
    <datalist id="broker-timezones">
      <option value="Etc/UTC"/><option value="Europe/Athens"/><option value="Europe/Helsinki"/>
      <option value="Europe/London"/><option value="Africa/Johannesburg"/><option value="America/New_York"/>
      <option value="Europe/Berlin"/><option value="Asia/Dubai"/>
    </datalist>
    {historyScan && <HistoryReview key={historyScan.link+'/'+historyScan.request} scan={historyScan}
      status={historyAccount?.history_id === historyScan.request ? historyAccount.history_status : undefined}
      onClose={()=>setHistoryScan(current=>current===historyScan ? null : current)}
      onFinished={async imported=>{
        setHistoryScan(current=>current===historyScan ? null : current);
        await run(async()=>{if(imported) await fetchTrades();});
      }}/>}
    <details className="card p-5 sm:p-6 ym-position-archives" aria-label="Rich position lifecycles">
      <summary className="cursor-pointer list-none flex flex-wrap items-center justify-between gap-3" aria-label="Expand broker position lifecycles">
        <span className="font-bold text-sm">Broker position evidence</span>
        <span className="ym-section-count">{positions.length} lifecycles</span>
        <ChevronDown size={17} />
      </summary>
      <div className="mt-4 pt-4 border-t border-themed space-y-3">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="text-base font-bold">Position lifecycles</h2>
          <p className="text-xs text-muted mt-1">A position lifecycle contains its entries, scale-ins and partial closes. Raw broker records are kept separately for audit.</p>
        </div>
        <span className="badge badge-neutral">{positions.length} projected positions</span>
      </header>
      {loaded && positions.length===0 && <p className="rounded-xl bg-secondary p-4 text-sm text-secondary">No rich broker position summaries have synced yet. Start the staging Windows connector and leave it running with a demo account.</p>}
      <div className="space-y-2">
        {positions.map(item=>{
          const x=item.summary;
          const broker=links.find(link=>link.id===item.link);
          return <details key={item.link+'/'+item.lifecycle_id} className="ym-mt5-lifecycle rounded-xl border border-themed p-3 sm:p-4" data-result={x.status==='open'?'open':pnlTone(x.net_realized_profit)==='positive'?'win':pnlTone(x.net_realized_profit)==='negative'?'loss':'neutral'}>
            <summary className="cursor-pointer list-none flex flex-wrap gap-3 items-center justify-between">
              <span className="flex flex-col gap-1"><strong className="text-sm flex flex-wrap items-center gap-2">{x.symbol}
                  <span className="ym-direction-tag" data-side={x.direction}>{x.direction==='long'?'Long':'Short'}</span>
                  <span className="text-muted text-xs font-normal">{x.status==='open'?'Open':'Closed'}</span></strong>
                <small className="text-muted">{broker?.company || 'Broker'} · {broker?.login || item.account_id} · Version {item.version}</small></span>
              <span className="flex flex-col text-right"><strong className={`ym-market-value text-sm ym-market-${pnlTone(x.net_realized_profit,x.status==='open')}`}>{x.status==='open'?'Unrealized / unknown':x.net_realized_profit==null?'Unavailable':signedMoney(Number(x.net_realized_profit),String(x.net_realized_profit))} {broker?.currency || ''}</strong>
                <small className="text-muted">Net R: {x.realized_r ?? 'Unavailable'} · {x.movement ?? '—'} {x.movement_unit || 'units'}</small></span>
            </summary>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 text-xs">
              {[
                ['First entry',x.first_entry_at],['Final exit',x.final_exit_at || 'Open'],
                ['Original SL',x.initial_sl ?? 'Not captured'],['Original TP',x.initial_tp ?? 'Not captured'],
                ['Stop source',x.initial_sl_provenance || 'Unverified'],
                ['First observed',x.initial_sl_observed_at || '—'],['Current SL',x.current_sl ?? '—'],['Current TP',x.current_tp ?? '—'],
                ['Initial risk',x.initial_risk_account ?? 'Unavailable'],['Capital source',x.capital_at_entry?.source || 'Unavailable'],
                ['Final net R',x.final_realized_r ?? 'Unavailable'],['Remaining volume',x.remaining_volume ?? 'Unknown'],
                ['Total holding',x.holding_seconds ? (Number(x.holding_seconds)/3600).toFixed(2)+' hours' : 'Open/unknown'],
                ['VW holding',x.weighted_holding_seconds ? (Number(x.weighted_holding_seconds)/3600).toFixed(2)+' hours' : 'Unavailable'],
              ].map(([label,value])=><div key={String(label)} className="ym-market-detail" data-level={label==='Original SL'||label==='Current SL'?'sl':label==='Original TP'||label==='Current TP'?'tp':label.toLowerCase().includes('risk')?'risk':undefined}><span>{label}</span><strong>{value}</strong></div>)}
            </div>
            <p className="text-xs text-secondary mt-3">Sessions: {x.sessions?.status==='confirmed' ? x.sessions.sessions?.join(', ') || 'None' : 'Unresolved — '+(x.sessions?.reason || 'broker timezone not confirmed')} · Initial risk: {x.capture_completeness?.original_risk || 'unknown'}</p>
            <div className="grid md:grid-cols-2 gap-4 mt-4">
              <div><h3 className="text-xs font-bold mb-2">Entry executions ({x.entries?.length || 0})</h3>
                {x.entries?.map((entry,index)=><div key={index} className="text-xs border-t border-themed py-2">
                  Deal {String(entry.deal_ticket || '—')} · {String(entry.volume || '?')} lots @ {String(entry.price || '?')}
                  <p className="text-muted">{String(entry.time || '')} · <span className="ym-market-sl">Opening SL {String(entry.initial_sl ?? 'unknown')}</span> · <span className="ym-market-warning">Risk {String(entry.initial_risk ?? 'unknown')}</span></p>
                </div>)}
              </div>
              <div><h3 className="text-xs font-bold mb-2">Closes ({x.exits?.length || 0})</h3>
                {x.exits?.map((exit,index)=><div key={index} className="text-xs border-t border-themed py-2">
                  Deal {String(exit.deal_ticket || '—')} · {String(exit.volume || '?')} lots @ {String(exit.price || '?')}
                  <p className="text-muted"><span className={`ym-market-${pnlTone(exit.net_profit as number | string | null)}`}>Net {String(exit.net_profit ?? 'unknown')}</span> · R {String(exit.realized_r ?? 'unavailable')} · {String(exit.holding_seconds ?? 'unknown')} seconds</p>
                </div>)}
              </div>
            </div>
          </details>;
        })}
      </div>
      {positionsMore && <button className="btn-secondary" onClick={async()=>{try {
        const page=await action('positions',{offset:positions.length});
        setPositions(previous=>[...previous,...page.rows]);setPositionsMore(Boolean(page.more));
      } catch(e){setError(e instanceof Error?e.message:'Could not load more lifecycles.');}}}>Load more lifecycles</button>}
      </div>
    </details>
    <dialog ref={dialog} aria-labelledby="mt5-dialog-title" className="mt5-dialog" onClose={()=>{setDevice('');void refresh().catch(e=>setError(e.message));}}>
      <header className="flex items-center justify-between border-b border-themed px-5 py-4"><h2 id="mt5-dialog-title" className="font-bold">Connect MT5 account</h2><button className="btn-ghost p-2" aria-label="Close login" onClick={()=>dialog.current?.close()}><X size={18}/></button></header>
      {device && <iframe title="MT5 broker account login" className="w-full border-0" style={{height:'min(530px,70dvh)'}} src={'/mt5-login.html#'+encodeURIComponent(device)}/>}
    </dialog>
    {trades.some(t=>source(t)==='mt5') && <details className="card p-5 space-y-3"><summary>Review manual and imported trade matches</summary>
      <label>Broker trade <Select value={imported} onChange={e=>{setImported(e.target.value);setManual('');}}><option value="">Choose a trade</option>{trades.filter(t=>source(t)==='mt5' && t.status==='closed').map(t=><option key={t.id} value={t.id}>{t.pair} · {t.direction} · {t.entry_time} · {t.pnl}</option>)}</Select></label>
      {selected && <label>Manual entry <Select value={manual} onChange={e=>setManual(e.target.value)}><option value="">Choose a matching entry</option>{matches.map(t=><option key={t.id} value={t.id}>{t.pair} · {t.entry_time} · {t.pnl}</option>)}</Select></label>}
      <button disabled={!manual} onClick={()=>run(async()=>{await action('match',{imported,manual});setManual('');setImported('');await fetchTrades();})}>Confirm match and retain journal notes</button></details>}
    {error && <p role="alert">{error}</p>}
  </main>;
}

interface HistoryReviewProps {
  scan: SelectedScan;
  status?: string;
  onClose: () => void;
  onFinished: (imported: boolean) => Promise<void>;
}

async function loadHistoryPage(scan: HistoryScan, offset: number, signal?: AbortSignal): Promise<HistoryPage> {
  const page = await action('history-preview', {link:scan.link, request:scan.request, offset}, signal);
  if (page.link !== scan.link || page.request !== scan.request || !Array.isArray(page.rows) ||
      !Number.isSafeInteger(page.nextOffset) || page.nextOffset !== offset + page.rows.length ||
      (page.more && page.rows.length === 0)) {
    throw new Error('The preview changed. Reopen this account’s history.');
  }
  return page;
}

function HistoryReview({scan, status, onClose, onFinished}: HistoryReviewProps) {
  const [preview, setPreview] = useState<HistoryPage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const current = status === 'ready' || status === 'imported';
  useEffect(() => {
    if (!current) return;
    const controller = new AbortController();
    setPreview(null);
    setError('');
    void loadHistoryPage(scan, 0, controller.signal).then(page => {
      if (!controller.signal.aborted) setPreview(page);
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not open these fills.');
    });
    return () => controller.abort();
  }, [scan, current, attempt]);

  async function perform(operation: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try { await operation(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not complete the request.'); }
    finally { setBusy(false); }
  }

  return <section className="rounded-xl border border-themed p-4 space-y-3" aria-label={'Earlier trades for '+scan.name}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h3 className="font-semibold">Earlier trades for {scan.name}</h3>
        {scan.brokerAccount && <p className="text-xs text-secondary">{scan.brokerAccount}</p>}</div>
      <button type="button" className="btn-ghost" onClick={onClose}>Close preview</button>
    </div>
    {!current ? <p role="status">This scan is no longer current. Open the latest preview for this account.</p> :
      !preview ? (error ? <p role="alert">{error} <button className="btn-secondary" onClick={()=>setAttempt(n=>n+1)}>Retry preview</button></p>
        : <p role="status">Loading broker fills…</p>) : <>
      <p className="text-sm text-secondary">{preview.rows.length} broker {preview.rows.length===1?'fill':'fills'} reviewed{preview.more?' so far. Review the next page before importing.':'.'} Your latest broker balance is shown on the account.</p>
      <div className="overflow-auto max-h-80"><table className="w-full min-w-[950px] text-xs text-left border-separate border-spacing-0">
        <thead><tr className="text-muted uppercase tracking-wide">
          {['Symbol','Position / deal','Entry / exit UTC','Direction','Volume','Entry / exit price','Opening SL / TP','Closing SL / TP','Initial risk','Costs / swap','Exit reason','Net P&L'].map(label=><th key={label} className="border-b border-themed px-2 py-3 font-semibold whitespace-nowrap">{label}</th>)}
        </tr></thead>
        <tbody>{preview.rows.map((r,i)=>{
          const broker=(r.broker_details && typeof r.broker_details==='object' ? r.broker_details : {}) as Record<string,unknown>;
          const value=(key:string)=>r[key]==null?'Unknown':String(r[key]);
          return <tr key={i} className="align-top hover:bg-secondary" data-result={pnlTone(r.pnl as number|string|null)}>
            <td className="px-2 py-3 font-semibold">{value('pair')}</td>
            <td className="px-2 py-3 font-mono">Position {broker.position_id == null?'Unknown':String(broker.position_id)}<div className="text-muted">Deal {broker.deal_ticket == null?'Unknown':String(broker.deal_ticket)}</div></td>
            <td className="px-2 py-3">{value('entry_time')}<div className="text-muted">{value('exit_time')}</div></td>
            <td className="px-2 py-3"><span className="ym-direction-tag" data-side={r.direction}>{value('direction')}</span></td>
            <td className="px-2 py-3 font-mono">{value('lot_size')}</td>
            <td className="px-2 py-3 font-mono">{value('entry_price')}<div className="text-muted">{value('exit_price')}</div></td>
            <td className="px-2 py-3 font-mono"><span className="ym-market-sl">SL {r.stop_loss == null?'Not recorded':String(r.stop_loss)}</span>
              <div className="ym-market-tp">TP {r.take_profit==null?'Not recorded':String(r.take_profit)}</div>
              <div className="text-muted font-sans">{broker.opening_protection_provenance==='executed_open_order'?'From opening order':'Opening protection unverified'}</div></td>
            <td className="px-2 py-3 font-mono"><span className="ym-market-sl">SL {broker.closing_order_sl==null?'Unavailable':String(broker.closing_order_sl)}</span>
              <div className="ym-market-tp">TP {broker.closing_order_tp==null?'Unavailable':String(broker.closing_order_tp)}</div>
              <div className="text-muted font-sans">Exit order {broker.exit_order_ticket==null?'Unknown':String(broker.exit_order_ticket)}</div></td>
            <td className="px-2 py-3">Historical initial risk cannot be proven without the opening order, instrument specification, and capital at entry</td>
            <td className="px-2 py-3 font-mono">Fees: {value('fees')}<div className="text-muted">Swap: {broker.swap==null?'Unknown':String(broker.swap)}</div></td>
            <td className="px-2 py-3">{broker.close_reason==null?'Not recorded':String(broker.close_reason)}
              <div className="text-muted">{broker.close_comment==null?'':String(broker.close_comment)}</div></td>
            <td className={`px-2 py-3 ym-market-value font-semibold ym-market-${pnlTone(r.pnl as number|string|null)}`}>{r.pnl==null?'Unknown':signedMoney(Number(r.pnl),String(r.pnl))}</td>
          </tr>;
        })}</tbody>
      </table></div>
      <p className="text-xs text-muted">These are individual closed broker fills, including partial exits. Original broker deals and orders (timestamps, fees, swap, reasons and known stop levels) are preserved as immutable evidence. A stop changed between observations may not be reconstructible from historical records. Initial risk and R remain unknown when broker evidence is insufficient.</p>
      {preview.more && <div className="flex flex-wrap gap-2">
        <button disabled={busy} className="btn-secondary" onClick={()=>perform(async()=>{
          const next = await loadHistoryPage(scan, preview.nextOffset);
          setPreview({...next, rows:[...preview.rows, ...next.rows]});
        })}>Review next 100 fills</button>
        <button disabled={busy} className="btn-secondary" onClick={()=>perform(async()=>{
          let current=preview, rows=[...preview.rows];
          // Reviewable batches; very large histories require another click
          // rather than blocking the browser or silently importing unseen data.
          for(let page=0;current.more && page<30;page++){
            current=await loadHistoryPage(scan,current.nextOffset);
            rows=rows.concat(current.rows);
            setPreview({...current,rows});
          }
        })}>Load remaining pages for review (up to 3,000)</button>
      </div>}
      <button disabled={busy || preview.more} className="btn-primary" onClick={()=>perform(async()=>{
        let more = true;
        while (more) {
          const batch = await action('history-import',{link:preview.link, request:preview.request, expected_count:preview.rows.length});
          more = batch.more;
        }
        await onFinished(true);
      })}>Import {preview.rows.length} reviewed {preview.rows.length===1?'fill':'fills'}</button>
      {status === 'ready' && <button disabled={busy} className="btn-secondary" onClick={()=>perform(async()=>{
        await action('history-decline',{link:preview.link,request:preview.request});
        await onFinished(false);
      })}>Skip import</button>}
      {error && <p role="alert">{error}</p>}
    </>}
  </section>;
}
