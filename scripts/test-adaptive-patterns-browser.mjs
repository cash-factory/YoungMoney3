import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { installDashboardFixtures } from './test-dashboard-browser.mjs';

const base=process.env.YM3_PREVIEW_URL || 'http://127.0.0.1:4173/';
const browser=await chromium.launch({headless:true});
let scenarios=0;
try {
  for(const width of [390,768,1440]) {
    const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    const {user}=await installDashboardFixtures(page);
    const now=Date.now();
    const reviews=Array.from({length:15},(_,i)=>({
      id:'pattern-review-'+i, reference:'trade/pattern-'+i, user_id:user.id,
      account_id:'fixture-account', strategy_id:'fixture-strategy',entry_model_id:'retest',
      strategy_name:'Breakout',model_name:i<12?'Confirmed retest':'Opening range',
      entry_time:new Date(now-(i*24*3600000)).toISOString(), updated_at:new Date(now-i*1000).toISOString(),
      verdict:i<10?'followed':'changed',pre_reveal_verdict:i<10?'followed':'changed',
      pre_reveal_at:new Date(now-i*1000).toISOString(),
      trigger:'My trigger fired',note:'',
    }));
    await page.route('**/api/data',route=>{
      const q=route.request().postDataJSON();
      if(q.table!=='decision_reviews') return route.fallback();
      assert.equal(q.action,'select');
      return route.fulfill({json:{data:reviews,count:reviews.length}});
    });
    await page.goto(base+'#dashboard',{waitUntil:'domcontentloaded'});
    const modes=page.getByRole('group',{name:'Trading desk modes'});
    await modes.waitFor();
    assert.equal(await modes.getByRole('button').count(),4);
    assert.equal(await modes.getByRole('button',{name:/Capture/}).getAttribute('aria-pressed'),'true');

    await modes.getByRole('button',{name:/Prepare/}).click();
    await page.locator('#dashboard-panel-risk').waitFor();
    assert.equal(await modes.getByRole('button',{name:/Prepare/}).getAttribute('aria-pressed'),'true');
    await page.locator('.ym-adaptive-focus').getByRole('button',{name:'Configure limits'}).click();
    const risk=page.getByRole('dialog',{name:/Risk/i});
    await risk.waitFor();
    await risk.getByRole('button',{name:'Close dialog'}).click();

    await modes.getByRole('button',{name:/Capture/}).click();
    await page.locator('#dashboard-panel-overview').waitFor();
    await page.getByRole('button',{name:'Record a deliberate pass'}).click();
    const capture=page.getByRole('dialog',{name:'Quick Capture'});
    await capture.waitFor();
    await capture.getByRole('button',{name:'Close dialog'}).click();

    await modes.getByRole('button',{name:/Review/}).click();
    await page.locator('#dashboard-panel-recent').waitFor();
    assert.ok(await page.locator('#ym-recent .ym-decision-desk').count());
    const ledger=page.locator('#ym-recent .ym-dash-recent-card');
    await ledger.getByText('Concealed').waitFor();
    assert.equal(await ledger.getByText('Hidden').count(),2,'Trade outcome and pips must be concealed by default.');
    assert.equal(await ledger.getByText('10.00', {exact:false}).count(),0);
    await page.getByRole('button',{name:'Reveal financial outcomes'}).click();
    assert.equal(await ledger.getByText('Concealed').count(),0);
    await page.getByRole('button',{name:'Hide financial outcomes'}).click();
    await ledger.getByText('Concealed').waitFor();
    await modes.getByRole('button',{name:/Understand/}).click();
    await page.locator('#dashboard-panel-deep-dive').waitFor();
    const patterns=page.getByRole('region',{name:'Personal trading patterns'});
    await patterns.waitFor();
    assert.equal(await patterns.getByText('15',{exact:true}).count()>=1,true);
    await patterns.getByRole('heading',{name:'Understand the process behind your decisions.'}).waitFor();
    await patterns.getByText('66.7%',{exact:true}).waitFor();
    assert.ok(await patterns.getByText(/15 eligible observations/).count());
    await patterns.getByLabel('Time window').selectOption('all');
    await patterns.getByRole('button',{name:'Refresh personal trading patterns'}).click();
    await patterns.getByText('66.7%',{exact:true}).waitFor();
    await patterns.getByText('Evidence quality & methodology').click();
    await patterns.getByText(/not a psychological diagnosis/).waitFor();
    const horizontal=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
    assert.ok(horizontal.scroll<=horizontal.width+2,'No horizontal overflow: '+JSON.stringify(horizontal));

    await modes.getByRole('button',{name:/Prepare/}).click();
    await page.getByRole('button',{name:'Make this my opening focus'}).click();
    assert.equal(await page.getByRole('button',{name:'Unpin opening focus'}).getAttribute('aria-pressed'),'true');
    await page.reload({waitUntil:'domcontentloaded'});
    await page.locator('#dashboard-panel-risk').waitFor();
    assert.equal(await page.getByRole('group',{name:'Trading desk modes'}).getByRole('button',{name:/Prepare/}).getAttribute('aria-pressed'),'true');
    await modes.getByRole('button',{name:/Understand/}).click();
    await page.getByRole('button',{name:'Open Improvement Laboratory'}).click();
    await page.getByRole('heading',{name:'Improvement Laboratory'}).waitFor();
    assert.match(new URL(page.url()).hash,/#strategy-testing$/);
    assert.deepEqual(errors,[],'No runtime exceptions');
    scenarios++;
    await page.close();
  }
  console.log(JSON.stringify({passed:true,scenarios,deskModes:true,personalPatterns:true,pinning:true,labHandoff:true}));
} finally {await browser.close();}
