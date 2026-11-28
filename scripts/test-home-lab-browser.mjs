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
        assert.ok(await page.locator('.living-decision-note').evaluate(el =>
          el.getBoundingClientRect().top >= document.querySelector('.chart-shell-living').getBoundingClientRect().bottom + 6),
          'Behind-the-chart note must not obstruct illustrative data disclaimer');
        await page.locator('[data-living-phase="2"]').click();
        assert.equal(await page.locator('[data-living-phase="2"]').getAttribute('aria-pressed'),'true',
          'Four-stage process selector is interactive');
        assert.match(await page.locator('[data-living-step-title]').innerText(),/hypothesis|experiment/i);
        await page.locator('[data-living-next]').click();
        assert.equal(await page.locator('[data-living-phase="3"]').getAttribute('aria-pressed'),'true',
          'Step navigation advances the decision process');
        assert.equal(await page.locator('.living-section-id').first().evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(230, 0, 18)',
          'CLabs-style true scarlet title plates replace the old pink/maroon color');
        assert.equal(await living.evaluate(el=>getComputedStyle(el).getPropertyValue('--living-red').trim()),'#e60012',
          'Concept 06 uses true scarlet across all sections');
        assert.ok(await page.locator('.living-hero').evaluate(el => {
          const opacity=Number(getComputedStyle(el,'::after').opacity);
          return opacity>0 && opacity<.05 && getComputedStyle(el,'::after').backgroundImage.includes('conic-gradient');
        }), 'Site-wide checkboard texture stays faint');
        const theme=page.locator('[data-living-theme-toggle]');
        await theme.click();
        assert.equal(await living.getAttribute('data-living-theme'),'light','Appearance switcher works');
        assert.equal(await theme.getAttribute('aria-pressed'),'true','Appearance is accessible');
        assert.ok((await page.evaluate(()=>document.documentElement.scrollWidth))<=width+2,
          'Light appearance has no horizontal overflow');
        if(width===390 || width===1440) {
          await page.evaluate(()=>window.scrollTo(0,0));
          await page.screenshot({path:`artifacts/home-lab/06-light-${width}.png`,animations:'disabled'});
        }
        await theme.click();
        assert.equal(await living.getAttribute('data-living-theme'),'dark','Appearance can be restored');
        const tour=page.locator('[data-living-cycle]');
        await tour.click();
        assert.equal(await tour.getAttribute('aria-pressed'),'true','Process tour can start');
        await tour.click();
        assert.equal(await tour.getAttribute('aria-pressed'),'false','Process tour can be paused');
        assert.equal(await page.locator('[data-explorer-area]').count(),18,'All eighteen actual platform areas are present');
        if(width===1440) {
          const layout=await page.locator('.living-hero').evaluate(hero=>{
            const copy=hero.querySelector('.living-hero-copy').getBoundingClientRect();
            const chart=hero.querySelector('.living-hero-visual').getBoundingClientRect();
            return {copyLeft:copy.left,copyRight:copy.right,chartLeft:chart.left,
              copyTop:copy.top,chartTop:chart.top,heroBottom:hero.getBoundingClientRect().bottom};
          });
          assert.ok(layout.chartLeft>layout.copyLeft+250 && layout.chartTop<layout.heroBottom,
            'Desktop hero must present text and chart beside one another, not in a displaced grid row');
          assert.ok(Math.abs(layout.chartTop-layout.copyTop)<250,
            'Headline and illustrative chart must share the first hero row');
        }
        assert.equal(await page.locator('.living-line-svg').count(),1,'Hero uses the original-style line chart, not candlesticks');
        assert.equal(await page.locator('.living-line-svg .candle').count(),0,'Hero has no candlesticks');
        assert.equal(await page.locator('[data-recent-trade]').count(),3,'Recent fictional trades are available');
        assert.equal(await page.locator('.living-slanted-divider').count(),1,'Angled signature ribbon divides the page');
        assert.match(await page.locator('.living-recent-head').innerText(),/FICTIONAL RESULTS/i);
        assert.match(await page.locator('.living-line-svg').getAttribute('aria-label'),/EURUSD/i);
        await page.locator('[data-recent-trade="2"]').click();
        assert.equal(await page.locator('[data-recent-trade="2"]').getAttribute('aria-pressed'),'true','Recent-trade card selects a scenario');
        assert.match(await page.locator('.living-line-svg').getAttribute('aria-label'),/US100/i);
        assert.equal(await page.locator('[data-story-step]').count(),4,'Evidence story includes intent through adjustment');
        await page.locator('[data-story-step="2"]').click();
        assert.equal(await page.locator('[data-story-step="2"]').getAttribute('aria-pressed'),'true');
        assert.match(await page.locator('[data-story-title]').innerText(),/conclude/i);
        await page.locator('[data-story-next]').click();
        assert.match(await page.locator('[data-story-label]').innerText(),/ADJUSTMENT/i);
        await page.locator('[data-explorer-area="11"]').click();
        assert.match(await page.locator('[data-explorer-heading]').innerText(),/Copy Studio/);
        await page.locator('[data-explorer-feature="2"]').click();
        assert.match(await page.locator('[data-explorer-feature-name]').innerText(),/Local consent/i);
        assert.match(await page.locator('[data-explorer-feature-why]').innerText(),/authoriz/i);
        await page.locator('[data-explorer-area="0"]').click();
        assert.equal(await page.locator('[data-explorer-feature]').count(),4,'Journal has specific functions');
        await page.locator('[data-explorer-search]').fill('risk');
        assert.ok((await page.locator('[data-explorer-area]:visible').count())>=1,'Category filter responds');
        await page.locator('[data-explorer-search]').fill('');
        assert.equal(await page.locator('[data-explorer-area]:visible').count(),18,'Clearing filter restores catalog');
        assert.ok((await page.evaluate(()=>document.documentElement.scrollWidth))<=width+2,
          'Expanded platform explorer must not overflow horizontally');
        assert.ok(await page.locator('.living-explorer-area-art').evaluate(el =>
          getComputedStyle(el).backgroundImage.includes('visual-atlas.svg')),
          'Selected area receives a separate category-specific illustration');
        assert.ok(await page.locator('.living-phase-art').evaluate(el =>
          getComputedStyle(el).backgroundImage.includes('visual-atlas.svg')),
          'Each decision stage receives contextual art');
        assert.ok(await page.locator('.living-method-panel > .living-phase-art').evaluate(el => {
          const frame=el.parentElement.getBoundingClientRect();
          const image=el.getBoundingClientRect();
          const opacity=Number(getComputedStyle(el).opacity);
          return image.width>=frame.width*.98 && image.height>=frame.height*.98 &&
            opacity>0 && opacity<=.18 && getComputedStyle(el).position==='absolute';
        }), 'Stage illustration fills the full decision panel as a subdued backdrop, not a popup');
        assert.ok(await page.locator('.living-step.is-current').evaluate(el => {
          const color=getComputedStyle(el).backgroundColor.match(/\d+/g)?.map(Number)||[];
          return color[0]<70 && Math.abs(color[0]-color[1])<20 && Math.abs(color[0]-color[2])<20;
        }), 'Selected decision cards remain neutral, without a maroon/purple fill');
      }
      await page.evaluate(()=>window.scrollTo(0,0));
      await page.screenshot({path:`artifacts/home-lab/${id}-${width}.png`,animations:'disabled'});
      if(id==='06' && (width===390 || width===1440)) {
        await page.screenshot({path:`artifacts/home-lab/${id}-full-${width}.png`,fullPage:true,animations:'disabled'});
      }
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
  assert.equal(await motion.locator('.living-slanted-track').evaluate(el=>getComputedStyle(el).animationName),
    'ribbonTravel','The slanted divider has authentic motion');
  await motion.locator('[data-living-phase="1"]').click();
  assert.ok(await motion.locator('.living-phase-art').evaluate(el=>getComputedStyle(el).backgroundImage.includes('visual-atlas.svg')),
    'Slideshow phase art remains available with animation enabled');
  const motionMethod=motion.locator('.living-method');
  const motionTour=motion.locator('[data-living-cycle]');
  assert.equal(await motionTour.getAttribute('aria-pressed'),'true',
    'The decision loop is enabled automatically for regular motion preference');
  await motion.locator('.living-method-grid').scrollIntoViewIfNeeded();
  await motion.mouse.move(2,2);
  await motion.waitForFunction(()=>
    document.querySelector('.living-method')?.dataset.livingAutoState==='playing',
    null,{timeout:6500});
  assert.equal(await motion.locator('[data-living-cycle-status]').innerText(),
    'AUTO · READ AT YOUR PACE');
  await motion.locator('.living-method-grid').hover();
  await motion.waitForFunction(()=>
    document.querySelector('.living-method')?.dataset.livingAutoState==='hover-paused',
    null,{timeout:4500});
  const whenPaused=await motion.locator('[data-living-step-number]').innerText();
  await motion.waitForTimeout(850);
  assert.equal(await motion.locator('[data-living-step-number]').innerText(),whenPaused,
    'Hovering must stop the automatic decision loop');
  await motion.mouse.move(2,2);
  await motion.waitForFunction(()=>
    document.querySelector('.living-method')?.dataset.livingAutoState==='playing',
    null,{timeout:4500});
  await motion.waitForFunction(before=>
    document.querySelector('[data-living-step-number]')?.textContent!==before,
    whenPaused,{timeout:12500});
  assert.notEqual(await motion.locator('[data-living-step-number]').innerText(),whenPaused,
    'Autoplay resumes the remaining reading interval after hover leaves');
  await motionTour.click();
  assert.equal(await motionTour.getAttribute('aria-pressed'),'false',
    'Manual pause stays available when autoplay is active');
  await motionTour.click();
  assert.equal(await motionTour.getAttribute('aria-pressed'),'true',
    'Users can opt back into the automatic slideshow');
  await motion.close();
} finally {
  await browser.close();
}