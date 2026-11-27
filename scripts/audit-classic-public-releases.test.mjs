import assert from 'node:assert/strict';
import test from 'node:test';
import {publicClassicAssets} from './audit-classic-public-releases.mjs';

const target='https://github.com/cash-factory/YoungMoney3/releases/download/staging-connector-v0.6.4-rc1/YoungMoney3.Connector.exe';
const entry=(tag,draft,assets)=>({tag_name:tag,draft,assets});

test('detect public legacy executables even when member website hides them',()=>{
  const rows=[
    entry('staging-connector-v0.6.4-rc1',false,[{name:'YoungMoney3.Connector.exe',browser_download_url:target}]),
    entry('private-draft',true,[{name:'YoungMoney3.Connector.exe',browser_download_url:target}]),
    entry('signaldesk',false,[{name:'YoungMoney3.Signal.Desk_0.4.0_x64-setup.exe',browser_download_url:target}]),
  ];
  const found=publicClassicAssets(rows);
  assert.equal(found.length,1);
  assert.equal(found[0].tag,'staging-connector-v0.6.4-rc1');
});

test('ignore untrusted URLs and reject malformed release inventories',()=>{
  assert.equal(publicClassicAssets([
    entry('invalid',false,[{name:'YoungMoney3.Connector.exe',browser_download_url:'https://example.invalid/other'}])
  ]).length,0);
  assert.throws(()=>publicClassicAssets({releases:[]}),/not an array/);
});
