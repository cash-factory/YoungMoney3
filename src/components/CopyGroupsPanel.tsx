import {useCallback,useEffect,useState,type FormEvent} from 'react';
import {AlertTriangle,CheckCircle2,ChevronDown,ChevronUp,FlaskConical,Plus,RefreshCw,Save,ShieldCheck,Trash2,Users} from 'lucide-react';
import {copyAction,type CopyAccount} from '@/lib/copyStudio';
import {announceAction} from '@/lib/actionFeedback';

type Mode='equity_percentage'|'balance_percentage'|'fixed_amount'|'balance_ratio'|'lot_multiplier';
type Follower={link:string;mode:Mode;value:number;maxLots:number;maxRiskPct:number};
type Group={id:string;name:string;source_link:string;followers:Follower[];state:'paused';version:number};
type GroupStatus={executionEnabled:false;mode:'planning-only';maximumFollowers:number;accounts:CopyAccount[];groups:Group[]};
type PreviewRow={link:string;currency:string|null;mode:Mode;indicativeLots:number;requestedLots:number;estimatedLoss:number;estimatedRiskPct:number;capped:boolean;unavailable:boolean;lossPerLotAssumed:number};
type GroupPreview={simulation:true;brokerValidated:false;executionEnabled:false;state:'paused';accountCount:number;results:PreviewRow[];warnings:string[]};

const modes:{value:Mode;label:string;hint:string}[]=[
  {value:'equity_percentage',label:'% of equity',hint:'Risk a percentage of current follower equity'},
  {value:'balance_percentage',label:'% of balance',hint:'Risk a percentage of follower account balance'},
  {value:'fixed_amount',label:'Fixed currency risk',hint:'Risk a specified amount in the follower account currency'},
  {value:'balance_ratio',label:'Balance proportion',hint:'Source lots × follower/source balance ratio × scale'},
  {value:'lot_multiplier',label:'Lot multiplier',hint:'Source lots × factor, subject to capital risk ceiling'},
];
const initial=(link:string):Follower=>({link,mode:'equity_percentage',value:1,maxLots:1,maxRiskPct:2});
const name=(account:CopyAccount)=>[account.company||account.server||'Broker',account.login||account.id.slice(0,8)].join(' · ');
const cap=(v:number)=>Number.isFinite(v)?v.toLocaleString(undefined,{maximumFractionDigits:2}):'—';

export function CopyGroupsPanel({accounts}:{accounts:CopyAccount[]}) {
 const [groups,setGroups]=useState<Group[]>([]);
 const [selected,setSelected]=useState<string|null>(null);
 const [label,setLabel]=useState('Multi-account copy plan');
 const [source,setSource]=useState('');
 const [followers,setFollowers]=useState<Follower[]>([]);
 const [loss,setLoss]=useState<Record<string,string>>({});
 const [sourceLots,setSourceLots]=useState('0.10');
 const [expanded,setExpanded]=useState(true);
 const [busy,setBusy]=useState('');
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const [preview,setPreview]=useState<GroupPreview|null>(null);
 const [dirty,setDirty]=useState(false);
 const reload=useCallback(async()=>{
   const status=await copyAction<GroupStatus>('group-status');
   setGroups(status.groups);
 },[]);
 useEffect(()=>{void reload().catch(e=>setError(e instanceof Error?e.message:'Could not load multi-follower plans.'));},[reload]);
 const chosen=groups.find(x=>x.id===selected);
 const select=(group:Group)=>{
   setSelected(group.id);setLabel(group.name);setSource(group.source_link);
   setFollowers(group.followers.map(f=>({...f})));setLoss({});
   setPreview(null);setDirty(false);setError('');setNotice('');
   setExpanded(true);
 };
 const reset=()=>{
   setSelected(null);setLabel('Multi-account copy plan');setSource('');
   setFollowers([]);setLoss({});setPreview(null);setDirty(false);setError('');setNotice('');
   setExpanded(true);
 };
 const edit=(updates:Partial<Follower>,link:string)=>{
   setFollowers(current=>current.map(item=>item.link===link?{...item,...updates}:item));
   setDirty(true);setPreview(null);
 };
 const toggle=(link:string)=>{
   setFollowers(current=>current.some(item=>item.link===link)?
     current.filter(item=>item.link!==link):[...current,initial(link)]);
   setDirty(true);setPreview(null);
 };
 const save=async(e:FormEvent)=>{
   e.preventDefault();if(busy||!source||followers.length===0||dirty&&chosen?.state!=='paused')return;
   setBusy('save');setError('');setNotice('');
   try{
     const response=await copyAction<{ok:true;id:string}>('group-save',{
       name:label,sourceLink:source,followers,
       ...(chosen?{id:chosen.id,version:chosen.version}:{})
     });
     const status=await copyAction<GroupStatus>('group-status');
     setGroups(status.groups);
     const item=status.groups.find(row=>row.id===response.id);
     if(item)select(item);
     setNotice('Multi-follower policies saved as paused plans. No broker orders were sent.');
     announceAction('success','Copy group saved.');
   }catch(e){const message=e instanceof Error?e.message:'Save failed';setError(message);announceAction('error',message);}
   finally{setBusy('');}
 };
 const run=async()=>{
   if(!chosen||dirty||busy)return;
   setBusy('preview');setError('');setNotice('');setPreview(null);
   try{
     const hypothetical=Object.fromEntries(chosen.followers.map(f=>[f.link,Number(loss[f.link])]));
     const response=await copyAction<GroupPreview>('group-preview',{
       id:chosen.id,sourceLots:Number(sourceLots),lossPerLot:hypothetical
     });
     setPreview(response);setNotice('Portfolio preview ready. Loss-per-lot values are assumptions, not broker quotes.');
   }catch(e){setError(e instanceof Error?e.message:'Preview could not be calculated.');}
   finally{setBusy('');}
 };
 const remove=async()=>{
   if(!chosen||busy||!window.confirm('Delete the paused copy group? MT5 accounts and journal trades are unaffected.'))return;
   setBusy('delete');setError('');
   try{
     await copyAction('group-delete',{id:chosen.id,version:chosen.version});
     await reload();reset();setNotice('Paused copy group deleted. No broker orders were changed.');
   }catch(e){setError(e instanceof Error?e.message:'Delete failed.');}
   finally{setBusy('');}
 };
 return <section className="card ym-cs-groups" aria-label="Multi-follower copy planning">
   <div className="ym-cs-section-title">
     <div><span className="ym-cs-eyebrow">MULTI-ACCOUNT / RISK OPERATIONS</span><h2>Copy network</h2></div>
     <span className="ym-cs-state"><ShieldCheck size={15}/> Paused planning</span>
   </div>
   <p className="ym-cs-context">Configure a source and multiple destination accounts independently. Each follower has its own capital, risk basis and maximum trade size. Market, limit, stop and stop-limit order execution will require a separately approved demo agent and verified broker calculations.</p>
   <div className="ym-cs-group-toolbar">
     <select className="input-field" aria-label="Choose existing copy network" value={selected||''} onChange={e=>{
       const item=groups.find(g=>g.id===e.target.value);if(item)select(item);else reset();
     }}><option value="">New network plan</option>{groups.map(item=><option key={item.id} value={item.id}>{item.name} · {item.followers.length} followers</option>)}</select>
     <button type="button" className="btn-secondary" onClick={reset} disabled={!!busy}><Plus size={15}/> New network</button>
     <button type="button" className="btn-secondary" onClick={()=>setExpanded(!expanded)} aria-expanded={expanded}>
       {expanded?<ChevronUp size={16}/>:<ChevronDown size={16}/>} {expanded?'Collapse':'Expand'}
     </button>
   </div>
   {error&&<div className="ym-cs-feedback" data-kind="error" role="alert"><AlertTriangle size={16}/>{error}</div>}
   {notice&&<div className="ym-cs-feedback" data-kind="success" role="status"><CheckCircle2 size={16}/>{notice}</div>}
   {expanded&&<>
     <form className="ym-cs-group-form" onSubmit={e=>void save(e)}>
       <div className="ym-cs-account-grid">
         <label className="ym-cs-field">Network name
           <input className="input-field" value={label} minLength={2} maxLength={64} required disabled={!!busy}
             onChange={e=>{setLabel(e.target.value);setDirty(true);setPreview(null);}}/>
         </label>
         <label className="ym-cs-field">Source account
           <select className="input-field" value={source} required disabled={!!busy} onChange={e=>{
             setSource(e.target.value);setFollowers(list=>list.filter(f=>f.link!==e.target.value));
             setDirty(true);setPreview(null);
           }}><option value="">Choose a verified demo</option>
             {accounts.map(account=><option key={account.id} value={account.id}>{name(account)} · {account.currency||'unknown'}</option>)}
           </select>
         </label>
       </div>
       <div className="ym-cs-section-title"><div><span className="ym-cs-eyebrow">DESTINATION ROUTES</span><h3>Follower accounts <small>({followers.length} / 20)</small></h3></div><Users size={18}/></div>
       <div className="ym-cs-follower-select">
         {accounts.filter(a=>a.id!==source).map(account=><label key={account.id} className="ym-cs-route-choice" data-selected={followers.some(f=>f.link===account.id)}>
           <input type="checkbox" checked={followers.some(f=>f.link===account.id)} disabled={!!busy||(!followers.some(f=>f.link===account.id)&&followers.length>=20)}
             onChange={()=>toggle(account.id)}/>
           <span><strong>{name(account)}</strong><small>{account.currency||'Currency unknown'} · {account.access_level==='trading-enabled'?'Broker trading permitted':'Trading restricted'}</small></span>
         </label>)}
       </div>
       {followers.map((f,index)=>{
         const account=accounts.find(a=>a.id===f.link);
         if(!account)return null;
         const chosenMode=modes.find(m=>m.value===f.mode)!;
         return <div className="ym-cs-follower-policy" key={f.link}>
           <div className="ym-cs-follower-policy-head">
             <div><span className="ym-cs-eyebrow">FOLLOWER {String(index+1).padStart(2,'0')}</span>
               <strong>{name(account)}</strong>
               <small>Equity {cap(account.broker_equity||0)} · Balance {cap(account.broker_balance||0)} {account.currency||''}</small>
             </div>
             <button type="button" className="btn-secondary" onClick={()=>toggle(f.link)} disabled={!!busy}>Remove</button>
           </div>
           <div className="ym-cs-policy-fields">
             <label className="ym-cs-field">Sizing basis
               <select className="input-field" value={f.mode} disabled={!!busy}
                 onChange={e=>edit({mode:e.target.value as Mode},f.link)}>
                 {modes.map(mode=><option key={mode.value} value={mode.value}>{mode.label}</option>)}
               </select>
             </label>
             <label className="ym-cs-field">Value {f.mode==='fixed_amount'?'('+account.currency+')':f.mode.includes('percentage')?'(%)':'(×)'}
               <input type="number" className="input-field" min=".000001" max={f.mode.includes('percentage')?10:f.mode==='fixed_amount'?1000000:5} step="any" value={f.value}
                 disabled={!!busy} onChange={e=>edit({value:Number(e.target.value)},f.link)} required/>
             </label>
             <label className="ym-cs-field">Max lots
               <input type="number" className="input-field" min=".01" max="50" step=".01" value={f.maxLots}
                 disabled={!!busy} onChange={e=>edit({maxLots:Number(e.target.value)},f.link)} required/>
             </label>
             <label className="ym-cs-field">Max order risk (% equity)
               <input type="number" className="input-field" min=".1" max="10" step=".1" value={f.maxRiskPct}
                 disabled={!!busy} onChange={e=>edit({maxRiskPct:Number(e.target.value)},f.link)} required/>
             </label>
           </div>
           <p className="ym-cs-help">{chosenMode.hint}. Actual lot step, conversion, margin and SL distance are checked by the local MT5 planner, not this browser editor.</p>
         </div>;
       })}
       <div className="ym-cs-form-actions">
         <button className="btn-primary" type="submit" disabled={!source||!followers.length||!!busy||label.trim().length<2}>
           {busy==='save'?<RefreshCw size={15} className="animate-spin"/>:<Save size={15}/>}
           {busy==='save'?'Saving…':selected?'Save network revisions':'Save paused network'}
         </button>
         {selected&&<button type="button" className="btn-secondary" disabled={!!busy} onClick={()=>void remove()}><Trash2 size={15}/> Delete</button>}
       </div>
     </form>
     <section className="ym-cs-network-preview" aria-label="Follower portfolio risk preview">
       <div className="ym-cs-section-title"><div><span className="ym-cs-eyebrow">PORTFOLIO / SCENARIO</span><h3>Per-follower risk projection</h3></div><FlaskConical size={18}/></div>
       <p className="ym-cs-help">Enter an illustrative monetary loss per <strong>1 lot</strong> at the protective SL in each follower's own account currency. This is a scenario calculator, not an MT5-verified quote. The real execution agent must calculate this itself from broker order_calc_profit.</p>
       <div className="ym-cs-policy-fields">
         <label className="ym-cs-field">Source position (lots)
           <input type="number" className="input-field" value={sourceLots} min=".01" max="100" step=".01" onChange={e=>{setSourceLots(e.target.value);setPreview(null);}}/>
         </label>
       </div>
       <div className="ym-cs-loss-fields">{followers.map(f=>{
         const account=accounts.find(a=>a.id===f.link);
         return <label className="ym-cs-field" key={f.link}>{account?name(account):f.link} · assumed SL loss / lot ({account?.currency||'account currency'})
           <input type="number" className="input-field" min=".000001" step="any" placeholder="e.g. 100.00" value={loss[f.link]||''}
             onChange={e=>{setLoss(old=>({...old,[f.link]:e.target.value}));setPreview(null);}}/>
         </label>;
       })}</div>
       <button type="button" className="btn-secondary" onClick={()=>void run()} disabled={!chosen||dirty||!!busy||followers.some(f=>!(Number(loss[f.link])>0))}>
         {busy==='preview'?<RefreshCw size={15} className="animate-spin"/>:<FlaskConical size={15}/>} Calculate portfolio preview
       </button>
       {dirty&&chosen&&<p className="ym-cs-help">Save the edited group before previewing it.</p>}
       {preview&&<div className="ym-cs-group-results" role="status" aria-live="polite">
         <div className="ym-cs-group-results-header"><strong>{preview.accountCount} follower outcomes</strong><span>No orders placed · assumptions only</span></div>
         <div className="ym-cs-results-grid">{preview.results.map(row=>{
           const account=accounts.find(a=>a.id===row.link);
           return <article key={row.link}>
             <strong>{account?name(account):row.link}</strong>
             <span className="ym-cs-result-lots">{row.unavailable?'Below assumed 0.01 minimum':row.indicativeLots.toFixed(2)+' lots'}</span>
             <small>Projected stop loss <b>{cap(row.estimatedLoss)} {row.currency}</b></small>
             <small>Equity at risk <b>{row.estimatedRiskPct.toFixed(2)}%</b></small>
             {row.capped&&<small>Limited by follower risk/lot policy</small>}
           </article>;
         })}</div>
         <p className="ym-cs-help"><AlertTriangle size={14}/> These results do not validate MT5 volume steps, conversions, margin, entry fills or protective stops. They cannot activate copying.</p>
       </div>}
     </section>
   </>}
 </section>;
}