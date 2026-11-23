import assert from 'node:assert/strict';
import {build} from 'esbuild';
const artifact=await build({entryPoints:['worker/copySignals.ts'],bundle:true,
  platform:'node',format:'esm',write:false});
const moduleURL='data:text/javascript;base64,'+Buffer.from(artifact.outputFiles[0].text).toString('base64');
const {deriveCopySignals,validCopyItem,validCopyProof}=await import(moduleURL);

const now=Date.now();
const source=(key,kind,type,changes={})=>({
  key,kind,symbol:'EURUSD',type,volume:0.3,price:1.1,
  sl:1.09,tp:1.2,stoplimit:0,expiration:0,time_ms:now-100,...changes,
});
const position=source('position:123','position',0);
const pending=source('pending:222','pending',4);
assert.ok(validCopyItem(position));
assert.ok(validCopyItem(pending));
assert.equal(validCopyItem({...position,volume:-1}),false);
assert.equal(validCopyItem({...position,key:'../../fake'}),false);
assert.equal(validCopyItem({...position,type:4}),false);
assert.equal(validCopyProof({key:position.key,kind:'closed',ticket:'456',time_ms:now}),true);
assert.equal(validCopyProof({key:position.key,kind:'closed',ticket:'BAD',time_ms:now}),false);

const opened=deriveCopySignals([], [position,pending], [], now);
assert.deepEqual(opened.map(x=>x.action).sort(),['open_market','place_pending']);
assert.equal(deriveCopySignals([],[{...position,time_ms:now-60_000}],[],now).length,0,
  'Do not execute stale market entries found on reconnect.');
assert.equal(deriveCopySignals([],[{...pending,time_ms:now-60_000}],[],now).length,0,
  'Do not backfill pending orders without explicit user approval after an offline gap.');
const update=deriveCopySignals([position,pending],[
  {...position,sl:1.095,tp:1.3},
  {...pending,price:1.11,stoplimit:1.107,tp:1.3},
],[],now);
assert.deepEqual(update.map(x=>x.action).sort(),['modify_pending','modify_sl_tp']);

assert.equal(deriveCopySignals([position],[],[],now).length,0,
  'Missing source position is not evidence of closure.');
const finalProof={key:position.key,kind:'closed',ticket:'456',time_ms:now-100};
assert.equal(deriveCopySignals([position],[],[finalProof],now)[0].action,'close_position');
assert.equal(deriveCopySignals([position],[],[{...finalProof,time_ms:now-60000}],now).length,0);
assert.equal(deriveCopySignals([position],[{...position,volume:0.1}],[],now).length,0,
  'Unverified volume drop cannot close any follower volume.');
const partial={key:position.key,kind:'reduced',ticket:'456',time_ms:now-100};
const reduction=deriveCopySignals([position],[{...position,volume:0.1}],[partial],now);
assert.equal(reduction.length,1);
assert.equal(reduction[0].action,'reduce_position');
assert.ok(Math.abs(reduction[0].source_volume-0.2)<1e-9);

assert.equal(deriveCopySignals([pending],[],[],now).length,0,
  'Pending disappearance could be fill, cancellation or expiry; never blindly cancel.');
const cancelProof={key:pending.key,kind:'cancelled',ticket:'222',time_ms:now-100};
assert.equal(deriveCopySignals([pending],[],[cancelProof],now)[0].action,'cancel_pending');
assert.equal(deriveCopySignals([pending],[],[{...cancelProof,ticket:'unverified'}],now).length,0);
console.log('Copy signals: market/pending, stop-limit modifications, proven close/cancel/partial, stale gap and missing-order guards passed.');
