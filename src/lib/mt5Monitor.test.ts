import assert from 'node:assert/strict';
import test from 'node:test';
import { monitoringGuidance, monitoringStatus, pcOnline, type Device, type Link } from './mt5Monitor.ts';

const now=Date.now();
const online:Device={id:'test-pc',pc_name:'Test workstation',last_seen:now};
const offline:Device={...online,last_seen:now-150_000};
const base:Link={id:'test-account',device:'test-pc',status:'connected',expires:now+60_000,
  monitoring_paused:0,last_sync:new Date(now).toISOString()};

test('only recent independently confirmed capture reads as Monitoring',()=>{
  assert.equal(monitoringStatus(base,online),'Monitoring');
  const guide=monitoringGuidance(base,online);
  assert.equal(guide.tone,'success');
  assert.match(guide.meaning,/does not prove every broker fill/i);
  assert.equal(monitoringStatus({...base,last_sync:undefined},online),'Waiting for first sync');
  assert.equal(monitoringGuidance({...base,last_sync:undefined},online).tone,'warning');
});

test('pairing, intentional pause and administrator stop cannot read as active capture',()=>{
  assert.equal(monitoringStatus(base,offline),'Waiting for PC');
  assert.match(monitoringGuidance(base,offline).nextStep,/Signal Desk/);
  assert.equal(monitoringStatus({...base,monitoring_paused:1},online),'Monitoring paused');
  assert.match(monitoringGuidance({...base,monitoring_paused:1},online).nextStep,/Resume monitoring/);
  assert.equal(monitoringStatus(base,online,true),'Staging capture paused');
});

test('integrity review and recovery retain their independent evidence states',()=>{
  assert.equal(monitoringStatus({...base,evidence_conflicts_pending:3},online),'Evidence review required');
  assert.match(monitoringGuidance({...base,evidence_conflicts_pending:3},online).nextStep,/evidence conflict/i);
  assert.equal(monitoringStatus({...base,recovery:{
    state:'catching_up',scanned_through:0,target_at:now,unresolved_positions:1,
    unobserved_stop_changes:0,updated_at:new Date(now).toISOString()
  }},online),'Recovering trade history');
  assert.match(monitoringGuidance({...base,recovery:{
    state:'awaiting_broker_history',scanned_through:0,target_at:now,unresolved_positions:1,
    unobserved_stop_changes:0,updated_at:new Date(now).toISOString()
  }},online).meaning,/cannot yet be reconciled/i);
});

test('login failure never receives a success tone',()=>{
  const failed:Link={...base,status:'failed'};
  assert.equal(monitoringGuidance(failed,online).tone,'danger');
  assert.match(monitoringGuidance(failed,online).nextStep,/fresh verification/);
});

test('invalid and future-dated broker evidence cannot become green',()=>{
  for(const last_sync of ['not-a-timestamp','',new Date(now+86400000).toISOString()]){
    assert.equal(monitoringStatus({...base,last_sync},online),'Waiting for fresh data');
    assert.equal(monitoringGuidance({...base,last_sync},online).tone,'warning');
  }
  assert.equal(pcOnline({...online,last_seen:now+86400000}),false);
  assert.equal(pcOnline({...online,last_seen:Number.NaN}),false);
  assert.equal(pcOnline(offline),false);
});
