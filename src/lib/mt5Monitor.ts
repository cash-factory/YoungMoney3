export type Device = { id: string; pc_name?: string | null; last_seen: number; setup_state?: 'ready' | 'install' | null; connector_version?: string | null };
export type Link = { id: string; device?:string; monitoring_paused?:number; pending_reviews?:number; capture_health?:string; evidence_conflicts_pending?:number; connector_spec_artifacts?:number; recovery?:{state:'catching_up'|'awaiting_broker_history'|'current';scanned_through:number;target_at:number;unresolved_positions:number;unobserved_stop_changes:number;updated_at:string}|null; retry_requested_at?:string; account_id?:string; company?: string; login?: string; server?: string; trade_mode?: number; access_level?: string; status: string; last_sync?: string; broker_balance?:number;broker_equity?:number;currency?:string; gap?: number; last_error?: string; expires: number;history_id?:string;history_status?:string;history_since?:number|null;history_mode?:string;history_anchor_at?:number|null;history_anchor_ticket?:string|null;history_anchor_amount?:number|null;history_scanned_until?:number|null;cash_history_cursor?:number|null;cash_history_completed_at?:string|null;broker_timezone?:string;timezone_confirmed_at?:string;timezone_source?:string;utc_conversion_status?:string };
export type MonitorStatus = { devices: Device[]; links: Link[]; accounts: {id:string; name:string}[]; demoOnly: boolean; capturePaused?: boolean };

export const pairedPcName = (pc?: Device) => pc?.pc_name?.trim() || (pc ? 'PC '+pc.id.slice(0,8) : 'Unknown PC');

export const pcOnline = (pc?: Device) => Boolean(pc && Date.now() - pc.last_seen < 90_000);

export function monitoringStatus(link: Link, pc?: Device, capturePaused = false) {
  if (['pending','verifying'].includes(link.status) && link.expires <= Date.now()) return 'Login request expired';
  if (link.status === 'pending') return 'Preparing MetaTrader';
  if (link.status === 'verifying') return 'Checking broker login';
  if (link.status === 'failed') return 'Login needs attention';
  if (link.status === 'expired') return 'Login request expired';
  if (link.status !== 'connected') return 'Disconnected';
  if (capturePaused) return 'Staging capture paused';
  if (link.monitoring_paused) return 'Monitoring paused';
  if (!pcOnline(pc)) return 'Waiting for PC';
  if ((link.evidence_conflicts_pending||0)>0) return 'Evidence review required';
  if (link.recovery?.state==='catching_up') return 'Recovering trade history';
  if (link.recovery?.state==='awaiting_broker_history') return 'Awaiting broker history';
  if (link.capture_health === 'needs_attention') return 'Capture needs attention';
  if (!link.last_sync) return 'Waiting for first sync';
  if (Date.now() - Date.parse(link.last_sync) > 120000) return 'Waiting for fresh data';
  return 'Monitoring';
}


export type MonitorGuidance = { meaning: string; nextStep: string; tone: 'success' | 'warning' | 'danger' | 'neutral' };

/** Explain verified account capture without inferring broker fills or permission to trade. */
export function monitoringGuidance(link: Link, pc?: Device, capturePaused = false): MonitorGuidance {
  const state = monitoringStatus(link, pc, capturePaused);
  switch (state) {
    case 'Monitoring':
      return { meaning: 'This account has a recent confirmed capture and its paired PC is online. This does not prove every broker fill was received.', nextStep: 'Review the latest broker trades and any outstanding integrity reviews.', tone: 'success' };
    case 'Preparing MetaTrader':
      return { meaning: 'An MT5 setup request is pending; the broker login is not verified yet.', nextStep: 'Open the dedicated MT5 terminal in Signal Desk and complete its broker login.', tone: 'neutral' };
    case 'Checking broker login':
      return { meaning: 'The connector is checking the exact broker login and server.', nextStep: 'Leave the dedicated MT5 terminal signed in, then refresh this page.', tone: 'neutral' };
    case 'Login needs attention':
    case 'Login request expired':
      return { meaning: 'The login attempt did not complete; monitoring has not been confirmed.', nextStep: 'Open Signal Desk, check the broker login and server, then start a fresh verification.', tone: 'danger' };
    case 'Staging capture paused':
      return { meaning: 'Capture is paused for staging regardless of account or PC state.', nextStep: 'Do not assume new trades are being recorded. Contact the staging administrator.', tone: 'warning' };
    case 'Monitoring paused':
      return { meaning: 'This linked account is intentionally excluded from active capture.', nextStep: 'Choose Resume monitoring only if you want this account recorded.', tone: 'neutral' };
    case 'Waiting for PC':
      return { meaning: 'The paired PC has not checked in recently; no fresh account capture is confirmed.', nextStep: 'Open Signal Desk on that PC, restore the connection and check this account again.', tone: 'warning' };
    case 'Evidence review required':
      return { meaning: 'Broker evidence requires integrity review. Original records are preserved.', nextStep: 'Inspect the evidence conflict report before trusting affected statistics.', tone: 'danger' };
    case 'Recovering trade history':
      return { meaning: 'The connector is scanning broker history after an interruption. Completion is not confirmed.', nextStep: 'Monitor the recovery checkpoint and review positions still awaiting broker records.', tone: 'warning' };
    case 'Awaiting broker history':
      return { meaning: 'Some previously observed positions cannot yet be reconciled with broker history.', nextStep: 'Keep MT5 connected, request a history recheck if appropriate and inspect unresolved positions.', tone: 'warning' };
    case 'Capture needs attention':
      return { meaning: 'Capture reported a problem even though the account remains linked.', nextStep: 'Inspect the account error and Signal Desk activity; retry after resolving the cause.', tone: 'danger' };
    case 'Waiting for first sync':
      return { meaning: 'The account is linked but no successful capture has been confirmed.', nextStep: 'Enable monitoring for this account and wait for a verified broker capture.', tone: 'warning' };
    case 'Waiting for fresh data':
      return { meaning: 'The last confirmed capture is too old to treat the account as currently monitored.', nextStep: 'Inspect connector health, then refresh after a completed broker capture.', tone: 'warning' };
    default:
      return { meaning: 'The broker connection is not in a confirmed monitoring state.', nextStep: 'Check the paired PC and MT5 broker login in Signal Desk.', tone: 'warning' };
  }
}

export async function mt5Action(name: string, payload: unknown = {}, signal?: AbortSignal) {
  const result = await fetch('/api/mt5/' + name, {method:'POST', headers:{'content-type':'application/json'},body:JSON.stringify(payload),signal});
  const data = await result.json();
  if (!result.ok) throw new Error(data.error || 'MT5 connection unavailable.');
  return data;
}
