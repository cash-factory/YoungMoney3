import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
const palettes = [...readFileSync('src/context/ThemeContext.ts', 'utf8').matchAll(/\{ id: '([^']+)', name:/g)].map(match => match[1]);
import { installDashboardFixtures } from './test-dashboard-browser.mjs';

/** Exercise the actual controls in the TradeForm using local read-only fixtures. */
export async function runControlChecks(page) {
  await page.route('https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js', route => route.fulfill({ status: 200, contentType: 'text/javascript', body: "const host = document.currentScript.parentElement.querySelector('.tradingview-widget-container__widget'); const frame = document.createElement('iframe'); frame.src='about:blank'; frame.style.height='150px'; host.append(frame);" }));
  await page.getByRole('button', { name: 'Add Trade', exact: true }).click();
  const title = page.getByRole('heading', { name: 'Add New Trade', exact: true });
  await title.waitFor();
  // This field uses the native JSX compatibility bridge, rather than hand-written options.
  const strategy = page.getByRole('combobox', { name: 'Strategy (optional)', exact: true });
  if (await strategy.count()) {
    await strategy.click();
    await page.getByRole('option', { name: /Browser fixture/ }).click();
    assert.match(await strategy.textContent(), /Browser fixture/);
  }
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  const emotional = page.getByRole('combobox', { name: 'Emotional State', exact: true });
  await emotional.scrollIntoViewIfNeeded();
  await emotional.click();
  const popup = page.getByRole('listbox', { name: 'Emotional State', exact: true });
  await popup.waitFor();
  // React must mount a positioned popup; wait for its usable geometry instead of
  // sampling an intermediate commit or assuming that DOM presence means ready.
  await page.waitForFunction(id => {
    const node = document.getElementById(id);
    if (!node || node.dataset.positioned !== 'true') return false;
    const box = node.getBoundingClientRect();
    const first = node.querySelector('[role="option"]');
    if (!first || box.width < Math.min(180, innerWidth - 24) || box.height < 40) return false;
    const optionBox = first.getBoundingClientRect();
    return box.left >= 6 && box.right <= innerWidth - 6 && box.top >= 6 && box.bottom <= innerHeight - 6
      && node.contains(document.elementFromPoint(optionBox.left + Math.min(30, optionBox.width / 2), optionBox.top + optionBox.height / 2));
  }, await popup.getAttribute('id'));
  const geometry = await popup.evaluate(node => {
    const box = node.getBoundingClientRect();
    const first = node.querySelector('[role="option"]');
    const firstBox = first.getBoundingClientRect();
    return { portalled: node.parentElement === document.body, top: box.top, bottom: box.bottom,
      left: box.left, right: box.right, viewportHeight: innerHeight, viewportWidth: innerWidth,
      visibleAtCenter: node.contains(document.elementFromPoint(firstBox.left + 30, firstBox.top + firstBox.height / 2)) };
  });
  assert.equal(geometry.portalled, true, 'Menus must escape the modal scroll container');
  assert.ok(geometry.top >= 6 && geometry.bottom <= geometry.viewportHeight - 6, JSON.stringify(geometry));
  assert.ok(geometry.left >= 6 && geometry.right <= geometry.viewportWidth - 6, JSON.stringify(geometry));
  assert.equal(geometry.visibleAtCenter, true, 'The popup must be clickable over dialog/footer content');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  assert.match(await emotional.textContent(), /Calm/);
  assert.equal(await popup.count(), 0);
  await emotional.click();
  await page.keyboard.press('Escape');
  assert.equal(await popup.count(), 0);
  assert.equal(await title.count(), 1, 'Escape should dismiss a picker before the dialog');
  assert.equal(await emotional.evaluate(node => node === document.activeElement), true);
  // The account control is also a converted select. Selecting it exercises its original e.target.value handler.
  const account = page.getByRole('combobox', { name: 'Trading account', exact: true });
  await account.click();
  await page.getByRole('option', { name: /Practice desk/ }).click();
  assert.match(await account.textContent(), /Practice desk/);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  const instrument = page.getByRole('combobox', { name: 'Instrument', exact: true });
  await instrument.click();
  const instruments = page.getByRole('listbox', { name: 'Instruments', exact: true });
  await instruments.waitFor();
  assert.equal(await instruments.evaluate(node => node.parentElement === document.body), true);
  await page.keyboard.press('Escape');
  assert.equal(await instruments.count(), 0);
  await page.locator('label').filter({ hasText: /^Entry Price/ }).locator('xpath=..').locator('input[type="number"]').fill('1.1');
  await page.locator('label').filter({ hasText: /^Size / }).locator('xpath=..').locator('input[type="number"]').fill('0.1');
  const summary = page.locator('.ym-trade-summary');
  await summary.waitFor();
  await page.addStyleTag({ content: '.ym-trade-summary,.ym-trade-summary *{transition:none!important}' });
  const contrasts = await summary.evaluate((node, palettes) => {
    const root = document.documentElement;
    const originalPalette = root.dataset.palette; const originalDark = root.classList.contains('dark');
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d');
    const rgb = color => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3); };
    const lum = rgb => rgb.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((v, n, i) => v + n * [.2126, .7152, .0722][i], 0);
    const results = [];
    for (const palette of palettes) for (const mode of ['light', 'dark']) {
      root.dataset.palette = palette; root.classList.toggle('dark', mode === 'dark');
      const bg = lum(rgb(getComputedStyle(node).backgroundColor));
      const minimum = Math.min(...[...node.querySelectorAll('p')].map(p => { const fg = lum(rgb(getComputedStyle(p).color)); return (Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05); }));
      results.push({ palette, mode, minimum, ...(minimum < 4.5 ? { background: getComputedStyle(node).backgroundColor, text: [...node.querySelectorAll('p')].map(p => ({ label:p.textContent,color:getComputedStyle(p).color })) } : {}) });
    }
    root.dataset.palette = originalPalette; root.classList.toggle('dark', originalDark);
    return results;
  }, palettes);
  assert.ok(contrasts.every(row => row.minimum >= 4.5), 'Every trade metric label/value needs readable contrast: ' + JSON.stringify(contrasts.filter(row => row.minimum < 4.5)));
  const minContrast = Math.min(...contrasts.map(row => row.minimum));
  const chartToggle = page.locator('summary').filter({ hasText: 'View TradingView chart' });
  let chartHeight = null;
  if (await chartToggle.count()) {
    await chartToggle.click();
    const frame = page.locator('.ym-chart-frame iframe');
    await frame.waitFor();
    const geometry = await frame.evaluate(node => { const box = node.getBoundingClientRect(); const root = node.closest('.ym-chart-frame').getBoundingClientRect(); return { height: box.height, rootHeight: root.height, width: box.width, rootWidth: root.width }; });
    assert.ok(geometry.height >= 320 && Math.abs(geometry.height - geometry.rootHeight) <= 3 && Math.abs(geometry.width - geometry.rootWidth) <= 3, 'Embedded chart must fill its usable frame: ' + JSON.stringify(geometry));
    chartHeight = geometry.height;
  }
  await page.getByPlaceholder('Leave empty for an open trade').fill('1.101');
  const actualFill = page.getByRole('checkbox', { name: /actual fill from my broker/ });
  if (await actualFill.count()) await actualFill.check();
  const historicalFill = page.getByRole('checkbox', { name: /historical price against my source data/ });
  if (await historicalFill.count()) await historicalFill.check();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  const mistake = page.getByRole('checkbox', { name: 'Overtraded', exact: true });
  await mistake.check();
  assert.equal(await mistake.isChecked(), true);
  const tickOnLeft = await mistake.evaluate(input => input.getBoundingClientRect().right < input.nextElementSibling.getBoundingClientRect().left);
  assert.equal(tickOnLeft, true, 'Checklist ticks must stay left of their option text');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(await title.count(), 0);
  return { menuPortal: true, viewportBounds: true, keyboardSelection: true, nativeBridge: true, escapeIsolation: true, summaryContrast: minContrast, themeModesChecked: contrasts.length, chartHeight, checklistTicksOnLeft: true };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true,
    ...(process.env.YM3_CHROMIUM_EXECUTABLE ? { executablePath: process.env.YM3_CHROMIUM_EXECUTABLE } : {}) });
  try {
    for (const width of [390, 1064, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 883 }, reducedMotion: 'reduce' });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await installDashboardFixtures(page);
      await page.goto((process.env.YM3_PREVIEW_URL || 'http://127.0.0.1:4173/') + '#trades', { waitUntil: 'domcontentloaded' });
      console.log(JSON.stringify({ viewport: width, ...await runControlChecks(page) }));
      assert.deepEqual(errors, [], 'Browser runtime errors');
      await context.close();
    }
  } finally { await browser.close(); }
}
