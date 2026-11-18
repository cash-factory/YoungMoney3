import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { installDashboardFixtures } from './test-dashboard-browser.mjs';

const base = process.env.YM3_PREVIEW_URL || 'http://127.0.0.1:4174/';
const browser = await chromium.launch({
  headless: true,
  ...(process.env.YM3_CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.YM3_CHROMIUM_EXECUTABLE }
    : {}),
});
try {
  for (const width of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 860 }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const { user, trade } = await installDashboardFixtures(page);
    const reviews = [],
      journal = [],
      writes = [];
    await page.route('**/api/decision/context', (route) =>
      route.fulfill({
        json: {
          strategy: 'Browser fixture',
          model: 'Retest',
          modelVersion: '2026-01-01',
          plan: null,
          earliest: '09:15',
          requireStop: true,
          riskLimit: null,
          criteria: 'Wait for the close.',
          checklist: [],
        },
      })
    );
    await page.route('**/api/data', async (route) => {
      const q = route.request().postDataJSON();
      if (q.table === 'strategy_entry_models')
        return route.fulfill({
          json: {
            data: [{ id: 'model', name: 'Retest', strategy_id: 'fixture-strategy', is_active: true }],
            count: 1,
          },
        });
      const rows =
        q.table === 'decision_reviews' ? reviews : q.table === 'journal_entries' ? journal : null;
      if (!rows) return route.fallback();
      if (q.action === 'select') return route.fulfill({ json: { data: rows, count: rows.length } });
      assert.equal(q.action, 'insert');
      const row = {
        ...(Array.isArray(q.payload) ? q.payload[0] : q.payload),
        user_id: user.id,
        id: q.payload.id || 'journal-id',
        updated_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      };
      rows.push(row);
      writes.push(q.table);
      return route.fulfill({ json: { data: [row], count: 1 } });
    });
    await page.goto(base + '#dashboard', { waitUntil: 'domcontentloaded' });
    const sampleButton = page.getByRole('button', { name: 'Try a sample replay' });
    await sampleButton.click();
    const dialog = page.getByRole('dialog', { name: 'Decision replay' });
    await dialog.getByRole('button', { name: 'Changed course' }).click();
    assert.equal(await dialog.getByText(/160\.00 ZAR/).count(), 0);
    await dialog.getByRole('button', { name: 'Reveal outcome', exact: true }).click();
    await dialog.getByText(/three minutes before/).waitFor();
    await dialog.getByText(/160\.00 ZAR/).waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await sampleButton.evaluate((el) => document.activeElement === el), true);

    await page.getByRole('button', { name: 'Review this entry' }).click();
    await dialog.getByLabel('Which strategy did you use?').selectOption('fixture-strategy');
    await dialog.getByLabel('Entry model', { exact: true }).selectOption('model');
    await dialog.getByRole('button', { name: 'My trigger fired' }).click();
    await dialog.getByRole('button', { name: 'Followed my plan' }).click();
    assert.equal(await dialog.getByText(/Net result/).count(), 0);
    await dialog.getByRole('button', { name: 'Reveal outcome and evidence' }).click();
    await dialog.getByRole('heading', { name: 'Still unclear' }).waitFor();
    await dialog.getByText(/Opening-stop evidence is unavailable/).waitFor();
    await dialog.getByRole('button', { name: 'Save decision' }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.deepEqual(
      [reviews[0].reference, reviews[0].strategy_id, reviews[0].entry_model_id],
      ['trade/' + trade.id, 'fixture-strategy', 'model']
    );

    await page.getByRole('button', { name: 'I passed', exact: true }).click();
    const capture = page.getByRole('dialog', { name: 'Quick Capture' });
    await capture.getByRole('button', { name: 'My trigger never fired' }).click();
    await capture.getByRole('button', { name: 'Save draft & close' }).click();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'I passed', exact: true }).click();
    await capture.getByText('Draft resumed on this device.').waitFor();
    assert.equal(
      await capture.getByRole('button', { name: 'My trigger never fired' }).getAttribute('aria-pressed'),
      'true'
    );
    await capture.getByRole('button', { name: 'Save capture' }).click();
    await capture.waitFor({ state: 'hidden' });
    assert.deepEqual(writes, ['decision_reviews', 'journal_entries']);
    assert.equal(journal[0].decision_kind, 'pass');
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(
    'Desktop and phone passed sample reveal, strategy attribution, evidence, focus restoration, review persistence and interrupted pass capture.'
  );
} finally {
  await browser.close();
}
