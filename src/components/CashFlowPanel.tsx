import { useEffect, useState } from 'react';
import { AlertCircle, ArrowDownRight, ArrowUpRight, CheckCircle2, RefreshCw, Wallet } from 'lucide-react';
import { mt5Action, type Link } from '@/lib/mt5Monitor';
import { announceAction } from '@/lib/actionFeedback';

type Flow = { ticket:string;amount:string;currency:string;direction:'in'|'out';
  classification:string;broker_time_msc:number;recorded_at:string };
type CashView = { link:string;currency:string;rows:Flow[];nextOffset:number;more:boolean;
  summary:{count:number;incoming:number;outgoing:number;netCashFlow:number;
    brokerBalance:number|null;brokerEquity:number|null;
    cashAdjustedBalance:number|null;cashAdjustedEquity:number|null;
    scanStatus:'not_started'|'scanning'|'epoch_scanned';cursor:number|null;
    scanCompletedAt:string|null;externalFlowsVerified:boolean;overallProfitVerified:boolean;
    methodology:string} };
function money(value:number,currency:string) {
  try { return new Intl.NumberFormat(undefined,{style:'currency',currency,maximumFractionDigits:2}).format(value); }
  catch { return value.toLocaleString(undefined,{maximumFractionDigits:2})+' '+currency; }
}
export function CashFlowPanel({link}:{link:Link}) {
  const [data,setData]=useState<CashView|null>(null);
  const [loading,setLoading]=useState(true);
  const [moreBusy,setMoreBusy]=useState(false);
  const [error,setError]=useState('');
  const [attempt,setAttempt]=useState(0);
  useEffect(()=>{
    let cancelled=false;
    setLoading(true);
    void mt5Action('cash-movements',{link:link.id}).then((view:CashView)=>{
      if(cancelled)return;setData(view);setError('');setLoading(false);
    }).catch((e:unknown)=>{if(cancelled)return;setLoading(false);setError(e instanceof Error?e.message:'Cash ledger unavailable.');});
    return()=>{cancelled=true;};
  },[link.id,link.cash_history_cursor,link.cash_history_completed_at,attempt]);
  if(loading) return <div className="ym-account-progress" role="status"><RefreshCw size={16} className="animate-spin"/>Loading broker balance movements…</div>;
  if(error) return <div className="ym-action-feedback" data-kind="error" role="alert">
    <AlertCircle size={18}/><span>{error}</span><button type="button" className="btn-secondary" onClick={()=>setAttempt(v=>v+1)}>Retry</button></div>;
  if(!data)return null;
  const {summary}=data;
  return <div className="ym-cash-ledger space-y-4">
    <div className="ym-account-pane-heading"><div><strong>Broker cash ledger</strong>
      <span>Automatic, read-only capture of MT5 balance operations before and after linking.</span></div><Wallet size={19}/></div>
    <div className="ym-cash-figures" aria-label="Recorded cash movements">
      <div data-tone="positive"><small>Balance credits · candidates</small><strong>{money(summary.incoming,data.currency)}</strong><span>Includes potential deposits or broker adjustments</span></div>
      <div data-tone="negative"><small>Balance debits · candidates</small><strong>{money(summary.outgoing,data.currency)}</strong><span>Includes potential withdrawals or broker adjustments</span></div>
      <div><small>Net recorded balance movements</small><strong>{money(summary.netCashFlow,data.currency)}</strong><span>Credit minus debit, not trading P&L</span></div>
    </div>
    <div className="ym-cash-coverage" role="status">
      {summary.scanStatus==='epoch_scanned'?<CheckCircle2 size={17}/>:<RefreshCw size={17} className={summary.scanStatus==='scanning'?'animate-spin':''}/>}
      <div><strong>{summary.scanStatus==='epoch_scanned'?'Historical lookup attempted back to MT5 epoch':summary.scanStatus==='scanning'?'Scanning earlier broker records':'Awaiting broker cash scan'}</strong>
        <small>{summary.count} recorded balance movements. Broker retention and balance-adjustment meaning may still be incomplete.</small></div>
    </div>
    <div className="ym-connection-data-note">
      <AlertCircle size={18}/><div><strong>Overall profitability is not verified yet</strong><p>A balance credit can be a deposit, rebate or correction. Current balance/equity minus these recorded movements is only an <em>unreconciled cash-adjusted value</em>, not lifetime profit, ROI or a verified total return. Compare broker statements and opening capital before drawing a conclusion.</p></div>
    </div>
    {summary.cashAdjustedEquity!==null && <div className="ym-detail-grid">
      <div><span>Broker equity · latest snapshot</span><strong>{money(summary.brokerEquity??0,data.currency)}</strong></div>
      <div><span>Equity less recorded flows · not verified P&L</span><strong>{money(summary.cashAdjustedEquity,data.currency)}</strong></div>
    </div>}
    <div className="ym-cash-table-wrap">
      <table className="ym-cash-table"><thead><tr><th>Broker time · unverified timezone</th><th>Type</th><th>Ticket</th><th>Amount</th></tr></thead>
        <tbody>{data.rows.map(row=><tr key={row.ticket}>
          <td>{new Date(row.broker_time_msc).toLocaleString()}</td>
          <td><span className="ym-market-chip" data-tone={row.direction==='in'?'positive':'negative'}>{row.direction==='in'?<ArrowDownRight size={13}/>:<ArrowUpRight size={13}/>} {row.direction==='in'?'Credit':'Debit'}</span></td>
          <td className="ym-market-value">{row.ticket}</td>
          <td className={'ym-market-value ym-market-'+(row.direction==='in'?'positive':'negative')}>{Number(row.amount)>0?'+':''}{money(Number(row.amount),row.currency)}</td>
        </tr>)}</tbody></table>
      {!data.rows.length&&<p className="ym-context-short">No MT5 balance movements have been found yet. Keep the connector running while earlier history is scanned.</p>}
    </div>
    {data.more&&<button type="button" className="btn-secondary" disabled={moreBusy} onClick={async()=>{
      setMoreBusy(true);
      try {const next=await mt5Action('cash-movements',{link:link.id,offset:data.nextOffset}) as CashView;
        setData(current=>current?{...next,rows:[...current.rows,...next.rows]}:next);
        announceAction('success','More broker cash movements loaded.');
      }catch(e){announceAction('error',e instanceof Error?e.message:'Could not load older cash movements.');}
      finally {setMoreBusy(false);}
    }}>{moreBusy?'Loading…':'Load older movements'}</button>}
    <details className="ym-context-help"><summary>How are deposits and withdrawals recognised?</summary><p>MT5 balance deal type 2 is classified by cash direction. The connector preserves each original ticket and amount, without assuming that every positive balance entry is a deposit. Cash is never included in trading profit simply because it changed your balance. Complete records depend on what the broker exposes.</p></details>
  </div>;
}
