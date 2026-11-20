import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { installDashboardFixtures } from './test-dashboard-browser.mjs';

/** Every write in this scenario is intercepted locally; no real account is modified. */
export async function installWorkspaceSetupFixtures(page) {
  const fixture = await installDashboardFixtures(page);
  const now = new Date().toISOString();
  let risk = { id: 'setup-risk-fixture', user_id: fixture.user.id, account_balance: 12500,
    max_daily_loss_pct: 2, max_daily_trades: 3, max_risk_per_trade_pct: 0.6,
    max_drawdown_pct: 7, daily_loss_limit_amount: 80, created_at: now, updated_at: now };
  const strategies = [{ id: 'setup-existing-strategy', user_id: fixture.user.id, name: 'Existing approach',
    description: 'Keep existing settings when revisiting setup', is_active: true, created_at: now }];
  const checklist = [{ id: 'setup-existing-item', user_id: fixture.user.id,
    strategy_id: strategies[0].id, entry_model_id: null, label: 'Existing entry condition',
    is_required: true, sort_order: 0, is_active: true }];
  const writes = [];
  await page.route('**/api/data', async route => {
    const query = route.request().postDataJSON();
    const answer = data => route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({data,count:data.length})});
    if (query.action === 'select') {
      if (query.table === 'risk_settings') return answer([risk]);
      if (query.table === 'trader_strategies') return answer(strategies);
      if (query.table === 'strategy_checklist_items') return answer(checklist.filter(item => item.strategy_id === query.filters.strategy_id));
      if (query.table === 'trades') return answer([{...fixture.trade, exit_time:null, realized_r:null}]);
      return route.fallback();
    }
    writes.push(query);
    if (query.table === 'risk_settings' && query.action === 'update') {
      assert.equal(query.id, risk.id);
      risk = {...risk,...query.payload};
      return answer([risk]);
    }
    if (query.table === 'trader_strategies' && query.action === 'insert') {
      const row = {...query.payload,id:'setup-created-strategy',user_id:fixture.user.id,created_at:now};
      strategies.push(row); return answer([row]);
    }
    if (query.table === 'strategy_checklist_items' && query.action === 'insert') {
      const rows = (Array.isArray(query.payload) ? query.payload : [query.payload]).map((row,index) =>
        ({...row,id:'setup-created-item-'+index,user_id:fixture.user.id}));
      checklist.push(...rows); return answer(rows);
    }
    throw new Error('Unexpected fixture write: '+JSON.stringify(query));
  });
  return {...fixture,writes,strategies,checklist,getRisk:()=>risk};
}

export async function runWorkspaceSetupChecks(page, fixture) {
  const setup = page.locator('.ym-workspace-setup');
  await setup.getByRole('heading',{name:'Workspace setup',exact:true}).waitFor();
  assert.equal(await setup.getByRole('button',{name:'Appearance settings'}).count(),0,'Use the existing shell appearance control');
  assert.equal(await setup.getByRole('list',{name:'Setup progress'}).locator('li').count(),4);
  assert.equal(await setup.locator('.min-h-screen').count(),0,'Setup must fit inside the workspace shell');
  await setup.getByRole('button',{name:'Get started',exact:true}).click();
  const balance = setup.getByLabel('Planning balance (USD)',{exact:true});
  await balance.waitFor();
  await page.waitForFunction(()=>document.getElementById('setup-account-balance')?.value==='12500');
  await balance.fill('0');
  await setup.getByRole('button',{name:'Continue',exact:true}).click();
  assert.match(await setup.getByRole('alert').textContent(),/valid account balance/);
  assert.equal(fixture.writes.length,0,'Invalid planning balances must never save');
  await balance.fill('20000');
  await setup.getByRole('button',{name:'Continue',exact:true}).click();
  await setup.getByRole('heading',{name:'Give your approach a name.',exact:true}).waitFor();
  const risk = fixture.getRisk();
  assert.equal(risk.account_balance,20000);
  assert.equal(risk.max_daily_loss_pct,2);
  assert.equal(risk.max_risk_per_trade_pct,0.6);
  assert.equal(risk.max_daily_trades,3);
  assert.equal(risk.max_drawdown_pct,7);
  assert.equal(risk.daily_loss_limit_amount,80,'Revisiting setup must preserve an existing absolute limit');
  await setup.getByLabel('Strategy name',{exact:true}).fill('London retest');
  await setup.getByRole('button',{name:'Add strategy',exact:true}).click();
  const checklist = setup.getByRole('region',{name:'Strategy checklist'});
  await checklist.getByRole('heading',{name:'London retest checklist',exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelectorAll('.ym-setup-checklist ol > li').length===5);
  const create = fixture.writes.find(write=>write.table==='strategy_checklist_items');
  assert.ok(Array.isArray(create.payload));
  assert.equal(create.payload.length,5);
  assert.ok(create.payload.every(item=>item.strategy_id==='setup-created-strategy'),'Starter items must belong to the newly created strategy');
  assert.equal(fixture.checklist.filter(item=>item.strategy_id==='setup-existing-strategy').length,1,'Existing strategy checklist stays untouched');
  await setup.getByRole('button',{name:'Continue',exact:true}).click();
  await setup.getByRole('heading',{name:'Your workspace is ready.',exact:true}).waitFor();
  await setup.getByRole('button',{name:'Open my dashboard',exact:true}).click();
  await page.getByRole('tablist',{name:'Dashboard sections'}).waitFor();
  return {stepsCompleted:4,duplicateAppearance:false,planningBalanceSaved:true,existingRiskPreserved:true,newStrategyChecklist:5};
}

export async function runDashboardSpacingChecks(page) {
  const heading = page.locator('.ym-dash-heading');
  const filters = page.getByRole('group',{name:'Performance filters'});
  const quality = page.getByRole('status',{name:'Dashboard data quality'});
  await quality.waitFor();
  const tabs = page.getByRole('tablist',{name:'Dashboard sections'});
  const boxes = await Promise.all([heading,filters,quality,tabs].map(locator=>locator.boundingBox()));
  assert.ok(boxes.every(Boolean));
  for(let i=1;i<boxes.length;i++) assert.ok(boxes[i].y>=boxes[i-1].y+boxes[i-1].height+8,'Header, filters, notices and results need breathing room');
  const notice = quality.locator('details').first();
  assert.equal(await notice.getAttribute('open'),null);
  assert.match(await notice.locator('summary').textContent(),/risk and R figures may be incomplete/i);
  await notice.locator('summary').click();
  await notice.getByText('Some closed trades need review for close time, currency or initial risk. Daily risk and R statistics may be incomplete.',{exact:true}).waitFor();
  assert.notEqual(await notice.getAttribute('open'),null,'The full financial warning remains available');
  const colors = await page.locator('.ym-dash-topic-mark').evaluate(node=>({background:getComputedStyle(node).backgroundColor,color:getComputedStyle(node).color}));
  assert.equal(colors.background,'rgb(255, 255, 255)');
  assert.match(colors.color,/rgb\((?:0|16), (?:0|16), (?:0|18)\)/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'Workspace content must not cause horizontal page overflow');
  return {headerOrder:true,financialWarningPreserved:true,whiteOverviewBadge:true};
}

if(process.argv[1] && pathToFileURL(process.argv[1]).href===import.meta.url) {
  const {chromium}=await import('playwright');
  const browser=await chromium.launch({headless:true,...(process.env.YM3_CHROMIUM_EXECUTABLE?{executablePath:process.env.YM3_CHROMIUM_EXECUTABLE}:{})});
  await mkdir('artifacts/workspace-setup',{recursive:true});
  try {
    for(const width of [390,1137,1440]) {
      const context=await browser.newContext({viewport:{width,height:883},reducedMotion:'reduce'});
      const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
      const fixture=await installWorkspaceSetupFixtures(page);
      await page.goto((process.env.YM3_PREVIEW_URL||'http://127.0.0.1:4191/')+'#workspace-setup',{waitUntil:'domcontentloaded'});
      await page.locator('.ym-workspace-setup').waitFor();
      await page.screenshot({path:`artifacts/workspace-setup/welcome-${width}.png`,fullPage:true});
      const setup=await runWorkspaceSetupChecks(page,fixture);
      const dashboard=await runDashboardSpacingChecks(page);
      await page.screenshot({path:`artifacts/workspace-setup/dashboard-${width}.png`,fullPage:true});
      assert.deepEqual(errors,[],'Browser runtime errors');
      console.log(JSON.stringify({width,...setup,...dashboard}));await context.close();
    }
  } finally {await browser.close();}
}
