import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { installDashboardFixtures } from './test-dashboard-browser.mjs';

const base=process.env.YM3_PREVIEW_URL || 'http://127.0.0.1:4173/';
const paletteSource=readFileSync('src/context/ThemeContext.ts','utf8');
const palettes=[...paletteSource.matchAll(/\{ id: '([^']+)', name:/g)].map(match=>match[1]);
assert.ok(palettes.length>=11,'The complete palette collection must be included in visual QA.');
const browser=await chromium.launch({headless:true});
await mkdir('artifacts/adaptive',{recursive:true});
let count=0;
try {
  for(const width of [390,1440]) {
    const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
    const page=await context.newPage();
    const errors=[];
    page.on('pageerror',err=>errors.push(err.message));
    await installDashboardFixtures(page);
    for(const palette of palettes) for(const appearance of ['dark','light']) {
      await page.goto(base+'#dashboard',{waitUntil:'domcontentloaded'});
      await page.evaluate(({palette,appearance})=>{
        localStorage.setItem('journal-palette',palette);
        localStorage.setItem('journal-theme',appearance);
      },{palette,appearance});
      await page.reload({waitUntil:'domcontentloaded'});
      const taskModes=page.getByRole('group',{name:'Trading desk modes'});
      await taskModes.waitFor();
      await page.waitForFunction(expected => document.documentElement.dataset.palette === expected, palette);
      assert.equal(await page.evaluate(()=>document.documentElement.dataset.palette),palette);
      assert.equal(await taskModes.getByRole('button').count(),4);
      await taskModes.getByRole('button',{name:/Understand/}).click();
      await page.locator('#ym-personal-patterns').waitFor();
      await page.locator('.ym-pattern-onboarding--empty, .ym-pattern-metric').first().waitFor();
      const snapshot=await page.evaluate(()=>{
        const containers=[...document.querySelectorAll('.ym-adaptive-mode-icon')];
        const iconRects=containers.map(node=>node.getBoundingClientRect());
        const pattern=document.querySelector('#ym-personal-patterns');
        const patternRects=[...pattern.querySelectorAll('.ym-pattern-metric')].map(node=>node.getBoundingClientRect());
        return {
          scrollWidth:document.documentElement.scrollWidth,
          viewport:innerWidth,
          iconRects:iconRects.map(r=>({width:r.width,height:r.height})),
          patternRects:patternRects.map(r=>({width:r.width,left:r.left,right:r.right})),
          emptyVisible:Boolean(pattern.querySelector('.ym-pattern-onboarding--empty')),
          modeSelected:document.querySelectorAll('.ym-adaptive-mode[aria-pressed="true"]').length,
          heading:pattern.querySelector('h2')?.textContent,
        };
      });
      assert.ok(snapshot.scrollWidth<=snapshot.viewport+2,
        'Horizontal overflow '+palette+'/'+appearance+'/'+width+': '+JSON.stringify(snapshot));
      assert.equal(snapshot.modeSelected,1,'One active desk mode per theme '+palette);
      assert.ok(snapshot.iconRects.length===4 &&
        snapshot.iconRects.every(icon=>icon.width>=32 && icon.width<=45 && icon.height>=32 && icon.height<=45),
        'Four consistently sized icon containers: '+JSON.stringify(snapshot.iconRects));
      assert.ok((snapshot.emptyVisible && snapshot.patternRects.length===0) ||
        (snapshot.patternRects.length===3 &&
         snapshot.patternRects.every(rect=>rect.width>100 && rect.left>=-2 && rect.right<=width+2)),
        'Patterns need either a compact first-use state or legible cards: '+JSON.stringify(snapshot));
      if(['craftylabs-studio','obsidian','true-pink'].includes(palette)) {
        await page.locator('#ym-personal-patterns').evaluate(element=>element.scrollIntoView({block:'start',behavior:'instant'}));
        await page.screenshot({path:'artifacts/adaptive/'+palette+'-'+appearance+'-'+width+'.png',fullPage:false});
      }
      count++;
    }
    assert.deepEqual(errors,[],'No theme-specific runtime errors at '+width+'px');
    await context.close();
  }
  console.log(JSON.stringify({passed:true,scenarios:count,palettes:palettes.length,widths:[390,1440],appearances:2}));
} finally {await browser.close();}
