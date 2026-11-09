import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertHealthReply,validateStagingUrl } from './check-staging-health.mjs';

test('health must return 200 JSON with a connected D1',()=>{
  const valid={status:200,contentType:'application/json; charset=utf-8',body:JSON.stringify({status:'ok',database:'connected'})};
  assert.equal(assertHealthReply(valid),true);
  for(const bad of [
    {...valid,status:401},
    {...valid,contentType:'text/html'},
    {...valid,body:'<html>website</html>'},
    {...valid,body:'{"status":"unavailable"}'},
    {...valid,body:'{"status":"ok","database":"offline"}'},
  ])assert.throws(()=>assertHealthReply(bad));
});
test('staging smoke refuses unrelated or production Worker URLs',()=>{
  assert.equal(validateStagingUrl('https://ym-fx-staging.account-123.workers.dev','ym-fx-staging'),
    'https://ym-fx-staging.account-123.workers.dev');
  for(const url of [
    'https://ym-fx.account-123.workers.dev',
    'https://ym-fx-staging.evil.example',
    'http://ym-fx-staging.account-123.workers.dev',
    'https://ym-fx-staging.account-123.workers.dev/api/health',
    'https://ym-fx-staging.account-123.workers.dev/?x=1',
  ])assert.throws(()=>validateStagingUrl(url,'ym-fx-staging'));
});
