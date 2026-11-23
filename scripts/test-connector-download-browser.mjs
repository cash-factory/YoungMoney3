import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const base=(process.env.YM3_PREVIEW_URL || 'http://127.0.0.1:4173/').replace(/\/$/,'');
const api='https://api.github.com/repos/cash-factory/YoungMoney3/releases?per_page=30';
const tag='staging-connector-v0.5.4-rc1';
const root='https://github.com/cash-factory/YoungMoney3/releases/download/'+tag+'/';
const exe=root+'YoungMoney3.Connector.exe';
const checksum=exe+'.sha256';
const digest='1057f2c94777f3a99c31647a16f119012406e0009247602e28705a0a944ea7b1';
const verified=[{
  tag_name:tag,prerelease:true,draft:false,published_at:'2026-11-23T06:29:29Z',
  assets:[
    {name:'YoungMoney3.Connector.exe',browser_download_url:exe,digest:'sha256:'+digest,size:36360932},
    {name:'YoungMoney3.Connector.exe.sha256',browser_download_url:checksum,size:93},
  ],
}];
const browser=await chromium.launch({headless:true});
await mkdir('artifacts/adaptive',{recursive:true});
try{
  for(const width of [390,1440]){
    const context=await browser.newContext({viewport:{width,height:880},reducedMotion:'reduce'});
    const page=await context.newPage();
    const exceptions=[];
    page.on('pageerror',err=>exceptions.push(err.message));
    await page.route(api,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(verified)}));
    const response=await page.goto(base+'/connector-download.html',{waitUntil:'domcontentloaded'});
    assert.equal(response?.status(),200,'The compiled site must serve its connector download page.');
    await page.getByRole('status').filter({hasText:/Staging prerelease is available/}).waitFor();
    const button=page.getByRole('link',{name:'Download Connector v0.5.4-rc1'});
    assert.equal(await button.getAttribute('href'),exe,
      'One-click install must target the verified official release executable.');
    assert.equal(await page.getByRole('link',{name:'Download SHA-256 checksum'}).getAttribute('href'),checksum);
    assert.equal((await page.locator('#digest').textContent()).trim(),digest);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),
      'Release page must fit narrow viewports.');
    assert.deepEqual(exceptions,[]);
    await page.screenshot({path:'artifacts/adaptive/connector-release-'+width+'.png',fullPage:true});

    // A failed GitHub API lookup may not invent a newer build or strip the
    // last independently published checksum from the static fallback.
    await page.unroute(api);
    await page.route(api,route=>route.fulfill({status:429,contentType:'application/json',body:'{}'}));
    await page.reload({waitUntil:'domcontentloaded'});
    await page.getByRole('status').filter({hasText:/Automatic release check unavailable/}).waitFor();
    assert.equal(await page.getByRole('link',{name:'Download Connector v0.5.4-rc1'}).getAttribute('href'),exe);
    assert.equal((await page.locator('#digest').textContent()).trim(),digest);

    // A draft or URL from an unrelated host must never replace trusted links.
    await page.unroute(api);
    await page.route(api,route=>route.fulfill({status:200,contentType:'application/json',
      body:JSON.stringify([
        {...verified[0],assets:[{...verified[0].assets[0],browser_download_url:'https://untrusted.invalid/connector.exe'},verified[0].assets[1]]},
      ])}));
    await page.reload({waitUntil:'domcontentloaded'});
    await page.getByRole('status').filter({hasText:/Latest release could not be verified automatically/}).waitFor();
    assert.equal(await page.getByRole('link',{name:'Download Connector v0.5.4-rc1'}).getAttribute('href'),exe);
    assert.deepEqual(exceptions,[]);
    await context.close();
  }
  console.log(JSON.stringify({passed:true,widths:[390,1440],verifiedVersion:tag,untrustedUrlsRejected:true,offlineFallback:true}));
}finally{
  await browser.close();
}
