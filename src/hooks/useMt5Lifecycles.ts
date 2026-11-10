import { useCallback, useEffect, useState } from 'react';

export interface Mt5Lifecycle {
  calculation_version: number;
  lifecycle_id: string;
  position_id: string;
  symbol: string;
  direction: 'long' | 'short';
  status: 'open' | 'closed';
  first_entry_at: string;
  final_exit_at: string | null;
  initial_entry_price: string | null;
  initial_volume: string | null;
  remaining_volume: string | null;
  closed_volume: string | null;
  initial_sl: string | null;
  initial_sl_provenance: string;
  initial_sl_observed_at: string | null;
  initial_tp: string | null;
  current_sl: string | null;
  current_tp: string | null;
  initial_risk_account: string | null;
  closed_volume_risk_account: string | null;
  current_stop_exposure_account: string | null;
  capital_at_entry: { value: string | null; source: string; observed_at: string | null };
  initial_risk_pct: string | null;
  gross_realized_profit: string | null;
  net_realized_profit: string | null;
  realized_r: string | null;
  final_realized_r: string | null;
  planned_reward_risk: string | null;
  movement: string | null;
  movement_unit: string;
  holding_seconds: string | null;
  weighted_holding_seconds: string | null;
  entry_weekday: string;
  sessions: { status: string; sessions: string[]; overlaps: string[]; reason?: string };
  entries: Array<Record<string, string | null>>;
  exits: Array<Record<string, string | null>>;
  capture_completeness: { original_risk: string; risk_reason: string | null; session_status: string };
  trade_source: 'mt5';
  settlement_currency: string;
  account_id: string;
  broker: string;
}

export type Mt5PositionVersion = {
  link: string;
  account_id: string;
  lifecycle_id: string;
  version: number;
  recorded_at: string;
  summary: Mt5Lifecycle;
};

export function useMt5Lifecycles(userId?: string | null) {
  const [rows,setRows]=useState<Mt5PositionVersion[]>([]);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const refresh=useCallback(async (signal?:AbortSignal)=>{
    if(!userId){setRows([]);setError(null);return;}
    setLoading(true);
    try {
      const gathered:Mt5PositionVersion[]=[];
      let offset=0,more=true;
      while(more && offset<1000) {
        const response=await fetch('/api/mt5/positions',{method:'POST',
          headers:{'content-type':'application/json'},body:JSON.stringify({offset}),signal});
        if(!response.ok)throw new Error('Position summaries could not be loaded.');
        const data=await response.json() as { rows?:Mt5PositionVersion[];more?:boolean;nextOffset?:number };
        if(!Array.isArray(data.rows))throw new Error('Invalid position summary response.');
        gathered.push(...data.rows);
        more=Boolean(data.more);
        offset=data.nextOffset??offset+data.rows.length;
        if(more && !data.rows.length)break;
      }
      if(!signal?.aborted){setRows(gathered);setError(null);}
    }catch(error){
      if(!signal?.aborted){setError(error instanceof Error?error.message:'Position summaries unavailable.');}
    }finally{
      if(!signal?.aborted)setLoading(false);
    }
  },[userId]);
  useEffect(()=>{
    if(!userId){setRows([]);return;}
    const controller=new AbortController();
    void refresh(controller.signal);
    const onFocus=()=>{if(!document.hidden)void refresh(controller.signal);};
    const timer=window.setInterval(onFocus,30000);
    window.addEventListener('focus',onFocus);
    return ()=>{controller.abort();window.clearInterval(timer);window.removeEventListener('focus',onFocus);};
  },[userId,refresh]);
  return {positions:rows,loading,error,refresh:()=>refresh()};
}
