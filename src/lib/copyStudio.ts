export type CopyAccount = {
  id:string; account_id:string; device:string; company:string|null; login:string|null; server:string|null;
  trade_mode:number|null; access_level:string; monitoring_paused:number; last_sync:string|null;
  broker_balance:number|null; broker_equity:number|null; currency:string|null;
};
export type CopyProfile = {
  id:string; owner:string; name:string; source_link:string; follower_link:string;
  sizing_mode:'fixed_multiplier'; multiplier:number; max_follower_lots:number;
  planned_max_daily_loss_pct:number; state:'paused'; version:number;
  created_at:string; updated_at:string;
};
export type CopyStatus = {
  executionEnabled:false; mode:'simulation-only'; accounts:CopyAccount[]; profiles:CopyProfile[];
  events:{profile_id:string;event:string;details:string;created_at:string}[];
  limits:{maximumProfiles:number;maxMultiplier:number;maxFollowerLots:number};
};
export type CopySimulation = {
  simulation:true; executionEnabled:false; state:'paused'; brokerValidated:false;
  sourceLots:number; multiplier:number; uncappedLots:number; indicativeFollowerLots:number;
  maximumLots:number; cappedByPolicy:boolean; plannedMaxDailyLossPct:number;
  dailyLossEnforced:false; followerTradeAccess:string; checks:string[];
};
export type CopyDraft = {
  name:string; sourceLink:string; followerLink:string; multiplier:number;
  maxFollowerLots:number; maxDailyLossPct:number;
};
export const emptyCopyDraft = ():CopyDraft => ({
  name:'',sourceLink:'',followerLink:'',multiplier:1,maxFollowerLots:1,maxDailyLossPct:2,
});
export const draftFromProfile=(item:CopyProfile):CopyDraft=>({
  name:item.name,sourceLink:item.source_link,followerLink:item.follower_link,
  multiplier:item.multiplier,maxFollowerLots:item.max_follower_lots,
  maxDailyLossPct:item.planned_max_daily_loss_pct,
});
export async function copyAction<T>(name:string, payload:Record<string,unknown>={}) :Promise<T> {
  let response:Response;
  try {
    response=await fetch('/api/copy/'+name,{
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload),
    });
  }catch{
    throw Error('The browser could not connect to Copy Studio. Check the workspace connection.');
  }
  let result:{error?:string}&Record<string,unknown>;
  try { result=await response.json() as typeof result; }
  catch{throw Error('Copy Studio returned an unreadable HTTP '+response.status+' response.');}
  if(!response.ok)throw Error(result.error||'Copy Studio request failed (HTTP '+response.status+').');
  return result as T;
}
