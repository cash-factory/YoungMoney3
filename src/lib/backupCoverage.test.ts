import {test} from 'node:test';
import assert from 'node:assert/strict';
import {brokerDerivedTradeCount, EXCLUDED_BROKER_EVIDENCE,
  personalBackupCoverage, WORKSPACE_ARCHIVE_SCOPE} from './backupCoverage.ts';

test('personal archive documents no immutable broker evidence recovery path',()=>{
  const coverage=personalBackupCoverage();
  assert.equal(coverage.scope,WORKSPACE_ARCHIVE_SCOPE);
  assert.equal(coverage.brokerEvidenceRestore,'not-supported');
  assert.ok(coverage.excludedBrokerCollections.includes('mt5_raw_evidence'));
  assert.ok(coverage.excludedBrokerCollections.includes('mt5_evidence_conflicts'));
  assert.ok(coverage.excludedBrokerCollections.includes('mt5_recovery_status'));
  assert.ok(coverage.excludedBrokerCollections.includes('trade_audit'));
  assert.equal(new Set(coverage.excludedBrokerCollections).size,EXCLUDED_BROKER_EVIDENCE.length);
});

test('broker-derived workspace trade records are not evidence of restored executions',()=>{
  const data={trades:[
    {trade_source:'mt5',broker_details:{ticket:'100'}},
    {trade_source:'manual'},
    {trade_source:'mt5',broker_details:{ticket:'101'}},
  ]};
  assert.equal(brokerDerivedTradeCount(data),2);
  assert.equal(brokerDerivedTradeCount({}),0);
});
