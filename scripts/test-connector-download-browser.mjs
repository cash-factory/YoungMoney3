import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';

const base=(process.env.YM3_PREVIEW_URL||'http://127.0.0.1:4173/').replace(/\/$/,'');
const api='https://api.github.com/repos/cash-factory/YoungMoney3/releases?per_page=40';
const tag='staging-signaldesk-v0.4.0-preview.1';
const root='https://github.com/cash-factory/YoungMoney3/releases/download/'+tag+'/';
const installer=root+'YoungMoney3.Signal.Desk_0.4.0_x64-setup.exe';
const checksum=installer+'.sha256';
const digest='a'.repeat(64); // Synthetic digest only inside mock GitHub API.
const legacy='https://github.com/cash-factory/YoungMoney3/releases/download/staging-connector-v0.6.4-rc1/YoungMoney3.Connector.exe';
const verified=[{
  tag_name:tag,prerelease:true,draft:false,
  assets:[
    {name:'YoungMoney3.Signal.Desk_0.4.0_x64-setup.exe',browser_download_url:installer,digest:'sha256:'+digest,size:35000000},
    {name:'YoungMoney3.Signal.Desk_0.4.0_x64-setup.exe.sha256',browser_download_url:checksum,size:66},
  ],
}];
const old=[{tag_name:'staging-connector-v0.6.4-rc1',prerelease:true,draft:false,
  assets:[{name:'YoungMoney3.Connector.exe',browser_download_url:legacy,size:36000000,digest:'sha256:'+digest}]}];
const browser=await chromium.launch({headless:true});
await mkdir('artifacts/adaptive',{recursive:true});
try{
  for(const width of [390,1440]){
    const ctx=await browser.newContext({viewport:{width,height:870},reducedMotion:'reduce'});
    const page=await ctx.newPage();
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route(api,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([...old,...verified])}));
    const r=await page.goto(base+'/connector-download.html',{waitUntil:'domcontentloaded'});
    assert.equal(r?.status(),200);
    await page.getByRole('status').filter({hasText:'Verified official staging installer available.'}).waitFor();
    assert.equal(await page.locator('#download').getAttribute('href'),installer);
    assert.equal(await page.locator('#checksum').getAttribute('href'),checksum);
    assert.equal((await page.locator('#digest').textContent()).trim(),digest);
    assert.match((await page.title()),/Signal Desk/);
    assert.equal(await page.getByRole('link',{name:/Download Signal Desk for Windows/}).count(),1);
    assert.ok(!await page.content().then(c=>c.includes(legacy)),
      'The primary download page may not advertise the owner-only classic executable.');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),
      'Download page must fit a narrow Windows/browser viewport.');
    assert.deepEqual(errors,[]);
    await page.screenshot({path:'artifacts/adaptive/signaldesk-download-'+width+'.png',fullPage:true});

    await page.unroute(api);
    await page.route(api,route=>route.fulfill({status:429,contentType:'application/json',body:'{}'}));
    await page.reload({waitUntil:'domcontentloaded'});
    await page.getByRole('status').filter({hasText:/Could not check for newer releases/}).waitFor();
    assert.match(await page.locator('#download').getAttribute('href'),/staging-signaldesk-v0\.3\.0-preview\.1/);
    assert.match((await page.locator('#digest').textContent()).trim(),/^[a-f0-9]{64}$/);

    await page.unroute(api);
    await page.route(api,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{
      ...verified[0],assets:[{...verified[0].assets[0],browser_download_url:'https://untrusted.invalid/payload.exe'},verified[0].assets[1]]
    }])}));
    await page.reload({waitUntil:'domcontentloaded'});
    await page.getByRole('status').filter({hasText:/latest installer could not be verified/i}).waitFor();
    assert.match(await page.locator('#download').getAttribute('href'),/staging-signaldesk-v0\.3\.0-preview\.1/);
    assert.deepEqual(errors,[]);
    await ctx.close();
  }
  console.log(JSON.stringify({passed:true,primary:'Signal Desk',widths:[390,1440],
    untrustedUrlsRejected:true,legacyNotAdvertised:true,offlineVerifiedFallback:true}));
}finally{await browser.close()}
