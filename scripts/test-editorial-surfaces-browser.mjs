import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {installDashboardFixtures} from './test-dashboard-browser.mjs';

/** User-comment regression: original art, meaningful tonal hierarchy,
 * theme compatibility, and signup-only availability notifications. */
const base=(process.env.YM3_PREVIEW_URL || 'http://127.0.0.1:4173/').replace(/\/$/,'');
const browser=await chromium.launch({headless:true});
const palettes=['obsidian','true-pink','tiffany','cyprus'];
try{
  for(const width of [390,1440]){
    const context=await browser.newContext({viewport:{width,height:800},reducedMotion:'reduce'});
    const page=await context.newPage();
    const pageErrors=[];
    page.on('pageerror',err=>pageErrors.push(err.message));
    await installDashboardFixtures(page);
    await page.goto(base+'/#dashboard',{waitUntil:'domcontentloaded'});
    await page.getByRole('group',{name:'Trading desk modes'}).waitFor();
    for(const palette of palettes){
      await page.evaluate(p=>{
        document.documentElement.dataset.palette=p;
        document.documentElement.classList.add('dark');
      },palette);
      const snapshot=await page.evaluate(()=>{
        const modes=[...document.querySelectorAll('.ym-adaptive-mode')];
        const ribbon=document.querySelector('.ym-editorial-ribbon');
        if(!ribbon)throw Error('No editorial ribbon');
        const checker=getComputedStyle(ribbon,'::before');
        return {
          pageWidth:document.documentElement.scrollWidth,
          viewport:innerWidth,
          checkerBackground:checker.backgroundImage,
          checkerOpacity:Number(checker.opacity),
          modeArt:modes.map(el=>{
            const art=getComputedStyle(el,'::after');
            const title=el.querySelector('.ym-adaptive-mode-label');
            const artRect=el.getBoundingClientRect();
            return {
              kind:el.getAttribute('data-mode'),
              mask:art.maskImage||art.webkitMaskImage,
              opacity:Number(art.opacity),
              textPosition:title&&getComputedStyle(title).position,
              width:artRect.width,
            };
          }),
        };
      });
      assert.ok(snapshot.pageWidth<=width+2,'No horizontal overflow for '+palette+'/'+width);
      assert.match(snapshot.checkerBackground,/conic-gradient/,'Checkered flag texture must be rendered');
      assert.ok(snapshot.checkerOpacity>=.02&&snapshot.checkerOpacity<=.05,'Checkered texture stays barely perceptible behind the stronger accent wash');
      assert.deepEqual(snapshot.modeArt.map(item=>item.kind),['prepare','capture','review','analyze']);
      for(const art of snapshot.modeArt){
        assert.match(art.mask,/assets\/desk-art\//,'Each mode renders a real vector visual, not a placeholder');
        assert.ok(art.opacity>=.1 && art.opacity<=.3,'Decorative art stays restrained '+art.kind);
        assert.ok(art.width>100,'Mode remains readable '+art.kind);
        assert.equal(art.textPosition,'relative','Mode text sits above decorative art');
      }
    }
    // Functional mode selection must remain possible through the decorative layer.
    const review=page.getByRole('button',{name:'Review trading desk mode'});
    await review.click();
    assert.equal(await review.getAttribute('aria-pressed'),'true');
    // Cover cards with genuine fixture data; don't simulate broker evidence.
    await page.goto(base+'/#calendar',{waitUntil:'domcontentloaded'});
    const calendar=page.getByRole('region',{name:'MT5 position lifecycle calendar summary'});
    await calendar.waitFor();
    assert.equal(await calendar.locator('.ym-calendar-stat').count(),3);
    const typography=await calendar.evaluate(el=>{
      const title=getComputedStyle(el.querySelector('.ym-calendar-evidence-title')).color;
      const support=getComputedStyle(el.querySelector('.ym-calendar-evidence-support')).color;
      const background=getComputedStyle(el).backgroundImage;
      return {title,support,background};
    });
    assert.notEqual(typography.title,typography.support,'Title and supporting text need distinctive accents');
    assert.match(typography.background,/gradient/);
    const today=page.locator('#workspace-content .ym-calendar-today');
    const todayStyle=await today.evaluate(el=>({color:getComputedStyle(el).color,background:getComputedStyle(el).backgroundImage}));
    assert.match(todayStyle.background,/linear-gradient/,'Today has the requested bright gradient');
    assert.match(todayStyle.color,/rgb\(155, 35, 68\)/,'Today label remains a readable wine red');
    await page.goto(base+'/#strategies',{waitUntil:'domcontentloaded'});
    const strategies=page.locator('.ym-strategy-record');
    await strategies.first().waitFor();
    assert.ok(await strategies.count()>=1);
    const strategyGradient=await strategies.first().evaluate(el=>getComputedStyle(el).backgroundImage);
    assert.match(strategyGradient,/gradient/,'Strategy cards use branded tonal surfaces');
    await page.goto(base+'/#brokers-charting',{waitUntil:'domcontentloaded'});
    const account=page.locator('.ym-broker-account-card');
    await account.first().waitFor();
    assert.match(await account.first().evaluate(el=>getComputedStyle(el).backgroundImage),/gradient/);
    await page.goto(base+'/#journal',{waitUntil:'domcontentloaded'});
    const journal=page.getByRole('region',{name:'Broker execution context for journaling'});
    await journal.waitFor();
    assert.match(await journal.evaluate(el=>getComputedStyle(el).backgroundImage),/gradient/);
    await page.goto(base+'/#weekly-reviews',{waitUntil:'domcontentloaded'});
    const weekly=page.getByRole('region',{name:'Current week broker lifecycle reconciliation'});
    await weekly.waitFor();
    assert.equal(await weekly.locator('.ym-tone-tile').count()>=3,true,
      'Weekly evidence statistics should use the same restrained tinted tiles');
    assert.match(await weekly.evaluate(el=>getComputedStyle(el).backgroundImage),/gradient/);
    await page.goto(base+'/#account-settings',{waitUntil:'domcontentloaded'});
    await page.locator('#settings-username').waitFor();
    assert.equal(await page.locator('#settings-username-feedback').count(),0,
      'The username availability banner is signup-only, not rendered in Account Settings');
    assert.deepEqual(pageErrors,[],'No browser errors for '+width);
    await context.close();
  }
  console.log(JSON.stringify({passed:true,palettes,widths:[390,1440],checks:'editorial art, textured ribbon, tonal evidence, signup-only availability notice'}));
}finally{await browser.close()}
