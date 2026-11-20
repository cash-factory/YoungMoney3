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
  for(const id of ['dashboard','strategies','journal','weekly-reviews']) {
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
test('all twelve themes retain independent light/dark surfaces and recognizable preview swatches',()=>{
  const css=read('src/index.css');
  const paletteComponent=read('src/components/ColorPaletteControl.tsx');
  for(const id of ['true-pink','tiffany','charcoal-violet','cyprus','turmeric','obsidian','sapphire-night','black-opal','royal-amethyst','champagne-noir','craftylabs-studio']) {
    assert.ok(css.includes(':root[data-palette="'+id+'"]'),id+' missing light theme');
    assert.ok(css.includes('.dark[data-palette="'+id+'"]'),id+' missing dark theme');
  }
  assert.ok(paletteComponent.includes('aria-pressed={theme'), 'Light/dark controls should be accessible');
  assert.ok(paletteComponent.includes('activePalette.accents'), 'Palette previews should show distinct colour triples');
});
test('CraftyLabs Studio is the new default without removing True Pink or overriding saved choices',()=>{
  const provider=read('src/context/ThemeProvider.tsx');
  assert.ok(theme.includes("export const DEFAULT_COLOR_PALETTE: ColorPalette = 'craftylabs-studio';"));
  assert.ok(theme.includes('palette: DEFAULT_COLOR_PALETTE'), 'Context fallback should match the studio default');
  assert.ok(provider.includes('return isPalette(saved) ? saved : DEFAULT_COLOR_PALETTE;'), 'Saved valid preferences must win over the default');
  assert.ok(provider.includes("readPreference('journal-palette')"));
  assert.ok(provider.includes("savePreference('journal-palette', palette)"));
  assert.ok(theme.includes("id: 'true-pink', name: 'True Pink'"), 'The pink theme must remain available');
  assert.ok(palette.includes('setPalette(option.id)'), 'Users must still be able to select any palette');
});

test('CraftyLabs Studio is a distinct black, red and white editorial trading theme',()=>{
  const css=read('src/index.css');
  const layout=read('src/components/Layout.tsx');
  const landing=read('src/pages/LandingPage.tsx');
  const theme=read('src/context/ThemeContext.ts');
  const picker=read('src/components/ColorPaletteControl.tsx');
  const entries=Array.from(theme.matchAll(/\{ id: '([^']+)', name: '([^']+)', detail: '[^']+', swatch: '(#[0-9a-fA-F]{6})', accents: \['([^']+)','([^']+)','([^']+)'\] \}/g));
  assert.equal(entries.length,12,'New palette must be in addition to the existing eleven');
  assert.ok(theme.includes("id: 'craftylabs-studio', name: 'CraftyLabs Studio'"));
  assert.ok(theme.includes("accents: ['#080808','#ff2145','#f8f8f8']"));
  assert.ok(picker.includes('COLOR_PALETTES.length'),'Palette count should not be hard-coded');
  assert.ok(css.includes(':root[data-palette="craftylabs-studio"]'));
  assert.ok(css.includes('.dark[data-palette="craftylabs-studio"]'));
  assert.ok(css.includes('--bg-primary:#080809'),'Dark surfaces should be near-black');
  assert.ok(css.includes('--brand:#ff2145'),'Dark accent should be vivid signal red');
  assert.ok(css.includes('--text-primary:#fafafa'),'Dark headings should remain legible');
  assert.ok(layout.includes('className="ym-studio-stripe" aria-hidden="true"'));
  assert.ok(css.includes('.ym-studio-landing-ticker'),'Welcome page should gain angled editorial banner only for this palette');
  assert.ok(landing.includes('className="ym-studio-landing '));
  assert.ok(css.includes('prefers-reduced-motion'),'Respect motion sensitivity');
});


test('workflow ribbon keeps every stage visible and stationary in all palettes',()=>{
  const css=read('src/index.css');
  assert.ok(landing.includes('className="ym-workflow-ribbon"'));
  assert.ok(landing.includes('aria-label="Your trading workflow"'));
  assert.ok(landing.includes('<ol className="ym-workflow-ribbon">'));
  assert.ok(landing.includes('workflowSteps.map(step =>'));
  assert.ok(landing.includes('ym-workflow-ribbon-label'));
  assert.ok(landing.includes('ym-workflow-ribbon-number'));
  assert.ok(!landing.includes('[...workflowSteps, ...workflowSteps]'),'Duplicated track can run out or leave empty space');
  assert.ok(!landing.includes('animate-ticker'),'Homepage ribbon must not translate offscreen');
  assert.ok(css.includes('grid-template-columns:repeat(4,minmax(0,1fr))'),'Desktop must show four steps');
  assert.ok(css.includes('grid-template-columns:repeat(2,minmax(0,1fr))'),'Mobile must show all stages in two rows');
  assert.ok(css.includes('.ym-workflow-ribbon > li'),'Steps need shared alignment rules');
  assert.ok(css.includes('.ym-workflow-ribbon-label'),'Labels must not be cut off');
  assert.ok(css.includes('animation:none'),'Ribbon must stay visible regardless of motion preferences');
  assert.ok(css.includes('skewY(1.25deg)'),'Preserve the editorial ribbon presentation');
});

test('homepage icons use a single accessible, predictable geometry component',()=>{
  const component=read('src/components/LandingIcon.tsx');
  const css=read('src/index.css');
  assert.equal((landing.match(/<LandingIcon /g)||[]).length,6, 'Feature and tool cards should use shared LandingIcon');
  assert.equal((landing.match(/<BrandLogo /g)||[]).length,2, 'Header and footer should use the production brand mark');
  for(const icon of ['item.icon','f.icon','s.icon','BookOpen','TrendingUp']) {
    assert.ok(landing.includes('icon={'+icon+'}'),icon+' must use the shared component');
  }
  assert.doesNotMatch(landing,/<(?:section|item|f|s)\.icon\b/, 'No raw SVG feature glyph should bypass canonical icon geometry');
  assert.ok(component.includes("import type { LucideIcon }"),'Keep one icon library');
  assert.ok(component.includes('strokeWidth={1.9}'), 'Normalize optical stroke weight');
  assert.ok(component.includes('aria-hidden="true"'), 'Decorative icons must not repeat adjacent readable labels');
  for(const token of ['--landing-icon-box-sm','--landing-icon-box-md','--landing-icon-box-lg','--landing-icon-glyph-sm','--landing-icon-glyph-md','--landing-icon-glyph-lg',
    '--landing-icon-surface','--landing-icon-fg','--landing-icon-border','--landing-icon-hover','--landing-icon-active']) {
    assert.ok(css.includes(token),token+' must be a shared semantic homepage icon token');
  }
  for(const selector of ['.landing-icon__glyph','.landing-icon--sm','.landing-icon--lg','.landing-icon--solid',
    '.landing-icon--desktop','.landing-step-number','@media (max-width:639px)','@media (min-width:640px)',
    '@media (forced-colors:active)','@media (prefers-reduced-motion:reduce)',':focus-visible .landing-icon']) {
    assert.ok(css.includes(selector),selector+' must retain icon design and accessibility behavior');
  }
});

test('annotated CraftyLabs page refresh retains functional content and loads original visual assets',()=>{
  const css=read('src/index.css');
  const auth=read('src/pages/AuthPage.tsx');
  const select=read('src/components/ThemedSelect.tsx');
  const dashboard=read('src/pages/DashboardPage.tsx');
  const entity=read('src/components/EntitySelect.tsx');
  for(const id of ['platform','features','practice','how'])assert.ok(landing.includes('id="'+id+'"'),'Public anchor should remain navigable: '+id);
  for(const selector of ['ym-platform-chapter','ym-platform-chapter-number','ym-editorial-banner','ym-intelligence-banner',
    'ym-practice-banner','ym-feature-tile','ym-process-stack','ym-process-step','ym-studio-footer','ym-footer-art']) {
    assert.ok(landing.includes(selector),'Missing requested homepage visual treatment: '+selector);
  }
  for(const art of ['studio-intelligence.svg','studio-journal.svg','studio-auth.svg','studio-wave.svg']) {
    const file=read('public/visuals/'+art);
    assert.ok(file.includes('<svg')&&file.includes('viewBox='),'Invalid vector artwork: '+art);
    assert.ok(file.includes('role="img"'),'Artwork should have an accessible description');
    // Older art files remain available, but new page-specific artwork replaces
    // the former repeated image in the authentication and workspace headers.
    if (art !== 'studio-auth.svg') {
      assert.ok((landing+auth).includes('/visuals/'+art),'Original landing art must remain usable: '+art);
    }
  }
  for(const token of ['.ym-platform-chapter','.ym-editorial-banner','.ym-feature-grid','.ym-process-stack',
    '.ym-studio-footer','.ym-auth-form-art','.ym-auth-showcase-art','.ym-dash-topic-mark','.ym-studio-stripe']) {
    assert.ok(css.includes(token),'Missing style: '+token);
  }
  assert.ok(landing.includes('prefers-reduced-motion')||css.includes('prefers-reduced-motion'),'Motion safety must be preserved');
  assert.ok(dashboard.includes('ym-dash-topic-mark'),'The overview chapter should have its red editorial accent');
  assert.ok(select.includes('role="combobox"')&&select.includes('role="listbox"')&&select.includes('aria-activedescendant'),
    'Custom menus must preserve discoverable keyboard semantics');
  assert.ok(select.includes("event.key === 'Escape'")&&select.includes("event.key === 'ArrowDown'"),
    'Custom menus need escape and arrow-key navigation');
  assert.ok(dashboard.includes('<ThemedSelect'),'Main account and performance filters need custom themed options');
  assert.ok(entity.includes('<ThemedSelect'),'Shared entity forms need custom themed options');
  assert.ok(css.includes('select.input-field option'),'Unconverted native selects still need palette-specific option styling');
  assert.ok(theme.includes("id: 'true-pink', name: 'True Pink'"),'True Pink must remain selectable');
});


test('every workspace page has its own text-free design image next to real headings',()=>{
  const source=read('src/components/PageExperience.tsx');
  const header=read('src/components/ui/SectionHeader.tsx');
  const styling=read('src/platform-studio.css')+read('src/surface-composition.css');
  const ids=['dashboard','trades','journal','calendar','weekly-reviews','trading-plan',
    'strategies','setups','risk-management','goals','market-sessions','strategy-testing',
    'brokers-charting','analytics','ai','media','resources','notes','study-material',
    'account-settings','admin-operations','mt5','workspace-setup'];
  for (const id of ids) {
    const path='/assets/page-art/'+id+'.svg';
    assert.ok(source.includes("art: '"+path+"'"),'Missing unique page mapping '+id);
    const art=read('public'+path);
    assert.ok(art.startsWith('<svg ')&&art.includes('viewBox="0 0 960 540"'),'Asset is not a scalable SVG: '+id);
    assert.doesNotMatch(art,/<text(?:\s|>)/i,'Page art must not contain baked-in headings: '+id);
    assert.ok(art.includes('aria-labelledby="title desc"'),'Decorative source should be described outside the site');
  }
  const examples=['welcome','sign-in'];
  for(const id of examples) {
    const art=read('public/assets/page-art/'+id+'.svg');
    assert.doesNotMatch(art,/<text(?:\s|>)/i,id+' art must not have embedded headline copy');
  }
  assert.ok(header.includes('src={experience.art}'),'Show exactly the art configured for each page');
  assert.ok(header.includes('alt=""'),'Decorative art must not double-announce the real heading');
  assert.ok(header.includes('{title}'),'Page heading must remain editable HTML');
  assert.ok(header.includes('{subtitle}'),'Explanatory copy must remain editable HTML');
  assert.ok(header.includes('{action}'),'Page actions must remain interactive');
  assert.ok(styling.includes('[data-workspace-page] .ym-page-heading-main'));
  assert.ok(styling.includes('[data-workspace-page] .ym-page-art img'));
  assert.match(styling,/@media\s*\(max-width:639px\)/,'Mobile composition must preserve readable copy');
  assert.ok(read('src/pages/DashboardPage.tsx').includes('/assets/page-art/dashboard.svg'));
  assert.ok(read('src/pages/LandingPage.tsx').includes('/assets/page-art/welcome.svg'));
  assert.ok(read('src/pages/AuthPage.tsx').includes('/assets/page-art/sign-in.svg'));
  assert.ok(read('src/pages/OnboardingPage.tsx').includes('/assets/page-art/workspace-setup.svg'));
});

test('connector visual refresh preserves read-only capture and editable headings',()=>{
  const connector=read('connector/connector_gui.py');
  const graphic=read('connector/assets/connector-scene.svg');
  assert.ok(connector.includes('ACCENT = "#ff365c"'),'Connector should share studio-red accent');
  assert.ok(connector.includes('BACKGROUND = "#09090d"'),'Connector surfaces should be obsidian-dark');
  assert.ok(connector.includes('def _draw_header_art('),'Connector panels need native, dependency-free illustrations');
  assert.ok(connector.includes('def _stack_heading('),'Connector heading must remain real text');
  assert.ok(connector.includes('READ-ONLY  •  NO TRADING COMMANDS'),'Read-only safety language must be retained');
  assert.ok(graphic.startsWith('<svg ')&&!/<text(?:\s|>)/i.test(graphic),'Standalone connector artwork must be text-free');
});

test('all homepage icons meet contrast targets in each of twelve light and dark palettes',()=>{
  const css=read('src/index.css');
  const ids=Array.from(theme.matchAll(/\{ id: '([^']+)', name:/g),m=>m[1]);
  assert.equal(ids.length,12, 'Do not silently remove an existing palette');
  const cssBlock=selector=>{
    const start=css.indexOf(selector+' {');
    assert.notEqual(start,-1,selector+' has no CSS declaration');
    return css.slice(start,css.indexOf('}',start)+1);
  };
  const hexToken=(selector,token)=>{
    const value=cssBlock(selector).match(new RegExp('--'+token+'\\s*:\\s*(#[0-9a-fA-F]{6})'));
    assert.ok(value,selector+' is missing '+token+' token');
    return [1,3,5].map(i=>Number.parseInt(value[1].slice(i,i+2),16));
  };
  const mix=(a,b,amount)=>a.map((channel,index)=>channel*amount+b[index]*(1-amount));
  const luminance=rgb=>rgb.map(channel=>{
    const normalized=channel/255;
    return normalized<=.04045?normalized/12.92:Math.pow((normalized+.055)/1.055,2.4);
  }).reduce((total,channel,index)=>total+channel*[.2126,.7152,.0722][index],0);
  const contrast=(a,b)=>{
    const first=luminance(a),second=luminance(b);
    return (Math.max(first,second)+.05)/(Math.min(first,second)+.05);
  };
  const tint=(selector)=>{
    const match=cssBlock(selector).match(/--landing-icon-surface:\s*color-mix\(in srgb, var\(--brand\) (\d+)%, var\(--bg-card\)\)/);
    assert.ok(match,selector+' missing semantic surface mix');
    return Number(match[1])/100;
  };
  const lightTint=tint('.ym-studio-landing');
  const darkTint=tint(':root.dark[data-palette] .ym-studio-landing');
  let tested=0;
  for(const id of ids){
    for(const mode of ['light','dark']){
      const selector=id==='original'
        ? (mode==='light'?':root':'.dark')
        : (mode==='light'?':root[data-palette="'+id+'"]':'.dark[data-palette="'+id+'"]');
      const brand=hexToken(selector,'brand');
      const card=hexToken(selector,'bg-card');
      const foreground=hexToken(selector,mode==='light'?'brand-dark':'brand-light');
      const surface=mix(brand,card,mode==='light'?lightTint:darkTint);
      assert.ok(contrast(foreground,surface)>=4.5,id+' '+mode+' soft icon foreground is not sufficiently visible');
      const solidBackground=mix(brand,[0,0,0],.55);
      assert.ok(contrast([255,255,255],solidBackground)>=4.5,id+' '+mode+' solid icon has insufficient contrast');
      tested+=1;
    }
  }
  assert.equal(tested,24,'Check every light/dark combination, not only the default');
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
    '<DecisionDesk',
    'id="ym-risk"',
    'id="ym-performance"',
    'className="ym-dash-metric-grid"',
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


test('historical trade import UI supports lookback, all broker history and deposit anchors',()=>{
  const mt5=read('src/components/Mt5Connections.tsx');
  assert.ok(mt5.includes("useState('30')"),'30-day default must remain selected');
  for(const mode of ['days','from_date','all','since_last_deposit','since_first_deposit']){
    assert.ok(mt5.includes('<option value="'+mode+'">'),'Missing history selection '+mode);
  }
  assert.ok(mt5.includes('type="date"'),'Specific starting date must be available');
  assert.ok(mt5.includes('Review earlier trades'),'History must still require review');
  assert.ok(mt5.includes('opening_protection_provenance'),'Historical SL/TP provenance must be visible');
});

test('failed MT5 login attempts are removable without affecting connected accounts',()=>{
  const mt5=read('src/components/Mt5Connections.tsx');
  assert.ok(mt5.includes("['failed','expired']"));
  assert.ok(mt5.includes("action('remove-failed'"));
  assert.ok(mt5.includes("action('clear-failed'"));
  assert.ok(mt5.includes("window.confirm("),'Removal must be confirmed');
});

test('staging MT5 Connections downloads the latest published Windows installer directly',()=>{
  const mt5=read('src/components/Mt5Connections.tsx');
  const page=read('public/connector-download.html');
  const tag='staging-connector-v0.5.3-rc1';
  const executable='https://github.com/cash-factory/YoungMoney3/releases/download/'+tag+'/YoungMoney3.Connector.exe';
  const checksum=executable+'.sha256';
  assert.ok(mt5.includes('href="'+executable+'"'),'Download Connector must go directly to latest official executable');
  assert.ok(mt5.includes('Download Connector v0.5.3-rc1'),'Users must know the version they are getting');
  assert.ok(mt5.includes('href="/connector-download.html"'),'Release details must be accessible next to the main download');
  assert.ok(page.includes('href="'+executable+'"'),'Release page must provide a working link without GitHub API');
  assert.ok(page.includes('href="'+checksum+'"'),'Show the published checksum next to the executable');
  assert.ok(page.includes('id="digest"'),'The download page must show checksum verification instructions');
  assert.ok(page.includes('92716f36a60318d37646e419f8e7f9fbdf554d0e5817445f47796673ea37fd46'),'Published Windows executable checksum must match the designated release');
  assert.ok(!page.includes('fb0e1f41a59fb44899c82d2f0139871bd6d081b03bb896df0571e8aa8e644c78'),'Never reuse the old connector checksum for a new release');
  assert.ok(page.includes('fetch(\'https://api.github.com/repos/cash-factory/YoungMoney3/releases?per_page=30\''),'Keep newer release discovery available');
});

test('staging connector download accepts GitHub-sanitized asset filenames',()=>{
  const page=read('public/connector-download.html');
  assert.ok(page.includes('YoungMoney3(?:[. -])Connector'), 'GitHub may replace whitespace in filenames');
  assert.ok(page.includes('Connector\\.exe'), 'Both Windows exe and checksum must be detected');
  assert.ok(page.includes('staging-connector-v'), 'Only staging prerelease tags should be eligible');
  assert.ok(page.includes('row.prerelease && !row.draft'), 'Do not link unreviewed or production releases');
  assert.ok(page.includes('row.browser_download_url.startsWith(base)'), 'Only official repo assets may be linked');
});


test('Field Guide is a real skippable and replayable journey through platform features',()=>{
  const guide=read('src/components/PlatformGuide.tsx');
  const stops=read('src/lib/platformGuide.ts');
  const css=read('src/platform-guide.css');
  const app=read('src/App.tsx');
  const shell=read('src/components/Layout.tsx');
  const dash=read('src/pages/DashboardPage.tsx');
  const auth=read('src/context/AuthProvider.tsx');
  const workflow=read('.github/workflows/platform-visual.yml');
  assert.equal([...stops.matchAll(/  \{ id: '[^']+', label: /g)].length,22,
    'Every feature destination must be a named live page target');
  for (const token of [
    "id: 'desk'","id: 'filters'","id: 'capture'","id: 'journal'",
    "id: 'mt5'","id: 'testing'","id: 'analytics'","id: 'risk'",
    "id: 'appearance'","id: 'search'","id: 'media'",
  ]) assert.ok(stops.includes(token), 'Missing explorer area '+token);
  assert.ok(stops.includes('GUIDE_EXPRESS_ROUTE'),'A curated short route is required');
  assert.ok(stops.includes('GUIDE_STATE_PREFIX + userId'),'Tour state must be per-user');
  assert.ok(stops.includes("status === 'pending'"),'New signup must be offered the guide');
  assert.ok(stops.includes("age < 12 * 60 * 60 * 1000"),'The auto invitation must be limited to newly registered accounts');
  assert.ok(auth.includes("writeGuideState(data.user.id, 'pending', [])"),'Signup must offer guide once');
  assert.ok(app.includes('guideShouldWelcome('),'Existing account settings must control automatic invitation');
  assert.ok(app.includes("completed ? 'completed' : 'dismissed'"),'Skip/complete must persist');
  assert.ok(app.includes('<PlatformGuide'),'Guide must be present in the authenticated workspace');
  assert.ok(guide.includes('pickTarget('),'Guidance should highlight real feature elements');
  assert.ok(guide.includes("onNavigate(next.page)"),'Feature jump must open the correct page');
  assert.ok(guide.includes("setView('hub')"),'Users need a Skip-to directory');
  assert.ok(guide.includes('Search guide destinations'),'The guide should be searchable');
  assert.ok(guide.includes('Skip the tutorial') && guide.includes('Skip tutorial'),
    'Skip must be available in the welcome and the live step');
  assert.ok(guide.includes('aria-modal="true"') && guide.includes('handleKeyDown'),
    'Tutorial must support accessible modal and escape navigation');
  assert.ok(shell.includes('onOpenGuide'),'Tour must be replayable from the global shell');
  assert.ok(dash.includes('Explore platform features'),'Dashboard must offer obvious replay');
  assert.ok(css.includes('prefers-reduced-motion:reduce') && css.includes('max-width:680px'),
    'Tour should work on phones and respect reduced motion');
  assert.ok(workflow.includes('node scripts/test-guide-browser.mjs'),
    'Browser QA must exercise the guide against real UI');
});

test('staging-only populated demo uses a real read-only account and never inserts synthetic trades into real journals',()=>{
  const worker=read('worker/index.ts');
  const landing=read('src/pages/LandingPage.tsx');
  const auth=read('src/context/AuthProvider.tsx');
  const shell=read('src/components/Layout.tsx');
  const staging=read('scripts/prepare-staging.mjs');
  const workflow=read('.github/workflows/rich-staging-release.yml');
  for(const marker of ['DEMO_SHOWCASE_ENABLED','/api/demo/enter','/api/demo/available',
    "user.id===DEMO_MEMBER_ID","request.clone()","action==='select'"])assert.ok(worker.includes(marker),'Missing read-only demo server protection '+marker);
  assert.ok(staging.includes("DEMO_SHOWCASE_ENABLED:'true'"),'Only staging should enable preview');
  assert.ok(landing.includes('Explore sample workspace'),'Landing page should lead invited members to the preview');
  assert.ok(shell.includes('/?showcase=1#dashboard') && shell.includes('View sample trader'),'Signed-in members need a direct sample-workspace link');
  assert.ok(worker.includes("const viewer=await currentUser(request,env.DB)"),'Anonymous users cannot bypass invite-only staging');
  assert.ok(auth.includes("new URLSearchParams(window.location.search).get('showcase')==='1'"),'Direct preview URL should authenticate');
  assert.ok(shell.includes('SAMPLE WORKSPACE · READ ONLY') && shell.includes('Exit demo'),'Every demo page must clearly label synthetic data');
  assert.ok(workflow.includes('write-staging-demo-sql.mjs') && workflow.includes('.demo-showcase-seed.sql'),'Only staging workflow may seed synthetic data');
});

test('market outcome palette is consistent on landing, dashboard, trade ledger and MT5 evidence',()=>{
  const css=read('src/trading-semantic.css');
  const app=read('src/App.tsx');
  const home=read('src/pages/LandingPage.tsx');
  const dashboard=read('src/pages/DashboardPage.tsx');
  const trades=read('src/pages/TradesPage.tsx');
  const mt5=read('src/components/Mt5Connections.tsx');
  const calc=read('src/components/TradeCalculator.tsx');
  const form=read('src/components/TradeForm.tsx');
  const rich=read('src/components/RichLifecycleAnalytics.tsx');
  assert.ok(app.includes("import '@/trading-semantic.css'"),'Semantic trading visuals must be loaded for all themes');
  for(const marker of ['--ym-gain','--ym-loss','--ym-caution','ym-market-sl','ym-market-tp',
    '.ym-direction-tag[data-side="short"]','.ym-ledger-row[data-result="loss"]','.ym-dash-pulse',
    '@media(max-width:600px)','prefers-reduced-motion:reduce']){
    assert.ok(css.includes(marker),'Missing themed market language '+marker);
  }
  assert.ok(!css.includes('data-side="short"] { color:var(--ym-loss)'),
    'Short direction must not be styled as a losing trade');
  assert.ok(home.includes('ym-landing-market-row') && home.includes('ym-landing-sltp'),
    'Public home needs a clear fictional trade preview with SL and TP');
  assert.ok(dashboard.includes('ym-dash-pulse') && dashboard.includes('signedMoney('),
    'Dashboard should show explicit signed outcome figures for selected filters');
  assert.ok(trades.includes('ym-trade-overview') && trades.includes('ym-direction-tag') &&
    trades.includes('ym-market-detail') && trades.includes('signedMoney('),
    'Journal rows need market outcome and protection hierarchy');
  assert.ok(mt5.includes('ym-mt5-lifecycle') && mt5.includes('ym-market-sl') &&
    mt5.includes('ym-market-tp'), 'MT5 lifecycle and history review must preserve red stop / green target semantics');
  assert.ok(calc.includes('ym-stop-input') && calc.includes('ym-market-'),
    'Risk calculation must distinguish estimated losses and profits');
  assert.ok(form.includes('ym-stop-input') && form.includes('ym-target-input') &&
    form.includes('signedMoney('),'Trade capture should have clear protective levels and signed results');
  assert.ok(rich.includes('var(--ym-loss)') && rich.includes('var(--ym-gain)'),
    'Lifecycle chart bins must distinguish negative and positive R');
});

test('paired PCs are named consistently on the dashboard and connector; repeated pairing is guarded',()=>{
  const worker=read('worker/mt5.ts');
  const migration=read('migrations/0014_mt5_pc_identity.sql');
  const site=read('src/components/Mt5Connections.tsx');
  const mobile=read('src/components/AccountMonitor.tsx');
  const types=read('src/lib/mt5Monitor.ts');
  const desktop=read('connector/connector_gui.py');
  const presence=read('connector/presence.py');
  const identity=read('connector/pc_identity.py');
  for(const text of ['installation_hash','pc_name','mt5_owner_installation_active']) {
    assert.ok(migration.includes(text),'Migration must retain identity and label '+text);
  }
  for(const text of ['rename-pc','device/rename','pc_already_paired','pc_identity_mismatch','installationId']) {
    assert.ok(worker.includes(text),'Worker must enforce owner-scoped PC identity '+text);
  }
  assert.ok(site.includes('pairedPcName(d)')&&site.includes('Rename')&&site.includes('Unpair PC')&&
    site.includes("action('rename-pc'")&&site.includes('Pair another PC'),
    'Dashboard must show stable PC names and discourage repeated pairings');
  assert.ok(site.includes('pairedPcName(pc)')&&mobile.includes('Paired PC:')&&types.includes('pc_name'),
    'Account cards and monitors must expose the responsible paired PC');
  assert.ok(desktop.includes('Rename this PC')&&desktop.includes('self.pc_name')&&
    desktop.includes('rename_paired_pc'),'Desktop must share PC names with dashboard');
  assert.ok(presence.includes('installationId')&&presence.includes('name=reply.get'),
    'Presence must advertise stable installation and return remote label');
  assert.ok(identity.includes('uuid.uuid4()')&&identity.includes('Saved PC identity is unreadable'),
    'Corrupted installations cannot silently create duplicate device identity');
});

test('the MT5 workspace uses selective disclosure and names action outcomes',()=>{
  const hub=read('src/components/Mt5Connections.tsx');
  const feedback=read('src/lib/actionFeedback.tsx');
  const css=read('src/connection-hub.css');
  assert.ok(hub.includes('aria-expanded={expanded}')&&hub.includes('accountPanel')&&hub.includes('ym-account-tabs'));
  assert.ok(hub.includes('CashFlowPanel')&&hub.includes('timezone_confirmed_at'));
  assert.ok(hub.includes("'Timezone saved for this broker account")&&hub.includes("announceAction('error'"));
  assert.ok(feedback.includes("'ym:action-result'")&&feedback.includes('role={item.tone'));
  assert.ok(css.includes('prefers-reduced-motion:reduce')&&css.includes('ym-feedback-toast'));
});

test('connection controls, cash provenance, notifications and media layouts are progressive and responsive',()=>{
  const hub=read('src/components/Mt5Connections.tsx');
  const account=read('src/components/CashFlowPanel.tsx');
  const feedback=read('src/lib/actionFeedback.tsx');
  const setup=read('src/pages/OnboardingPage.tsx');
  const library=read('src/pages/MediaLibraryPage.tsx');
  const worker=read('worker/mt5.ts');
  const css=read('src/connection-hub.css');
  const libraryCss=read('src/library-studio.css');
  const setupCss=read('src/onboarding-studio.css');
  assert.ok(hub.includes('ym-pc-accounts')&&hub.includes('ym-pc-account-link')&&hub.includes('aria-expanded={expanded}'),
    'A paired PC must expand into selectable broker accounts');
  assert.ok(hub.includes("accountPanel==='cash'")&&hub.includes("accountPanel==='timezone'"),
    'Each broker account has focused management panels');
  assert.ok(hub.includes('Confirmed {new Date(l.timezone_confirmed_at)')&&hub.includes('announceAction('),
    'Timezone and other actions require visible server-backed feedback');
  assert.ok(feedback.includes('Action unsuccessful')&&feedback.includes('Needs attention'),
    'Global feedback must distinguish action success and failure');
  assert.ok(account.includes("mt5Action('cash-review'")&&account.includes('statementReference'),
    'Broker deposit classification requires statement provenance');
  assert.ok(worker.includes('mt5_cash_review_events')&&worker.includes('performance_baseline_at'),
    'Cash review is audited and period analysis uses the first observed broker snapshot');
  assert.ok(library.includes('ym-library-image-open')&&libraryCss.includes('object-fit:cover'),
    'Thumbnail images must remain prominent and operable with keyboard');
  assert.ok(setup.includes('ym-setup-welcome-grid')&&setupCss.includes('.ym-setup-welcome-grid'),
    'Workspace setup needs composed media and concise guided steps');
  assert.ok(css.includes('ym-cash-review-card')&&css.includes('prefers-reduced-motion'),
    'Financial review and alert animation should respect motion preferences');
});
