/** Canonical personal archive coverage; keep in sync with the Worker schema.
 * A workspace export is NOT a complete MT5 capture/evidence backup.
 * Never present presence of journal trade projections as raw broker evidence.
 */
export const WORKSPACE_ARCHIVE_SCOPE = 'workspace-and-media-only' as const;
export const EXCLUDED_BROKER_EVIDENCE = [
  'mt5_raw_evidence',
  'mt5_evidence_corrections',
  'mt5_evidence_conflicts',
  'mt5_conflict_classifications',
  'mt5_recovery_status',
  'mt5_links',
  'mt5_position_versions',
  'mt5_events',
  'mt5_cash_movements',
  'mt5_cash_reviews',
  'mt5_cash_review_events',
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

export function assertCompleteWorkspaceExport(unavailableTables: string[]): void {
  if (unavailableTables.length)
    throw new Error('Workspace backup incomplete: could not read '+
      unavailableTables.join(', ')+'. No file was downloaded. Retry after the service is restored.');
}

export function brokerDerivedTradeCount(data: Record<string, Record<string, unknown>[]>): number {
  return (data.trades ?? []).filter(trade => trade.trade_source === 'mt5').length;
}
