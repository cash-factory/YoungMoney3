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


test('prop-style dashboard emphasizes account context, performance, risk and recent trades before advanced tools',()=>{
  const dashboard=read('src/pages/DashboardPage.tsx');
  const css=read('src/index.css');
  const milestones=[
    'id="ym-overview"',
    'className="ym-dash-metric-grid"',
    'id="ym-risk"',
    'id="ym-performance"',
    'id="ym-recent"',
    'id="ym-deep-dive"',
  ];
  const positions=milestones.map(token=>dashboard.indexOf(token));
  assert.ok(positions.every(index=>index>=0),'The dashboard is missing a primary section');
  assert.ok(positions.every((index,i)=>i===0||index>positions[i-1]),
    'The primary dashboard sections must appear in reading order');
  assert.ok(dashboard.includes('className="ym-dash-jump"'), 'Dashboard needs quick section navigation');
  assert.ok(dashboard.includes('Cumulative closed P&amp;L'),
    'Running closed P&L must not be mislabeled as broker equity');
  assert.ok(dashboard.includes('Balances stay separate across currencies'),
    'Multiple-currency balances must not be presented as one total');
  assert.ok(dashboard.includes('Not a live broker quote.'),
    'Derived journal balance must not be presented as live equity');
  assert.ok(dashboard.includes('Current filters'),
    'Performance context must remain visible to the user');
  assert.ok(css.includes('.ym-dash-balance')&&css.includes('.ym-dash-controls'),
    'The account summary and filter rail must use the consistent dashboard design');
  assert.ok(css.includes('@media (max-width:480px)'),'Compact phone layout must be styled');
});

test('deep-dive analytics are not removed when the home screen is simplified',()=>{
  const dashboard=read('src/pages/DashboardPage.tsx');
  for(const component of [
    'TradeCalculator','RiskGuardian','ActivityHeatmap','Achievements','MoodTracker',
    'StrategyEdgeScore','TradeAttachments','RiskSettingsModal','TradeForm',
  ]) {
    assert.ok(dashboard.includes('<'+component),component+' must remain available');
  }
  assert.match(dashboard,/<details className="ym-dash-details"/);
  assert.match(dashboard,/<summary className="ym-dash-details-trigger"/);
  for(const text of ['challenge_target_pct','daily_loss_limit_pct','max_loss_limit_pct','mixedCurrencyView','tradeOrigin']) {
    assert.ok(dashboard.includes(text),'Existing financial safeguard or filter lost: '+text);
  }
});


test('staging connector download accepts GitHub-sanitized asset filenames',()=>{
  const page=read('public/connector-download.html');
  assert.ok(page.includes('YoungMoney3(?:[. -])Connector'), 'GitHub may replace whitespace in filenames');
  assert.ok(page.includes('Connector\\\\.exe'), 'Both Windows exe and checksum must be detected');
  assert.ok(page.includes('staging-connector-v'), 'Only staging prerelease tags should be eligible');
  assert.ok(page.includes('row.prerelease && !row.draft'), 'Do not link unreviewed or production releases');
  assert.ok(page.includes('row.browser_download_url.startsWith(base)'), 'Only official repo assets may be linked');
});
