import assert from 'node:assert/strict';
import test from 'node:test';
import { copyArmIssues,hasLocalCopyEligibility,type CopyArmAccount,type CopyArmFleet,type CopyArmConsent } from './copyArmReadiness.ts';

const now=Date.now();
const source:CopyArmAccount={id:'source',trade_mode:0,access_level:'trading-restricted',monitoring_paused:0,last_seen:now};
const follower:CopyArmAccount={id:'follower',trade_mode:0,access_level:'trading-enabled',monitoring_paused:0,last_seen:now};
const fleet:CopyArmFleet={state:'paused',execution_mode:'demo',source_link:'source',
  targets:[{follower_link:'follower',enabled:1}]};
const consent:CopyArmConsent={follower_link:'follower',demo_authorized:1,authorization_mode:'demo',expires_at:now+60000};

test('source can be capture-only; follower must have separate trading access and current consent',()=>{
  assert.deepEqual(copyArmIssues(fleet,[source,follower],[consent],false,now),[]);
  assert.equal(hasLocalCopyEligibility(source,'demo',now),false);
  assert.equal(hasLocalCopyEligibility(follower,'demo',now),true);
  assert.match(copyArmIssues(fleet,[source,follower],[],false,now).join(' '),/local consent/i);
  assert.match(copyArmIssues(fleet,[source,follower],[{...consent,expires_at:now-1}],false,now).join(' '),/local consent/i);
});

test('account mode and Windows connection freshness block arming',()=>{
  const stale={...follower,last_seen:now-46000};
  assert.match(copyArmIssues(fleet,[source,stale],[consent],false,now).join(' '),/1 enabled follower/);
  const wrongMode={...follower,trade_mode:2};
  assert.match(copyArmIssues(fleet,[source,wrongMode],[consent],false,now).join(' '),/broker mode/i);
  assert.match(copyArmIssues(fleet,[{...source,monitoring_paused:1},follower],[consent],false,now).join(' '),/Source account/);
});

test('live mode requires environment release gate and explicit live consent',()=>{
  const liveFleet:CopyArmFleet={...fleet,execution_mode:'live'};
  const liveSource={...source,trade_mode:2};
  const liveFollower={...follower,trade_mode:2};
  const issues=copyArmIssues(liveFleet,[liveSource,liveFollower],[consent],false,now).join(' ');
  assert.match(issues,/Live execution is disabled/);
  assert.match(issues,/local consent/);
  assert.deepEqual(copyArmIssues(liveFleet,[liveSource,liveFollower],[{...consent,authorization_mode:'live'}],true,now),[]);
});

test('cannot arm an empty follower fleet; armed states do not show pre-arm checklists',()=>{
  assert.match(copyArmIssues({...fleet,targets:[]},[source,follower],[consent],false,now).join(' '),/Enable at least one follower/);
  assert.deepEqual(copyArmIssues({...fleet,state:'demo_armed'},[],[],false,now),[]);
});
