import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../desktop-ui/assets/native-updates.js',import.meta.url),'utf8');
const stored=new Map();
const window={
  setTimeout:()=>0,
  setInterval:()=>0,
  __TAURI__:{core:{invoke:async()=>({configured:true,available:true,
    version:'0.3.1',notes:['Improved capture recovery','Cleaner setup']})}},
};
const document={addEventListener:()=>{},hidden:false};
const localStorage={getItem:key=>stored.get(key)||null,setItem:(key,value)=>stored.set(key,value)};
runInNewContext(source,{window,document,localStorage});
const updates=window.YMFXUpdates;
assert.equal(typeof updates.attach,'function');
const operations=[];
let refreshes=0;
const model={source:'local-connector',demo:false,capture_active:true,
  copying_armed:false,copy_permission_available:false,queued_updates:0,
  sessions:[{status:'monitoring'}]};
let bridge=false;
updates.attach({
  getModel:()=>model,
  refreshView:()=>refreshes++,
  request:async(name)=>{operations.push(name);bridge=false;return {}},
  hasBridge:()=>bridge,
  waitForBridgeStop:async()=>{},
  isBusy:()=>false,
});
const evt=name=>({target:{closest:selector=>selector==='[data-native-update]'?
  {dataset:{nativeUpdate:name}}:null}});
assert.equal(updates.handleClick(evt('check')),true);
await new Promise(resolve=>setTimeout(resolve,20));
assert.equal(updates.debug().version,'0.3.1');
assert.equal(updates.debug().canInstall,false);
assert.equal(updates.panel(x=>'<span>'+x+'</span>').includes('Improved capture recovery'),true);
assert.equal(updates.panel(x=>x).includes('disabled'),true);
updates.handleClick(evt('install'));
await new Promise(resolve=>setTimeout(resolve,10));
assert.equal(operations.length,0,'Never install while monitoring is running');
assert.equal(updates.debug().installing,false);
model.capture_active=false;
model.sessions=[];
model.queued_updates=2;
updates.onSnapshot();
await new Promise(resolve=>setTimeout(resolve,10));
assert.equal(operations.length,0,'Pending broker uploads block installation');
model.queued_updates=0;
model.copy_permission_available=true;
updates.onSnapshot();
await new Promise(resolve=>setTimeout(resolve,10));
assert.equal(operations.length,0,'Copy permission blocks installation');
model.copy_permission_available=false;
bridge=true;
window.__TAURI__.core.invoke=async(name)=>{operations.push(name);return {}};
updates.onSnapshot();
await new Promise(resolve=>setTimeout(resolve,20));
assert.deepEqual(operations,['shutdown','install_connector_update'],
  'Stop local sidecar before requesting signature-verified Windows installation');
assert.ok(refreshes>0);
console.log('Signal Desk signed-updater safety checks passed');
