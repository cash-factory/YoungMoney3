import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { installDashboardFixtures } from './test-dashboard-browser.mjs';

const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64');
function silentWav() {
  const samples = 800;
  const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(samples * 2, 40);
  return bytes;
}

export async function installMediaFixtures(page) {
  const fixture = await installDashboardFixtures(page);
  const root = `private-media://trading-media/${fixture.user.id}/`;
  const trade = { ...fixture.trade, screenshot_url: root + 'entry.png', entry_screenshot_url: root + 'entry.png', closure_voice_note_url: root + 'closure.wav' };
  let pageRequests = 0;
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/media/download') {
      const path = url.searchParams.get('path');
      assert.ok(path.startsWith(fixture.user.id + '/'), 'Media requests stay in the fixture owner namespace');
      return route.fulfill({ status: 200, contentType: path.endsWith('.wav') ? 'audio/wav' : 'image/png', body: path.endsWith('.wav') ? silentWav() : pixel });
    }
    if (url.pathname === '/api/media/page') {
      pageRequests++;
      let data = { files: [], folders: [], next: null };
      if (url.searchParams.get('provider') === 'r2') data.files = [{ id: 'duplicate', name: 'entry.png' }];
      else if (url.searchParams.get('folder') === 'archive') data.files = [{ id: 'orphan', name: 'archive/orphan.png' }];
      else if (url.searchParams.get('cursor') === 'second') data.files = [{ id: 'closure', name: 'closure.wav' }];
      else data = { files: [{ id: 'entry', name: 'entry.png' }], folders: ['archive'], next: 'second' };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    }
    if (url.pathname === '/api/data') {
      const query = route.request().postDataJSON();
      assert.equal(query.action, 'select', 'Media QA cannot mutate records');
      if (query.table === 'trades' || query.table === 'journal_entries') {
        const rows = query.table === 'trades' ? [trade] : [{ id: 'journal-fixture', user_id: fixture.user.id,
          screenshot_url: root + 'entry.png', entry_date: fixture.trade.entry_time.slice(0, 10),
          linked_trade_ids: [trade.id] }];
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: rows, count: rows.length }) });
      }
    }
    return route.fallback();
  });
  return { ...fixture, trade, pageRequests: () => pageRequests };
}

export async function runMediaChecks(page) {
  const library = page.locator('.ym-library');
  await library.waitFor();
  await page.getByRole('status').filter({ hasText: /^3 attachments$/ }).waitFor();
  const cards = library.locator('.ym-library-card');
  assert.equal(await cards.count(), 3, 'Aliases and cross-provider duplicates collapse into one asset');
  const imageCard = cards.filter({ has: page.getByRole('heading', { name: 'EUR/USD', exact: true }) }).filter({ hasText: 'IMAGE' });
  assert.equal(await imageCard.count(), 1);
  await imageCard.locator('img').waitFor();
  await imageCard.locator('img').evaluate(image => image.decode());
  assert.equal(await imageCard.locator('img').evaluate(image => image.naturalWidth > 0), true);
  await imageCard.getByRole('button', { name: 'Open attachment details' }).click();
  const preview = page.getByRole('dialog', { name: 'Attachment preview' });
  await preview.waitFor();
  await preview.locator('img').waitFor();
  await preview.locator('img').evaluate(image => image.decode());
  assert.equal(await preview.locator('.ym-library-references > div').count(), 2, 'Preview retains both trade and journal context');
  await page.keyboard.press('Escape');
  await preview.waitFor({ state: 'detached' });
  await library.getByRole('button', { name: /Voice notes/ }).click();
  assert.equal(await cards.count(), 1);
  const audio = cards.locator('audio');
  await audio.waitFor();
  await page.waitForFunction(() => document.querySelector('.ym-library-card audio')?.readyState >= 1);
  await library.getByRole('button', { name: 'Entry', exact: true }).click();
  await library.getByRole('heading', { name: 'No matching captures' }).waitFor();
  await library.getByRole('button', { name: 'Closure', exact: true }).click();
  assert.equal(await cards.count(), 1);
  await library.getByRole('button', { name: /All media/ }).click();
  await library.getByRole('button', { name: 'Unlinked', exact: true }).click();
  assert.equal(await cards.count(), 1);
  await library.getByRole('heading', { name: 'orphan.png' }).waitFor();
  await library.getByRole('button', { name: 'All captures', exact: true }).click();
  const search = library.getByRole('textbox', { name: 'Search media or linked trade' });
  await search.fill('fixture-trade-1');
  await page.getByRole('status').filter({ hasText: /^2 attachments$/ }).waitFor();
  assert.equal(await cards.count(), 2, 'Trade identifier search finds both entry image and closure note');
  await search.fill('not-an-existing-capture');
  await library.getByRole('heading', { name: 'No matching captures' }).waitFor();
  await search.fill('');
  await page.getByRole('status').filter({ hasText: /^3 attachments$/ }).waitFor();
  assert.equal(await library.evaluate(node => node.scrollWidth <= node.clientWidth + 1), true, 'Library fits viewport');
  await imageCard.getByRole('link', { name: 'EUR/USD', exact: true }).click();
  await page.getByRole('heading', { name: 'Trade capture · Media Library' }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get('trade'), 'fixture-trade-1');
  await page.getByRole('button', { name: 'Back to trades', exact: true }).click();
  assert.equal(new URL(page.url()).searchParams.has('trade'), false);
  return { uniqueAssets: 3, imagePreview: true, playableAudio: true, phaseFilters: true, tradeDeepLink: true };
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
      const fixture = await installMediaFixtures(page);
      await page.goto((process.env.YM3_PREVIEW_URL || 'http://127.0.0.1:4173/') + '#media', { waitUntil: 'domcontentloaded' });
      const result = await runMediaChecks(page);
      assert.ok(fixture.pageRequests() >= 4, 'Storage listing follows folders and continuation cursors');
      assert.deepEqual(errors, [], 'Browser runtime errors');
      console.log(JSON.stringify({ viewport: width, ...result }));
      await context.close();
    }
  } finally { await browser.close(); }
}
