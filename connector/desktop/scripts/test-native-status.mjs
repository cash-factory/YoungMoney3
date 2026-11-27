import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source=readFileSync(new URL('../desktop-ui/assets/native.js',import.meta.url),'utf8');
function section(start,end){
  const from=source.indexOf(start),to=source.indexOf(end,from+start.length);
  assert.ok(from>=0&&to>from,'Native status contract must be present: '+start);
  return source.slice(from,to);
}
// Execute only the real, unchanged pure native status helpers: no fake broker or UI claims.
const describeStatus=new Function('model',section('function statusLabel(){','const statusTone=')+'return statusLabel();');
const nextAction=new Function('model','s',section('function sessionNextStep(s){','function editableSession(s){')+'return sessionNextStep(s);');
const sample={paired:true,connection_state:'connected',capture_active:true,sessions:[
  {id:'a',status:'monitoring'},{id:'b',status:'not-verified'}]};
assert.match(describeStatus(sample),/1 of 2 MT5 account\(s\) monitoring/);
assert.match(describeStatus({...sample,sessions:[{id:'b',status:'not-verified'}]}),/no confirmed account capture/);
assert.match(describeStatus({...sample,paired:false}),/Not paired/);
assert.match(nextAction(sample,{verified_link:false,terminal_present:true}),/scan this PC/i);
assert.match(nextAction(sample,{verified_link:true,terminal_present:false}),/Open the saved MT5 terminal/);
assert.match(nextAction(sample,{verified_link:true,terminal_present:true,enabled:false}),/paused/);
assert.match(nextAction(sample,{verified_link:true,terminal_present:true,enabled:true,status:'monitoring'}),/latest broker records/);
assert.match(source,/Signal Desk cannot grant consent or arm fleets yet/);
console.log('Native session status and safe next-actions: contract checks passed');
