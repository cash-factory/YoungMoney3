import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source=readFileSync('public/mt5-brokers.js','utf8');
const {normalizeBrokerName,buildBrokerRegistry,getBrokerMatches,getServerSuggestions,suggestServerFormats}=runInNewContext(
  source+'\n({normalizeBrokerName,buildBrokerRegistry,getBrokerMatches,getServerSuggestions,suggestServerFormats})'
);

test('Just Markets, JustMarkets and spacing/punctuation variants find the same broker',()=>{
  const registry=buildBrokerRegistry([],true);
  for(const input of ['Just Markets','justmarkets','JUST-MARKETS','Just Market','justmarkets ','justmarktes']){
    const result=getBrokerMatches(input,registry);
    assert.equal(result[0]?.name,'JustMarkets',input);
  }
  assert.equal(normalizeBrokerName('IC Markets'),'icmarkets');
});
test('JustMarkets demo suggestions do not pretend a company name is a server',()=>{
  const registry=buildBrokerRegistry([],true);
  const broker=registry.find(row=>row.name==='JustMarkets');
  assert.ok(broker);
  const servers=Array.from(broker.servers.values(),row=>row.name);
  assert.ok(servers.includes('JustMarkets-Demo'));
  assert.ok(servers.includes('JustMarkets-Demo2'));
  assert.ok(servers.every(name=>!name.toLowerCase().includes('live')));
  assert.equal(registry.find(row=>row.name==='Weltrade').servers.size,0);
  assert.equal(getBrokerMatches('Unknown New Broker',registry).length,0);
});
test('known user-linked servers are offered without leaking real accounts when live capture is off',()=>{
  const links=[
    {company:'Custom Broker',server:'Custom-Demo-9',status:'connected',trade_mode:0},
    {company:'Custom Broker',server:'Custom-Live-9',status:'connected',trade_mode:2},
    {company:'Unconnected',server:'Unconnected-Demo',status:'failed',trade_mode:0},
  ];
  const demo=buildBrokerRegistry(links,true);
  const row=demo.find(item=>item.name==='Custom Broker');
  assert.equal(row.servers.size,1);
  assert.ok(row.servers.has('custom-demo-9'));
  assert.equal(demo.some(item=>item.name==='Unconnected'),false);
  const all=buildBrokerRegistry(links,false);
  assert.equal(all.find(item=>item.name==='Custom Broker').servers.size,2);
});
test('UI requires confirmed server and exposes accessible broker suggestions',()=>{
  const html=readFileSync('public/mt5-login.html','utf8');
  assert.match(html,/id="broker-results" role="listbox"/);
  assert.match(html,/aria-autocomplete="list"/);
  assert.match(html,/id="server"[^>]*required/);
  assert.match(source,/Select(ed)? broker|Selected broker/);
  assert.match(html,/not MT5's live global directory/);
  assert.match(html,/Capture only:/);
});

test('known MT5 servers match spaced or hyphenated user input without changing the stored server',()=>{
  const links=[
    {company:'Exness',server:'Exness-Real-9',status:'connected',trade_mode:0},
    {company:'Exness',server:'Exness-MT5Real11',status:'connected',trade_mode:0},
  ];
  const registry=buildBrokerRegistry(links,true);
  const one=getServerSuggestions('Exness Real 9',registry,'Exness',true);
  assert.equal(one[0].name,'Exness-Real-9');
  assert.equal(one[0].origin,'linked');
  const two=getServerSuggestions('Exness Real 11',registry,'Exness',true);
  assert.equal(two[0].name,'Exness-MT5Real11');
  assert.equal(two[0].origin,'linked');
});
test('unknown server formatting candidates are always explicitly unverified',()=>{
  const registry=buildBrokerRegistry([],true);
  const matches=getServerSuggestions('Exness Real 9',registry,'Exness',true);
  assert.ok(matches.some(item=>item.name==='Exness-Real-9'));
  assert.ok(matches.some(item=>item.name==='Exness-MT5Real9'));
  assert.ok(matches.every(item=>item.origin==='format'));
  assert.equal(suggestServerFormats('WrongBroker Real 9','Exness').length,0);
  assert.equal(getServerSuggestions('NoSuchBroker Real 9',registry,'',true).length,0);
});
test('live-account links never enter the trusted staging suggestions',()=>{
  const registry=buildBrokerRegistry([
    {company:'Exness',server:'Exness-MT5Real9',status:'connected',trade_mode:2},
  ],true);
  const matches=getServerSuggestions('Exness Real 9',registry,'Exness',true);
  assert.ok(matches.length>0);
  assert.ok(matches.every(item=>item.origin==='format'));
  const allowed=buildBrokerRegistry([
    {company:'Exness',server:'Exness-MT5Real9',status:'connected',trade_mode:2},
  ],false);
  const exact=getServerSuggestions('Exness Real 9',allowed,'Exness',false);
  assert.equal(exact[0].name,'Exness-MT5Real9');
  assert.equal(exact[0].origin,'linked');
});
test('server search is keyboard accessible and submit uses the literal selected server',()=>{
  const html=readFileSync('public/mt5-login.html','utf8');
  const login=readFileSync('public/mt5-login.js','utf8');
  assert.match(html,/id="server-results" role="listbox"/);
  assert.match(html,/id="server"[^>]*aria-autocomplete="list"/);
  assert.match(source,/serverActive/);
  assert.match(login,/byId\('server-choice'\)\.value \|\| byId\('server'\)\.value\.trim\(\)/);
  assert.match(source,/NOT a verified server/);
});
