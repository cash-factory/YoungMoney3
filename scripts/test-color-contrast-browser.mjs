import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import { chromium } from 'playwright';
import { installDashboardFixtures } from './test-dashboard-browser.mjs';

const base = process.env.YM3_PREVIEW_URL || 'http://127.0.0.1:4174/';
const palettes = [...readFileSync('src/context/ThemeContext.ts', 'utf8').matchAll(/\{ id: '([^']+)', name:/g)].map(match => match[1]);
const selectedPalettes = process.env.YM3_CONTRAST_PALETTES?.split(',') || palettes;
const reportOnly = process.argv.includes('--report-only');
const output = 'artifacts/color-contrast';
await mkdir(output, { recursive: true });

// Chromium screenshots contain the actual composited surface: gradient, tinted
// image, glass card and alpha overlays. PNG decoding needs no extra dependency.
function decodePng(buffer) {
  assert.equal(buffer.subarray(1, 4).toString(), 'PNG');
  const chunks = [];
  let width, height, channels;
  for (let offset = 8; offset < buffer.length;) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString();
    if (type === 'IHDR') {
      width = buffer.readUInt32BE(offset + 8);
      height = buffer.readUInt32BE(offset + 12);
      assert.equal(buffer[offset + 16], 8, 'Use an 8-bit screenshot');
      channels = { 2: 3, 6: 4 }[buffer[offset + 17]];
      assert.ok(channels, 'Use an RGB/RGBA screenshot');
    } else if (type === 'IDAT') chunks.push(buffer.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  const paeth = (a, b, c) => {
    const p = a + b - c, da = Math.abs(p - a), db = Math.abs(p - b), dc = Math.abs(p - c);
    return da <= db && da <= dc ? a : db <= dc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const at = y * stride + x;
      const a = x >= channels ? pixels[at - channels] : 0;
      const b = y ? pixels[at - stride] : 0;
      const c = y && x >= channels ? pixels[at - stride - channels] : 0;
      const predictors = [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)];
      pixels[at] = (raw[y * (stride + 1) + x + 1] + predictors[filter]) & 255;
    }
  }
  return { width, height, pixel(x, y) {
    const at = (Math.max(0, Math.min(height - 1, Math.round(y))) * width + Math.max(0, Math.min(width - 1, Math.round(x)))) * channels;
    return [...pixels.subarray(at, at + 3)];
  } };
}
const luminance = rgb => rgb.map(value => {
  const v = value / 255;
  return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
}).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
const ratio = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);

async function sample(page, selector, name) {
  const records = await page.evaluate(selector => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d');
    const rgba = value => {
      context.clearRect(0, 0, 1, 1); context.fillStyle = value; context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data];
    };
    return [...new Set(document.querySelectorAll(selector))].flatMap((element, index) => {
      const box = element.getBoundingClientRect(), style = getComputedStyle(element);
      const directCopy = [...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
      const input = element instanceof HTMLInputElement;
      const icon = element instanceof SVGElement;
      if (!box.width || !box.height || box.right <= 0 || box.left >= innerWidth || box.bottom <= 0 || box.top >= innerHeight || style.visibility === 'hidden' || (!directCopy && !input && !icon)) return [];
      let opacity = 1;
      for (let parent = element; parent; parent = parent.parentElement) opacity *= Number(getComputedStyle(parent).opacity);
      const paint = input ? getComputedStyle(element, '::placeholder') : style;
      const gradient = !input && paint.webkitTextFillColor === 'rgba(0, 0, 0, 0)' && paint.backgroundImage !== 'none';
      const colors = gradient ? [...paint.backgroundImage.matchAll(/(?:rgba?\([^)]*\)|color\([^)]*\)|#[a-f\d]{3,8})/gi)].map(match => rgba(match[0])) : [rgba(paint.color)];
      if (!colors.length) throw Error('Cannot resolve text gradient colors');
      const fontSize = Number.parseFloat(paint.fontSize), weight = Number.parseFloat(paint.fontWeight);
      const minimum = icon || fontSize >= 24 || (fontSize >= 18.66 && weight >= 700) ? 3 : 4.5;
      element.setAttribute('data-contrast-sample', String(index));
      if (gradient) element.setAttribute('data-contrast-gradient', '');
      return [{ label: input ? 'Input placeholder' : icon ? 'Icon ' + element.getAttribute('class') : element.textContent.trim().replace(/\s+/g, ' ').slice(0, 90),
        colors, opacity, minimum, primary: element.matches('.ym-auth-form button[type="submit"],.ym-dash-new-trade'), box: { x: Math.max(0, box.x), y: Math.max(0, box.y), width: Math.min(innerWidth, box.right) - Math.max(0, box.left), height: Math.min(innerHeight, box.bottom) - Math.max(0, box.top) } }];
    });
  }, selector);
  assert.ok(records.length, name + ': no rendered foregrounds found');
  const mask = await page.addStyleTag({ content:
    '[data-contrast-sample],[data-contrast-sample] *{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important}' +
    '[data-contrast-sample]::placeholder{color:transparent!important;-webkit-text-fill-color:transparent!important}' +
    '[data-contrast-gradient]{background-image:none!important}' });
  let screenshot;
  try { screenshot = decodePng(await page.screenshot({ animations: 'disabled' })); }
  finally {
    await mask.evaluate(element => element.remove());
    await page.locator('[data-contrast-sample]').evaluateAll(elements => elements.forEach(element => {
      element.removeAttribute('data-contrast-sample'); element.removeAttribute('data-contrast-gradient');
    }));
  }
  return records.map(record => {
    let minimumRatio = Infinity;
    for (const x of [.12, .5, .88]) for (const y of [.25, .5, .75]) {
      const background = screenshot.pixel(record.box.x + record.box.width * x, record.box.y + record.box.height * y);
      for (const color of record.colors) {
        const alpha = color[3] / 255 * record.opacity;
        const foreground = color.slice(0, 3).map((channel, index) => channel * alpha + background[index] * (1 - alpha));
        minimumRatio = Math.min(minimumRatio, ratio(foreground, background));
      }
    }
    const normalCraftyPrimary = record.primary && name.includes('/craftylabs-studio/') && (name.startsWith('auth/') || name.startsWith('dashboard/'));
    const background = screenshot.pixel(record.box.x + record.box.width / 2, record.box.y + record.box.height / 2);
    // White-text contrast alone also passes for the old maroon fill. Preserve
    // the owner's brighter signal-red direction without pinning one hex value.
    const vividRed = !normalCraftyPrimary || (background[0] >= 210 && background[1] < 80 && background[2] < 100);
    return { scenario: name, label: record.label, ratio: Number(minimumRatio.toFixed(3)), required: record.minimum,
      ...(normalCraftyPrimary ? { background, vividRed } : {}) };
  });
}

async function stable(page) {
  await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}[data-reveal]{opacity:1!important;transform:none!important;filter:none!important}' });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function setTheme(page, palette, mode) {
  await page.evaluate(({ palette, mode }) => {
    localStorage.setItem('journal-palette', palette); localStorage.setItem('journal-theme', mode);
  }, { palette, mode });
  await page.reload({ waitUntil: 'domcontentloaded' });
}

const authSelector = '.ym-auth-showcase h1,.ym-auth-showcase h2,.ym-auth-showcase h2 span,.ym-auth-showcase p,.ym-auth-showcase svg,.ym-auth-showcase .ym-auth-privacy,.ym-auth-form h2,.ym-auth-form p,.ym-auth-form label,.ym-auth-form input,.ym-auth-form button,.ym-auth-form button svg';
const landingSelector = '.ym-studio-landing h1,.ym-studio-landing h1 span,.ym-studio-landing h1 + p,.ym-studio-landing .text-gradient,.ym-studio-landing .text-gradient-amber,.ym-studio-landing .btn-primary';
const footerSelector = '.ym-studio-landing footer p,.ym-studio-landing footer a,.ym-studio-landing footer span,.ym-studio-landing footer small';
const browser = await chromium.launch({ headless: true, ...(process.env.YM3_CHROMIUM_EXECUTABLE ? { executablePath: process.env.YM3_CHROMIUM_EXECUTABLE } : {}) });
const results = [];
let scenarios = 0;
try {
  for (const width of [390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', route => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Unauthenticated' }) }));
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    for (const palette of selectedPalettes) for (const mode of ['light', 'dark']) {
      const name = `${palette}/${mode}/${width}`;
      await setTheme(page, palette, mode);
      await page.locator('.ym-studio-landing h1').waitFor();
      await stable(page);
      results.push(...await sample(page, landingSelector, 'landing/' + name));
      await page.locator('.ym-studio-footer').scrollIntoViewIfNeeded();
      results.push(...await sample(page, footerSelector, 'footer/' + name));
      await page.evaluate(() => scrollTo(0, 0));
      await page.locator('.ym-studio-landing nav .btn-primary').click();
      await page.getByRole('heading', { name: 'Welcome back', exact: true }).waitFor();
      await stable(page);
      results.push(...await sample(page, authSelector, 'auth/' + name));
      const primary = page.locator('.ym-auth-form button[type="submit"]');
      await primary.hover();
      results.push(...await sample(page, '.ym-auth-form button[type="submit"]', 'auth-hover/' + name));
      await page.mouse.move(0, 0); await primary.focus();
      results.push(...await sample(page, '.ym-auth-form button[type="submit"]', 'auth-focus/' + name));
      if (process.env.YM3_CONTRAST_SHOTS === '1' && palette === 'craftylabs-studio') {
        await page.screenshot({ path: `${output}/auth-${mode}-${width}.png`, fullPage: true });
      }
      scenarios++;
    }
    assert.deepEqual(errors, [], 'Public contrast checks must not trigger runtime errors');
    console.log(JSON.stringify({ width, scenarios, sampledForegrounds: results.length }));
    await context.close();
  }

  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await installDashboardFixtures(page);
  await page.goto(base + '#dashboard', { waitUntil: 'domcontentloaded' });
  for (const palette of selectedPalettes) for (const mode of ['light', 'dark']) {
    await setTheme(page, palette, mode);
    await page.getByRole('heading', { name: /Trading Overview/ }).waitFor(); await stable(page);
    results.push(...await sample(page, '.ym-dash-new-trade,.ym-dash-jump button[aria-selected="true"],.ym-nav-item[data-active="true"],.ym-nav-item[data-active="true"] svg,.ym-dash-topic-mark', `dashboard/${palette}/${mode}`));
    scenarios++;
  }
  await context.close();
} finally { await browser.close(); }
const failures = results.filter(result => result.ratio + .02 < result.required || result.vividRed === false);
await writeFile(`${output}/report.json`, JSON.stringify({ scenarios, palettes: selectedPalettes, samples: results.length, failures, results }, null, 2) + '\n');
console.log(JSON.stringify({ passed: failures.length === 0, scenarios, palettes: selectedPalettes.length, modes: 2, sampledForegrounds: results.length, failures: failures.slice(0, 35) }));
if (!reportOnly) assert.deepEqual(failures, [], 'Rendered text and controls must contrast with their actual composited backgrounds');
