/** Canonical personal archive coverage; keep in sync with the Worker schema.
 * A workspace export is NOT a complete MT5 capture/evidence backup.
 * Never present presence of journal trade projections as raw broker evidence.
 */
export const WORKSPACE_ARCHIVE_SCOPE = 'workspace-and-media-only' as const;
export const EXCLUDED_BROKER_EVIDENCE = [
  'mt5_raw_events',
  'mt5_evidence_conflicts',
  'mt5_conflict_classifications',
  'mt5_recovery_status',
  'mt5_links',
  'mt5_lifecycle_revisions',
  'mt5_position_lifecycles',
  'mt5_position_specs',
  'mt5_cash_movements',
  'trade_audit',
] as const;

export interface BackupCoverage {
  scope: typeof WORKSPACE_ARCHIVE_SCOPE;
  brokerEvidenceRestore: 'not-supported';
  excludedBrokerCollections: string[];
}

export function personalBackupCoverage(): BackupCoverage {
  return {
    scope: WORKSPACE_ARCHIVE_SCOPE,
    brokerEvidenceRestore: 'not-supported',
    excludedBrokerCollections: [...EXCLUDED_BROKER_EVIDENCE],
  };
}

export function includesBrokerEvidenceRestore(value: unknown): boolean {
  // Do not trust a client-supplied or historical JSON field claiming full recovery.
  // No safe broker-evidence restoration endpoint exists in this archive format.
  void value;
  return false;
}

export function brokerDerivedTradeCount(data: Record<string, Record<string, unknown>[]>): number {
  return (data.trades ?? []).filter(trade => trade.trade_source === 'mt5').length;
}
