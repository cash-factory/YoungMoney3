import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseUrl = process.env.YM3_PREVIEW_URL || 'http://127.0.0.1:4173/';
const output = process.env.YM3_VISUAL_DIR || 'artifacts/workflow-ribbon';
const widths = process.env.YM3_QA_WIDTHS ? process.env.YM3_QA_WIDTHS.split(',').map(Number) : [280, 320, 360, 390, 639, 640, 768, 1103, 1440];
const palettes = [...readFileSync('src/context/ThemeContext.ts', 'utf8').matchAll(/\{ id: '([^']+)', name:/g)].map(m => m[1]);
const browser = await chromium.launch({ headless: true, channel: process.env.YM3_BROWSER_CHANNEL || undefined });
await mkdir(output, { recursive: true });
let scenarios = 0;
try {
  const page = await browser.newPage();
  await page.route('**/api/me', route => route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"Unauthenticated"}' }));
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.locator('.ym-workflow-ribbon').waitFor();
  await page.evaluate(() => document.fonts.ready);
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    for (const palette of palettes) {
      for (const mode of ['light', 'dark']) {
        for (const reducedMotion of ['reduce', 'no-preference']) {
          await page.emulateMedia({ reducedMotion });
          await page.evaluate(({ palette, mode }) => {
            // Exercise the same root attributes the theme provider applies.
            // This matrix tests ribbon geometry; theme persistence is covered separately.
            document.documentElement.dataset.palette = palette;
            document.documentElement.classList.toggle('dark', mode === 'dark');
          }, { palette, mode });
          // Media emulation can acknowledge before Chromium has applied its
          // style update. Measure only after two rendered frames have settled.
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          const ribbon = page.locator('.ym-workflow-ribbon');
          await ribbon.waitFor();
          await ribbon.scrollIntoViewIfNeeded();
          // Centre the ribbon below the fixed navigation for visual QA.
          await ribbon.evaluate(list => {
            const rect = list.getBoundingClientRect();
            window.scrollTo({ top: scrollY + rect.top - innerHeight / 2 + rect.height / 2, behavior: 'instant' });
          });
          const result = await ribbon.evaluate(list => {
            const section = list.parentElement;
            const box = section.getBoundingClientRect();
            const items = [...list.children];
            const problems = [];
            for (const node of [section, list, ...list.querySelectorAll('*')]) {
              const style = getComputedStyle(node);
              if (style.animationName !== 'none') problems.push('Animated ribbon');
              // Separators intentionally sit in the grid gaps outside each li.
              if ((node === section || node === list) && node.scrollWidth > node.clientWidth + 1) problems.push('Overflow inside ribbon: ' + node.className);
            }
            for (const span of list.querySelectorAll('span')) {
              const range = document.createRange();
              range.selectNodeContents(span);
              for (const rect of range.getClientRects()) {
                if (rect.left < 0 || rect.right > innerWidth || rect.left < box.left || rect.right > box.right || rect.top < box.top || rect.bottom > box.bottom) problems.push('Clipped label');
              }
            }
            if (document.documentElement.scrollWidth > innerWidth) problems.push('Horizontal page scrolling');
            return {
              labels: items.map(item => item.textContent.replace(/\s+/g, ' ').trim()),
              columns: getComputedStyle(list).gridTemplateColumns.split(' ').length,
              problems,
              positions: items.map(item => { const r = item.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; }),
            };
          });
          const name = `${palette}-${mode}-${width}-${reducedMotion}`;
          assert.deepEqual(result.labels, ['01Plan', '02Capture', '03Test', '04Review'], name);
          assert.equal(result.columns, width < 640 ? 2 : 4, name);
          assert.deepEqual(result.problems, [], name);
          // A running ticker must fail even if its animation name changes.
          await page.waitForTimeout(40);
          const positions = await ribbon.locator('li').evaluateAll(items => items.map(item => { const r = item.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; }));
          assert.deepEqual(positions, result.positions, `${name}: ribbon moved`);
          if (palette === 'craftylabs-studio' && reducedMotion === 'no-preference') await page.locator('.ym-studio-landing-ticker').screenshot({ path: `${output}/${name}.png` });
          scenarios++;
        }
      }
    }
    console.log(`PASS: width ${width}, all palettes and motion preferences`);
  }
  console.log(`PASS: ${scenarios} ribbon scenarios across ${widths.length} widths, 12 palettes, light/dark and both motion preferences`);
} finally {
  await browser.close();
}
