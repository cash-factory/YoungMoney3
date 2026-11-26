import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { installDashboardFixtures } from './test-dashboard-browser.mjs';

// Account data is a local fixture. Nothing in this check connects to or
// modifies a trader's actual workspace.
const base=process.env.YM3_PREVIEW_URL||'http://127.0.0.1:4173/';
const palettes=['craftylabs-studio','obsidian','true-pink','tiffany'];
const browser=await chromium.launch({headless:true});
const results=[];
await mkdir('artifacts/adaptive',{recursive:true});

function contrast(foreground,background) {
  const channels=color => {
    const values=color.match(/[\d.]+/g)?.slice(0,3).map(Number)||[];
    assert.equal(values.length,3,'RGB colour required for contrast checks: '+color);
    return values.map(value => {
      const normalized=value/255;
      return normalized<=.04045?normalized/12.92:((normalized+.055)/1.055)**2.4;
    });
  };
  const lum=color=>channels(color).reduce((total,value,index)=>total+value*[.2126,.7152,.0722][index],0);
  const a=lum(foreground), b=lum(background);
  return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
}

try {
  for(const width of [390,1440]) {
    const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
    const page=await context.newPage();
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await installDashboardFixtures(page);
    await page.route('**/api/mt5/status',route=>route.fulfill({
      status:200,contentType:'application/json',
      body:JSON.stringify({accounts:[],devices:[],links:[],discoveries:[],scans:[],demoOnly:true,capturePaused:false}),
    }));
    for(const palette of palettes) for(const appearance of ['dark','light']) {
      await page.goto(base+'#dashboard',{waitUntil:'domcontentloaded'});
      await page.evaluate(({palette,appearance})=>{
        localStorage.setItem('journal-palette',palette);
        localStorage.setItem('journal-theme',appearance);
      },{palette,appearance});
      await page.reload({waitUntil:'domcontentloaded'});
      await page.getByRole('heading',{name:/Trading Overview/}).waitFor();
      const sample=await page.evaluate(()=>{
        const root=document.querySelector('.ym-workspace');
        const action=document.querySelector('.ym-dash-new-trade');
        const nav=document.querySelector('.ym-sidebar-nav .ym-nav-item');
        const tab=document.querySelector('.ym-dash-jump button');
        const description=document.querySelector('.ym-dash-focus-description');
        const sections=document.querySelector('.ym-nav-section');
        const preferences=document.querySelector('.ym-nav-preferences');
        const ribbon=document.querySelector('.ym-studio-stripe');
        const primary=getComputedStyle(action);
        return {
          rootSize:parseFloat(getComputedStyle(root).fontSize),
          actionHeight:action.getBoundingClientRect().height,
          navMin:parseFloat(getComputedStyle(nav).minHeight),
          tabHeight:tab.getBoundingClientRect().height,
          descriptionSize:parseFloat(getComputedStyle(description).fontSize),
          primaryForeground:primary.color,
          primaryBackground:primary.backgroundColor,
          preferencesAfterTasks:Boolean(sections.compareDocumentPosition(preferences)&Node.DOCUMENT_POSITION_FOLLOWING),
          ribbonVisible:Boolean(ribbon && getComputedStyle(ribbon).display!=='none'),
          ribbonHeight:ribbon?.getBoundingClientRect().height||0,
          ribbonWords:[...document.querySelectorAll('.ym-ribbon-group:first-child .ym-ribbon-word')].map(node=>node.textContent),
          ribbonCopyCount:document.querySelectorAll('.ym-ribbon-group').length,
          ribbonGeometry:[...document.querySelectorAll('.ym-ribbon-group')].map(group=>{
            const rect=group.getBoundingClientRect();
            return {left:rect.left,right:rect.right,width:rect.width,contentWidth:group.scrollWidth};
          }),
          ribbonTextSize:parseFloat(getComputedStyle(document.querySelector('.ym-ribbon-word')).fontSize),
          ribbonMotion:getComputedStyle(document.querySelector('.ym-ribbon-track')).animationName,
          headingSize:parseFloat(getComputedStyle(document.querySelector('.ym-dash-heading h1')).fontSize),
          pageAnimation:getComputedStyle(document.querySelector('.ym-dash-focus-panel')).animationName,
          dockHeight:document.querySelector('.ym-mobile-dock .ym-dock-item').getBoundingClientRect().height,
          overflow:document.documentElement.scrollWidth>innerWidth+2,
        };
      });
      assert.ok(sample.rootSize>=14, 'Workspace must not inherit a tiny body scale: '+JSON.stringify(sample));
      assert.ok(sample.actionHeight>=43.5 && sample.tabHeight>=43.5 && sample.navMin>=43.5,
        'Primary actions, tabs and navigation need usable targets: '+JSON.stringify(sample));
      assert.ok(sample.descriptionSize>=14, 'Supporting copy must remain legible: '+JSON.stringify(sample));
      assert.ok(contrast(sample.primaryForeground,sample.primaryBackground)>=4.5,
        'Primary control text must pass 4.5:1 contrast: '+JSON.stringify({palette,appearance,sample}));
      assert.equal(sample.preferencesAfterTasks,true,'Settings belong below daily trader tasks');
      assert.ok(sample.ribbonVisible,'Restore the signature editorial ribbon on trader pages');
      assert.ok(sample.ribbonHeight>=35 && sample.ribbonHeight<=41,'Keep the ribbon slim, never a second hero');
      assert.deepEqual(sample.ribbonWords,['PROCESS','PRECISION','DISCIPLINE','CONSISTENCY','GROWTH']);
      assert.equal(sample.ribbonCopyCount,2,'Seamless scroll uses two identical visual tracks');
      assert.ok(sample.ribbonGeometry.every(group=>group.width>=group.contentWidth-1),
        'Each ribbon loop must contain all its words without overlapping the next: '+JSON.stringify(sample.ribbonGeometry));
      assert.ok(Math.abs(sample.ribbonGeometry[0].width-sample.ribbonGeometry[1].width)<=1,
        'A marquee can only loop smoothly when both word tracks match in width');
      assert.ok(sample.ribbonTextSize>=10.5 && sample.ribbonTextSize<=12.5,'Premium ribbon words stay proportionate');
      assert.equal(sample.ribbonMotion,'none','Reduced motion must stop the moving words');
      assert.ok(sample.headingSize<=35,'Page heading must not feel enlarged: '+JSON.stringify(sample));
      assert.equal(sample.overflow,false,'The workspace must not overflow horizontally');
      assert.equal(sample.pageAnimation,'none','Reduce motion must disable panel entrance effects');
      if(width===390) assert.ok(sample.dockHeight>=55,'Mobile dock targets must be generous');
      results.push({palette,appearance,width,actionHeight:sample.actionHeight,
        contrast:Number(contrast(sample.primaryForeground,sample.primaryBackground).toFixed(2))});
      if(palette==='craftylabs-studio') {
        await page.screenshot({path:'artifacts/adaptive/ergonomics-'+appearance+'-'+width+'.png',animations:'disabled'});
      }
    }
    await page.goto(base+'#mt5',{waitUntil:'domcontentloaded'});
    await page.getByRole('heading',{name:'MT5 Connections'}).waitFor();
    await page.getByText(/Last checked/).waitFor();
    const refresh=page.getByRole('button',{name:'Refresh status'});
    assert.ok(await refresh.evaluate(button=>button.getBoundingClientRect().height>=35));
    await refresh.click();
    await page.getByText('Account status refreshed.').waitFor();
    assert.equal(await page.locator('.ym-feedback-toast').count(),0,
      'MT5 inline action receipts should not generate a second toast');
    assert.deepEqual(errors,[],'No runtime errors at '+width+'px');
    await context.close();
  }
  // Motion opt-out must not disable the standard (subtle) animation for users
  // who actually want it. Avoid timing-based screenshot assertions.
  const motionContext=await browser.newContext({viewport:{width:1280,height:800},reducedMotion:'no-preference'});
  const motionPage=await motionContext.newPage();
  await installDashboardFixtures(motionPage);
  await motionPage.goto(base+'#dashboard',{waitUntil:'domcontentloaded'});
  await motionPage.getByRole('heading',{name:/Trading Overview/}).waitFor();
  const actualMotion=await motionPage.locator('.ym-ribbon-track').evaluate(node=>({
    name:getComputedStyle(node).animationName,
    duration:getComputedStyle(node).animationDuration,
    playState:getComputedStyle(node).animationPlayState,
  }));
  assert.equal(actualMotion.name,'ym-editorial-drift','The ribbon needs a real CSS animation');
  assert.equal(actualMotion.duration,'60s','Movement must remain slow and non-distracting');
  assert.equal(actualMotion.playState,'running');
  await motionContext.close();
  console.log(JSON.stringify({passed:true,cases:results.length,widths:[390,1440],palettes,
    lowestPrimaryContrast:Math.min(...results.map(row=>row.contrast))}));
} finally {
  await browser.close();
}
