import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';

const base = (process.env.YM3_PREVIEW_URL || 'http://127.0.0.1:4173/').replace(/\/$/, '');
const path = `${base}/home-lab/`;
const browser = await chromium.launch({headless:true});
const results=[];
await mkdir('artifacts/home-lab',{recursive:true});
try {
  for(const width of [390,768,1440]) {
    const page = await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    const gallery = await page.goto(path,{waitUntil:'domcontentloaded'});
    assert.equal(gallery?.status(),200,'Public concept gallery must be accessible without login');
    await page.locator('.concept-choice').first().waitFor();
    assert.equal(await page.locator('.concept-choice').count(),5,'All five design choices must be visible');
    assert.ok((await page.evaluate(()=>document.documentElement.scrollWidth))<=width+2,'Gallery must not overflow horizontally');
    for(const id of ['01','02','03','04','05']) {
      const response = await page.goto(`${path}?concept=${id}`,{waitUntil:'domcontentloaded'});
      assert.equal(response?.status(),200,'Standalone concept '+id+' must be accessible');
      await page.locator(`.concept[data-design="${id}"]`).waitFor();
      assert.equal(await page.locator('.signature-ribbon').count(),1,'Each concept retains its ribbon');
      assert.equal(await page.locator('.trade-pick').count(),3,'Each concept offers three trade examples');
      assert.ok((await page.locator('.chart-disclaimer').innerText()).includes('not actual account performance'),
        'Sample trades cannot masquerade as live evidence');
      assert.ok((await page.evaluate(()=>document.documentElement.scrollWidth))<=width+2,
        `Design ${id} must not overflow horizontally at ${width}px`);
      assert.equal(await page.locator('.ribbon-motion').evaluate(el=>getComputedStyle(el).animationName),'none',
        'Motion preferences must be respected');
      await page.locator('[data-trade="1"]').click();
      assert.equal(await page.locator('[data-trade="1"]').getAttribute('aria-pressed'),'true','Trade selector is interactive');
      assert.match(await page.locator('.market-svg').getAttribute('aria-label'),/EURUSD/i);
      assert.ok(await page.getByRole('link',{name:/Next concept/}).count()===1,'Comparison navigation exists');
      await page.screenshot({path:`artifacts/home-lab/${id}-${width}.png`,animations:'disabled'});
      results.push({id,width,overflow:false,tradeSelection:true});
    }
    assert.deepEqual(errors,[],'No runtime errors at '+width+'px');
    await page.close();
  }
  console.log(JSON.stringify({passed:true,designs:5,widths:[390,768,1440],checks:results.length,
    summary:'Public standalone gallery, responsive variants, accessible trade selectors, ribbon and sample-data labeling'}));
} finally {
  await browser.close();
}