import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { installDashboardFixtures } from './test-dashboard-browser.mjs';

const palettes = [...readFileSync('src/context/ThemeContext.ts','utf8').matchAll(/\{ id: '([^']+)', name:/g)].map(match=>match[1]);
const base = process.env.YM3_PREVIEW_URL || 'http://127.0.0.1:4174/';
const pages = ['dashboard','trades','calendar','journal','strategies','notes','analytics','media'];
const browser = await chromium.launch({headless:true,...(process.env.YM3_CHROMIUM_EXECUTABLE ? {executablePath:process.env.YM3_CHROMIUM_EXECUTABLE} : {})});
await mkdir('artifacts/platform',{recursive:true});
let scenarios=0;
try {
 for(const width of [390,1064,1440]) {
  const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
  const page=await context.newPage();
  const errors=[];
  page.on('pageerror', error=>errors.push(error.message));
  await installDashboardFixtures(page);
  for(const palette of palettes) for(const mode of ['light','dark']) {
   await page.goto(base+'#dashboard',{waitUntil:'domcontentloaded'});
   await page.evaluate(({palette,mode})=>{localStorage.setItem('journal-palette',palette);localStorage.setItem('journal-theme',mode);},{palette,mode});
   await page.reload({waitUntil:'domcontentloaded'});
   for(const destination of pages) {
    await page.evaluate(destination=>{location.hash=destination;},destination);
    const experience=page.locator(`[data-workspace-page="${destination}"]`);
    await experience.locator('h1').first().waitFor();
    await page.waitForTimeout(40);
    const result=await page.evaluate(()=>{
     const styles=getComputedStyle(document.documentElement);
     const canvas=document.createElement('canvas');canvas.width=canvas.height=1;
     const ctx=canvas.getContext('2d');
     const rgb=color=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].slice(0,3);};
     const lum=color=>rgb(color).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
     const bg=lum(styles.getPropertyValue('--bg-card'));
     const ratios=['--text-primary','--text-secondary','--text-muted','--success-text','--error-text'].map(token=>{
      const fg=lum(styles.getPropertyValue(token));return [token,(Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05)];
     });
     return {width:document.documentElement.scrollWidth,viewport:innerWidth,palette:document.documentElement.dataset.palette,
      ratios, visibleHeadings:[...document.querySelectorAll('[data-workspace-page] h1')].filter(n=>n.getBoundingClientRect().height>0).length};
    });
    assert.equal(result.palette,palette);
    assert.ok(result.width<=width+2,`${destination}/${palette}/${mode}/${width}: horizontal overflow ${result.width}`);
    assert.equal(result.visibleHeadings,1,`${destination}: needs one page heading`);
    const artSelector = destination==='dashboard' ? '.ym-dash-heading-art'
      : destination==='media' ? '.ym-library-art img' : '.ym-page-art img';
    const art=experience.locator(artSelector).first();
    await art.waitFor({state:'attached'});
    await page.waitForFunction(
      ({ pageId, selector }) => {
        const element = document.querySelector(`[data-workspace-page="${pageId}"] ${selector}`);
        return element instanceof HTMLImageElement && element.complete && element.naturalWidth > 0;
      },
      { pageId:destination, selector:artSelector },
      { timeout:8000 },
    );
    const asset=await art.evaluate(img=>{
      const src=img.getAttribute('src');
      const region=img.getBoundingClientRect();
      const parent=img.closest('.ym-page-heading, .ym-dash-heading, .ym-library-hero');
      const copy=parent?.querySelector('.ym-page-heading-main');
      const text=copy?.getBoundingClientRect();
      return {src,complete:img.complete,naturalWidth:img.naturalWidth,
        width:region.width,height:region.height,
        textOverlaps: !!text && region.left<text.right-1 && region.top<text.bottom-1 && region.bottom>text.top+1 &&
          region.right>text.left+1};
    });
    assert.ok(asset.src && asset.src.startsWith(destination==='media'?'/visuals/':'/assets/page-art/'),
      destination+' must load decorative art from local versioned assets: '+JSON.stringify(asset));
    assert.ok(asset.complete && asset.naturalWidth>0,
      destination+' image must render in the browser: '+JSON.stringify(asset));
    assert.ok(asset.width>50 && asset.height>50,
      destination+' illustration needs adequate visible size: '+JSON.stringify(asset));
    if(destination!=='dashboard' && destination!=='media') {
      assert.equal(asset.textOverlaps,false,
        destination+' image must not overlap editable heading or actions: '+JSON.stringify(asset));
    }
    for(const [token,ratio] of result.ratios) assert.ok(ratio>=4.5,`${palette}/${mode}: ${token} contrast ${ratio.toFixed(2)}`);
    if(palette==='craftylabs-studio'&&mode==='dark') await page.screenshot({path:`artifacts/platform/${destination}-${width}.png`,fullPage:false});
    scenarios++;
   }
  }
  assert.deepEqual(errors,[],`Runtime errors at ${width}`);
  console.log(JSON.stringify({viewport:width,scenarios}));
  await context.close();
 }
 console.log(JSON.stringify({passed:true,scenarios,palettes:palettes.length,modes:2,viewports:3}));
} finally {await browser.close();}
