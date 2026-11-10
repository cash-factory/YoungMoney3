import { useMemo } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, LineChart, Line } from 'recharts';
import type { Mt5PositionVersion } from '@/hooks/useMt5Lifecycles';

type RichProps = {
  positions: Mt5PositionVersion[];
  accountId?: string;
  compact?: boolean;
};

const number = (value:string|null|undefined) => {
  const parsed = value==null ? NaN : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const fmt = (v:number) => v.toLocaleString(undefined,{maximumFractionDigits:2});
const average = (list:number[]) => list.length ? list.reduce((sum,v)=>sum+v,0)/list.length : null;

export function RichLifecycleAnalytics({positions,accountId='all',compact=false}:RichProps) {
  const rows = useMemo(()=>positions.filter(row=>accountId==='all'||row.account_id===accountId),[positions,accountId]);
  const closed = useMemo(()=>rows.filter(row=>row.summary.status==='closed'),[rows]);
  const knownR = useMemo(()=>closed
    .map(row=>({row,r:number(row.summary.final_realized_r)}))
    .filter((record):record is {row:Mt5PositionVersion;r:number}=>record.r!==null),[closed]);
  const holding = useMemo(()=>closed.map(row=>number(row.summary.weighted_holding_seconds))
    .filter((v):v is number=>v!==null),[closed]);
  const totalR=knownR.reduce((sum,item)=>sum+item.r,0);
  const avgR=average(knownR.map(item=>item.r));
  const avgHours=average(holding.map(v=>v/3600));
  const open=rows.filter(row=>row.summary.status==='open');
  const sessionConfirmed=closed.filter(row=>row.summary.sessions?.status==='confirmed');
  const movement=closed.filter(row=>number(row.summary.movement)!==null && row.summary.movement_unit!=='unknown');
  const currencyBreakdown = useMemo(()=>{
    const groups=new Map<string,{amount:number;count:number}>();
    for(const row of closed){
      const amount=number(row.summary.net_realized_profit);
      const currency=row.summary.settlement_currency||'Unknown';
      if(amount===null)continue;
      const previous=groups.get(currency)||{amount:0,count:0};
      groups.set(currency,{amount:previous.amount+amount,count:previous.count+1});
    }
    return [...groups.entries()].sort((a,b)=>a[0].localeCompare(b[0]));
  },[closed]);
  const R_BINS=[
    {label:'≤ -2R',test:(v:number)=>v<=-2},
    {label:'-2 to -1',test:(v:number)=>v>-2&&v<=-1},
    {label:'-1 to 0',test:(v:number)=>v>-1&&v<0},
    {label:'0 to 1',test:(v:number)=>v>=0&&v<1},
    {label:'1 to 2',test:(v:number)=>v>=1&&v<2},
    {label:'≥ 2R',test:(v:number)=>v>=2},
  ];
  const distribution=R_BINS.map(bin=>({range:bin.label,count:knownR.filter(item=>bin.test(item.r)).length}));
  const cumulative = [...knownR].sort((a,b)=>Date.parse(a.row.summary.final_exit_at || '')-Date.parse(b.row.summary.final_exit_at || ''))
    .reduce<{label:string;total:number}[]>((acc,item)=>{
      acc.push({label:new Date(item.row.summary.final_exit_at||item.row.summary.first_entry_at).toLocaleDateString(undefined,{month:'short',day:'numeric'}),
        total:item.r+(acc.length?acc[acc.length-1].total:0)});
      return acc;
    },[]);
  const sessionGroups = new Map<string,{count:number;knownR:number[];currencies:Set<string>}>();
  for(const row of sessionConfirmed){
    for(const session of row.summary.sessions?.sessions||[]){
      const current=sessionGroups.get(session)||{count:0,knownR:[],currencies:new Set<string>()};
      current.count++;
      const r=number(row.summary.final_realized_r);
      if(r!==null)current.knownR.push(r);
      current.currencies.add(row.summary.settlement_currency||'Unknown');
      sessionGroups.set(session,current);
    }
  }
  const movements = new Map<string,{count:number;values:number[]}>();
  for(const row of movement){
    const key=row.summary.symbol+' · '+row.summary.movement_unit;
    const group=movements.get(key)||{count:0,values:[]};
    group.count++;
    const value=number(row.summary.movement);
    if(value!==null)group.values.push(value);
    movements.set(key,group);
  }
  return <section className="ym-rich-analytics card p-4 sm:p-5 space-y-4" aria-label="Broker lifecycle analytics">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-xs uppercase tracking-wider text-muted font-bold">EXECUTION ANALYTICS · MT5 ONLY</p>
        <h2 className="text-lg font-bold mt-1">Position lifecycle performance</h2>
        <p className="text-xs text-muted mt-1">Every full broker position counts once. Open lifecycles are excluded from realized metrics; no estimate replaces unknown values.</p>
      </div>
      <span className="badge badge-neutral">{rows.length} lifecycles · {open.length} open</span>
    </header>
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
      {[
        ['Net R (known)',knownR.length?fmt(totalR)+'R':'Unavailable',knownR.length+' / '+closed.length+' closed trades'],
        ['Average net R',avgR===null?'Unavailable':fmt(avgR)+'R',knownR.length+' / '+closed.length+' eligible'],
        ['Avg weighted holding',avgHours===null?'Unavailable':fmt(avgHours)+' hours',holding.length+' / '+closed.length+' eligible'],
        ['Confirmed sessions',String(sessionConfirmed.length),sessionConfirmed.length+' / '+closed.length+' closed trades'],
      ].map(([label,value,note])=><div key={label} className="rounded-xl border border-themed bg-secondary p-3">
        <p className="text-xs text-muted">{label}</p><p className="font-mono font-bold text-base mt-2 break-words">{value}</p>
        <p className="text-xs text-muted mt-1">{note}</p>
      </div>)}
    </div>
    {!compact && <>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-themed p-3">
          <h3 className="text-sm font-bold mb-1">Net R distribution</h3>
          <p className="text-xs text-muted mb-3">{knownR.length}/{closed.length} closed lifecycles have original risk provenance.</p>
          {knownR.length===0?<p className="text-sm text-muted p-8 text-center">No verified original risk available yet.</p>:
          <ResponsiveContainer width="100%" height={220}><BarChart data={distribution}>
            <XAxis dataKey="range" tick={{fill:'var(--text-muted)',fontSize:10}} axisLine={false} tickLine={false}/>
            <YAxis tick={{fill:'var(--text-muted)',fontSize:10}} allowDecimals={false} axisLine={false} tickLine={false}/>
            <Tooltip contentStyle={{background:'var(--bg-card)',border:'1px solid var(--border)'}}/>
            <Bar dataKey="count" fill="var(--brand)" radius={[3,3,0,0]}/>
          </BarChart></ResponsiveContainer>}
        </div>
        <div className="rounded-xl border border-themed p-3">
          <h3 className="text-sm font-bold mb-1">Cumulative net R</h3>
          <p className="text-xs text-muted mb-3">Known-R, fully closed positions only; no inferred denominator.</p>
          {!cumulative.length?<p className="text-sm text-muted p-8 text-center">No closed lifecycles with known risk.</p>:
          <ResponsiveContainer width="100%" height={220}><LineChart data={cumulative}>
            <XAxis dataKey="label" tick={{fill:'var(--text-muted)',fontSize:10}} axisLine={false} tickLine={false}/>
            <YAxis tick={{fill:'var(--text-muted)',fontSize:10}} axisLine={false} tickLine={false}/>
            <Tooltip contentStyle={{background:'var(--bg-card)',border:'1px solid var(--border)'}}/>
            <Line dataKey="total" stroke="var(--brand)" strokeWidth={2} dot={false}/>
          </LineChart></ResponsiveContainer>}
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-themed p-4">
          <h3 className="text-sm font-bold">Session and overlap coverage</h3>
          <p className="text-xs text-muted my-2">Only timezone-confirmed histories. A trade may span several sessions; these counts are not additive.</p>
          {sessionGroups.size===0?<p className="text-xs text-muted">No verified sessions yet.</p>:
            [...sessionGroups].sort((a,b)=>b[1].count-a[1].count).map(([name,group])=>
              <div key={name} className="flex justify-between items-center gap-2 py-2 border-b border-themed text-xs">
                <span>{name}</span><span className="font-mono">{group.count} positions · {group.knownR.length?fmt(average(group.knownR)??0)+' avg R':'R unavailable'}</span>
              </div>)}
        </div>
        <div className="rounded-xl border border-themed p-4">
          <h3 className="text-sm font-bold">Instrument movement</h3>
          <p className="text-xs text-muted my-2">{movement.length}/{closed.length} closed lifecycles have compatible instrument movement units. Pips and ticks are never summed together.</p>
          {movements.size===0?<p className="text-xs text-muted">No verified pip/tick specifications yet.</p>:
            [...movements].sort((a,b)=>b[1].count-a[1].count).map(([name,group])=>
              <div key={name} className="flex justify-between items-center gap-2 py-2 border-b border-themed text-xs">
                <span>{name}</span><span className="font-mono">{group.count} · avg {fmt(average(group.values)??0)}</span>
              </div>)}
        </div>
      </div>
      <div className="rounded-xl bg-secondary p-3">
        <p className="text-xs font-bold">Realized P&amp;L, grouped by currency</p>
        <div className="flex flex-wrap gap-4 mt-2 text-sm">
          {currencyBreakdown.map(([currency,group])=><span key={currency} className="font-mono">{currency} {fmt(group.amount)} <small className="text-muted">({group.count} closed)</small></span>)}
          {!currencyBreakdown.length&&<span className="text-xs text-muted">No completed broker lifecycles yet.</span>}
        </div>
      </div>
    </>}
    <p className="text-xs text-muted">These metrics are an audited, separate projection from immutable MT5 records. Legacy journal totals remain separate until exact-identity migration and two-broker statement reconciliation are approved.</p>
  </section>;
}
