import fs from 'node:fs';
import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url);
const read=p=>fs.readFileSync(new URL(p,root),'utf8');
const html=read('desktop-ui/index.html'),css=read('desktop-ui/assets/signal-desk.css'),app=read('desktop-ui/assets/signal-desk.js');
const bridge=read('desktop-ui/assets/native.js'),conf=JSON.parse(read('src-tauri/tauri.conf.json'));
const permission=JSON.parse(read('src-tauri/capabilities/default.json'));
assert.match(html,/assets\/native\.js/);assert.match(html,/assets\/signal-desk\.js/);
assert(!/<script>/.test(html),'Production must not embed executable scripts in HTML');
assert(css.includes('native-overview-art'));assert(app.includes('YMFXNative.install'));
assert(bridge.includes('copy_permission_available:false'));
assert(bridge.includes("x.status==='monitoring'"),'An online PC must not masquerade as verified broker capture');
assert(!bridge.includes('demo: true'));
assert(conf.bundle.externalBin.includes('binaries/ymfx-bridge'));
const shell=permission.permissions.find(p=>typeof p==='object'&&p.identifier==='shell:allow-spawn');
assert(shell&&shell.allow.length===1&&shell.allow[0].name==='binaries/ymfx-bridge'&&shell.allow[0].args===false);
for(const method of ['snapshot','scan_terminals','pair_pc','stop_monitoring','start_monitoring'])
  assert(bridge.includes(`'${method}'`));
console.log('Static design, safety boundaries and Tauri packaging contracts passed');