import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base=(process.env.YM3_PREVIEW_URL || 'http://127.0.0.1:4173/').replace(/\/$/,'');
const sample={
  source:'third-party-catalogue',
  verified:false,
  updatedAt:'2026-11-23T00:00:00Z',
  brokers:[{name:'Example Broker',servers:[
    {name:'Example-Demo',type:'demo'},
    {name:'Example-Live',type:'real'},
  ]}],
};
const browser=await chromium.launch({headless:true});
try {
  for(const width of [390,1440]) {
    const context=await browser.newContext({viewport:{width,height:850}});
    const page=await context.newPage();
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/api/mt5/status',route=>route.fulfill({
      status:200,contentType:'application/json',
      body:JSON.stringify({accounts:[],links:[],devices:[],demoOnly:true,capturePaused:false}),
    }));
    let releaseDirectory;
    const waitForUserInput=new Promise(resolve=>{releaseDirectory=resolve;});
    await page.route('**/api/mt5/broker-directory',async route=>{
      await waitForUserInput;
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(sample)});
    });
    const response=await page.goto(base+'/mt5-login.html#test-pc',{waitUntil:'domcontentloaded'});
    assert.equal(response?.status(),200,'Account setup page should load in a browser.');
    await page.locator('#broker').fill('Example Broker');
    await page.locator('#server').fill('Example-Private-Demo-7');
    releaseDirectory();
    await page.locator('#server-choice option[value="Example-Demo"]').waitFor({state:'attached'});
    assert.equal(await page.locator('#broker').inputValue(),'Example Broker');
    assert.equal(await page.locator('#server').inputValue(),'Example-Private-Demo-7',
      'Background directory lookup must not erase a manually entered exact server.');
    assert.equal(await page.locator('#server-choice option[value="Example-Live"]').count(),0,
      'Live account endpoints must not appear in demo-only staging.');
    await page.locator('#server-choice').selectOption('Example-Demo');
    assert.equal(await page.locator('#server').isDisabled(),true,
      'Choosing a catalogued server must disable the competing manual field.');
    await page.locator('#server-choice').selectOption('');
    assert.equal(await page.locator('#server').inputValue(),'Example-Private-Demo-7',
      'Switching back to manual entry must preserve the original value.');
    assert.equal(await page.locator('#server').isDisabled(),false);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),
      'Broker onboarding must not overflow the mobile viewport.');
    assert.deepEqual(errors,[],'Broker finder should not trigger runtime errors.');
    await context.close();
  }
  console.log(JSON.stringify({passed:true,widths:[390,1440],directory:'merged',typedServer:'retained',liveFiltered:true}));
}finally {
  await browser.close();
}
