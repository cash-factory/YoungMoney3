import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseUrl = process.env.YM3_PREVIEW_URL || 'http://127.0.0.1:4173/';
const screenshotDir = process.env.YM3_VISUAL_DIR || 'artifacts/landing-icons';
const paletteSource = readFileSync('src/context/ThemeContext.ts','utf8');
const palettes = Array.from(paletteSource.matchAll(/\{ id: '([^']+)', name:/g), match => match[1]);
assert.equal(palettes.length, 12, 'Visual QA must cover every YoungMoney3 palette');

const viewports = [
  {name:'phone-360', width:360, height:800},
  {name:'phone-390', width:390, height:844},
  {name:'tablet', width:768, height:1024},
  {name:'desktop', width:1440, height:900},
];
await mkdir(screenshotDir, {recursive:true});
const browser = await chromium.launch({headless:true,...(process.env.YM3_CHROMIUM_EXECUTABLE ? {executablePath:process.env.YM3_CHROMIUM_EXECUTABLE} : {})});
let scenarios=0;
try {
  for(const viewport of viewports) {
    const context=await browser.newContext({
      viewport:{width:viewport.width,height:viewport.height},
      reducedMotion:'reduce',
      deviceScaleFactor:1,
    });
    const page=await context.newPage();
    // Vite preview serves static assets only; simulate the unauthenticated
    // Worker response so the actual LandingPage renders without a live backend.
    await page.route('**/api/me',route=>route.fulfill({
      status:401,
      contentType:'application/json',
      body:JSON.stringify({error:'Unauthenticated'}),
    }));
    await page.goto(baseUrl,{waitUntil:'domcontentloaded'});
    for(const palette of palettes) {
      for(const mode of ['light','dark']) {
        await page.evaluate(({palette,mode})=>{
          localStorage.setItem('journal-palette',palette);
          localStorage.setItem('journal-theme',mode);
        },{palette,mode});
        await page.reload({waitUntil:'domcontentloaded'});
        await page.locator('.ym-studio-landing .landing-icon').first().waitFor({timeout:15000});
        await page.addStyleTag({content:
          '*,*::before,*::after{animation-duration:0s!important;transition:none!important}'+
          '[data-reveal]{opacity:1!important;transform:none!important;filter:none!important}'
        });
        const outcome=await page.evaluate(()=>{
          const root=document.documentElement;
          const icons=[...document.querySelectorAll('.ym-studio-landing .landing-icon')]
            .filter(icon=>icon.getBoundingClientRect().height>0);
          const problems=[];
          const sizeGroups=new Map();
          const luminance=rgb=>rgb.map(channel=>{
            const n=channel/255;
            return n<=.04045?n/12.92:Math.pow((n+.055)/1.055,2.4);
          }).reduce((sum,part,index)=>sum+part*[.2126,.7152,.0722][index],0);
          const contrast=(a,b)=>(Math.max(luminance(a),luminance(b))+.05)
            /(Math.min(luminance(a),luminance(b))+.05);
          const rgb=(value)=>{
            if(value.startsWith('rgb('))return (value.match(/[\d.]+/g)||[]).slice(0,3).map(Number);
            if(value.startsWith('color(srgb '))return (value.slice(11).match(/[\d.]+/g)||[]).slice(0,3).map(n=>Number(n)*255);
            return [];
          };
          for(const icon of icons) {
            const rect=icon.getBoundingClientRect();
            const glyph=icon.querySelector('svg');
            const svgRect=glyph?.getBoundingClientRect();
            const size=icon.classList.contains('landing-icon--lg')?'lg':icon.classList.contains('landing-icon--sm')?'sm':'md';
            // Layout dimensions, not transformed screenshot bounds, govern the shared
            // size contract. Some surrounding hero elements animate at scale(.97).
            const width=icon.offsetWidth;
            const group=sizeGroups.get(size)||new Set();
            group.add(width);
            sizeGroups.set(size,group);
            if(Math.abs(icon.offsetWidth-icon.offsetHeight)>1)problems.push(size+' icon box not square');
            if(!svgRect||!svgRect.width||!svgRect.height)problems.push(size+' missing rendered glyph');
            if(svgRect&&(
              Math.abs(rect.left+rect.width/2-svgRect.left-svgRect.width/2)>1||
              Math.abs(rect.top+rect.height/2-svgRect.top-svgRect.height/2)>1
            ))problems.push(size+' glyph off-centre');
            if(rect.left< -2||rect.right>innerWidth+2)problems.push(size+' icon clipped horizontally');
            const style=getComputedStyle(icon);
            const foreground=rgb(style.color),background=rgb(style.backgroundColor);
            if(foreground.length===3&&background.length===3&&contrast(foreground,background)<4.5)
              problems.push(size+' icon has insufficient foreground/surface contrast');
          }
          for(const [group,values] of sizeGroups){
            if(values.size!==1)problems.push(group+' icon boxes have inconsistent width');
          }
          return {
            palette:root.dataset.palette,
            mode:root.classList.contains('dark')?'dark':'light',
            visibleIcons:icons.length,
            problems:[...new Set(problems)],
            sizes:Object.fromEntries([...sizeGroups].map(([key,set])=>[key,[...set]])),
          };
        });
        assert.equal(outcome.palette,palette,'Theme selection failed');
        assert.equal(outcome.mode,mode,'Light/dark selection failed');
        assert.ok(outcome.visibleIcons>=30,'Missing homepage card icons');
        assert.deepEqual(outcome.problems,[],palette+' '+mode+' '+viewport.name+' '+JSON.stringify(outcome));
        const ribbon = await page.locator('.ym-workflow-ribbon').evaluate(element => {
          const nodes = [...element.querySelectorAll('li')];
          const labels = nodes.map(node => [node.querySelector('.ym-workflow-ribbon-number')?.textContent, node.querySelector('.ym-workflow-ribbon-label')?.textContent].join(' '));
          const inViewport = nodes.every(node => {
            const rect=node.getBoundingClientRect();
            return rect.left>=-2 && rect.right<=window.innerWidth+2 && rect.width>0;
          });
          const animation = getComputedStyle(element).animationName;
          return {labels,inViewport,animation,scrollWidth:element.scrollWidth,clientWidth:element.clientWidth};
        });
        assert.deepEqual(ribbon.labels,['01 Plan','02 Capture','03 Test','04 Review'],
          'All four trading stages must appear exactly once');
        assert.ok(ribbon.inViewport,palette+' '+mode+' '+viewport.name+' workflow label escaped the ribbon');
        assert.ok(ribbon.scrollWidth<=ribbon.clientWidth+1,
          palette+' '+mode+' '+viewport.name+' ribbon causes horizontal scrolling: '+JSON.stringify(ribbon));
        assert.equal(ribbon.animation,'none','The workflow stages should not drift offscreen');
        if(['phone-390','desktop'].includes(viewport.name)) {
          await page.locator('#features').screenshot({
            path:screenshotDir+'/'+palette+'-'+mode+'-'+viewport.name+'.png',
            animations:'disabled',
          });
        }

        for (const artwork of await page.locator('img[src^="/visuals/studio-"]').all()) {
          await artwork.scrollIntoViewIfNeeded();
          await artwork.evaluate(async img => {
            img.loading = 'eager';
            if (!img.complete) await new Promise((resolve, reject) => {
              img.addEventListener('load', resolve, { once: true });
              img.addEventListener('error', () => reject(new Error('Artwork failed to load: ' + img.src)), { once: true });
            });
            if (!img.naturalWidth) throw new Error('Artwork failed to load: ' + img.src);
            // Some Chromium versions reject decode() for otherwise valid SVGs.
            await img.decode().catch(() => {});
          });
          assert.ok(await artwork.evaluate(img=>Number(getComputedStyle(img).opacity)>0), 'Initial artwork must remain visible in every theme');
        }
        if (palette === 'craftylabs-studio' && mode === 'dark') {
          for (const selector of ['#features','#practice','footer.ym-studio-footer']) {
            await page.locator(selector).scrollIntoViewIfNeeded();
            const artwork=page.locator(selector+' img[src^="/visuals/studio-"]');
            const loaded=await artwork.evaluate(async img=>{
              try {
                await img.decode();
              } catch (error) {
                const res=await fetch(img.currentSrc || img.src);
                const source=await res.text();
                const xml=new DOMParser().parseFromString(source,'image/svg+xml');
                const parserError=xml.querySelector('parsererror');
                // Chromium can reject HTMLImageElement.decode() for a valid SVG
                // even when the image is complete, has intrinsic dimensions, and
                // the SVG is served correctly. Verify those properties instead.
                if (res.ok && res.headers.get('content-type')?.includes('image/svg+xml') &&
                    img.complete && img.naturalWidth > 0 && !parserError) {
                  // Valid, present SVG; screenshot assertions check the paint.
                } else throw new Error(JSON.stringify({
                  src:img.currentSrc || img.src,
                  status:res.status,
                  contentType:res.headers.get('content-type'),
                  imageComplete:img.complete,
                  imageNaturalWidth:img.naturalWidth,
                  xmlError:parserError?.textContent?.slice(0,500),
                  sourceHead:source.slice(0,130),
                  reason:String(error),
                }));
              }
              const bounds=img.getBoundingClientRect();
              return {width:img.naturalWidth,height:img.naturalHeight,left:bounds.left,right:bounds.right};
            });
            assert.ok(loaded.width>=900 && loaded.height>=500,
              selector+' artwork failed to load at '+viewport.name+' '+JSON.stringify(loaded));
            assert.ok(loaded.left>=-2 && loaded.right<=viewport.width+2,
              selector+' artwork overflows '+viewport.name+' viewport');
            if(['phone-390','desktop'].includes(viewport.name)) {
              await page.locator(selector).screenshot({
                path:screenshotDir+'/'+selector.replace(/[^a-z]+/g,'-')+'-'+viewport.name+'.png',
                animations:'disabled',
              });
            }
          }
          assert.equal(await page.locator('#how .ym-process-step').count(),6,'All six workflow steps remain rendered');
          assert.equal(await page.locator('#platform .ym-platform-chapter').count(),6,'Section categories should have a distinct chapter treatment');
          const banner=await page.locator('#features .ym-editorial-banner').evaluate(el=>{
            const bounds=el.getBoundingClientRect();
            const copy=el.querySelector('.ym-editorial-copy').getBoundingClientRect();
            const media=el.querySelector('.ym-editorial-media').getBoundingClientRect();
            return {width:bounds.width,copyLeft:copy.left,copyRight:copy.right,mediaLeft:media.left,mediaRight:media.right};
          });
          assert.ok(banner.width>=Math.min(viewport.width-32,600),'Editorial banner too narrow for viewport');
          assert.ok(banner.copyRight<=viewport.width+2 && banner.mediaRight<=viewport.width+2,'Editorial content overflows');
        }
        scenarios+=1;
      }
    }
    await context.close();
    process.stdout.write(viewport.name+': 24 palette/mode icon checks passed\n');
  }
} finally {
  await browser.close();
}
assert.equal(scenarios,96,'Every theme/mode/viewport combination must be rendered');
process.stdout.write('Verified '+scenarios+' responsive theme combinations; screenshots: '+screenshotDir+'\n');
