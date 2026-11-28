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
    assert.equal(await page.locator('.concept-choice').count(),6,'All six design choices must be visible');
    assert.ok((await page.evaluate(()=>document.documentElement.scrollWidth))<=width+2,'Gallery must not overflow horizontally');
    for(const id of ['01','02','03','04','05','06']) {
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
      if(id==='06') {
        const living=page.locator('.concept-living');
        assert.equal(await living.count(),1,'Original-inspired sixth concept is present');
        await page.locator('[data-living-phase="2"]').click();
        assert.equal(await page.locator('[data-living-phase="2"]').getAttribute('aria-pressed'),'true',
          'Four-stage process selector is interactive');
        assert.match(await page.locator('[data-living-step-title]').innerText(),/hypothesis|experiment/i);
        await page.locator('[data-living-next]').click();
        assert.equal(await page.locator('[data-living-phase="3"]').getAttribute('aria-pressed'),'true',
          'Step navigation advances the decision process');
        await page.locator('[data-living-module="3"]').click();
        assert.equal(await page.locator('[data-living-module="3"]').getAttribute('aria-pressed'),'true');
        assert.match(await page.locator('[data-living-module-headline]').innerText(),/broker record/i,
          'Accounts feature panel responds to tab selection');
        const theme=page.locator('[data-living-theme-toggle]');
        await theme.click();
        assert.equal(await living.getAttribute('data-living-theme'),'light','Appearance switcher works');
        assert.equal(await theme.getAttribute('aria-pressed'),'true','Appearance is accessible');
        assert.ok((await page.evaluate(()=>document.documentElement.scrollWidth))<=width+2,
          'Light appearance has no horizontal overflow');
        await theme.click();
        assert.equal(await living.getAttribute('data-living-theme'),'dark','Appearance can be restored');
        const tour=page.locator('[data-living-cycle]');
        await tour.click();
        assert.equal(await tour.getAttribute('aria-pressed'),'true','Process tour can start');
        await tour.click();
        assert.equal(await tour.getAttribute('aria-pressed'),'false','Process tour can be paused');
        assert.ok(await page.locator('[data-living-module-preview] .living-module-preview').count()===1);
      }
      await page.screenshot({path:`artifacts/home-lab/${id}-${width}.png`,animations:'disabled'});
      results.push({id,width,overflow:false,tradeSelection:true});
    }
    assert.deepEqual(errors,[],'No runtime errors at '+width+'px');
    await page.close();
  }
  console.log(JSON.stringify({passed:true,designs:6,widths:[390,768,1440],checks:results.length,
    summary:'Six standalone concepts, responsive variants, active trade charts, accessible original-inspired decisions, theme switching and labeled illustrative data'}));
  const motion=await browser.newPage({viewport:{width:1280,height:900},reducedMotion:'no-preference'});
  await motion.goto(path+'?concept=06',{waitUntil:'domcontentloaded'});
  assert.equal(await motion.locator('.ribbon-motion').evaluate(el=>getComputedStyle(el).animationName),
    'ribbonTravel','The sixth signature ribbon really moves without reduced motion');
  assert.equal(await motion.locator('.living-hero-copy').evaluate(el=>getComputedStyle(el).animationName),
    'living-hero-enter','The sixth hero has a controlled entrance animation');
  await motion.locator('[data-living-cycle]').click();
  assert.equal(await motion.locator('[data-living-cycle]').getAttribute('aria-pressed'),'true');
  await motion.locator('[data-living-cycle]').click();
  await motion.close();
} finally {
  await browser.close();
}