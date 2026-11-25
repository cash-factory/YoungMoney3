import fs from 'node:fs';
import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url);
const read=p=>fs.readFileSync(new URL(p,root),'utf8');
const html=read('desktop-ui/index.html'),css=read('desktop-ui/assets/signal-desk.css'),app=read('desktop-ui/assets/signal-desk.js');
const bridge=read('desktop-ui/assets/native.js'),conf=JSON.parse(read('src-tauri/tauri.conf.json'));
const permission=JSON.parse(read('src-tauri/capabilities/default.json'));
assert.match(html,/assets\/native\.js/); assert.match(html,/native\.css/);assert.match(html,/assets\/signal-desk\.js/);
assert(!/<script>/.test(html),'Production must not embed executable scripts in HTML');
assert(css.includes('native-overview-art'));assert(app.includes('YMFXNative.install'));
assert(bridge.includes('copy_permission_available:false'));
assert(bridge.includes('function patchNode(') && bridge.includes('lastSnapshotKey'), 'The native connector must keep DOM nodes stable across identical polls');
assert(app.includes('YMFXNative.patch('), 'Native desktop refresh must use keyed reconciliation rather than replacing the whole window');
assert(!bridge.includes('authorize_live_copy'), 'The new bridge must not unlock local trading');
assert(bridge.includes("x.status==='monitoring'"),'An online PC must not masquerade as verified broker capture');
assert(!bridge.includes('demo: true'));
assert(conf.bundle.externalBin.includes('binaries/ymfx-bridge'));
const shell=permission.permissions.find(p=>typeof p==='object'&&p.identifier==='shell:allow-spawn');
assert(shell&&shell.allow.length===1&&shell.allow[0].name==='binaries/ymfx-bridge'&&shell.allow[0].args===false);
for(const method of ['snapshot','scan_terminals','pair_pc','add_account','open_account_terminal','stop_monitoring','start_monitoring','retry_session','rename_session','remove_session'])
  assert(bridge.includes(`'${method}'`));
console.log('Static design, safety boundaries and Tauri packaging contracts passed');

assert(bridge.includes('prepare-account-setup') && bridge.includes('native-account-label'),'Account creation must be a local MT5 terminal action');
assert(bridge.includes('model.user') && !bridge.includes('model.device)'), 'Connector sidebar must identify user and account, not computer');