import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, Copy, KeyRound, LockKeyhole, RefreshCw, ShieldCheck, UserRoundCheck, UserRoundX } from 'lucide-react';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { useAuth } from '@/context/AuthContext';

type Member={id:string;email:string;username?:string;display_name?:string;role?:string;account_status?:'active'|'suspended';created_at:string;trade_count:number;plan_count:number};
type Audit={id:string;action:string;outcome:string;target_user_id?:string;created_at:string;metadata?:Record<string,unknown>};
type Overview={users?:{total:number;members:number;suspended:number};devices?:{total:number;active:number};links?:{total:number;connected:number};signupPaused:boolean;mt5CapturePaused:boolean;latestAdminActionAt?:string|null;database:string;backupAutomation:string};
type Recovery={code:string;email:string;expires_at:string};
async function adminCall(payload:Record<string,unknown>):Promise<Record<string,unknown>> {
  const response=await fetch('/api/admin',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
  const data=await response.json() as Record<string,unknown>;
  if(!response.ok)throw Error(String(data.error||'Administration service unavailable.'));
  return data;
}
export function AdminOperationsPage(){
  const {user,profile}=useAuth();
  const [members,setMembers]=useState<Member[]>([]);
  const [audit,setAudit]=useState<Audit[]>([]);
  const [overview,setOverview]=useState<Overview|null>(null);
  const [query,setQuery]=useState('');
  const [password,setPassword]=useState('');
  const [mt5Password,setMt5Password]=useState('');
  const [recovery,setRecovery]=useState<Recovery|null>(null);
  const [busy,setBusy]=useState<string|null>(null);
  const [loading,setLoading]=useState(true);
  const [feedback,setFeedback]=useState<{error?:string;success?:string}>({});
  const load=useCallback(async()=>{
    setLoading(true);
    try{
      const [list,events,system]=await Promise.all([adminCall({action:'list'}),adminCall({action:'audit'}),adminCall({action:'overview'})]);
      setMembers(Array.isArray(list.members)?list.members as Member[]:[]);
      setAudit(Array.isArray(events.entries)?events.entries as Audit[]:[]);
      setOverview(system as unknown as Overview);
    }catch(e){setFeedback({error:e instanceof Error?e.message:'Could not load administrative data.'});}
    finally{setLoading(false);}
  },[]);
  useEffect(()=>{void load();},[load]);
  const shown=useMemo(()=>members.filter(member=>[member.email,member.username,member.display_name].some(x=>x?.toLowerCase().includes(query.toLowerCase()))),[members,query]);
  if(profile?.role!=='admin'||profile.account_status!=='active')return <p role="alert" className="card p-5">Administrator access required.</p>;
  const act=async(action:string,targetUserId?:string,extra:Record<string,unknown>={})=>{
    setBusy(targetUserId || action);setFeedback({});
    try{
      const result=await adminCall({action,...(targetUserId?{targetUserId}:{}),...extra});
      if(action==='issue-recovery'){
        setRecovery(result as unknown as Recovery);
        setPassword('');
        setFeedback({success:'One-time recovery code created. Copy it and deliver it through a trusted channel. No email was sent.'});
      }else{setFeedback({success:'Administrative action completed and logged.'});await load();}
    }catch(e){setFeedback({error:e instanceof Error?e.message:'Action failed.'});}
    finally{setBusy(null);}
  };
  const memberAction=(action:string,member:Member)=>{
    if(action==='delete'){
      const typed=window.prompt('Permanent deletion of member and private files. Type the exact member email to confirm:');
      if(typed!==member.email)return;
    }else if(action==='suspend'&&!window.confirm('Suspend this member and revoke their active sessions?'))return;
    void act(action,member.id);
  };
  const issue=(member:Member)=>{
    if(!password){setFeedback({error:'Confirm your own administrator password before issuing a recovery code.'});return;}
    if(!window.confirm('Issue a 15-minute recovery code for '+member.email+'? Existing unused codes will be invalidated.'))return;
    setRecovery(null);void act('issue-recovery',member.id,{currentPassword:password});
  };
  return <main className="space-y-6">
    <SectionHeader title="Admin Operations" subtitle="Owner-level workspace administration, account recovery, and system oversight. Trading activity remains private."/>
    <div className="flex flex-wrap items-center gap-3">
      <span className="flex items-center gap-2 text-xs text-secondary"><ShieldCheck size={16}/> Signed in as {user?.email || 'administrator'}</span>
      <button className="btn-secondary" type="button" disabled={loading||!!busy} onClick={()=>void load()}><RefreshCw size={15}/>Refresh status</button>
    </div>
    {feedback.error&&<p role="alert" className="card p-3 text-sm text-error-500">{feedback.error}</p>}
    {feedback.success&&<p role="status" className="card p-3 text-sm text-secondary">{feedback.success}</p>}
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {[
        ['Members',overview?.users?.members??'—'],
        ['Suspended',overview?.users?.suspended??'—'],
        ['Linked MT5 accounts',overview?.links?.connected??'—'],
        ['Active connector PCs',overview?.devices?.active??'—'],
      ].map(([title,value])=><div className="card p-4" key={title}><p className="text-xs text-muted">{title}</p><p className="mt-2 text-2xl font-bold font-mono">{value}</p></div>)}
    </div>
    <div className="grid gap-5 xl:grid-cols-2">
      <section className="card p-5 space-y-4">
        <h2 className="font-semibold flex items-center gap-2"><Activity size={18}/> Workspace controls</h2>
        <p className="text-xs text-secondary">D1: {overview?.database||'checking'} · Live broker capture settings are managed in Cloudflare, not this panel.</p>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-secondary p-3">
          <div><p className="font-medium text-sm">New registrations</p><p className="text-xs text-muted">{overview?.signupPaused?'Paused for invited users':'Open to invited users (pilot limit applies)'}</p></div>
          <button className="btn-secondary" type="button" disabled={!!busy||!overview} onClick={()=>{
            const paused=!overview?.signupPaused;
            if(window.confirm(paused?'Pause all new workspace registrations?':'Resume invited registration?'))void act('set-signups',undefined,{paused});
          }}>{overview?.signupPaused?'Resume registration':'Pause registration'}</button>
        </div>
        <div className="rounded-xl border border-themed p-3 space-y-3">
          <div>
            <p className="font-semibold text-sm">MT5 capture emergency stop</p>
            <p className="mt-1 text-xs text-muted">{overview?.mt5CapturePaused ? 'Capture paused for all accounts. Existing records are retained.' : 'Connector synchronization is enabled, subject to the real-account release gate.'}</p>
          </div>
          <label className="block text-xs font-semibold text-secondary">Administrator password<input className="input-field mt-1.5" type="password" autoComplete="current-password" value={mt5Password} onChange={event=>setMt5Password(event.target.value)}/></label>
          <button className="btn-secondary" type="button" disabled={!!busy||!overview||!mt5Password} onClick={()=>{
            const paused=!overview?.mt5CapturePaused;
            const question=paused?'Pause all MT5 pairing, imports and syncing? No trades will be deleted.':'Resume MT5 imports and syncing? Confirm staging and broker health first.';
            if(window.confirm(question)){ void act('set-mt5-capture',undefined,{paused,currentPassword:mt5Password}).finally(()=>setMt5Password('')); }
          }}>{overview?.mt5CapturePaused?'Resume MT5 capture':'Pause MT5 capture'}</button>
          <p className="text-xs text-muted">This controls journal capture only. It does not stop or control trades in MetaTrader or at your broker.</p>
        </div>
        <button className="btn-secondary" type="button" disabled={!!busy} onClick={()=>{if(window.confirm('Revoke every other session signed into your administrator account?'))void act('revoke-own-other-sessions');}}>Sign out my other sessions</button>
        <p className="text-xs text-muted">Automated off-site backup, email delivery, Worker metrics and deployment approval require provider setup; they are not controlled by the journal database.</p>
      </section>
      <section className="card p-5 space-y-4">
        <h2 className="font-semibold flex items-center gap-2"><LockKeyhole size={18}/> Account recovery</h2>
        <p className="text-xs text-secondary">Issue a single-use code for an active member. They open the login page, select <strong>Have a recovery code?</strong>, and choose a new password. Existing sessions are revoked on successful recovery.</p>
        <label className="block text-xs font-semibold text-secondary">Confirm your administrator password<input type="password" className="input-field mt-1.5" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Required to issue member recovery codes"/></label>
        {recovery && <div className="rounded-xl border border-themed bg-secondary p-3 space-y-2">
          <p className="font-semibold text-sm">One-time code for {recovery.email}</p>
          <code className="block break-all select-all text-xs">{recovery.code}</code>
          <button type="button" className="btn-secondary" onClick={()=>{if(navigator.clipboard?.writeText)void navigator.clipboard.writeText(recovery.code).catch(()=>setFeedback({error:'Clipboard unavailable. Select the displayed code to copy it.'}));else setFeedback({error:'Clipboard unavailable. Select the displayed code to copy it.'});}}><Copy size={14}/> Copy recovery code</button>
          <p className="text-xs text-muted">Expires {new Date(recovery.expires_at).toLocaleString()}. Displayed only here; send privately, not in a public issue. No automatic email has been sent.</p>
        </div>}
        <p className="text-xs text-muted">Changing your own administrator password remains in Account Settings. If the owner is locked out, use the secured Cloudflare operator recovery process rather than granting account recovery to anonymous visitors.</p>
      </section>
    </div>
    <section className="card p-5 space-y-4">
      <h2 className="font-semibold flex items-center gap-2"><KeyRound size={18}/> Member access</h2>
      <label className="block text-xs text-secondary">Search members<input className="input-field mt-1.5" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Email, name, username"/></label>
      {loading?<p className="text-sm text-muted">Loading members…</p>:<div className="overflow-x-auto"><table className="min-w-full text-left text-sm">
        <thead><tr className="border-b border-themed text-xs text-muted"><th className="p-2">Member</th><th className="p-2">Status</th><th className="p-2">Usage</th><th className="p-2">Actions</th></tr></thead>
        <tbody>{shown.map(member=><tr key={member.id} className="border-b border-themed align-top"><td className="p-2"><span className="font-semibold">{member.display_name||member.username||'Member'}</span><p className="text-xs text-muted">{member.email}</p></td><td className="p-2 text-xs">{member.account_status||'active'}</td><td className="p-2 text-xs text-muted">{member.trade_count} trades · {member.plan_count} plans</td><td className="p-2">
          {member.id!==user?.id && member.role!=='admin' && <div className="flex max-w-md flex-wrap gap-2">
            {member.account_status==='suspended'?<button className="btn-secondary text-xs" disabled={!!busy} onClick={()=>memberAction('restore',member)}><UserRoundCheck size={14}/> Restore</button>:<button className="btn-secondary text-xs" disabled={!!busy} onClick={()=>memberAction('suspend',member)}><UserRoundX size={14}/> Suspend</button>}
            <button className="btn-secondary text-xs" disabled={!!busy} onClick={()=>memberAction('revoke-sessions',member)}>Revoke sessions</button>
            <button className="btn-secondary text-xs" disabled={!!busy||member.account_status==='suspended'} onClick={()=>issue(member)}>Issue recovery code</button>
            <button className="btn-secondary text-xs" disabled={!!busy} onClick={()=>memberAction('revoke-recovery',member)}>Revoke code</button>
            <button className="btn-secondary text-xs text-error-500" disabled={!!busy} onClick={()=>memberAction('delete',member)}>Delete member</button>
          </div>}
        </td></tr>)}</tbody>
      </table></div>}
      <p className="text-xs text-muted">Admins may manage member access but cannot browse member trade notes, download private media, inspect their broker passwords, or issue recovery codes for other administrators.</p>
    </section>
    <section className="card p-5"><h2 className="font-semibold">Recent administration audit</h2><div className="mt-3 max-h-80 space-y-2 overflow-y-auto">{audit.length?audit.map(item=><div key={item.id} className="flex flex-wrap justify-between gap-3 rounded-lg bg-secondary p-3 text-xs text-secondary"><span>{item.action} · {item.outcome}</span><span>{new Date(item.created_at).toLocaleString()}</span></div>):<p className="text-xs text-muted">No administration changes recorded.</p>}</div></section>
  </main>;
}
