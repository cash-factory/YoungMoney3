import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { installDashboardFixtures } from './test-dashboard-browser.mjs';

const base = process.env.YM3_PREVIEW_URL || 'http://127.0.0.1:4173/';
const browser = await chromium.launch({ headless: true });
await mkdir('artifacts/adaptive', { recursive: true });
try {
  for (const width of [390, 1440]) {
    const page = await browser.newPage({viewport:{width,height:880},reducedMotion:'reduce'});
    const errors=[];
    page.on('pageerror', error=>errors.push(error.message));
    const { user, trade }=await installDashboardFixtures(page);
    const studies=[];
    const today=new Date().toISOString().slice(0,10);
    const decisions=[
      ...['2026-10-05','2026-10-07','2026-10-11','2026-10-14','2026-10-17'].map((date,i)=>({
        id:'review-baseline-'+i,entry_time:date+'T11:00:00Z',strategy_id:null,account_id:null,
        verdict:i<2?'followed':'changed',
      })),
      ...['2026-11-05','2026-11-07','2026-11-11','2026-11-14','2026-11-17'].map((date,i)=>({
        id:'review-intervention-'+i,entry_time:date+'T11:00:00Z',strategy_id:null,account_id:null,
        verdict:'followed',pre_reveal_verdict:'followed',pre_reveal_at:date+'T11:20:00Z',
      })),
    ];
    let mutations=0;
    await page.route('**/api/data', async route=>{
      const q=route.request().postDataJSON();
      const rows=q.table==='improvement_experiments'?studies:q.table==='decision_reviews'?decisions:null;
      if(!rows) return route.fallback();
      if(q.action==='select') return route.fulfill({json:{data:rows,count:rows.length}});
      assert.equal(q.table,'improvement_experiments','Laboratory must never modify decision evidence.');
      assert.ok(['insert','update'].includes(q.action));
      const now=new Date(Date.now()+mutations*1000).toISOString();
      if(q.action==='update' && q.payload.status==='active' && q.payload.start_date<today)
        return route.fulfill({status:409,json:{error:'Prospective studies must start today or later. Change draft dates before activation.'}});
      const activatedAt=q.action==='update' && q.payload.status==='active'
        ? now : q.action==='insert' && q.payload.status==='active' ? now
          : studies.find(item=>item.id===q.id)?.activated_at || null;
      const record=q.action==='insert'
        ? {...q.payload,id:'study-'+(studies.length+1),user_id:user.id,created_at:now,updated_at:now,activated_at:activatedAt}
        : {...studies.find(item=>item.id===q.id),...q.payload,updated_at:now,activated_at:activatedAt};
      if(q.action==='insert') studies.push(record);
      else studies[studies.findIndex(item=>item.id===q.id)]=record;
      mutations++;
      return route.fulfill({json:{data:[record],count:1}});
    });
    await page.goto(base+'#strategy-testing',{waitUntil:'domcontentloaded'});
    const area=page.getByRole('button',{name:'Improvement Laboratory',exact:true});
    await area.waitFor();
    await area.click();
    const heading=page.getByRole('heading',{name:'Improvement Laboratory'});
    await heading.waitFor();
    await page.getByRole('button',{name:'New experiment'}).click();
    const form=page.getByRole('dialog',{name:'Register an improvement experiment'});
    await form.waitFor();
    await form.getByLabel('Experiment name').fill('Wait for the entry confirmation');
    await form.getByLabel('What is your hypothesis?').fill('Waiting for the candle close should improve my plan adherence.');
    await form.getByLabel('The one rule or behavior you will change').fill('Do not enter until the confirmation candle closes.');
    await form.getByLabel('Intervention begins (UTC)').fill('2026-11-01');
    await form.getByLabel('Minimum decisions per period').fill('5');
    await form.getByRole('button',{name:'Save draft'}).click();
    await form.waitFor({state:'hidden'});
    const study=page.locator('[data-lab-study="study-1"]');
    await study.waitFor();
    assert.equal(await study.getAttribute('data-study-status'),'draft');
    await study.getByRole('button',{name:/Wait for the entry confirmation/}).click();
    await study.getByText('+60.0 percentage points').waitFor();
    assert.equal(await study.getByText('Before-and-after observations do not establish causation. Market conditions and trader behavior may also change.').isVisible(),false,
      'Methodology must stay behind its progressive disclosure until requested');
    await study.locator('summary').click();
    await study.getByText(/do not establish causation/).waitFor();
    await study.getByRole('button',{name:'Start & lock study'}).click();
    await page.locator('.ym-improvement-lab .ym-lab-error').filter({hasText:'Prospective studies must start today or later'}).waitFor();
    assert.equal(await study.getAttribute('data-study-status'),'draft');
    await study.getByRole('button',{name:'Edit design'}).click();
    const editor=page.getByRole('dialog',{name:'Edit experiment draft'});
    await editor.waitFor();
    await editor.getByLabel('Intervention begins (UTC)').fill(today);
    await editor.getByRole('button',{name:'Save draft'}).click();
    await editor.waitFor({state:'hidden'});
    await study.getByRole('button',{name:/Wait for the entry confirmation/}).click();
    await study.getByRole('button',{name:'Start & lock study'}).click();
    await page.waitForFunction(()=>document.querySelector('[data-lab-study="study-1"]')?.getAttribute('data-study-status')==='active');
    assert.ok(Number.isFinite(Date.parse(studies[0].activated_at)), 'API simulation must seal activation time.');
    await study.getByText(/Server-sealed at/).waitFor();
    await study.getByLabel('Your conclusion, including limitations')
      .fill('In this small record, adherence improved, but other factors were not controlled.');
    await study.getByRole('button',{name:'Complete with conclusion'}).click();
    await page.waitForFunction(()=>document.querySelector('[data-lab-study="study-1"]')?.getAttribute('data-study-status')==='completed');
    await study.getByText(/other factors were not controlled/).waitFor();
    assert.equal(studies[0].metric,'plan_adherence');
    assert.equal(studies[0].minimum_samples,5);
    assert.equal(studies[0].status,'completed');
    assert.equal(mutations,4,'One create, one draft revision, one activation, one completion');
    const sourceReference='trade/'+trade.id;
    decisions.push({
      id:'review/'+user.id+'/'+sourceReference,
      reference:sourceReference,
      symbol:trade.pair,
      account_id:trade.account_id,
      strategy_id:null,entry_model_id:null,strategy_name:'',model_name:'',
      entry_time:trade.entry_time,updated_at:new Date().toISOString(),
      verdict:'changed',pre_reveal_verdict:null,pre_reveal_at:null,
      note:'Waited too little for the confirmation candle.',
      trigger:'My confirmation was incomplete.',
      commitment_id:null,commitment_text:'',commitment_result:null,
      voice_note_url:null,screenshot_url:null,
    });
    await page.evaluate(({userId,reference,accountId,symbol})=>{
      sessionStorage.setItem('ymfx:lab-intent:v1:'+userId,JSON.stringify({
        source_reference:reference,account_id:accountId,strategy_id:null,symbol,
      }));
    },{userId:user.id,reference:sourceReference,accountId:trade.account_id,symbol:trade.pair});
    await page.reload({waitUntil:'domcontentloaded'});
    const linkedForm=page.getByRole('dialog',{name:'Register an improvement experiment'});
    await linkedForm.waitFor();
    const origin=linkedForm.getByLabel('Linked originating decision');
    await origin.getByText(trade.pair).waitFor();
    await origin.getByText(/Waited too little/).waitFor();
    await linkedForm.getByLabel('Experiment name').fill('Wait for confirmed candle close');
    await linkedForm.getByLabel('What is your hypothesis?').fill('Waiting for entry confirmation may improve my plan adherence.');
    await linkedForm.getByLabel('The one rule or behavior you will change').fill('Wait for the candle to close before entering.');
    await linkedForm.getByRole('button',{name:'Save draft'}).click();
    await linkedForm.waitFor({state:'hidden'});
    const linkedStudy=page.locator('[data-lab-study="study-2"]');
    await linkedStudy.waitFor();
    await linkedStudy.getByRole('button',{name:/Wait for confirmed candle close/}).click();
    assert.equal(studies[1].source_reference,sourceReference,'Experiment retains exact originating decision reference.');
    await linkedStudy.getByText(/Waited too little/).waitFor();
    await linkedStudy.screenshot({path:'artifacts/adaptive/lab-linked-review-'+width+'.png'});
    await linkedStudy.getByRole('button',{name:/Open original replay/}).click();
    await page.getByRole('dialog',{name:'Decision replay'}).waitFor();
    assert.match(new URL(page.url()).hash,/#dashboard$/, 'Linked study must return to dashboard replay.');
    await page.getByRole('dialog',{name:'Decision replay'}).getByRole('button',{name:'Close dialog'}).click();
    assert.equal(mutations,5,'Source handoff creates one additional draft, never modifies original evidence.');
    const overflow=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,viewport:innerWidth}));
    assert.ok(overflow.scroll<=overflow.viewport+2,'Laboratory must not overflow phone layout: '+JSON.stringify(overflow));
    assert.deepEqual(errors,[], 'Improvement Lab should not trigger runtime errors');
    await page.close();
    console.log(JSON.stringify({width,create:true,lock:true,conclude:true,comparisons:true}));
  }
} finally {await browser.close();}
