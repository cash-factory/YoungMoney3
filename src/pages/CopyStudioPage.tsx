import { CopyFleetConsole } from '@/components/CopyFleetConsole';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ArrowRightLeft, CheckCircle2, FlaskConical, LockKeyhole, PauseCircle, Plus, RefreshCw, Save, ShieldCheck, Trash2, AlertTriangle, CircleHelp } from 'lucide-react';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { announceAction } from '@/lib/actionFeedback';
import {
  copyAction, draftFromProfile, emptyCopyDraft,
  type CopyAccount, type CopyDraft, type CopyProfile, type CopySimulation, type CopyStatus,
} from '@/lib/copyStudio';

const accountTitle=(account:CopyAccount)=>(account.company || account.server || 'MT5 demo')+' · '+(account.login || account.id.slice(0,8));
const labelDate=(iso:string)=>Number.isFinite(Date.parse(iso))?new Date(iso).toLocaleString():'Unknown';
const errorText=(error:unknown)=>error instanceof Error?error.message:'The request failed. Please retry.';
const initialSourceLots='0.10';
const profileDraftChanged=(form:CopyDraft,item:CopyProfile)=>
  Object.keys(form).some(key=>form[key as keyof CopyDraft]!==draftFromProfile(item)[key as keyof CopyDraft]);

export function CopyStudioPage() {
  const [status,setStatus]=useState<CopyStatus|null>(null);
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const [form,setForm]=useState<CopyDraft>(emptyCopyDraft);
  const [sourceLots,setSourceLots]=useState(initialSourceLots);
  const [simulation,setSimulation]=useState<CopySimulation|null>(null);
  const [busy,setBusy]=useState<string|null>(null);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const refresh=useCallback(async()=>{
    const result=await copyAction<CopyStatus>('status');
    setStatus(result);
  },[]);
  useEffect(()=>{
    let active=true;
    copyAction<CopyStatus>('status').then(data=>{if(active)setStatus(data);})
      .catch(err=>{if(active)setError(errorText(err));});
    return()=>{active=false;};
  },[]);
  const profile=status?.profiles.find(item=>item.id===selectedId);
  const dirty=profile?profileDraftChanged(form,profile):false;
  const accounts=status?.accounts||[];
  const source=accounts.find(item=>item.id===form.sourceLink);
  const follower=accounts.find(item=>item.id===form.followerLink);
  const canSave=Boolean(form.name.trim().length>=2 && source && follower && source.id!==follower.id &&
    form.multiplier>=0.1 && form.multiplier<=3 &&
    form.maxFollowerLots>=0.01 && form.maxFollowerLots<=50 &&
    form.maxDailyLossPct>=0.25 && form.maxDailyLossPct<=10);
  const update=<K extends keyof CopyDraft>(key:K,value:CopyDraft[K])=>{
    setForm(previous=>({...previous,[key]:value}));setSimulation(null);setNotice('');
  };
  const select=(item:CopyProfile)=>{
    setSelectedId(item.id);setForm(draftFromProfile(item));setSimulation(null);
    setSourceLots(initialSourceLots);setError('');setNotice('');
  };
  const newDraft=()=>{
    setSelectedId(null);setForm(emptyCopyDraft());setSimulation(null);
    setSourceLots(initialSourceLots);setError('');setNotice('');
  };
  async function save(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(busy || !canSave)return;
    setBusy('save');setError('');setNotice('');
    try{
      const response=await copyAction<{ok:true;id:string;version:number;state:'paused'}>('save',{
        ...form,
        ...(profile?{id:profile.id,version:profile.version}:{}),
      });
      const latest=await copyAction<CopyStatus>('status');
      setStatus(latest);setSelectedId(response.id);
      const updated=latest.profiles.find(item=>item.id===response.id);
      if(updated)setForm(draftFromProfile(updated));
      setSimulation(null);
      setNotice('Simulation draft saved. It remains paused; no broker orders will be placed.');
      announceAction('success','Copy Studio draft saved.');
    }catch(err){setError(errorText(err));announceAction('error','Copy Studio draft could not be saved.');}
    finally{setBusy(null);}
  }
  async function simulate(){
    if(busy || !profile || dirty)return;
    setBusy('simulate');setError('');setNotice('');setSimulation(null);
    try{
      const answer=await copyAction<CopySimulation>('simulate',{id:profile.id,sourceLots:Number(sourceLots)});
      setSimulation(answer);
      setNotice('Indicative position size calculated. No execution request was created.');
      announceAction('success','Simulation completed without placing an order.');
    }catch(err){setError(errorText(err));}
    finally{setBusy(null);}
  }
  async function remove(){
    if(!profile||busy)return;
    if(!window.confirm('Delete this simulation draft? This does not affect your MT5 accounts or trades.'))return;
    setBusy('delete');setError('');setNotice('');
    try{
      await copyAction<{ok:true}>('delete',{id:profile.id,version:profile.version});
      await refresh();newDraft();setNotice('Draft deleted. Your connected accounts and journal entries were not changed.');
      announceAction('success','Copy Studio draft deleted.');
    }catch(err){setError(errorText(err));}
    finally{setBusy(null);}
  }
  async function reload(){
    if(busy)return;setBusy('refresh');setError('');
    try{
      const latest=await copyAction<CopyStatus>('status');setStatus(latest);
      if(selectedId){
        const match=latest.profiles.find(item=>item.id===selectedId);
        if(match){setForm(draftFromProfile(match));setSimulation(null);}
        else newDraft();
      }
      setNotice('Copy Studio information refreshed.');
    }catch(err){setError(errorText(err));}
    finally{setBusy(null);}
  }

  return <main className="ym-copy-studio space-y-5">
    <SectionHeader title="Copy Studio" subtitle="Multi-account copy execution and broker-aware sizing, with independently controlled demo followers."
      action={<button type="button" className="btn-secondary inline-flex items-center gap-2" onClick={()=>void reload()} disabled={!!busy} aria-label="Refresh Copy Studio">
        <RefreshCw size={15} className={busy==='refresh'?'animate-spin':''}/> Refresh
      </button>}/>
    <CopyFleetConsole/>
    <div className="ym-cf-legacy-heading"><span>LEGACY / PAUSED SIMULATIONS</span><p>Your existing two-account sizing drafts remain available below. They cannot execute broker orders.</p></div>
    <section className="ym-cs-identity" aria-label="Execution protection">
      <span className="ym-cs-identity-icon"><LockKeyhole size={21}/></span>
      <div className="ym-cs-identity-text"><strong>Simulation-only workspace</strong><span>Execution is disabled at the API and database level. No copy agent, trading permissions or broker order routing are enabled here.</span></div>
      <span className="ym-cs-lock-status"><PauseCircle size={16}/> All plans paused</span>
    </section>

    {error&&<div className="ym-cs-feedback" data-kind="error" role="alert"><AlertTriangle size={18}/><span>{error}</span><button type="button" onClick={()=>setError('')}>Dismiss</button></div>}
    {notice&&<div className="ym-cs-feedback" data-kind="success" role="status"><CheckCircle2 size={18}/><span>{notice}</span><button type="button" onClick={()=>setNotice('')}>Dismiss</button></div>}

    <section className="ym-cs-metrics" aria-label="Copy Studio summary">
      <div><span>Connected demos</span><strong>{accounts.length}</strong><small>Verified MT5 demo links</small></div>
      <div><span>Saved plans</span><strong>{status?.profiles.length||0}</strong><small>Configurations only</small></div>
      <div><span>Execution</span><strong>Off</strong><small>Independent hard block</small></div>
    </section>

    <div className="ym-cs-workspace">
      <aside className="card ym-cs-saved" aria-label="Saved simulation drafts">
        <div className="ym-cs-section-title"><div><span className="ym-cs-eyebrow">YOUR SIMULATIONS</span><h2>Saved plans</h2></div>
          <button type="button" className="ym-cs-square-button" title="New draft" aria-label="Create a new simulation draft" onClick={newDraft}><Plus size={18}/></button>
        </div>
        {!status&&!error&&<p className="text-secondary text-sm">Loading your account information…</p>}
        {status?.profiles.length===0&&<div className="ym-cs-empty"><FlaskConical size={25}/><strong>No simulation drafts</strong><p>Select two of your connected demo accounts to build your first sizing preview.</p></div>}
        <div className="ym-cs-profile-list">
          {status?.profiles.map(item=>{
            const selected=item.id===selectedId;
            const from=accounts.find(account=>account.id===item.source_link);
            const to=accounts.find(account=>account.id===item.follower_link);
            return <button type="button" key={item.id} className="ym-cs-profile" data-selected={selected} aria-pressed={selected} onClick={()=>select(item)}>
              <span className="ym-cs-profile-head"><strong>{item.name}</strong><span>PAUSED</span></span>
              <span className="ym-cs-profile-route">{from?.login||'Source unavailable'} <ArrowRightLeft size={13}/> {to?.login||'Follower unavailable'}</span>
              <span className="ym-cs-profile-foot">{item.multiplier.toFixed(2)}× size · Max {item.max_follower_lots.toFixed(2)} lots</span>
            </button>;
          })}
        </div>
        <details className="ym-cs-details"><summary><CircleHelp size={15}/> What will Copy Studio eventually do?</summary>
          <p>Future phases require separate permissions, an authenticated execution agent, reconciliation, instrument specifications, latency checks and risk enforcement. None are active in this release.</p>
        </details>
      </aside>

      <section className="card ym-cs-editor" aria-label="Simulation configuration">
        <div className="ym-cs-section-title"><div><span className="ym-cs-eyebrow">01 / SOURCE & FOLLOWER</span><h2>{profile?'Edit simulation':'New simulation'}</h2></div>
          <span className="ym-cs-state"><PauseCircle size={15}/> Paused</span>
        </div>
        {accounts.length<2&&status?<div className="ym-cs-callout" role="status"><AlertTriangle size={20}/><div><strong>Two connected demo accounts needed</strong><p>Link two separate MT5 demo accounts before configuring a copy relationship. Real accounts and pending connections are excluded.</p><a href="#mt5">Open MT5 Connections</a></div></div>:null}
        <form onSubmit={event=>void save(event)} className="ym-cs-form">
          <label className="ym-cs-field ym-cs-name">Plan name
            <input className="input-field" required minLength={2} maxLength={64} value={form.name} placeholder="Demo EURUSD sizing test" disabled={!!busy}
              onChange={event=>update('name',event.target.value)}/>
          </label>
          <div className="ym-cs-account-grid">
            <label className="ym-cs-field"><span className="ym-cs-field-label">Source account <small>Observed trades</small></span>
              <select className="input-field" value={form.sourceLink} disabled={!!busy} onChange={event=>update('sourceLink',event.target.value)}>
                <option value="">Choose a demo source</option>
                {accounts.map(account=><option key={account.id} value={account.id}>{accountTitle(account)} ({account.currency||'currency unknown'})</option>)}
              </select>
            </label>
            <label className="ym-cs-field"><span className="ym-cs-field-label">Follower account <small>Hypothetical target</small></span>
              <select className="input-field" value={form.followerLink} disabled={!!busy} onChange={event=>update('followerLink',event.target.value)}>
                <option value="">Choose a demo follower</option>
                {accounts.map(account=><option key={account.id} value={account.id} disabled={account.id===form.sourceLink}>{accountTitle(account)} ({account.currency||'currency unknown'})</option>)}
              </select>
            </label>
          </div>
          {follower&&<p className="ym-cs-context">Follower account permission: <strong>{follower.access_level==='trading-enabled'?'Trading enabled':follower.access_level==='trading-restricted'?'Read-only / restricted':'Unverified'}</strong>. This does not grant Copy Studio permission to place orders.</p>}
          {source&&follower&&source.currency&&follower.currency&&source.currency!==follower.currency&&
            <p className="ym-cs-warning" role="alert">Different account currencies need explicit conversion and risk validation. Save is blocked for this first release.</p>}
          <div className="ym-cs-divider"/>
          <div className="ym-cs-section-title"><div><span className="ym-cs-eyebrow">02 / POSITION LIMITS</span><h3>Sizing guardrails</h3></div><ShieldCheck size={19}/></div>
          <div className="ym-cs-controls">
            <label className="ym-cs-field">Size multiplier
              <div className="ym-cs-number"><input type="number" inputMode="decimal" min="0.1" max="3" step="0.1" required value={form.multiplier} disabled={!!busy}
                onChange={event=>update('multiplier',Number(event.target.value))}/><span>×</span></div>
              <small className="ym-cs-help">1.0× = same nominal lot size</small>
            </label>
            <label className="ym-cs-field">Maximum follower size
              <div className="ym-cs-number"><input type="number" inputMode="decimal" min="0.01" max="50" step="0.01" required value={form.maxFollowerLots} disabled={!!busy}
                onChange={event=>update('maxFollowerLots',Number(event.target.value))}/><span>lots</span></div>
              <small className="ym-cs-help">Preview cap only; not broker-validated</small>
            </label>
            <label className="ym-cs-field">Planned daily loss ceiling
              <div className="ym-cs-number"><input type="number" inputMode="decimal" min="0.25" max="10" step="0.25" required value={form.maxDailyLossPct} disabled={!!busy}
                onChange={event=>update('maxDailyLossPct',Number(event.target.value))}/><span>%</span></div>
              <small className="ym-cs-help">Stored intention; not actively enforced</small>
            </label>
          </div>
          <div className="ym-cs-form-actions">
            <button className="btn-primary" type="submit" disabled={!canSave||!!busy||Boolean(source&&follower&&source.currency&&follower.currency&&source.currency!==follower.currency)}>
              {busy==='save'?<RefreshCw size={16} className="animate-spin"/>:<Save size={16}/>} {busy==='save'?'Saving…':profile?'Save changes':'Save paused draft'}
            </button>
            {profile&&<button type="button" className="btn-secondary" disabled={!!busy} onClick={()=>void remove()}><Trash2 size={15}/> Delete draft</button>}
          </div>
        </form>
      </section>
    </div>

    <section className="card ym-cs-preview" aria-label="Indicative copy simulation">
      <header className="ym-cs-preview-header"><div><span className="ym-cs-eyebrow">03 / DRY RUN</span><h2>Position-size preview</h2><p>Explore one hypothetical source volume. No MT5 data is modified and no order is sent.</p></div><span className="ym-cs-sim-badge"><FlaskConical size={15}/> DRY RUN</span></header>
      <div className="ym-cs-simulator">
        <label className="ym-cs-field">Hypothetical source size (lots)
          <div className="ym-cs-number"><input type="number" inputMode="decimal" value={sourceLots} min="0.01" max="100" step="0.01" onChange={event=>{setSourceLots(event.target.value);setSimulation(null);}} disabled={!!busy}/><span>lots</span></div>
        </label>
        <button type="button" className="btn-primary" disabled={!profile||!!busy||dirty||!(Number(sourceLots)>=0.01)} onClick={()=>void simulate()}>
          {busy==='simulate'?<RefreshCw size={16} className="animate-spin"/>:<FlaskConical size={16}/>} Run simulation
        </button>
        {dirty&&<p className="ym-cs-warning" role="status">Save your revised settings before running this preview.</p>}
        {!profile&&<p className="ym-cs-help">Save or select a simulation draft to activate the calculator.</p>}
      </div>
      {simulation&&<div className="ym-cs-result" role="status" aria-live="polite">
        <div><span>Source position</span><strong>{simulation.sourceLots.toFixed(2)} <small>lots</small></strong></div>
        <div><span>Uncapped estimate</span><strong>{simulation.uncappedLots.toFixed(2)} <small>lots</small></strong></div>
        <div data-highlight><span>Indicative follower</span><strong>{simulation.indicativeFollowerLots.toFixed(2)} <small>lots</small></strong><small>{simulation.cappedByPolicy?'Capped by your draft limit':'Within your draft limit'}</small></div>
        <p><ShieldCheck size={16}/> Read-only estimate. Broker lot steps, margin, symbol compatibility and daily P/L were not verified.</p>
      </div>}
    </section>

    <details className="ym-cs-disclosure">
      <summary><CircleHelp size={17}/> Safety, audit and feature boundaries</summary>
      <div className="ym-cs-disclosure-grid">
        <div><h3>What works</h3><p>Owner-only demo-account pairing, paused draft configuration, optimistic version checks, append-only changes audit and an indicative lot calculator.</p></div>
        <div><h3>What does not execute</h3><p>No trade copier, EA, execution-agent permissions, broker symbol mapping, margin check, hard daily-loss enforcement or order placement exists in this release.</p></div>
        <div><h3>Recent changes</h3>
          {status?.events.length? <ul>{status.events.slice(0,5).map((item,index)=><li key={item.profile_id+'-'+index}>{item.event} · {labelDate(item.created_at)}</li>)}</ul> : <p>No saved configuration changes yet.</p>}
        </div>
      </div>
    </details>
  </main>;
}
