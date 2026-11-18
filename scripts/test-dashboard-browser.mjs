import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

/** Local browser fixtures only: this helper never signs in to or writes to a real account. */
export async function installDashboardFixtures(page) {
  const now = new Date().toISOString();
  const owner = 'browser-fixture-owner';
  const user = { id: owner, email: 'fixture@example.test', display_name: 'Browser QA', role: 'member', account_status: 'active' };
  const trade = {
    id: 'fixture-trade-1', user_id: owner, pair: 'EUR/USD', direction: 'long',
    entry_price: 1.1, exit_price: 1.101, lot_size: 0.1, stop_loss: 1.099,
    take_profit: 1.102, outcome: 'win', status: 'closed', pnl: 10, pips: 10,
    settlement_currency: 'USD', trade_source: 'manual', strategy: null,
    session: 'london', broker: 'Demo broker', account_type: 'personal',
    entry_time: now, exit_time: now, risk_percent: 1, risk_reward_ratio: 2,
    initial_risk: 10, realized_r: 1, emotional_state: null, setup_quality: null,
    mistakes: [], lessons: 'Review the original plan.', notes: 'Browser fixture trade',
    screenshot_url: null, voice_note_url: null, entry_screenshot_url: null,
    entry_voice_note_url: null, closure_screenshot_url: null, closure_voice_note_url: null,
    what_went_wrong: null, observations: null, strategy_id: null, setup_id: null,
    plan_id: null, entry_model_id: null, account_id: 'fixture-account',
    checklist_items: null, checklist_override_reason: null, checklist_completed: true,
    created_at: now, updated_at: now,
  };
  const account = { id: 'fixture-account', user_id: owner, name: 'Practice desk',
    base_currency: 'USD', balance: 1000, is_active: true, account_type: 'personal',
    broker: 'Demo broker', default_plan_id: null, created_at: now, updated_at: now,
    broker_balance: null, broker_equity: null, challenge_reset_timezone: 'UTC' };
  const rowsByTable = {
    trades: [trade], trading_accounts: [account],
    trader_strategies: [{ id: 'fixture-strategy', user_id: owner, name: 'Browser fixture', is_active: true }],
  };
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    let response;
    if (url.pathname === '/api/me') response = { user };
    else if (url.pathname === '/api/data') {
      const query = route.request().postDataJSON();
      assert.equal(query.action, 'select', 'Browser QA may only read fixture records');
      const data = rowsByTable[query.table] || [];
      response = { data, count: data.length };
    } else if (url.pathname === '/api/mt5/positions') response = { rows: [], more: false };
    else if (url.pathname === '/api/account-summaries') response = { rows: [{ account_id: account.id, currency: 'USD', origin: 'manual', profit: '10', trades: 1 }] };
    else response = { data: [], rows: [], files: [] };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) });
  });
  return { user, trade, account };
}

/** Reused by the all-theme runner after opening the real App at #dashboard. */
export async function runDashboardChecks(page) {
  const tabs = page.getByRole('tablist', { name: 'Dashboard sections' });
  await tabs.waitFor();
  const panel = page.getByRole('tabpanel');
  const assertPanel = async id => {
    await page.locator(`#dashboard-panel-${id}`).waitFor();
    assert.equal(await panel.count(), 1, 'Exactly one focused dashboard panel is mounted');
    assert.equal(await tabs.getByRole('tab', { selected: true }).count(), 1);
    const tab = page.locator(`#dashboard-tab-${id}`);
    assert.equal(await tab.getAttribute('aria-selected'), 'true');
    assert.equal(await tab.getAttribute('aria-controls'), `dashboard-panel-${id}`);
  };
  await assertPanel('overview');
  assert.equal(await page.locator('.ym-dash-balance').count(), 1);
  assert.equal(await page.locator('#ym-performance, #ym-risk, #ym-recent, #ym-deep-dive').count(), 0,
    'Other sections must not fill the overview with hidden or stacked content');
  const initialHash = new URL(page.url()).hash;
  await tabs.getByRole('tab', { name: 'Recent trades' }).click();
  await assertPanel('recent');
  assert.equal(await page.locator('.ym-dash-balance').count(), 0);
  assert.equal(await page.locator('#ym-recent tbody tr').count(), 1);
  assert.equal(new URL(page.url()).hash, initialHash, 'Section selection must not use scroll anchors');

  // Automatic activation follows the ARIA tabs pattern, including wrapping and Home/End.
  await page.keyboard.press('ArrowRight');
  await assertPanel('deep-dive');
  assert.equal(await page.locator('#dashboard-tab-deep-dive').evaluate(node => node === document.activeElement), true);
  await page.keyboard.press('ArrowRight');
  await assertPanel('overview');
  await page.keyboard.press('End');
  await assertPanel('deep-dive');
  const achievements = page.locator('.ym-achievements');
  await achievements.waitFor();
  assert.equal(await achievements.locator('.ym-achievement').count(), 4, 'Milestones start with a compact preview');
  const total = Number(await achievements.getByRole('progressbar', {name:'Achievements unlocked'}).getAttribute('aria-valuemax'));
  assert.ok(total > 4);
  const toggle = achievements.getByRole('button', { name: 'View all ' + total + ' milestones' });
  await toggle.click();
  assert.equal(await achievements.locator('.ym-achievement').count(), total);
  assert.equal(await achievements.getByRole('button', { name: 'Show fewer milestones' }).getAttribute('aria-expanded'), 'true');
  const achievementLayout = await achievements.locator('.ym-achievement').evaluateAll(items => items.map(item => {
    const box = item.getBoundingClientRect();
    const icon = item.querySelector('.ym-achievement-icon').getBoundingClientRect();
    const copy = item.querySelector('.ym-achievement-copy').getBoundingClientRect();
    return { width: box.width, copyWidth: copy.width, iconOnLeft: icon.right < copy.left,
      overflow: item.scrollWidth > item.clientWidth + 1 };
  }));
  assert.ok(achievementLayout.every(row => row.copyWidth >= 100 && row.iconOnLeft && !row.overflow),
    'Achievements need readable horizontal rows at the available container width: ' + JSON.stringify(achievementLayout));
  await achievements.getByRole('button', { name: 'Show fewer milestones' }).click();
  assert.equal(await achievements.locator('.ym-achievement').count(), 4);

  // Return keyboard focus to the section rail after inspecting the lower content.
  await page.locator('#dashboard-tab-deep-dive').focus();
  await page.keyboard.press('Home');
  await assertPanel('overview');
  await page.keyboard.press('ArrowLeft');
  await assertPanel('deep-dive');
  await tabs.getByRole('tab', { name: 'Performance', exact: false }).click();
  await assertPanel('performance');
  assert.equal(await page.locator('.ym-dash-charts').count(), 1);
  await tabs.getByRole('tab', { name: 'Risk & rules', exact: false }).click();
  await assertPanel('risk');
  await page.getByRole('combobox', { name: 'Performance view' }).click();
  await page.getByRole('option', { name: 'Backtest results', exact: false }).click();
  await assertPanel('overview');
  assert.equal(await tabs.getByRole('tab', { name: 'Risk & rules', exact: false }).count(), 0,
    'Practice views must not show live account risk metrics');
  await page.getByRole('combobox', { name: 'Performance view' }).click();
  await page.getByRole('option', { name: 'Recorded trades', exact: false }).click();
  await assertPanel('overview');
  return { panels: 5, keyboardNavigation: true, achievementRows: total, practiceRiskIsolation: true };
}

/** Entry animations must release fixed-position descendants when ordinary motion is enabled. */
export async function runDashboardMotionChecks(page) {
  await page.getByRole('tablist', { name: 'Dashboard sections' }).waitFor();
  await page.waitForFunction(() => {
    const surface = document.querySelector('.ym-page-experience');
    return surface && getComputedStyle(surface).transform === 'none';
  });
  await page.evaluate(() => window.scrollTo(0, 120));
  await page.locator('.ym-dash-new-trade').click();
  const modal = page.locator('div.fixed.inset-0.z-50').last();
  await modal.waitFor();
  const geometry = await modal.evaluate(element => {
    const box = element.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height,
      viewportWidth: innerWidth, viewportHeight: innerHeight };
  });
  assert.ok(Math.abs(geometry.x) <= 1 && Math.abs(geometry.y) <= 1
    && Math.abs(geometry.width - geometry.viewportWidth) <= 1
    && Math.abs(geometry.height - geometry.viewportHeight) <= 1,
  'Trade dialog must cover the viewport after page animation and scrolling: ' + JSON.stringify(geometry));
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  return { normalMotionViewportModal: true };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true,
    ...(process.env.YM3_CHROMIUM_EXECUTABLE ? { executablePath: process.env.YM3_CHROMIUM_EXECUTABLE } : {}) });
  try {
    for (const width of [390, 1064, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await installDashboardFixtures(page);
      await page.goto((process.env.YM3_PREVIEW_URL || 'http://127.0.0.1:4173/') + '#dashboard', { waitUntil: 'domcontentloaded' });
      const result = await runDashboardChecks(page);
      assert.deepEqual(errors, [], 'Browser runtime errors');
      console.log(JSON.stringify({ viewport: width, ...result }));
      await context.close();
    }
    const context = await browser.newContext({ viewport: { width: 1064, height: 883 }, reducedMotion: 'no-preference' });
    const page = await context.newPage();
    await installDashboardFixtures(page);
    await page.goto((process.env.YM3_PREVIEW_URL || 'http://127.0.0.1:4173/') + '#dashboard', { waitUntil: 'domcontentloaded' });
    console.log(JSON.stringify(await runDashboardMotionChecks(page)));
    await context.close();
  } finally { await browser.close(); }
}

