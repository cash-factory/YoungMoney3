import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { installDashboardFixtures } from './test-dashboard-browser.mjs';

const base=process.env.YM3_PREVIEW_URL || 'http://127.0.0.1:4173/';
const palettes=[...readFileSync('src/context/ThemeContext.ts','utf8').matchAll(/\{ id: '([^']+)', name:/g)]
  .map(value=>value[1]);
const browser=await chromium.launch({headless:true});
let cases=0;
try{
  for(const width of [390,1440]){
    const context=await browser.newContext({viewport:{width,height:840},reducedMotion:'reduce'});
    const page=await context.newPage();
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await installDashboardFixtures(page);
    for(const palette of palettes)for(const appearance of ['light','dark']){
      await page.goto(base+'#dashboard',{waitUntil:'domcontentloaded'});
      await page.evaluate(({palette,appearance})=>{
        localStorage.setItem('journal-palette',palette);
        localStorage.setItem('journal-theme',appearance);
      },{palette,appearance});
      await page.reload({waitUntil:'domcontentloaded'});
      await page.getByRole('button',{name:'Prepare trading desk mode'}).click();
      const opener=page.getByRole('button',{name:'Configure limits'});
      await opener.click();
      const dialog=page.getByRole('dialog',{name:'Risk & Discipline Settings'});
      await dialog.waitFor();
      const geometry=await dialog.evaluate(node=>{
        const accent=node.querySelector('.ym-modal-accent');
        const box=node.getBoundingClientRect();
        return{
          left:box.left,right:box.right,width:box.width,
          animation:getComputedStyle(node).animationName,
          palette:document.documentElement.dataset.palette,
          accent:getComputedStyle(accent).backgroundImage,
          brand:getComputedStyle(document.documentElement).getPropertyValue('--brand').trim(),
          within:node.contains(document.activeElement),
        };
      });
      assert.equal(geometry.palette,palette);
      assert.ok(geometry.left>=-1 && geometry.right<=width+1,
        'Modal must fit available viewport: '+JSON.stringify({palette,appearance,width,geometry}));
      assert.equal(geometry.animation,'none','Reduced-motion preference disables modal entrance motion.');
      assert.ok(geometry.accent.startsWith('linear-gradient('),'Modal must use the theme-aware accent.');
      assert.ok(geometry.within,'Focus must start in the opened modal.');
      await page.keyboard.press('Tab');
      assert.ok(await dialog.evaluate(node=>node.contains(document.activeElement)));
      await page.keyboard.press('Escape');
      await dialog.waitFor({state:'detached'});
      assert.ok(await opener.evaluate(node=>node===document.activeElement),
        'Dismissal must restore focus to the invoking control.');
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),
        'Modal must not induce horizontal overflow.');
      cases++;
    }
    assert.deepEqual(errors,[],'Runtime errors on '+width+'px.');
    await context.close();
  }
  console.log(JSON.stringify({passed:true,modalCases:cases,palettes:palettes.length,appeances:2,widths:2}));
}finally{await browser.close();}
