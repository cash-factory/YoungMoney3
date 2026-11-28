/* YM-FX Home Lab Concept 06 — all review annotations, standalone demo only. */
(() => {
  'use strict';
  const core = window.YMFXConcept06;
  if (!core) return;
  // Structured after inspection of the original LandingPage and its product areas.
  // Array item: name, positioning, category, features [name, what it does, why it matters].
  const catalog = [
    ['Journal','A place for the thinking behind every decision.','REVIEW',[
      ['Pre-trade context','Record planned execution, setup conditions and emotional context before the result.','Preserves intent without hindsight.'],['Daily journal','Capture session observations, reflections and dated notes.','Builds a chronological decision record.'],['Post-trade reflection','Compare the plan with what actually occurred.','Separates process from profit or loss.'],['Trade links','Connect personal notes with captured trade records.','Makes both narrative and evidence easier to inspect.']]],
    ['Trades','Inspect each broker-linked trade and its context.','EXECUTION',[
      ['Trade records','Review entries, exits, direction, symbols and available identifiers.','Connects activity with its source.'],['Initial protection','Preserve original observed stop independently of later changes.','Protects historical risk accuracy.'],['Trade notes','Add setup tags, screenshots and related observations.','Explains a trade without modifying broker events.'],['Lifecycle history','Follow relevant order events, adjustments and closures.','Shows sequence rather than only outcomes.']]],
    ['Weekly Reviews','Give each week a useful reflection checkpoint.','CADENCE',[
      ['Weekly outcomes','Review closed position summaries and account context.','Anchors the review to recorded results.'],['Strong decisions','Document behaviors that respected your rules.','Supports repeatable good practice.'],['Areas for improvement','Choose a focused process adjustment for the next week.','Turns reflection into a specific next action.']]],
    ['Analytics','Explore performance beyond headline profit.','DATA',[
      ['Instrument analysis','Compare records across traded instruments.','Shows where outcomes cluster.'],['Session breakdown','Explore results across time windows and sessions.','Connects performance with timing.'],['Strategy outcomes','Compare documented setup categories.','Identifies hypotheses for further testing.'],['Risk perspective','Consider risk and drawdown alongside results.','Keeps a good-looking number in context.']]],
    ['Playbook','Keep your trading rules where decisions happen.','PROCESS',[
      ['Trading plan','Document strategy, risk, management and invalidation rules.','Makes expectations explicit beforehand.'],['Strategy library','Organize named models and structured entry criteria.','Keeps reference material consistent.'],['Rule checklists','Define conditions for a trade to be valid.','Helps reduce impulsive ambiguity.']]],
    ['Setups','Make recurring trade ideas inspectable.','MODELS',[
      ['Entry criteria','Define the setup conditions and confirmations.','Provides a repeatable evaluation basis.'],['Timeframes','Record market and timeframe context.','Prevents judging an entry in isolation.'],['Annotated examples','Organize relevant charts and notes.','Helps explain what qualifies as the setup.']]],
    ['Risk Management','Set protective limits before the moment of action.','CONTROL',[
      ['Risk framework','Configure trade and daily risk boundaries.','Makes limits visible before execution.'],['Trade calculator','Review protective distance and reward-to-risk.','Clarifies planned exposure.'],['Risk guardian','Review configured limits against captured account context.','Supports timely protective decisions.'],['Original risk','Keep initial protective risk distinct from subsequent stops.','Preserves the integrity of later review.']]],
    ['Goals','Make progress visible beyond individual trades.','DIRECTION',[
      ['Goal library','Organize trading and personal objectives.','Makes priorities easier to revisit.'],['Milestones','Define target dates and intermediate progress.','Turns ambition into manageable actions.'],['Goal status','Mark work completed, active or paused.','Supports realistic progress reviews.']]],
    ['Market Sessions','Understand when and why decisions occur.','CONTEXT',[
      ['Session windows','Review trading activity by relevant session.','Places decisions in their time context.'],['Economic events','Log relevant news and event timing.','Encourages event-aware planning.'],['No-trade windows','Define periods to avoid based on your rules.','Gives deliberate restraint a place in the plan.']]],
    ['Testing Workspace','Test hypotheses, not promises.','LABORATORY',[
      ['Backtesting','Record historical hypothetical examples separately from broker trades.','Keeps test evidence clearly labeled.'],['Forward testing','Document prospective paper-trade scenarios.','Distinguishes simulated practice from execution.'],['Experiment records','State rules, observations and test limitations.','Makes findings easier to challenge or reproduce.']]],
    ['Brokers & Charting','Organize accounts and charting resources.','ACCOUNTS',[
      ['Broker directory','Review broker account context and settings.','Supports informed account oversight.'],['Account details','Record relevant specifications and funding context.','Keeps execution cost assumptions visible.'],['Charting tools','Manage research/charting resources and subscriptions.','Reduces scattered workspace administration.']]],
    ['Copy Studio','Coordinate copying with explicit local authorization.','REPLICATION',[
      ['Sources and followers','Define a source and intended follower relationships.','Clarifies the direction of replication.'],['Risk modes','Review fixed and proportional sizing settings where supported.','Accounts for different balance and risk profiles.'],['Local consent','Require online connector authorization before live replication.','Prevents a dashboard click from silently authorizing execution.'],['Order coverage','Inspect expected handling of market and pending orders.','Makes limitations and exceptional cases more visible.']]],
    ['AI Insights','Use evidence to sharpen your questions.','INTELLIGENCE',[
      ['Behavior observations','Explore patterns in recorded activities and notes.','Surfaces questions worth investigating.'],['Evidence confidence','Separate broker facts from self-reports and interpretation.','Prevents overstating what a pattern proves.'],['Review prompts','Generate reflective questions tied to available context.','Keeps decisions with the trader.']]],
    ['Media Library','Keep chart images connected to their context.','MEDIA',[
      ['Trade screenshots','Store visuals of a setup or execution.','Lets later reviews revisit visual evidence.'],['Attachments','Keep supporting files with the relevant record.','Reduces fragmented documentation.'],['Organized media','Browse and retrieve saved reference material.','Makes review faster.']]],
    ['Notes','Capture useful thinking outside formal trade entries.','KNOWLEDGE',[
      ['Freeform notes','Write market ideas, research and observations.','Keeps informal learning accessible.'],['Tags and pins','Organize and highlight important notes.','Makes reference material easier to find.'],['Research context','Preserve unanswered questions and study findings.','Maintains continuity between sessions.']]],
    ['Study Material','Turn study time into documented progress.','LEARNING',[
      ['Study library','Organize books, courses and learning resources.','Makes learning plans more concrete.'],['Completion progress','Track lessons, units or study milestones.','Shows consistency beyond trading outcomes.'],['Learning notes','Record insights or areas to revisit.','Bridges theory and practice.']]],
    ['MT5 Connections','Connect available account evidence to the journal.','BROKER CAPTURE',[
      ['Account discovery','Pair an account through the Windows connector.','Clarifies which account supplies records.'],['Capture monitoring','View connection and monitoring state.','Makes missing evidence easier to notice.'],['Reconnection recovery','Reconcile available account history after interruptions.','Supports continuity without duplicates.'],['Evidence integrity','Keep broker events immutable and flag conflicts.','Protects the source record against silent rewrites.']]],
    ['Calendar','See trading activity and review across time.','TIME',[
      ['Activity overview','Inspect trades and results by day.','Reveals concentration and quieter periods.'],['Session notes','Relate a calendar date to decisions and reflections.','Adds context to the daily outcome.'],['Review cadence','Use dated patterns to plan reflection.','Encourages a repeatable review habit.']]]
  ];
  const phaseArt = [4,1,9,2], storyArt = [4,1,0,3];
  const stories = [
    ['01','INTENT','What did the plan say?','Preserve the entry conditions, reasons and protective limits established before the result was known.','An intended decision is more useful when it has measurable criteria.'],
    ['02','EXECUTION','What actually happened?','Read the broker-captured orders, position lifecycle and changes independently from your interpretation.','The execution and the intention may differ; both deserve their own record.'],
    ['03','REFLECTION','What can I responsibly conclude?','Compare what you wrote with what occurred, clearly separating documented facts and assumptions.','A favorable outcome does not automatically validate the decision process.'],
    ['04','ADJUSTMENT','What will I test next?','Choose one specific rule or behavior to refine and observe it prospectively.','Useful improvement is testable rather than merely motivational.']
  ];
  const esc = v => String(v).replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));
  const art = i => `--art-x:${(i%6)*20}%;--art-y:${Math.floor(i/6)*50}%`;
  let host = null, trades = [], moduleIndex=0, featureIndex=0, storyIndex=0, reduce=false, phaseObserver=null;
  const coreRender = core.render.bind(core), coreMount = core.mount.bind(core), coreTrade = core.tradeChanged.bind(core);
  function lineSVG(t){
    const left=50,right=825,top=20,bottom=326,n=42;
    const series=Array.from({length:n},(_,i)=>t.entry + t.step*(1.48*Math.sin(i*.62)+.57*Math.sin(i*1.41)+1.2*Math.cos(i*.21)+(i-20)*.17*t.direction));
    const low=Math.min(t.sl,t.tp,...series)-t.step*1.3,high=Math.max(t.sl,t.tp,...series)+t.step*1.3;
    const x=i=>left+(right-left)*i/(n-1),y=v=>top+(high-v)/(high-low)*(bottom-top),price=v=>v.toFixed(t.precision);
    const trace=series.map((p,i)=>(i?'L':'M')+x(i).toFixed(2)+' '+y(p).toFixed(2)).join(' ');
    const grid=Array.from({length:5},(_,i)=>{const yy=top+(bottom-top)*i/4;return `<path d="M${left} ${yy}H${right}" class="chart-grid-line"/><text x="${right+12}" y="${yy+3}" class="axis-text">${price(high-(high-low)*i/4)}</text>`}).join('');
    const level=(v,label,cls)=>{const yy=y(v);return `<g class="level level-${cls}"><path d="M${left} ${yy.toFixed(2)}H${right}" stroke-dasharray="${cls==='entry'?'3 6':'6 7'}"/><rect x="${right-4}" y="${(yy-13).toFixed(1)}" width="105" height="26" rx="4"/><text x="${right+7}" y="${(yy+4).toFixed(1)}">${label} ${price(v)}</text></g>`};
    return `<svg class="market-svg living-line-svg" viewBox="0 0 940 380" role="img" aria-label="Illustrative ${esc(t.symbol)} ${esc(t.side)} line chart. Entry ${price(t.entry)}, initial stop ${price(t.sl)}, target ${price(t.tp)}. No live prices."><title>Sample ${esc(t.symbol)} trade with entry, stop and target</title><desc>Synthetic line-chart movement, not a real market feed or broker result.</desc><defs><linearGradient id="livingLineFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e81738" stop-opacity=".22"/><stop offset="1" stop-color="#e81738" stop-opacity="0"/></linearGradient></defs>${grid}<path d="${trace} L${right} ${bottom} L${left} ${bottom}Z" fill="url(#livingLineFill)"/><path d="${trace}" class="living-chart-trace" fill="none" stroke="var(--accent)" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"/>${level(t.tp,'TARGET','take')}${level(t.entry,'ENTRY','entry')}${level(t.sl,'STOP','stop')}<circle cx="${x(n-1)}" cy="${y(series[n-1])}" r="5" fill="var(--accent)"/><g class="axis-days"><text x="${left}" y="${bottom+30}">PLAN</text><text x="${(left+right)/2}" y="${bottom+30}">EXECUTE</text><text x="${right}" y="${bottom+30}" text-anchor="end">REVIEW</text></g></svg>`;
  }
  function swapChart(index){
    const chart=host?.querySelector('.chart-shell-living .market-svg'); if(chart && trades[index])chart.outerHTML=lineSVG(trades[index]);
    host?.querySelectorAll('[data-recent-trade]').forEach(b=>{let active=Number(b.dataset.recentTrade)===index;b.classList.toggle('is-current',active);b.setAttribute('aria-pressed',String(active));});
  }
  function recentHTML(){
    const outcome=['DEMO +$82.40','DEMO −$34.20','DEMO +$46.10'];
    return `<section class="living-recent" aria-label="Recent fictional trade examples"><div class="living-recent-head"><strong>RECENT TRADES</strong><span>FICTIONAL RESULTS · NOT BROKER DATA</span></div><div class="living-recent-grid">${trades.map((t,i)=>`<button type="button" class="living-recent-trade ${i?'':'is-current'}" data-recent-trade="${i}" aria-pressed="${!i}"><span><strong>${esc(t.symbol)}</strong><small>${esc(t.side)}</small></span><span class="living-recent-sub">${esc(t.setup)}</span><span class="living-recent-value"><small>${i===2?'EXAMPLE · PLANNED':'EXAMPLE · CLOSED'}</small><b class="${i===1?'negative':''}">${outcome[i]||'DEMO'}</b></span></button>`).join('')}</div></section>`;
  }
  function slantedHTML(){
    const words=['PROCESS','PRECISION','DISCIPLINE','CONSISTENCY','GROWTH'];
    const group=words.map(w=>`<span>${w}</span><i aria-hidden="true">✳</i>`).join('');
    return `<div class="living-slanted-divider" aria-label="Process, Precision, Discipline, Consistency, Growth"><div class="living-slanted-ribbon"><div class="living-slanted-track"><div class="living-slanted-group">${group}</div><div class="living-slanted-group" aria-hidden="true">${group}</div></div></div></div>`;
  }
  function storyHTML(){
    return `<div class="living-story"><div class="living-story-step-list" role="group" aria-label="Explore the decision evidence sequence">${stories.map((s,i)=>`<button class="living-story-step ${i?'':'is-current'}" type="button" data-story-step="${i}" aria-pressed="${!i}"><span>${s[0]} / ${s[1]}</span><strong>${s[2]}</strong><i aria-hidden="true">↗</i></button>`).join('')}</div><div class="living-story-spotlight" aria-live="polite"><div class="living-story-art" style="${art(storyArt[0])}" aria-hidden="true"></div><div class="living-story-content"><span data-story-label>01 / INTENT</span><h3 data-story-title>${stories[0][2]}</h3><p data-story-body>${stories[0][3]}</p><blockquote data-story-lesson>${stories[0][4]}</blockquote><button type="button" data-story-next>Continue the story <span aria-hidden="true">↗</span></button></div></div></div>`;
  }
  function explorerHTML(){
    return `<div class="living-explorer"><section class="living-explorer-categories" aria-label="Product areas"><div class="living-explorer-search"><span>PLATFORM INDEX / 18</span><label><span class="sr-only">Filter areas</span><input type="search" data-explorer-search placeholder="Find an area" autocomplete="off"/></label></div><div class="living-explorer-categories-scroll" role="group" aria-label="Choose an area">${catalog.map((c,i)=>`<button type="button" data-explorer-area="${i}" class="living-explorer-area ${i?'':'is-current'}" aria-pressed="${!i}"><span>${String(i+1).padStart(2,'0')}</span><strong>${esc(c[0])}</strong><span aria-hidden="true">↗</span></button>`).join('')}</div><p class="living-explorer-count" data-explorer-count>18 areas in the trading workspace</p></section><section class="living-explorer-overview" aria-label="Selected area and functions"><div class="living-explorer-area-art" style="${art(0)}" aria-hidden="true"></div><span class="living-explorer-kicker" data-explorer-category>JOURNAL / REVIEW</span><h3 data-explorer-heading>Journal</h3><p data-explorer-intro>${esc(catalog[0][1])}</p><div class="living-explorer-feature-label">EXPLORE A FUNCTION</div><div class="living-explorer-features" role="group" aria-label="Choose a function"></div></section><aside class="living-explorer-detail" aria-live="polite"><div class="living-explorer-detail-art" style="${art(0)}" aria-hidden="true"></div><span class="living-explorer-detail-kicker" data-explorer-feature-number>FEATURE / 01</span><h3 data-explorer-feature-name>Pre-trade context</h3><div class="living-explorer-description"><span>WHAT IT DOES</span><p data-explorer-feature-how></p></div><div class="living-explorer-description"><span>WHY IT MATTERS</span><p data-explorer-feature-why></p></div><div class="living-explorer-disclaimer">ILLUSTRATIVE EXPERIENCE · ACTUAL FEATURES MAY DEPEND ON CONFIGURATION</div></aside></div>`;
  }
  core.render = function(ctx){
    trades=ctx.tradeExamples||trades;
    const template=document.createElement('template');template.innerHTML=coreRender(ctx);
    const root=template.content.querySelector('.concept-living');if(!root)return template.innerHTML;
    const svg=root.querySelector('.chart-shell-living .market-svg');if(svg && trades.length)svg.outerHTML=lineSVG(trades[0]);
    const visual=root.querySelector('.living-hero-visual');if(visual)visual.querySelector('.living-decision-note')?.insertAdjacentHTML('beforebegin',recentHTML());
    const hero=root.querySelector('.living-hero');if(hero)hero.insertAdjacentHTML('afterend',slantedHTML());
    root.querySelector('.living-process-art')?.insertAdjacentHTML('afterbegin',`<div class="living-phase-art" style="${art(phaseArt[0])}" aria-hidden="true"></div><div class="living-phase-pips" aria-hidden="true"><i class="is-current"></i><i></i><i></i><i></i></div>`);
    const oldEvidence=root.querySelector('.living-evidence-grid');if(oldEvidence)oldEvidence.outerHTML=storyHTML();
    const oldPlatform=root.querySelector('.living-platform-grid');if(oldPlatform)oldPlatform.outerHTML=explorerHTML();
    return template.innerHTML;
  };
  function paintExplorer(){
    if(!host)return;const c=catalog[moduleIndex],features=c[3],f=features[featureIndex];
    host.querySelectorAll('[data-explorer-area]').forEach(b=>{const on=Number(b.dataset.explorerArea)===moduleIndex;b.classList.toggle('is-current',on);b.setAttribute('aria-pressed',String(on));});
    const intro=host.querySelector('[data-explorer-intro]'),name=host.querySelector('[data-explorer-heading]'),category=host.querySelector('[data-explorer-category]');
    if(intro)intro.textContent=c[1];if(name)name.textContent=c[0];if(category)category.textContent=String(moduleIndex+1).padStart(2,'0')+' / '+c[2];
    for(const sel of ['.living-explorer-area-art','.living-explorer-detail-art']){const img=host.querySelector(sel);if(img)img.style.cssText=art(moduleIndex);}
    const featureList=host.querySelector('.living-explorer-features');
    if(featureList)featureList.innerHTML=features.map((a,i)=>`<button type="button" data-explorer-feature="${i}" class="living-explorer-feature ${i===featureIndex?'is-current':''}" aria-pressed="${i===featureIndex}"><span>${String(i+1).padStart(2,'0')}</span><strong>${esc(a[0])}</strong><span aria-hidden="true">↗</span></button>`).join('');
    const values=[['[data-explorer-feature-number]','FEATURE / '+String(featureIndex+1).padStart(2,'0')],['[data-explorer-feature-name]',f[0]],['[data-explorer-feature-how]',f[1]],['[data-explorer-feature-why]',f[2]]];
    values.forEach(([sel,val])=>{const x=host.querySelector(sel);if(x)x.textContent=val;});
    const panel=host.querySelector('.living-explorer-detail');if(panel&&!reduce)panel.animate([{opacity:.5,transform:'translateX(15px)'},{opacity:1,transform:'translateX(0)'}],{duration:420,easing:'cubic-bezier(.2,.8,.2,1)'});
  }
  function paintStory(i){
    storyIndex=(i+stories.length)%stories.length;const s=stories[storyIndex];
    host.querySelectorAll('[data-story-step]').forEach(b=>{const on=Number(b.dataset.storyStep)===storyIndex;b.classList.toggle('is-current',on);b.setAttribute('aria-pressed',String(on));});
    const image=host.querySelector('.living-story-art');if(image)image.style.cssText=art(storyArt[storyIndex]);
    for(const [sel,value] of [['[data-story-label]',s[0]+' / '+s[1]],['[data-story-title]',s[2]],['[data-story-body]',s[3]],['[data-story-lesson]',s[4]]]){const x=host.querySelector(sel);if(x)x.textContent=value;}
    const panel=host.querySelector('.living-story-spotlight');if(panel&&!reduce)panel.animate([{opacity:.35,transform:'translateX(22px)'},{opacity:1,transform:'translateX(0)'}],{duration:500,easing:'cubic-bezier(.2,.8,.2,1)'});
  }
  function updatePhase(){
    if(!host)return;const i=Number(host.querySelector('[data-living-step-number]')?.textContent||'1')-1;
    if(!Number.isInteger(i)||i<0||i>3)return;
    const artEl=host.querySelector('.living-phase-art');if(artEl)artEl.style.cssText=art(phaseArt[i]);
    host.querySelectorAll('.living-phase-pips i').forEach((e,j)=>e.classList.toggle('is-current',i===j));
    if(!reduce)host.querySelectorAll('.living-phase-art,.living-method-panel-copy').forEach((x,j)=>x.animate([{opacity:.15,transform:'translateX(24px) scale(.97)'},{opacity:1,transform:'translateX(0) scale(1)'}],{duration:480+j*100,easing:'cubic-bezier(.2,.8,.2,1)'}));
  }
  core.mount=function(el){
    coreMount(el);host=el.querySelector('.concept-living');if(!host)return;
    reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;paintExplorer();updatePhase();
    host.addEventListener('click',ev=>{
      const trade=ev.target.closest('[data-recent-trade]');if(trade){host.querySelector(`[data-trade="${trade.dataset.recentTrade}"]`)?.click();return;}
      const module=ev.target.closest('[data-explorer-area]');if(module){moduleIndex=Number(module.dataset.explorerArea);featureIndex=0;paintExplorer();return;}
      const feature=ev.target.closest('[data-explorer-feature]');if(feature){featureIndex=Number(feature.dataset.explorerFeature);paintExplorer();return;}
      const story=ev.target.closest('[data-story-step]');if(story){paintStory(Number(story.dataset.storyStep));return;}
      if(ev.target.closest('[data-story-next]'))paintStory(storyIndex+1);
    });
    host.querySelector('[data-explorer-search]')?.addEventListener('input',ev=>{
      const query=ev.target.value.trim().toLocaleLowerCase();let count=0;
      host.querySelectorAll('[data-explorer-area]').forEach(el=>{const item=catalog[Number(el.dataset.explorerArea)];const hit=item[0].toLowerCase().includes(query)||item[2].toLowerCase().includes(query)||item[3].some(f=>f[0].toLowerCase().includes(query));el.hidden=!hit;if(hit)count++;});
      const countText=host.querySelector('[data-explorer-count]');if(countText)countText.textContent=count+' matching workspace areas';
    });
    phaseObserver?.disconnect();const watched=host.querySelector('[data-living-step-number]');if(watched){phaseObserver=new MutationObserver(updatePhase);phaseObserver.observe(watched,{childList:true,subtree:true,characterData:true});}
  };
  core.tradeChanged=function(i,examples){coreTrade(i,examples);trades=examples;swapChart(i);};
  window.YMFXConcept06Review={catalog,stories};
})();