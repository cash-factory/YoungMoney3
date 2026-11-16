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
const browser = await chromium.launch({headless:true});
let scenarios=0;
try {
  for(const viewport of viewports) {
    const context=await browser.newContext({
      viewport:{width:viewport.width,height:viewport.height},
      reducedMotion:'reduce',
      deviceScaleFactor:1,
    });
    const page=await context.newPage();
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
            const width=Math.round(rect.width*10)/10;
            const group=sizeGroups.get(size)||new Set();
            group.add(width);
            sizeGroups.set(size,group);
            if(Math.abs(rect.width-rect.height)>1)problems.push(size+' icon box not square');
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
        if(['phone-390','desktop'].includes(viewport.name)) {
          await page.locator('#features').screenshot({
            path:screenshotDir+'/'+palette+'-'+mode+'-'+viewport.name+'.png',
            animations:'disabled',
          });
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
