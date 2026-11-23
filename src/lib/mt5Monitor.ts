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

export async function mt5Action(name: string, payload: unknown = {}, signal?: AbortSignal) {
  const result = await fetch('/api/mt5/' + name, {method:'POST', headers:{'content-type':'application/json'},body:JSON.stringify(payload),signal});
  const data = await result.json();
  if (!result.ok) throw new Error(data.error || 'MT5 connection unavailable.');
  return data;
}
