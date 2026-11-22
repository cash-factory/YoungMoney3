import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { installDashboardFixtures } from './test-dashboard-browser.mjs';

const base = process.env.YM3_PREVIEW_URL || 'http://127.0.0.1:4173/';
const browser = await chromium.launch({ headless: true });
let scenarios = 0;

try {
  for (const width of [390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 850 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await installDashboardFixtures(page);
    await page.goto(base + '#dashboard', { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: /Trading Overview/ }).waitFor();
    const launch = width < 640
      ? page.locator('.ym-mobile-topbar').getByRole('button', { name: 'Search workspace' })
      : page.getByRole('button', { name: 'Search workspace (Ctrl K)' });
    await launch.click();

    const dialog = page.getByRole('dialog', { name: 'Quick navigation' });
    await dialog.waitFor();
    const input = dialog.getByRole('combobox', { name: 'Search workspace' });
    await input.waitFor();
    assert.ok(await input.evaluate(element => document.activeElement === element),
      'Search must receive focus when opening the command centre');
    assert.equal(await dialog.getByRole('option', { name: /Capture a trade/ }).count(), 1);
    assert.equal(await dialog.getByRole('option', { name: /Explore the field guide/ }).count(), 1);

    const bounds = await dialog.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1,
      'The command centre must fit on the phone viewport');

    await input.fill('risk management');
    const risk = dialog.getByRole('option', { name: /Risk management/ });
    await risk.waitFor();
    assert.equal(await risk.getAttribute('aria-selected'), 'true');
    assert.equal(await input.getAttribute('aria-activedescendant'), await risk.getAttribute('id'));
    await page.keyboard.press('Enter');
    await dialog.waitFor({ state: 'detached' });
    await page.waitForURL(/#risk-management$/);

    await launch.click();
    await dialog.waitFor();
    const recent = dialog.getByRole('option', { name: /Risk management/ });
    await recent.waitFor();
    assert.match(await recent.getAttribute('data-command-id'), /page-risk-management/);
    await input.fill('xyz-no-matches-123');
    await dialog.getByText('No matching destinations').waitFor();
    assert.equal(await dialog.getByRole('option').count(), 0);
    await input.fill('');

    // Focus stays within the search/close controls and Escape restores the launcher's focus.
    await input.focus();
    await page.keyboard.press('Shift+Tab');
    const close = dialog.getByRole('button', { name: 'Close quick navigation' });
    assert.ok(await close.evaluate(element => document.activeElement === element));
    await page.keyboard.press('Tab');
    assert.ok(await input.evaluate(element => document.activeElement === element));
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    assert.ok(await launch.evaluate(element => document.activeElement === element),
      'Dismissal returns focus to the invoking navigation control');

    await launch.click();
    await input.fill('field guide');
    await dialog.getByRole('option', { name: /Explore the field guide/ }).click();
    await dialog.waitFor({ state: 'detached' });
    const guide = page.getByRole('dialog', { name: /Make yourself at home/ });
    await guide.waitFor();
    await guide.getByRole('button', { name: 'Skip the tutorial' }).click();
    await guide.waitFor({ state: 'detached' });

    assert.deepEqual(errors, [], 'Command centre should not trigger runtime errors');
    scenarios++;
    await context.close();
  }
  console.log(JSON.stringify({ passed: true, scenarios, recentPages: true, keyboard: true, responsive: true, guideLaunch: true }));
} finally {
  await browser.close();
}
