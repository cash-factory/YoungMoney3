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


test('the original workspace hierarchy gains contextual desktop navigation and a usable phone dock',()=>{
  const css=read('src/index.css');
  for(const id of ['dashboard','trades','journal','analytics']) {
    assert.ok(layout.includes("current === '"+id+"'"),'Mobile dock missing '+id);
  }
  assert.ok(layout.includes('ym-workspace-topbar'),'Missing desktop page-context header');
  assert.ok(layout.includes('ym-mobile-dock lg:hidden'),'Missing mobile dock');
  assert.ok(layout.includes('ym-sidebar-nav'),'Original grouped sidebar must remain');
  assert.ok(layout.includes('onQuickAdd'),'Quick add must remain wired');
  assert.ok(layout.includes('aria-current={active ?'), 'Sidebar should identify current page');
  for(const selector of ['.ym-nav-item[data-active="true"]','.ym-mobile-dock','.ym-stat-card','.ym-auth-showcase','.ym-palette-choice']) {
    assert.ok(css.includes(selector),'Missing responsive theme-aware rule: '+selector);
  }
  assert.ok(css.includes('env(safe-area-inset-bottom)'), 'Mobile dock should honor phone safe area');
  assert.ok(css.includes('prefers-reduced-motion'), 'Motion preferences must remain respected');
});
test('all eleven themes retain independent light/dark surfaces and recognizable preview swatches',()=>{
  const css=read('src/index.css');
  const paletteComponent=read('src/components/ColorPaletteControl.tsx');
  for(const id of ['true-pink','tiffany','charcoal-violet','cyprus','turmeric','obsidian','sapphire-night','black-opal','royal-amethyst','champagne-noir']) {
    assert.ok(css.includes(':root[data-palette="'+id+'"]'),id+' missing light theme');
    assert.ok(css.includes('.dark[data-palette="'+id+'"]'),id+' missing dark theme');
  }
  assert.ok(paletteComponent.includes('aria-pressed={theme'), 'Light/dark controls should be accessible');
  assert.ok(paletteComponent.includes('activePalette.accents'), 'Palette previews should show distinct colour triples');
});
test('performance cards preserve currency, percent and decimal formatting',()=>{
  const cards=read('src/components/ui/StatCard.tsx');
  assert.ok(cards.includes('const isNumeric = /^-?'), 'Numeric detection must not parse currency tokens as plain numbers');
  assert.ok(cards.includes("value.includes('.')"),'Must retain numerical precision when animating');
  assert.ok(cards.includes(' : value}'),'Formatted P&L, percentages and mixed currency states must stay legible');
});
