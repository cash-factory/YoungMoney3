import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { installDashboardFixtures } from './test-dashboard-browser.mjs';

/** Synthetic records only. Every API read is isolated from real accounts. */
export async function installPageResultFixtures(page) {
  const fixture = await installDashboardFixtures(page);
  const now = new Date().toISOString();
  const stamp = { user_id: fixture.user.id, created_at: now, updated_at: now };
  const setup = { ...stamp, id: 'setup-a', name: 'London continuation', category: 'trend_following', description: 'A patient continuation after the first pullback.', market_conditions: 'Clear higher-timeframe trend.', timeframes: 'H1 / M15', entry_criteria: 'Wait for a retest and a confirmed close.', exit_criteria: 'Reduce at the planned objective.', example_notes: 'Record the first clean example.', screenshot_url: '/assets/page-art/setups.svg', voice_note_url: null, is_active: true };
  const goal = { ...stamp, id: 'goal-a', title: 'Record every planned trade', description: 'Build a consistent review habit.', target_metric: 'journal_entries', target_value: 20, current_value: 8, deadline: '2026-12-31', category: 'process', status: 'active', goal_type: 'trading', priority: 'high', progress_notes: null, year: 2026, is_template: false };
  const note = { ...stamp, id: 'note-a', title: 'Pre-market observation', content: 'Keep the higher-timeframe idea visible.\nWait for the first clear retest.', tags: ['process'], is_pinned: true, screenshot_url: null };
  const plan = { ...stamp, id: 'plan-a', title: 'Intraday process', philosophy: 'Protect the downside before considering opportunity.', htf_selection: 'Mark the daily range.', ltf_execution: 'Wait for a confirmed trigger.', trade_management: 'Manage to the written plan.', risk_management: 'Use a fixed risk budget.', mapping_process: null, entry_models: null, market_conditions: null, additional_notes: null, adherence_score: null, max_risk_per_trade_pct: 1, max_daily_loss_pct: 2, max_drawdown_pct: 5 };
  const tomorrow = new Date(Date.now() + 86400000).toISOString();
  const records = {
    trades: [{ ...fixture.trade, setup_id: 'setup-a' }, { ...fixture.trade, id: 'closed-loss', setup_id: 'setup-a', outcome: 'loss', pnl: -10 }, { ...fixture.trade, id: 'still-open', setup_id: 'setup-a', status: 'open', exit_price: null, exit_time: null }],
    trading_setups: [setup, { ...setup, id: 'setup-b', name: 'Range rejection', category: 'range', screenshot_url: null, entry_criteria: 'Wait for the range boundary rejection.' }],
    goals: [goal, { ...goal, id: 'goal-b', title: 'Review last month', status: 'completed', current_value: 20 }, { ...goal, id: 'goal-c', title: 'Refine an entry model', status: 'paused' }],
    notes: [note, { ...note, id: 'note-b', title: 'Afternoon lesson', content: 'A full reflection remains readable in the notebook reader.', is_pinned: false }],
    resources: [{ ...stamp, id: 'resource-a', title: 'Risk workbook', category: 'book', description: 'A practical reference for reviewing risk.', tags: ['risk'], url: 'https://example.test/risk', thumbnail_url: null }, { ...stamp, id: 'resource-b', title: 'Session preparation', category: 'video', description: 'A preparation checklist.', tags: ['process'], url: null, thumbnail_url: null }],
    study_materials: [{ ...stamp, id: 'study-a', title: 'Market structure course', type: 'course', status: 'in_progress', progress: 40, total_units: 10, completed_units: 4, notes: 'Continue with the next chapter.', url: null, cover_image_url: null }, { ...stamp, id: 'study-b', title: 'A trading journal', type: 'book', status: 'completed', progress: 100, total_units: 5, completed_units: 5, notes: null, url: null, cover_image_url: null }],
    journal_entries: [{ ...stamp, id: 'journal-a', entry_date: now.slice(0, 10), entry_type: 'daily', daily_goals: 'Wait for the best setup.', weekly_focus: null, pre_market_notes: 'Define the range.', post_session_review: 'Stayed within the plan.', trading_plan_checklist: [], review_prompts: [], mood: 'calm', notes: null, screenshot_url: null, strategy_id: null, linked_trade_ids: [], account_id: fixture.account.id }],
    weekly_reviews: [{ ...stamp, id: 'review-a', week_start: '2026-11-09', week_end: '2026-11-15', rating: 8, trades_taken: 4, trades_planned: 5, pnl: 50, what_went_well: 'Waited for confirmation.', what_went_wrong: 'Reviewed the final trade too late.', lessons_learned: 'Keep a consistent review time.', focus_next_week: 'Review each session before switching off.', psychological_notes: 'Patient and calm.', screenshot_url: null, voice_note_url: null }],
    trading_plans: [plan, { ...plan, id: 'plan-b', title: 'Swing process', philosophy: 'Give the higher-timeframe idea room.' }],
    market_sessions: [{ ...stamp, id: 'event-a', event_name: 'Session review', event_date: tomorrow, event_type: 'session_open', impact: 'low', session: 'london', is_no_trade: false, notes: 'Prepare before the open.' }, { ...stamp, id: 'event-b', event_name: 'Scheduled data release', event_date: tomorrow.slice(0, 10) + 'T14:30:00.000Z', event_type: 'data', impact: 'high', session: 'new_york', is_no_trade: true, notes: 'Wait until the event has passed.' }],
  };
  let empty = false;
  await page.route('**/api/data', async route => {
    const query = route.request().postDataJSON();
    assert.equal(query.action, 'select', 'Page presentation checks must not mutate account records');
    if (!(query.table in records)) return route.fallback();
    const data = empty && query.table !== 'trades' ? [] : records[query.table];
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data, count: data.length }) });
  });
  return { setEmpty: value => { empty = value; } };
}

const surfaces = { setups: '.ym-setup-workbench', goals: '.ym-goal-lanes', notes: '.ym-notebook', resources: '.ym-resource-catalogue', 'study-material': '.ym-learning-shelves', journal: '.ym-journal-timeline', 'weekly-reviews': '.ym-weekly-debriefs', 'trading-plan': '.ym-plan-library', 'market-sessions': '.ym-market-agenda' };

/** Optional populated-output matrix, so every palette is exercised beyond empty headings. */
export async function runPageResultPaletteChecks(browser, base) {
  const palettes = [...readFileSync('src/context/ThemeContext.ts', 'utf8').matchAll(/\{ id: '([^']+)', name:/g)].map(match => match[1]);
  let scenarios = 0;
  for (const width of [390, 1064, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 960 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await installPageResultFixtures(page);
    for (const palette of palettes) for (const mode of ['light', 'dark']) {
      await page.goto(base + '#setups', { waitUntil: 'domcontentloaded' });
      await page.evaluate(({ palette, mode }) => {
        localStorage.setItem('journal-palette', palette);
        localStorage.setItem('journal-theme', mode);
      }, { palette, mode });
      await page.reload({ waitUntil: 'domcontentloaded' });
      for (const [route, surface] of Object.entries(surfaces)) {
        await page.goto(base + '#' + route, { waitUntil: 'domcontentloaded' });
        await page.locator(surface).waitFor();
        const result = await page.locator(surface).evaluate(element => ({
          width: document.documentElement.scrollWidth,
          viewport: innerWidth,
          surfaceWidth: element.scrollWidth,
          available: element.clientWidth,
          palette: document.documentElement.dataset.palette,
          headings: [...document.querySelectorAll('[data-workspace-page] h1')].filter(heading => heading.getBoundingClientRect().height > 0).length,
        }));
        const scenario = `${route}/${palette}/${mode}/${width}`;
        assert.equal(result.palette, palette, scenario);
        assert.equal(result.headings, 1, scenario + ': expected one page heading');
        assert.ok(result.width <= result.viewport + 2 && result.surfaceWidth <= result.available + 2,
          scenario + ': horizontal overflow ' + JSON.stringify(result));
        scenarios++;
      }
    }
    assert.deepEqual(errors, [], `Output palette runtime errors at ${width}`);
    console.log(JSON.stringify({ outputPaletteViewport: width, scenarios, runtimeErrors: 0 }));
    await context.close();
  }
  return { paletteScenarios: scenarios, palettes: palettes.length, modes: 2, viewports: 3 };
}

export async function runPageResultChecks(page, base) {
  for (const [route, surface] of Object.entries(surfaces)) {
    await page.goto(base + '#' + route, { waitUntil: 'domcontentloaded' });
    await page.locator(surface).waitFor();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const layout = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(layout.width <= layout.viewport + 2, `${route}: horizontal overflow ${JSON.stringify(layout)}`);
    assert.equal(await page.locator(surface).count(), 1);
    if (route === 'setups') {
      assert.match(await page.locator('.ym-setup-evidence').textContent(), /50%/);
      assert.match(await page.locator('.ym-setup-evidence').textContent(), /2 closed/);
      await page.getByRole('button', { name: /Range rejection/ }).click();
      assert.match(await page.locator('.ym-setup-playbook h2').textContent(), /Range rejection/);
      assert.match(await page.locator('.ym-setup-rules').textContent(), /range boundary/);
      await page.getByRole('button', { name: 'Edit setup', exact: true }).click();
      await page.getByRole('heading', { name: 'Edit Setup', exact: true }).waitFor();
      assert.equal(await page.getByPlaceholder('e.g. London Open Breakout').inputValue(), 'Range rejection');
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    }
    if (route === 'goals') {
      assert.equal(await page.locator('.ym-goal-lane').count(), 3);
      assert.equal(await page.locator('.ym-goal-milestone').count(), 3);
      await page.getByRole('button', { name: 'Paused', exact: true }).click();
      assert.equal(await page.locator('.ym-goal-milestone').count(), 1);
      assert.match(await page.locator('.ym-goal-milestone').textContent(), /Refine an entry model/);
    }
    if (route === 'notes') {
      await page.getByRole('navigation', { name: 'Saved notes' }).getByRole('button', { name: /Afternoon lesson/ }).click();
      assert.match(await page.locator('.ym-note-content').textContent(), /full reflection remains readable/);
      await page.getByRole('button', { name: 'Edit Afternoon lesson', exact: true }).click();
      await page.getByRole('heading', { name: 'Edit Note', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    }
    if (route === 'resources') {
      await page.getByRole('navigation', { name: 'Resource collections' }).getByRole('button', { name: /Books/ }).click();
      assert.equal(await page.locator('.ym-resource-row').count(), 1);
      assert.equal(await page.getByRole('link', { name: 'Open Risk workbook' }).getAttribute('href'), 'https://example.test/risk');
    }
    if (route === 'study-material') assert.equal(await page.getByRole('progressbar', { name: 'Market structure course progress', exact: true }).getAttribute('value'), '40');
    if (route === 'trading-plan') {
      await page.getByRole('navigation', { name: 'Trading plans' }).getByRole('button', { name: /Swing process/ }).click();
      assert.match(await page.locator('.ym-plan-document').textContent(), /higher-timeframe idea room/);
      assert.equal(await page.locator('.ym-plan-document').count(), 1);
    }
    if (route === 'market-sessions') {
      assert.equal(await page.locator('.ym-agenda-day').count(), 1);
      assert.equal(await page.locator('.ym-agenda-event').count(), 2);
    }
    if (process.env.YM3_RESULT_SHOTS === '1') {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: `artifacts/page-results/${route}-${page.viewportSize().width}.png`, fullPage: true });
    }
  }
  return { distinctSurfaces: Object.keys(surfaces).length, selectionAndFiltering: true, setupClosedTradeEvidence: true };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true, ...(process.env.YM3_CHROMIUM_EXECUTABLE ? { executablePath: process.env.YM3_CHROMIUM_EXECUTABLE } : {}) });
  await mkdir('artifacts/page-results', { recursive: true });
  try {
    for (const width of [390, 1064, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 960 }, reducedMotion: 'reduce' });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const fixture = await installPageResultFixtures(page);
      const base = process.env.YM3_PREVIEW_URL || 'http://127.0.0.1:4182/';
      const result = await runPageResultChecks(page, base);
      fixture.setEmpty(true);
      for (const [route, surface] of Object.entries(surfaces)) {
        await page.goto(base + '#' + route, { waitUntil: 'domcontentloaded' });
        await page.locator(`[data-workspace-page="${route}"]`).getByRole('heading', { level: 1 }).waitFor();
        await page.getByRole('heading', { name: /No |starts here|Build your/ }).last().waitFor();
        assert.equal(await page.locator(surface).count(), 0, `${route}: empty view must not mount stale output`);
      }
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ viewport: width, ...result, emptyStates: 9, runtimeErrors: 0 }));
      await context.close();
    }
    if (process.argv.includes('--palettes')) {
      console.log(JSON.stringify(await runPageResultPaletteChecks(browser, process.env.YM3_PREVIEW_URL || 'http://127.0.0.1:4182/')));
    }
  } finally { await browser.close(); }
}
