import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {installDashboardFixtures} from './test-dashboard-browser.mjs';

const base=(process.env.YM3_PREVIEW_URL || 'http://127.0.0.1:4173/').replace(/\/$/,'');
const browser=await chromium.launch({headless:true});
try{
  for(const width of [390,740,1440]){
    const context=await browser.newContext({viewport:{width,height:640},reducedMotion:'reduce'});
    const page=await context.newPage();
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await installDashboardFixtures(page);
    await page.goto(base+'/#mt5',{waitUntil:'domcontentloaded'});
    await page.getByRole('heading',{name:'Find accounts from Signal Desk'}).waitFor();
    const button=page.getByRole('button',{name:'How to add an account'});
    assert.equal(await button.getAttribute('aria-expanded'),'false');
    await button.click();
    const guide=page.locator('#ym-mt5-howto');
    await guide.waitFor();
    assert.equal(await guide.getByRole('listitem').count(),4);
    assert.equal(await button.getAttribute('aria-expanded'),null,
      'The show control intentionally switches its label when open');
    assert.equal(await page.getByRole('button',{name:'Hide account guide'}).getAttribute('aria-expanded'),'true');
    assert.equal(await guide.getByRole('link',{name:/Open Signal Desk download/}).getAttribute('href'),'/connector-download.html');
    assert.equal(await guide.getByRole('button',{name:/View paired PCs/}).count(),1);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),
      'MT5 walkthrough should not horizontally overflow '+width+'px');
    await guide.getByRole('button',{name:'Close account guide'}).click();
    await guide.waitFor({state:'detached'});
    assert.equal(await page.getByRole('button',{name:'How to add an account'}).getAttribute('aria-expanded'),'false');
    assert.deepEqual(errors,[], 'No runtime errors '+width);
    await context.close();
  }
  const context=await browser.newContext({viewport:{width:1180,height:700}});
  const page=await context.newPage();
  await installDashboardFixtures(page);
  await page.goto(base+'/#dashboard',{waitUntil:'domcontentloaded'});
  const ribbon=page.locator('.ym-editorial-ribbon');
  await ribbon.waitFor();
  const colors=[];
  for(const palette of ['true-pink','tiffany','charcoal-violet','cyprus','turmeric']){
    await page.evaluate(p=>{document.documentElement.dataset.palette=p;document.documentElement.classList.add('dark')},palette);
    const styling=await ribbon.evaluate(element=>{
      const cs=getComputedStyle(element);
      return {background:cs.backgroundColor,text:cs.color,word:getComputedStyle(element.querySelector('.ym-ribbon-word')).color};
    });
    colors.push(styling.background);
    assert.notEqual(styling.background,'rgb(195, 27, 62)',
      'Editorial ribbon must not use the hard-coded red across every theme');
    assert.ok(styling.text && styling.word);
  }
  assert.ok(new Set(colors).size>=4,'Ribbon reflects the selected palette across dark themes');
  await context.close();
  console.log(JSON.stringify({passed:true,mt5Widths:[390,740,1440],themeRibbonPalettes:5}));
}finally{await browser.close()}
