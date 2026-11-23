import { useState } from 'react';
import { AlertTriangle, ChevronDown, RefreshCw, ShieldCheck } from 'lucide-react';
import { mt5Action } from '@/lib/mt5Monitor';

type ConflictRow = {
  event_key:string; evidence_kind:string; changed_fields:string[];
  original_fingerprint:string; candidate_fingerprint:string;
  review_status:'needs_review'; recorded_at:string;
};

export function EvidenceConflictPanel({link,count}:{link:string;count:number}) {
  const [opened,setOpened]=useState(false);
  const [rows,setRows]=useState<ConflictRow[]>([]);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const [more,setMore]=useState(false);
  const load=async()=>{
    if(loading)return;
    setLoading(true);setError('');
    try {
      const result=await mt5Action('evidence-conflicts',{link}) as {rows:ConflictRow[];has_more:boolean};
      setRows(result.rows);setMore(result.has_more);
    }catch(reason){
      setError(reason instanceof Error?reason.message:'Could not load evidence review.');
    }finally{setLoading(false);}
  };
  return <section className="ym-evidence-conflict-panel" aria-label="Broker evidence integrity review">
    <div className="ym-action-feedback" data-kind="warning" role="status">
      <AlertTriangle size={17}/>
      <span>
        <strong>{count} broker evidence {count===1?'discrepancy':'discrepancies'} preserved for review.</strong>
        {' '}New capture batches can continue. The first broker record remains unchanged; conflicting versions are retained separately and are not accepted as corrections.
      </span>
    </div>
    <button type="button" className="btn-secondary" aria-expanded={opened}
      onClick={()=>{
        const next=!opened;setOpened(next);
        if(next)void load();
      }}>
      <ChevronDown size={15} aria-hidden="true"/>
      {opened?'Hide evidence details':'Inspect conflicting evidence'}
    </button>
    {opened&&<div className="ym-evidence-review-details">
      <p className="ym-context-short">This view displays identifiers, changed field names and short fingerprints only — not the full broker data. Review is informational; it cannot replace the original source.</p>
      <button type="button" className="btn-secondary" disabled={loading} onClick={()=>void load()}>
        <RefreshCw size={15} className={loading?'animate-spin':''}/> {loading?'Refreshing…':'Refresh list'}
      </button>
      {error&&<div className="ym-action-feedback" data-kind="warning" role="alert">{error}</div>}
      {rows.length>0&&<ul className="ym-evidence-review-list">
        {rows.map(item=><li key={item.event_key+'-'+item.candidate_fingerprint}>
          <div><strong>{item.evidence_kind}</strong><span className="ym-context-short"> · {item.event_key}</span></div>
          <div className="ym-context-short">Changed: {item.changed_fields.length?item.changed_fields.join(', '):'unclassified fields'}</div>
          <div className="ym-context-short">Source {item.original_fingerprint} · Observed {item.candidate_fingerprint} · {new Date(item.recorded_at).toLocaleString()}</div>
        </li>)}
      </ul>}
      {!loading&&!rows.length&&!error&&<p className="ym-context-short">No conflict records returned for this account.</p>}
      {more&&<p className="ym-context-short">Showing the latest 100 candidates. Earlier evidence remains preserved server-side.</p>}
      <p className="ym-context-short"><ShieldCheck size={14} aria-hidden="true"/> These records are retained for an audited reconciliation; no automatic overwrite or deletion occurs.</p>
    </div>}
  </section>;
}
