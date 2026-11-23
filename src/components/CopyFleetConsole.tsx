import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowDownUp, CheckCircle2, CircleHelp, PauseCircle, Play, Plus, RefreshCw, Save, ShieldCheck, Square, X } from 'lucide-react';
import { copyAction } from '@/lib/copyStudio';
import { announceAction } from '@/lib/actionFeedback';
import './copy-fleet-console.css';

type RiskMode = 'risk_pct_equity'|'fixed_risk'|'equity_ratio'|'lot_multiplier';
type ExecutionMode = 'demo'|'live';
type Account = {
  id:string; company:string|null; server:string|null; login:string|null;
  trade_mode:number|null;access_level:string;monitoring_paused:number;
  broker_balance:number|null;broker_equity:number|null;currency:string|null;
  last_seen:number|null;last_sync:string|null;
};
type TargetRow={
  link:string;mode:RiskMode;value:number;maxLots:number;maxDailyLossPct:number;
  enabled:boolean;symbolMap:Record<string,string>;
  mirrorPending:boolean;mirrorProtection:boolean;
};
type SavedTarget={
  follower_link:string;sizing_mode:RiskMode;sizing_value:number;
  max_lots:number;max_daily_loss_pct:number;enabled:number;
  symbol_map:Record<string,string>;mirror_pending:number;mirror_protection:number;
};
type Fleet={
  id:string;name:string;source_link:string;execution_mode:ExecutionMode;state:'paused'|'demo_armed'|'live_armed';version:number;
  targets:SavedTarget[];
};
type Report={link:string;account_balance:number;account_equity:number;account_currency:string;margin_free:number;
  open_positions:number;pending_orders:number;broker_connected:number;demo_trading_enabled:number;observed_at_ms:number};
type Consent={follower_link:string;demo_authorized:number;authorization_mode:string;expires_at:number};
type Task={id:string;fleet_id:string;source_key:string;action:string;status:string;follower_link:string;retcode:number|null;result_code:string|null;result_payload?:{lots?:number;risk_amount?:number;risk_pct_equity?:number;account_currency?:string}|null;created_at:number};
type Status={mode:'demo-and-live';liveExecutionEnabled:boolean;requiresLocalConsent:true;maxFollowersPerFleet:number;
  accounts:Account[];fleets:Fleet[];reports:Report[];consents:Consent[];tasks:Task[]};
type PreviewRow={followerLink:string;enabled:boolean;mode:RiskMode;accountCurrency:string|null;
  plannedRiskBudget:number|null;indicativeLots:number|null;brokerValidated:false;needsBrokerPreflight:true;notice:string};
const defaultTarget=(link:string):TargetRow=>({
  link,mode:'risk_pct_equity',value:1,maxLots:1,maxDailyLossPct:2,
  enabled:true,symbolMap:{},mirrorPending:true,mirrorProtection:true,
});
const newDraft=()=>({name:'',sourceLink:'',executionMode:'demo' as ExecutionMode,targets:[] as TargetRow[]});
const title=(a?:Account)=>a?(a.company||a.server||'MT5')+' · '+(a.login||a.id.slice(0,8)):'Unavailable';
const err=(x:unknown)=>x instanceof Error?x.message:'Request failed. Refresh and try again.';
const cash=(n:number|null|undefined,currency?:string|null)=>typeof n==='number'&&Number.isFinite(n)?
  new Intl.NumberFormat(undefined,{maximumFractionDigits:2,minimumFractionDigits:2}).format(n)+' '+(currency||''):
  'Not verified';
const modeLabel:Record<RiskMode,string>={
  risk_pct_equity:'Risk % of follower equity',fixed_risk:'Fixed money at risk',
  equity_ratio:'Equity-proportional lots',lot_multiplier:'Source lot multiplier',
};
const symbolMapText=(map:Record<string,string>)=>
  Object.entries(map).map(([from,to])=>from+'='+to).join(', ');
const parseSymbolMapText=(text:string):Record<string,string>|null=>{
  if(!text.trim())return {};
  const entries=text.split(/[,\n]/).map(x=>x.trim()).filter(Boolean);
  if(entries.length>40)return null;
  const map:Record<string,string>={};
  for(const text of entries){
    const match=/^([A-Za-z0-9._#-]{1,40})\s*=\s*([A-Za-z0-9._#-]{1,40})$/.exec(text);
    if(!match||Object.prototype.hasOwnProperty.call(map,match[1]))return null;
    map[match[1]]=match[2];
  }
  return map;
};
const permission=(a:Account,mode:ExecutionMode)=>a.trade_mode===(mode==='live'?2:0)&&a.access_level==='trading-enabled'&&
  a.monitoring_paused===0&&Number(a.last_seen)>Date.now()-45000;
export function CopyFleetConsole(){
  const [status,setStatus]=useState<Status|null>(null);
  const [selected,setSelected]=useState<string|null>(null);
  const [draft,setDraft]=useState(newDraft);
  const [busy,setBusy]=useState('');
  const [alert,setAlert]=useState('');
  const [notice,setNotice]=useState('');
  const [lots,setLots]=useState('0.10');
  const [entry,setEntry]=useState('1.10000');
  const [stop,setStop]=useState('1.09500');
  const [side,setSide]=useState<'buy'|'sell'>('buy');
  const [preview,setPreview]=useState<PreviewRow[]|null>(null);
  const [mappingInputs,setMappingInputs]=useState<Record<string,string>>({});
  const load=useCallback(async()=>setStatus(await copyAction<Status>('fleet-status')),[]);
  useEffect(()=>{let active=true;copyAction<Status>('fleet-status')
    .then(x=>{if(active)setStatus(x);}).catch(x=>{if(active)setAlert(err(x));});
    return()=>{active=false;};},[]);
  const picked=status?.fleets.find(f=>f.id===selected);
  const accounts=status?.accounts||[];
  const source=accounts.find(a=>a.id===draft.sourceLink);
  const remaining=accounts.filter(a=>a.id!==draft.sourceLink&&!draft.targets.some(t=>t.link===a.id));
  const reports=new Map(status?.reports.map(x=>[x.link,x]));
  const consent=new Map(status?.consents.map(x=>[x.follower_link,x]));
  const armed=status?.fleets.filter(x=>x.state==='demo_armed'||x.state==='live_armed')||[];
  const expectedTradeMode=draft.executionMode==='live'?2:0;
  const sourceAllowed=(a:Account)=>a.trade_mode===0||(draft.executionMode==='live'&&a.trade_mode===2);
  const riskPass=useMemo(()=>draft.targets.every(t=>t.value>0&&t.maxLots>0&&t.maxDailyLossPct>0&&
    (t.mode!=='risk_pct_equity'||t.value<=10)&&
    (t.mode!=='equity_ratio'||t.value<=3)&&
    (t.mode!=='lot_multiplier'||t.value<=5)&&
    (draft.executionMode!=='live'||(t.maxDailyLossPct<=5&&
      (t.mode!=='risk_pct_equity'||t.value<=2)))),[draft.targets,draft.executionMode]);
  const canSave=draft.name.trim().length>=2&&Boolean(source)&&sourceAllowed(source!)&&draft.targets.length>0&&riskPass&&
    draft.targets.every(t=>accounts.some(a=>a.id===t.link&&a.trade_mode===expectedTradeMode)&&t.link!==draft.sourceLink &&
      parseSymbolMapText(mappingInputs[t.link]??symbolMapText(t.symbolMap))!==null);
  const edit=(item:Fleet)=>{
    setSelected(item.id);
    setDraft({name:item.name,sourceLink:item.source_link,executionMode:item.execution_mode,targets:item.targets.map(t=>({
      link:t.follower_link,mode:t.sizing_mode,value:t.sizing_value,maxLots:t.max_lots,
      maxDailyLossPct:t.max_daily_loss_pct,enabled:!!t.enabled,symbolMap:t.symbol_map,
      mirrorPending:!!t.mirror_pending,mirrorProtection:!!t.mirror_protection,
    }))});
    setMappingInputs(Object.fromEntries(item.targets.map(t=>[t.follower_link,symbolMapText(t.symbol_map)])));
    setAlert('');setNotice('');setPreview(null);
  };
  const clear=()=>{setSelected(null);setDraft(newDraft());setMappingInputs({});setAlert('');setNotice('');setPreview(null);};
  const mutate=(link:string,change:Partial<TargetRow>)=>{
    setDraft(d=>({...d,targets:d.targets.map(t=>t.link===link?{...t,...change}:t)}));
    setPreview(null);setNotice('');
  };
  async function act(name:string,body:Record<string,unknown>,success:string){
    if(busy)return;
    setBusy(name);setAlert('');setNotice('');
    try{
      const result=await copyAction<{ok:true;id?:string;version?:number;warning?:string}>(name,body);
      await load();
      if(result.id)setSelected(result.id);
      setNotice(success+(result.warning?' '+result.warning:''));
      announceAction('success',success);
      if(name==='fleet-save'){
        const next=await copyAction<Status>('fleet-status');setStatus(next);
        const fresh=next.fleets.find(x=>x.id===result.id);
        if(fresh)edit(fresh);
      }
    }catch(e){const message=err(e);setAlert(message);announceAction('error',message);}
    finally{setBusy('');}
  }
  async function refresh(){
    if(busy)return;setBusy('refresh');setAlert('');
    try{await load();setNotice('All linked account and copy task statuses refreshed.');}
    catch(e){setAlert(err(e));}finally{setBusy('');}
  }
  async function simulate(){
    if(!picked||busy)return;
    setBusy('preview');setAlert('');setPreview(null);
    try{
      const answer=await copyAction<{previews:PreviewRow[]}>('fleet-preview',{
        id:picked.id,sourceLots:Number(lots),sourceEquity:Number(source?.broker_equity),
        entry:Number(entry),stop:Number(stop),direction:side,
      });
      setPreview(answer.previews);setNotice('Planning estimate only. Each follower independently recalculates risk and broker requirements before a demo or live order; no trade was submitted by this preview.');
    }catch(e){setAlert(err(e));}finally{setBusy('');}
  }
  return <section className="ym-cf" aria-label="Multi-account Copy Fleet control centre">
    <div className="ym-cf-head">
      <div>
        <span className="ym-cf-overline">COPY STUDIO / EXECUTION ROUTING</span>
        <h2>Copy Fleet</h2>
        <p>One verified MT5 source, up to 24 independently configured followers. Demo and live execution are separate, opt-in modes with account-bound permissions and broker-native sizing.</p>
      </div>
      <div className="ym-cf-head-actions">
        <button type="button" className="btn-secondary" disabled={!!busy} onClick={()=>void refresh()}><RefreshCw size={15}/>Refresh</button>
        <button type="button" className="ym-cf-kill" disabled={!!busy||!armed.length}
          onClick={()=>{if(window.confirm('EMERGENCY PAUSE all Copy Fleets? Queued work will be cancelled. Already dispatched MT5 orders may still complete.'))void act('fleet-pause-all',{},'All fleets paused. Check any orders already dispatched.');}}>
          <Square size={15}/>Emergency pause all
        </button>
      </div>
    </div>
    <div className="ym-cf-stats" aria-label="Copy Fleet overview">
      <div><small>Connected MT5 accounts</small><strong>{accounts.length}</strong><span>{accounts.filter(a=>a.trade_mode===2).length} live · {accounts.filter(a=>a.trade_mode===0).length} demo</span></div>
      <div><small>Saved copy fleets</small><strong>{status?.fleets.length||0}</strong><span>Source-to-many configurations</span></div>
      <div><small>Armed fleets</small><strong>{armed.length}</strong><span>{armed.filter(f=>f.execution_mode==='live').length} live · account-specific Windows consent</span></div>
      <div><small>Unresolved dispatches</small><strong>{status?.tasks.filter(t=>t.status==='dispatched'||t.status==='unknown').length||0}</strong><span>Never silently retried</span></div>
    </div>
    <div className="ym-cf-safety"><ShieldCheck size={18}/><span><strong>Execution is disabled by default.</strong> LIVE followers can place real broker orders and incur real losses. Every follower requires a matching Windows consent, fresh verification and MT5 preflight. Emergency pause cannot undo orders already sent; execution outcomes must be reconciled with the broker.</span></div>
    {alert&&<div className="ym-cs-feedback" data-kind="error" role="alert"><AlertTriangle size={16}/><span>{alert}</span><button type="button" onClick={()=>setAlert('')}>Dismiss</button></div>}
    {notice&&<div className="ym-cs-feedback" data-kind="success" role="status"><CheckCircle2 size={16}/><span>{notice}</span><button type="button" onClick={()=>setNotice('')}>Dismiss</button></div>}
    <div className="ym-cf-layout">
      <aside className="ym-cf-sidebar">
        <div className="ym-cf-smallhead"><strong>ROUTING DESKS</strong><button type="button" title="Create fleet" aria-label="Create fleet" disabled={!!busy} onClick={clear}><Plus size={16}/></button></div>
        {!status&&<p className="ym-cf-muted">Loading verified account connections…</p>}
        {status?.fleets.length===0&&<p className="ym-cf-muted">No fleets yet. Create one source and attach multiple follower accounts.</p>}
        {status?.fleets.map(f=><button type="button" key={f.id} data-active={selected===f.id} className="ym-cf-route" onClick={()=>edit(f)}>
          <span><strong>{f.name}</strong><small>{f.state==='demo_armed'?'ARMED · DEMO':f.state==='live_armed'?'ARMED · LIVE':'PAUSED · '+f.execution_mode.toUpperCase()}</small></span>
          <span className="ym-cf-route-sub">{f.targets.filter(t=>t.enabled).length} enabled / {f.targets.length} total followers</span>
        </button>)}
        <div className="ym-cf-source-note"><CircleHelp size={16}/> Different account balances are supported. Different account currencies require broker-native profit/loss valuation; equity-ratio mode deliberately rejects unverified cross-currency ratios.</div>
      </aside>
      <div className="ym-cf-body">
        <div className="ym-cf-smallhead"><strong>{picked?'CONFIGURE FLEET / REVISION '+picked.version:'NEW FLEET'}</strong><span>{picked?.state!=='paused'&&picked?'ARMED · LOCKED':'SAFE TO EDIT'}</span></div>
        <div className="ym-cf-fields">
          <label>Fleet name<input className="input-field" value={draft.name} maxLength={64} disabled={!!busy||(picked&&picked.state!=='paused')} placeholder="London desk · 4 linked accounts" onChange={e=>{setDraft(d=>({...d,name:e.target.value}));setPreview(null);}}/></label>
          <label>Execution environment<select className="input-field" value={draft.executionMode}
            disabled={!!busy||(picked&&picked.state!=='paused')} onChange={e=>{
              const mode=e.target.value as ExecutionMode;
              setDraft(d=>({...d,executionMode:mode,sourceLink:'',targets:[]}));setPreview(null);setMappingInputs({});
            }}><option value="demo">Demo — simulated funds</option><option value="live">Live — REAL MONEY</option></select></label>
          <label>MT5 source account<select className="input-field" value={draft.sourceLink} disabled={!!busy||(picked&&picked.state!=='paused')} onChange={e=>{setDraft(d=>({...d,sourceLink:e.target.value,targets:d.targets.filter(t=>t.link!==e.target.value)}));setPreview(null);}}>
            <option value="">Select source MT5 account</option>
            {accounts.filter(sourceAllowed).map(a=><option key={a.id} value={a.id}>{title(a)} · {a.trade_mode===2?"LIVE":"DEMO"}</option>)}
          </select></label>
        </div>
        <div className="ym-cf-smallhead ym-cf-target-header"><strong>FOLLOWER ALLOCATIONS</strong><span>{draft.targets.length} / 24</span></div>
        {draft.executionMode==='live'&&status&&!status.liveExecutionEnabled&&<p className="ym-cf-note" role="status"><strong>LIVE EXECUTION NOT ACTIVE:</strong> live-account configurations can be saved, but arming is disabled until a broker-tested release is explicitly enabled by the operator.</p>}
        {draft.executionMode==='live'&&<p className="ym-cf-note" role="note"><strong>REAL MONEY MODE:</strong> account-specific Windows authorization and broker verification are mandatory. Per-entry stop risk is capped at 2% of follower equity and configured daily loss at 5%. Markets can gap beyond stops, and costs may exceed estimates.</p>}
        {draft.targets.map((target,i)=>{
          const a=accounts.find(x=>x.id===target.link);
          const report=reports.get(target.link);
          const authorized=consent.get(target.link);
          const ready=Boolean(a&&permission(a,draft.executionMode)&&authorized?.demo_authorized&&authorized.authorization_mode===draft.executionMode&&Number(authorized.expires_at)>Date.now());
          return <div className="ym-cf-target" key={target.link}>
            <div className="ym-cf-target-top"><div><span className="ym-cf-index">{String(i+1).padStart(2,'0')}</span><strong>{title(a)}</strong><span className="ym-cf-tag" data-ready={ready}>{ready?'LOCAL CONSENT ACTIVE':a?.access_level==='trading-restricted'?'INVESTOR / READ-ONLY':'LOCAL CONSENT NEEDED'}</span></div>
              <button type="button" title="Remove follower" aria-label={'Remove follower '+title(a)} disabled={!!busy||(picked&&picked.state!=='paused')} onClick={()=>setDraft(d=>({...d,targets:d.targets.filter(t=>t.link!==target.link)}))}><X size={17}/></button>
            </div>
            <div className="ym-cf-target-controls">
              <label>Allocation method<select className="input-field" value={target.mode} disabled={!!busy||(picked&&picked.state!=='paused')} onChange={e=>mutate(target.link,{mode:e.target.value as RiskMode,value:1})}>
                {Object.entries(modeLabel).map(([k,v])=><option key={k} value={k}>{v}</option>)}
              </select></label>
              <label>{target.mode==='risk_pct_equity'?'Equity risk %':target.mode==='fixed_risk'?'Risk in '+(a?.currency||'account currency'):target.mode==='equity_ratio'?'Equity ratio factor':'Lots multiplier'}
                <input className="input-field" type="number" min="0.001" step="0.001" value={target.value} disabled={!!busy||(picked&&picked.state!=='paused')} onChange={e=>mutate(target.link,{value:Number(e.target.value)})}/>
              </label>
              <label>Lot ceiling<input className="input-field" type="number" min="0.01" max="100" step="0.01" value={target.maxLots} disabled={!!busy||(picked&&picked.state!=='paused')} onChange={e=>mutate(target.link,{maxLots:Number(e.target.value)})}/></label>
              <label>Daily loss cap %<input className="input-field" type="number" min="0.1" max="10" step="0.1" value={target.maxDailyLossPct} disabled={!!busy||(picked&&picked.state!=='paused')} onChange={e=>mutate(target.link,{maxDailyLossPct:Number(e.target.value)})}/></label>
            </div>
            <details className="ym-cf-symbol-mapping"><summary>Broker instrument mapping · optional</summary>
              <label htmlFor={'ym-cf-symbol-'+target.link}>Map source symbols to follower broker symbols</label>
              <input id={'ym-cf-symbol-'+target.link} className="input-field"
                placeholder="EURUSD=EURUSD.a, XAUUSD=GOLD"
                value={mappingInputs[target.link]??symbolMapText(target.symbolMap)}
                disabled={!!busy||(picked&&picked.state!=='paused')}
                aria-invalid={parseSymbolMapText(mappingInputs[target.link]??symbolMapText(target.symbolMap))===null}
                onChange={e=>{
                  const value=e.target.value;
                  setMappingInputs(prev=>({...prev,[target.link]:value}));
                  const parsed=parseSymbolMapText(value);
                  if(parsed!==null)mutate(target.link,{symbolMap:parsed});
                }}/>
              {parseSymbolMapText(mappingInputs[target.link]??symbolMapText(target.symbolMap))===null?
                <small role="alert">Use comma-separated SOURCE=FOLLOWER pairs with unique symbols.</small>:
                <small>Empty uses the same symbol. The connector never guesses broker suffixes.</small>}
            </details>
            <div className="ym-cf-target-footer"><label><input type="checkbox" checked={target.enabled} disabled={!!busy||(picked&&picked.state!=='paused')} onChange={e=>mutate(target.link,{enabled:e.target.checked})}/> Include follower</label>
              <label><input type="checkbox" checked={target.mirrorPending} disabled={!!busy||(picked&&picked.state!=='paused')} onChange={e=>mutate(target.link,{mirrorPending:e.target.checked})}/> Pending orders</label>
              <label><input type="checkbox" checked={target.mirrorProtection} disabled={!!busy||(picked&&picked.state!=='paused')} onChange={e=>mutate(target.link,{mirrorProtection:e.target.checked})}/> Mirror SL/TP</label>
              <span>{report?cash(report.account_equity,report.account_currency)+' equity':'Awaiting account telemetry'}</span></div>
          </div>;
        })}
        {draft.targets.length===0&&<div className="ym-cf-empty">Add a follower to set independent allocation, risk and order behaviour.</div>}
        <div className="ym-cf-target-add"><select aria-label="Add follower account" value="" disabled={!!busy||!draft.sourceLink||draft.targets.length>=24||(picked&&picked.state!=='paused')} onChange={e=>{
          if(!e.target.value)return;
          setDraft(d=>({...d,targets:[...d.targets,defaultTarget(e.target.value)]}));setPreview(null);
        }}><option value="">+ Add another follower</option>{remaining.filter(a=>a.trade_mode===expectedTradeMode).map(a=><option key={a.id} value={a.id}>{title(a)} · {draft.executionMode.toUpperCase()}</option>)}</select></div>
        <div className="ym-cf-actions">
          <button type="button" className="btn-primary" disabled={!!busy||!canSave||(picked&&picked.state!=='paused')} onClick={()=>void act('fleet-save',{
            ...draft, ...(picked?{id:picked.id,version:picked.version}:{})
          },'Fleet saved in paused state.')}><Save size={16}/>Save fleet</button>
          {picked?.state==='paused'&&<button type="button" className="btn-secondary" disabled={!!busy||!picked||(picked.execution_mode==='live'&&!status?.liveExecutionEnabled)} onClick={()=>{
            if(picked.execution_mode==='live'){
              const phrase='ARM LIVE '+picked.id.slice(0,8);
              const typed=window.prompt('REAL MONEY: live broker orders may be placed across all enabled followers. All accounts require separate local Windows authorization. A pause cannot undo already dispatched trades.\nType '+phrase+' to arm this fleet:', '');
              if(typed===phrase)void act('fleet-arm',{id:picked.id,version:picked.version,confirm:true,liveConfirmation:typed},'LIVE fleet armed. Monitor real broker executions.');
            }else if(window.confirm('Arm DEMO fleet? Only locally authorized demo followers will execute broker orders.')){
              void act('fleet-arm',{id:picked.id,version:picked.version,confirm:true},'Demo fleet armed.');
            }
          }}><Play size={16}/>Arm {picked.execution_mode==='live'?'LIVE · REAL MONEY':'demo'} fleet</button>}
          {(picked&&picked.state!=='paused')&&<button type="button" className="ym-cf-kill" disabled={!!busy} onClick={()=>void act('fleet-pause',{id:picked.id,version:picked.version},'Fleet paused.')}><PauseCircle size={16}/>Pause this fleet</button>}
        </div>
        {picked&&<div className="ym-cf-preview">
          <div className="ym-cf-smallhead"><strong>PRE-TRADE ALLOCATION PREVIEW</strong><span>BROKER PREFLIGHT FOLLOWS LOCALLY</span></div>
          <div className="ym-cf-preview-controls">
            <label>Side<select className="input-field" value={side} onChange={e=>setSide(e.target.value as 'buy'|'sell')}><option value="buy">BUY</option><option value="sell">SELL</option></select></label>
            <label>Source lots<input className="input-field" type="number" min="0.001" step="0.01" value={lots} onChange={e=>setLots(e.target.value)}/></label>
            <label>Entry<input className="input-field" type="number" step="any" value={entry} onChange={e=>setEntry(e.target.value)}/></label>
            <label>Stop loss<input className="input-field" type="number" step="any" value={stop} onChange={e=>setStop(e.target.value)}/></label>
            <button className="btn-secondary" type="button" disabled={!!busy||!source} onClick={()=>void simulate()}><ArrowDownUp size={15}/>Calculate</button>
          </div>
          <p className="ym-cf-note">Risk figures are estimated before execution. Actual risk depends on verified instrument specifications, fill price, conversion, fees and slippage; the follower terminal recalculates or rejects every order; live losses can exceed stops after gaps or slippage.</p>
          {preview&&<div className="ym-cf-table-scroll"><table className="ym-cf-table"><thead><tr><th>Follower</th><th>Policy</th><th>Risk budget</th><th>Lots</th><th>Broker proof</th></tr></thead>
            <tbody>{preview.map(row=><tr key={row.followerLink}><td>{title(accounts.find(a=>a.id===row.followerLink))}</td><td>{modeLabel[row.mode]}</td><td>{cash(row.plannedRiskBudget,row.accountCurrency)}</td><td>{row.indicativeLots==null?'Calculated by MT5':row.indicativeLots.toFixed(3)+' indicative'}</td><td>Required at execution</td></tr>)}</tbody>
          </table></div>}
        </div>}
      </div>
    </div>
    <div className="ym-cf-bottom">
      <div className="ym-cf-smallhead"><strong>ACCOUNT TELEMETRY</strong><span>FROM VERIFIED WINDOWS CONNECTORS</span></div>
      <div className="ym-cf-table-scroll"><table className="ym-cf-table"><thead><tr><th>Connected account</th><th>Equity</th><th>Free margin</th><th>Open trades</th><th>Pending</th><th>Last report</th></tr></thead><tbody>
        {accounts.map(a=>{const report=reports.get(a.id);return <tr key={a.id}><td>{title(a)}</td><td>{cash(report?.account_equity??a.broker_equity,a.currency)}</td><td>{cash(report?.margin_free,a.currency)}</td><td>{report?.open_positions??'—'}</td><td>{report?.pending_orders??'—'}</td><td>{report?new Date(report.observed_at_ms).toLocaleTimeString():'No report yet'}</td></tr>;})}
      </tbody></table></div>
      <div className="ym-cf-smallhead ym-cf-task-head"><strong>EXECUTION & RECONCILIATION LOG</strong><span>LAST 100 COMMANDS</span></div>
      {status?.tasks.length===0?<div className="ym-cf-empty">No execution instructions yet. An armed fleet must first observe a fresh, actionable source change.</div>:
        <div className="ym-cf-table-scroll"><table className="ym-cf-table"><thead><tr><th>Time</th><th>Follower</th><th>Action</th><th>Status</th><th>Lots</th><th>Initial SL risk</th><th>Equity risk</th><th>Broker</th></tr></thead><tbody>
          {status?.tasks.map(task=><tr key={task.id}><td>{new Date(task.created_at).toLocaleTimeString()}</td><td>{title(accounts.find(a=>a.id===task.follower_link))}</td><td>{task.action.split('_').join(' ')}</td><td><span className="ym-cf-task-status" data-state={task.status}>{task.status}</span></td><td>{task.result_payload?.lots?.toFixed(2)??'—'}</td>
              <td>{cash(task.result_payload?.risk_amount,task.result_payload?.account_currency)}</td>
              <td>{task.result_payload?.risk_pct_equity==null?'—':task.result_payload.risk_pct_equity.toFixed(2)+'%'}</td>
              <td>{task.result_code||task.retcode||'—'}</td></tr>)}</tbody>
        </table></div>}
    </div>
  </section>;
}
