/** UI-level prerequisites only. Server and local connector remain the trade authority. */
export type CopyArmMode='demo'|'live';
export type CopyArmAccount={
  id:string;trade_mode:number|null;access_level:string;monitoring_paused:number;last_seen:number|null;
};
export type CopyArmFleet={
  state:string;execution_mode:CopyArmMode;source_link:string;
  targets:{follower_link:string;enabled:number}[];
};
export type CopyArmConsent={
  follower_link:string;demo_authorized:number;authorization_mode:string;expires_at:number;
};

export function hasLocalCopyEligibility(account:CopyArmAccount,mode:CopyArmMode,now=Date.now()):boolean {
  return account.trade_mode===(mode==='live'?2:0)&&
    account.access_level==='trading-enabled'&&account.monitoring_paused===0&&
    Number(account.last_seen)>now-45000;
}

/** Explanatory blockers, never a substitute for broker preflight or server authorization. */
export function copyArmIssues(
  fleet:CopyArmFleet|undefined,
  accounts:CopyArmAccount[],
  consents:CopyArmConsent[],
  liveEnabled:boolean,
  now=Date.now(),
):string[]{
  if(!fleet||fleet.state!=='paused')return [];
  const mode=fleet.execution_mode;
  const issues:string[]=[];
  const source=accounts.find(a=>a.id===fleet.source_link);
  if(mode==='live'&&!liveEnabled)issues.push('Live execution is disabled for this environment.');
  if(!source||source.trade_mode!==(mode==='live'?2:0)||
     source.monitoring_paused!==0||Number(source.last_seen)<=now-45000)
    issues.push('Source account needs a current MT5 connection and active monitoring in the selected broker mode.');
  const enabled=fleet.targets.filter(t=>t.enabled);
  if(!enabled.length)issues.push('Enable at least one follower in the saved fleet.');
  const unavailable=enabled.filter(t=>{
    const a=accounts.find(x=>x.id===t.follower_link);
    return !a||!hasLocalCopyEligibility(a,mode,now);
  });
  const missingConsent=enabled.filter(t=>{
    const grant=consents.find(c=>c.follower_link===t.follower_link);
    return !grant||grant.demo_authorized!==1||grant.authorization_mode!==mode||
      Number(grant.expires_at)<=now;
  });
  if(unavailable.length)issues.push(unavailable.length+
    ' enabled follower(s) lack a current, trading-enabled Windows MT5 connection with the correct broker mode.');
  if(missingConsent.length)issues.push(missingConsent.length+
    ' enabled follower(s) need unexpired, account-bound local consent in the established connector.');
  return issues;
}
