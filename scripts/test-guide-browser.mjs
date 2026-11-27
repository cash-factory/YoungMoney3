import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { installDashboardFixtures } from './test-dashboard-browser.mjs';

const base = process.env.YM3_PREVIEW_URL || 'http://127.0.0.1:4174/';
const storageKey = 'ymfx:platform-guide:v1:browser-fixture-owner';
const browser = await chromium.launch({ headless: true,
  ...(process.env.YM3_CHROMIUM_EXECUTABLE ? { executablePath: process.env.YM3_CHROMIUM_EXECUTABLE } : {}) });
let scenarios = 0;

try {
  for (const width of [390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await installDashboardFixtures(page);
    await page.goto(base + '#dashboard', { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: /Trading Overview/ }).waitFor();
    assert.equal(await page.getByRole('dialog').count(), 0, 'Older accounts are never forced into a tour');

    // Dashboard entry opens the complete directory, not a generic toast.
    await page.getByRole('button', { name: 'Explore platform features' }).click();
    const hub = page.getByRole('dialog', { name: /Make yourself at home/ });
    await hub.waitFor();
    assert.equal(await hub.getByRole('button', { name: /Go to / }).count(), 22);
    assert.equal(await hub.getByRole('button', { name: /^Guided path:/ }).count(), 4,
      'Four task-based learning paths should be available');
    assert.equal(await hub.getByRole('button', { name: 'Skip the tutorial' }).count(), 1);

    // The curated route highlights real DOM elements. Users can jump to a chosen feature.
    await hub.getByRole('button', { name: /Take the grand tour/ }).click();
    let tour = page.getByRole('dialog', { name: 'Your trading command centre' });
    await tour.waitFor();
    await page.locator('[data-guide-stop="desk"][data-spotlight="active"]').waitFor();
    assert.equal(new URL(page.url()).hash, '#dashboard');
    await tour.getByRole('button', { name: 'Next stop' }).click();
    tour = page.getByRole('dialog', { name: 'Make the numbers yours' });
    await tour.waitFor();
    await page.locator('[data-guide-stop="filters"][data-spotlight="active"]').waitFor();

    await tour.getByRole('button', { name: 'Skip to...' }).click();
    const directory = page.getByRole('dialog', { name: /Make yourself at home/ });
    await directory.waitFor();
    const directoryBeforeSearch = await directory.boundingBox();
    await directory.getByRole('textbox', { name: 'Search guide destinations' }).fill('risk');
    assert.equal(await directory.getByRole('button', { name: 'Go to Risk Control' }).count(), 1);
    const directoryAfterSearch = await directory.boundingBox();
    assert.ok(Math.abs(directoryBeforeSearch.y - directoryAfterSearch.y) <= 1 &&
      Math.abs(directoryBeforeSearch.height - directoryAfterSearch.height) <= 1,
      'Filtering keeps the guide panel and its click targets in a stable frame');
    await directory.getByRole('button', { name: 'Go to Risk Control' }).click();
    tour = page.getByRole('dialog', { name: 'Protect the next opportunity' });
    await tour.waitFor();
    assert.equal(new URL(page.url()).hash, '#risk-management');
    await page.locator('[data-guide-stop="risk"][data-spotlight="active"]').waitFor();
    assert.equal(await tour.getByText('Define your permitted risk and daily limits before a trade.').count(), 1,
      'Critical features provide concrete how-to instructions');

    const geometry = await tour.evaluate(node => {
      const { width: cardWidth, height: cardHeight, left, right } = node.getBoundingClientRect();
      return { cardWidth, cardHeight, left, right, windowWidth: innerWidth };
    });
    assert.ok(geometry.cardWidth > 270 && geometry.cardHeight > 250 &&
      geometry.left >= 0 && geometry.right <= width + 2,
      'Step panel remains usable: ' + JSON.stringify(geometry));

    // Esc dismisses without touching the user's trades and persists the choice.
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    const state = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
    assert.equal(state.status, 'dismissed');
    assert.ok(state.visited.includes('desk') && state.visited.includes('risk'));

    // Can be relaunched from both permanent navigation and dashboard after dismissal.
    await page.evaluate(() => { location.hash = 'dashboard'; });
    await page.getByRole('button', { name: 'Explore platform features' }).click();
    await hub.waitFor();
    await hub.getByRole('button', { name: 'Guided path: Connect MetaTrader' }).click();
    await page.getByRole('dialog', { name: 'Let execution find your journal' }).waitFor();
    await page.locator('[data-guide-stop="mt5"]').waitFor();
    await page.getByRole('button', { name: 'Skip to...' }).click();
    await hub.waitFor();
    await hub.getByRole('button', { name: 'Skip the tutorial' }).click();
    await hub.waitFor({ state: 'detached' });
    await page.evaluate(() => { location.hash = 'dashboard'; });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: /Trading Overview/ }).waitFor();
    assert.equal(await page.getByRole('dialog').count(), 0, 'Dismissal is sticky after reload');

    if (width === 1440) {
      await page.getByRole('button', { name: 'Explore platform tour' }).click();
    } else {
      await page.locator('.ym-mobile-topbar').getByRole('button', { name: 'Open platform guide' }).click();
    }
    await hub.waitFor();
    await hub.getByRole('button', { name: 'Go to The Desk' }).click();
    await page.getByRole('dialog', { name: 'Your trading command centre' }).waitFor();
    await page.getByRole('button', { name: 'Skip tutorial' }).click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    assert.deepEqual(errors, [], 'Guide must not trigger runtime errors');
    console.log(JSON.stringify({ viewport: width, replay: true, directJump: true,
      skipAndPersistence: true, hotspot: true }));
    scenarios++;
    await context.close();
  }

  // Signup-like session from same-origin auth should receive one invitation.
  // No account is created, no authenticated staging endpoint is contacted.
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const fixture = await installDashboardFixtures(page);
  await page.route('**/api/me', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ user: { ...fixture.user, created_at: new Date().toISOString() } }),
  }));
  await page.goto(base + '#dashboard', { waitUntil: 'domcontentloaded' });
  const welcome = page.getByRole('dialog', { name: /Make yourself at home/ });
  await welcome.waitFor();
  await welcome.getByRole('button', { name: 'Skip the tutorial' }).click();
  await welcome.waitFor({ state: 'detached' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: /Trading Overview/ }).waitFor();
  assert.equal(await page.getByRole('dialog').count(), 0,
    'The onboarding invitation respects a saved skip state on subsequent visits');
  await context.close();
  scenarios++;
  console.log(JSON.stringify({ passed: true, scenarios, featureDestinations: 22, expressStops: 9 }));
} finally {
  await browser.close();
}
