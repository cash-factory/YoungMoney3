import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read=path=>readFileSync(path,'utf8');
const app=read('src/App.tsx'),layout=read('src/components/Layout.tsx');
const theme=read('src/context/ThemeContext.ts');
const palette=read('src/components/ColorPaletteControl.tsx');
const landing=read('src/pages/LandingPage.tsx');
const admin=read('src/pages/AdminOperationsPage.tsx');
const connect=read('public/mt5-login.html');

test('landing, login, optional setup and every workspace navigation target remain available',()=>{
  for(const marker of ['<LandingPage','<AuthPage','<OnboardingPage','<DashboardPage','<Mt5Connections']) {
    assert.ok(app.includes(marker),'Missing application entry: '+marker);
  }
  assert.ok(app.includes('onboardingNeeded &&'),'Workspace setup must stay optional');
  const pages=Array.from(layout.matchAll(/\{ id: '([a-z-]+)', label:/g),match=>match[1]);
  for(const id of pages){
    if (!['home','journal','playbook','testing','accounts','insights','more'].includes(id)) assert.ok(app.includes(`page === '${id}'`),`Navigation page ${id} has no renderer`);
  }
  assert.ok(landing.includes('ColorPaletteControl'),'Landing must offer appearance settings');
  assert.ok(palette.includes('aria-pressed'),'Palette selection must be accessible');
});

test('premium palettes use unique identifiers, swatches and accent groups',()=>{
  const entries=Array.from(theme.matchAll(/\{ id: '([^']+)', name: '([^']+)', detail: '[^']+', swatch: '(#[0-9a-fA-F]{6})', accents: \['([^']+)','([^']+)','([^']+)'\] \}/g));
  assert.ok(entries.length>=10,`Expected curated palettes, found ${entries.length}`);
  for(const indexes of [[1,'id'],[2,'name'],[3,'swatch']]){
    const distinct=new Set(entries.map(m=>m[indexes[0]]));
    assert.equal(distinct.size,entries.length,`Duplicate palette ${indexes[1]}`);
  }
  const triples=entries.map(m=>m.slice(4,7).join('-'));
  assert.equal(new Set(triples).size,triples.length,'Accent collections must be distinct');
});

test('admin operations stay on their own role-gated route; MT5 login is clearly capture-only',()=>{
  assert.ok(app.includes("profile?.role === 'admin'"),'Admin page must be gated by role');
  assert.ok(layout.includes("profile?.role === 'admin'"),'Admin navigation must be hidden for normal members');
  assert.ok(admin.includes("Issue recovery code") && admin.includes("Revoke sessions") || admin.includes("revoke-sessions"),'Admin operations must offer account recovery and session controls');
  assert.ok(connect.includes('investor or standard') && connect.includes('Capture only:'),'Broker connection must explain allowed credentials and lack of execution');
});
