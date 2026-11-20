import { useEffect, useState } from 'react';
import { AlertCircle, ArrowDownRight, ArrowUpRight, CheckCircle2, ChevronDown, RefreshCw, Wallet, ShieldCheck } from 'lucide-react';
import { mt5Action, type Link } from '@/lib/mt5Monitor';
import { announceAction } from '@/lib/actionFeedback';

type CashClass='external_deposit'|'external_withdrawal'|'broker_adjustment'|'internal_transfer'|'unresolved';
type Flow = {ticket:string;amount:string;currency:string;direction:'in'|'out';classification:string;
  broker_time_msc:number;recorded_at:string;reviewed_classification?:CashClass|null;
  statement_reference?:string|null;note?:string|null;attested_at?:string|null;revision?:number|null};
type Period={baselineAt:string|null;openingBalance:number|null;openingEquity:number|null;
  reviewedExternalNet:number;reviewedNonTradingNet:number;unresolvedMovements:number|null;reviewedCount:number|null;
  deltaBalance:number|null;deltaEquity:number|null;status:string;
  independentlyVerified:false;basis:string};
type CashView={link:string;currency:string;rows:Flow[];nextOffset:number;more:boolean;
  summary:{count:number;incoming:number;outgoing:number;netCashFlow:number;
    brokerBalance:number|null;brokerEquity:number|null;
    cashAdjustedBalance:number|null;cashAdjustedEquity:number|null;
    scanStatus:'not_started'|'scanning'|'epoch_scanned';cursor:number|null;
    scanCompletedAt:string|null;externalFlowsVerified:boolean;overallProfitVerified:boolean;
    linkedPeriod:Period;methodology:string}};
function money(value:number,currency:string){
  try{return new Intl.NumberFormat(undefined,{style:'currency',currency,maximumFractionDigits:2}).format(value);}
  catch{return value.toLocaleString(undefined,{maximumFractionDigits:2})+' '+currency;}
}
export function CashFlowPanel({link}:{link:Link}){
  const [data,setData]=useState<CashView|null>(null);
  const [loading,setLoading]=useState(true);
  const [moreBusy,setMoreBusy]=useState(false);
  const [error,setError]=useState('');
  const [attempt,setAttempt]=useState(0);
  const [reviewTicket,setReviewTicket]=useState<string|null>(null);
  const [category,setCategory]=useState<CashClass>('unresolved');
  const [reference,setReference]=useState('');
  const [note,setNote]=useState('');
  const [reviewBusy,setReviewBusy]=useState(false);
  const [reviewError,setReviewError]=useState('');
  useEffect(()=>{
    let cancelled=false;
    setLoading(true);
    void mt5Action('cash-movements',{link:link.id}).then((view:CashView)=>{
      if(cancelled)return;setData(view);setError('');setLoading(false);
    }).catch((e:unknown)=>{if(cancelled)return;setLoading(false);setError(e instanceof Error?e.message:'Cash ledger unavailable.');});
    return()=>{cancelled=true;};
  },[link.id,link.cash_history_cursor,link.cash_history_completed_at,attempt]);
  async function refreshCash(){
    const next=await mt5Action('cash-movements',{link:link.id}) as CashView;
    setData(next);setReviewTicket(null);setReviewError('');
  }
  async function saveReview(ticket:string){
    if(reviewBusy)return;
    setReviewBusy(true);setReviewError('');
    try{
      await mt5Action('cash-review',{link:link.id,ticket,classification:category,
        statementReference:reference,note,confirm:true});
    }catch(e){const message=e instanceof Error?e.message:'Could not save cash review.';
      setReviewError(message);announceAction('error',message);
      setReviewBusy(false);
      return;
    }
    // The mutation has succeeded even if fetching the refreshed ledger fails.
    announceAction('success','Balance transaction '+ticket+' classified and its review recorded.');
    try{await refreshCash();}
    catch{
      const message='Classification was saved, but the updated ledger could not be loaded. Refresh this account before reviewing another movement.';
      setReviewError(message);announceAction('warning',message);
    }finally{setReviewBusy(false);}
  }
  if(loading)return <div className="ym-account-progress" role="status"><RefreshCw size={16} className="animate-spin"/>Loading recorded broker cash movements…</div>;
  if(error)return <div className="ym-action-feedback" data-kind="error" role="alert">
    <AlertCircle size={18}/><span>{error}</span><button type="button" className="btn-secondary" onClick={()=>setAttempt(v=>v+1)}>Retry</button></div>;
  if(!data)return null;
  const {summary}=data,period=summary.linkedPeriod;
  return <div className="ym-cash-ledger space-y-5">
    <div className="ym-account-pane-heading"><div><strong>Funding and performance</strong><span>Captured automatically from your account's MT5 balance transactions, including older records the broker exposes.</span></div><button type="button" className="btn-secondary" disabled={reviewBusy||moreBusy} onClick={()=>setAttempt(value=>value+1)}><RefreshCw size={15}/> Refresh ledger</button></div>
    <div className="ym-cash-figures" aria-label="Recorded balance movements">
      <div data-tone="positive"><small>Credits · deposit candidates</small><strong>{money(summary.incoming,data.currency)}</strong><span>Includes possible broker adjustments</span></div>
      <div data-tone="negative"><small>Debits · withdrawal candidates</small><strong>{money(summary.outgoing,data.currency)}</strong><span>Includes possible broker corrections</span></div>
      <div><small>Net balance movements</small><strong>{money(summary.netCashFlow,data.currency)}</strong><span>Not trading P&L</span></div>
    </div>
    <section className="ym-cash-performance" aria-label="Cash-adjusted results since connection">
      <div className="ym-cash-performance-head">
        <div><span className="ym-connection-eyebrow">PERFORMANCE / SINCE FIRST SNAPSHOT</span>
          <h3>Separate trading results from transfers</h3></div>
        <span className="ym-connection-badge" data-tone={period.status==='indicative'?'warning':'neutral'}>
          {period.status==='review_required'?'Review movements':period.status==='awaiting_baseline'?'Awaiting broker snapshot':period.status==='capture_gap'?'Capture gap':period.status==='timezone_unverified'?'Timezone unverified':'Indicative'}</span>
      </div>
      <div className="ym-cash-figures">
        <div><small>Change in balance, adjusted for transfers</small><strong className={period.deltaBalance===null?'':period.deltaBalance>0?'ym-market-positive':period.deltaBalance<0?'ym-market-negative':''}>{period.deltaBalance===null?'Not ready':money(period.deltaBalance,data.currency)}</strong><span>Since {period.baselineAt?new Date(period.baselineAt).toLocaleDateString():'first broker sync'}</span></div>
        <div><small>Change in equity, adjusted for transfers</small><strong className={period.deltaEquity===null?'':period.deltaEquity>0?'ym-market-positive':period.deltaEquity<0?'ym-market-negative':''}>{period.deltaEquity===null?'Not ready':money(period.deltaEquity,data.currency)}</strong><span>Includes unrealised P&L, if present</span></div>
        <div><small>Reviewed non-trading balance movements</small><strong>{money(period.reviewedNonTradingNet,data.currency)}</strong><span>{period.unresolvedMovements===null?'Awaiting baseline':period.unresolvedMovements+' movements still need review'}</span></div>
      </div>
      <details className="ym-context-help"><summary><ShieldCheck size={15}/>Calculation method and limitations</summary>
        <p>Current balance/equity less the first observed snapshot, then subtracting classified deposits, withdrawals, internal transfers and broker adjustments. External deposits and withdrawals require a statement reference. The calculation is hidden while movements remain unreviewed. Capture gaps, timestamp offsets, missing broker history and unverified opening capital can make a result incomplete. This is <strong>not verified lifetime profit, ROI or a certified account statement</strong>.</p>
      </details>
    </section>
    <div className="ym-cash-coverage" role="status">
      {summary.scanStatus==='epoch_scanned'?<CheckCircle2 size={17}/>:<RefreshCw size={17} className={summary.scanStatus==='scanning'?'animate-spin':''}/>}
      <div><strong>{summary.scanStatus==='epoch_scanned'?'Broker historical periods queried':summary.scanStatus==='scanning'?'Looking for earlier cash transactions':'Preparing automatic cash-history scan'}</strong>
        <small>{summary.count} balance movements recorded. The broker may not retain all older records; earlier deposits cannot be invented.</small></div>
    </div>
    <div className="ym-cash-movements-header"><h3>Transaction review <span className="ym-section-count">{summary.count}</span></h3><span>Choose a row to classify it against your broker statement</span></div>
    <div className="ym-cash-review-list" role="list" aria-label="Recorded broker cash transactions">
      {data.rows.map(row=><div key={row.ticket} role="listitem" className="ym-cash-review-card" data-open={reviewTicket===row.ticket}>
        <button type="button" className="ym-cash-review-trigger" aria-expanded={reviewTicket===row.ticket}
          onClick={()=>{if(reviewTicket===row.ticket){setReviewTicket(null);return;}
            setReviewTicket(row.ticket);setCategory(row.reviewed_classification||'unresolved');
            setReference(row.statement_reference||'');setNote(row.note||'');setReviewError('');
          }}>
          <span className="ym-cash-review-glyph" data-side={row.direction}>{row.direction==='in'?<ArrowDownRight size={17}/>:<ArrowUpRight size={17}/>}</span>
          <span className="ym-cash-review-name"><strong>{row.reviewed_classification?.replace(/_/g,' ')||(row.direction==='in'?'Unreviewed credit':'Unreviewed debit')}</strong>
            <small>Broker deal {row.ticket} · {new Date(row.broker_time_msc).toLocaleString()} (broker clock)</small></span>
          <span className={'ym-cash-review-amount ym-market-'+(row.direction==='in'?'positive':'negative')}>{Number(row.amount)>0?'+':''}{money(Number(row.amount),row.currency)}</span>
          <ChevronDown size={16} className="ym-selectable-chevron"/>
        </button>
        {reviewTicket===row.ticket&&<div className="ym-cash-review-body">
          <div className="ym-history-inputs">
            <label>Movement classification
              <select className="input-field" value={category} onChange={e=>setCategory(e.target.value as CashClass)}>
                <option value="unresolved">Not sure yet</option>
                {row.direction==='in'&&<option value="external_deposit">External deposit · verified against statement</option>}
                {row.direction==='out'&&<option value="external_withdrawal">External withdrawal · verified against statement</option>}
                <option value="broker_adjustment">Broker adjustment / rebate</option>
                <option value="internal_transfer">Internal account transfer</option>
              </select>
            </label>
            <label>Broker statement reference
              <input className="input-field" maxLength={120} value={reference} onChange={e=>setReference(e.target.value)}
                placeholder="Required for deposits and withdrawals"/>
            </label>
          </div>
          <label className="ym-cash-review-note">Review note (optional)<textarea className="input-field" rows={2} maxLength={320} value={note} onChange={e=>setNote(e.target.value)}
            placeholder="Why did you classify this transaction this way?"/></label>
          <div className="ym-connection-actions">
            <button type="button" className="btn-primary" disabled={reviewBusy||((category==='external_deposit'||category==='external_withdrawal')&&reference.trim().length<3)}
              onClick={()=>void saveReview(row.ticket)}>{reviewBusy?'Saving review…':row.revision?'Update classification':'Confirm classification'}</button>
            <button type="button" className="btn-secondary" onClick={()=>setReviewTicket(null)}>Cancel</button>
            {row.attested_at&&<span className="ym-confirmation-stamp"><CheckCircle2 size={15}/>Reviewed {new Date(row.attested_at).toLocaleDateString()} · Revision {row.revision}</span>}
          </div>
          {reviewError&&<div role="alert" className="ym-action-feedback" data-kind="error">{reviewError}</div>}
        </div>}
      </div>)}
      {!data.rows.length&&<div className="ym-connection-empty"><Wallet size={23}/><strong>No broker cash transactions found yet</strong><p>The connector automatically searches older broker records while it monitors this account.</p></div>}
    </div>
    {data.more&&<button type="button" className="btn-secondary" disabled={moreBusy} onClick={async()=>{
      setMoreBusy(true);try{const next=await mt5Action('cash-movements',{link:link.id,offset:data.nextOffset}) as CashView;
        setData(current=>current&&current.link===next.link?{...next,rows:[...new Map([...current.rows,...next.rows].map(row=>[row.ticket,row])).values()]}:next);
        announceAction('success','Older broker cash transactions loaded.');
      }catch(e){announceAction('error',e instanceof Error?e.message:'Could not load older movements.');}
      finally{setMoreBusy(false);}
    }}>{moreBusy?'Loading…':'Load earlier transactions'}</button>}
  </div>;
}
