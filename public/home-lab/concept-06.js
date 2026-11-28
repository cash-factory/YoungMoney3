/* YM-FX Home Lab / 06: The Living Desk.
   Original-homepage concepts, newly composed. No account access or live prices. */
(() => {
  'use strict';
  const phases = [
    {n:'01',name:'Plan',verb:'Define the idea before it becomes a trade.',detail:'Document the setup, the invalidation, and the protective limits while your judgment is still clear.',signal:'A PLAN WITH BOUNDARIES',meta:'SETUP · RISK · INVALDIATION',short:'What would make this trade valid?'},
    {n:'02',name:'Capture',verb:'Keep the record as it actually happened.',detail:'Connect the intended plan to captured execution context. Preserve original risk and subsequent changes as separate events.',signal:'EXECUTION WITH PROVENANCE',meta:'ORDERS · CHANGES · LIFECYCLE',short:'What happened, without hindsight?'},
    {n:'03',name:'Test',verb:'Turn curiosity into a deliberate experiment.',detail:'Compare a defined hypothesis against documented examples and keep your assumptions separate from observed results.',signal:'A HYPOTHESIS YOU CAN CHALLENGE',meta:'SETUPS · EXAMPLES · EVIDENCE',short:'What deserves another test?'},
    {n:'04',name:'Review',verb:'Make the next decision more informed.',detail:'Look for recurring decisions, rule deviations, and the context behind performance. Choose one improvement worth tracking.',signal:'LEARNING THAT TRAVELS FORWARD',meta:'REFLECTION · PATTERNS · NEXT STEP',short:'What will I do differently?'}
  ];
  const modules = [
    {name:'Journal',label:'01 / YOUR RECORD',headline:'The trade is only half the story.',lead:'Capture the thinking, emotion, screenshot and post-trade reflection beside the execution record.',tags:['Decision notes','Context timeline','Media attachments'],a:'Before the trade',b:'Execution record',c:'Review note',detail:'A single place to connect intention and evidence.'},
    {name:'Playbook',label:'02 / YOUR RULES',headline:'A plan you can actually return to.',lead:'Trading plans, entry criteria, risk limits and repeatable setup checklists—organized for decisions, not decoration.',tags:['Trading plans','Risk rules','Entry models'],a:'Setup criteria',b:'Protective limits',c:'Pre-trade checklist',detail:'Know what a good decision requires before it happens.'},
    {name:'Testing',label:'03 / YOUR EXPERIMENTS',headline:'Treat an idea like a hypothesis.',lead:'Keep structured strategy tests and forward observations separate from historical account evidence.',tags:['Strategy tests','Hypotheses','Learning log'],a:'Hypothesis',b:'Recorded examples',c:'Review findings',detail:'Evidence is earned through a repeatable process.'},
    {name:'Accounts',label:'04 / YOUR EVIDENCE',headline:'The broker record stays intact.',lead:'Bring connected account activity into view, while distinguishing captured facts from personal notes and interpretations.',tags:['MT5 context','Position lifecycle','Original risk'],a:'Broker activity',b:'Protection history',c:'Account review',detail:'No silent rewriting of the original trade.'},
    {name:'Insights',label:'05 / YOUR PATTERNS',headline:'See patterns. Keep your judgment.',lead:'Review your documented behaviors and outcomes over time with evidence, confidence and clear limitations.',tags:['Behavior patterns','Confidence labels','Review prompts'],a:'Observed behavior',b:'Evidence quality',c:'Next experiment',detail:'A useful insight invites scrutiny, not blind agreement.'}
  ];
  let host = null;
  let activePhase = 0;
  let activeModule = 0;
  let tour = null;
  let tourInterval = 0;
  let scrollRaf = 0;
  const enc = v => String(v).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  function phaseButtons(){
    return phases.map((p,i) => '<button type="button" class="living-step'+(i===activePhase?' is-current':'')+'" data-living-phase="'+i+'" aria-pressed="'+(i===activePhase)+'"><span class="living-step-n">'+p.n+'</span><strong>'+p.name+'</strong><span class="living-step-arrow" aria-hidden="true">↗</span></button>').join('');
  }
  function modulePreview(m){
    return '<div class="living-module-preview" aria-label="Illustrative '+enc(m.name)+' workspace panel">'+
      '<div class="living-module-preview-top"><span><i class="living-led" aria-hidden="true"></i> YM / FX</span><span>DEMO INTERFACE</span></div>'+
      '<div class="living-module-preview-grid"><div class="living-module-side"><span>01 / TODAY</span><b>'+enc(m.name)+'</b><span>02 / LIBRARY</span><span>03 / REVIEW</span><span class="living-active-mark">●</span></div>'+
      '<div class="living-module-main"><p class="living-module-eyebrow">'+enc(m.label)+'</p><h4>'+enc(m.headline)+'</h4><div class="living-module-lines">'+
      [m.a,m.b,m.c].map((x,i) => '<div class="living-module-line"><span class="living-module-icon">'+String(i+1).padStart(2,'0')+'</span><span>'+enc(x)+'</span><span aria-hidden="true">↗</span></div>').join('')+
      '</div><div class="living-module-caption">'+enc(m.detail)+'</div></div></div></div>';
  }
  function moduleButtons(){
    return modules.map((m,i)=>'<button type="button" class="living-module-tab'+(i===activeModule?' is-current':'')+'" data-living-module="'+i+'" aria-pressed="'+(i===activeModule)+'"><span>0'+(i+1)+'</span><strong>'+enc(m.name)+'</strong><span aria-hidden="true">↗</span></button>').join('');
  }
  function evidenceTiles(){
    return '<div class="living-evidence-grid">'+[
      ['01','INTENT','What did the plan say?','Record the reason, planned entry and original protective limits.'],
      ['02','EXECUTION','What actually happened?','Follow the position lifecycle without silently changing captured evidence.'],
      ['03','REFLECTION','What deserves a second look?','Review documented decisions before assuming a profitable trade was a good trade.']
    ].map(x=>'<article class="living-evidence-card" data-living-reveal><span class="living-card-no">'+x[0]+' / '+x[1]+'</span><div class="living-card-sigil" aria-hidden="true"><span></span><i></i></div><h3>'+x[2]+'</h3><p>'+x[3]+'</p><span class="living-card-end">PART OF THE SAME STORY ↗</span></article>').join('')+'</div>';
  }
  function render(ctx){
    activePhase=0;activeModule=0;
    const p=phases[0],m=modules[0];
    return [
      '<article class="concept concept-living" data-design="06" data-living-theme="dark">',
      '<div class="living-progress-track" aria-hidden="true"><span data-living-progress></span></div>',
      ctx.siteNav('MAKE THE PROCESS VISIBLE'),
      ctx.sampleRibbon(),
      '<div class="living-stage">',
      '<section class="living-hero" id="top">',
        '<div class="living-ambient" aria-hidden="true"><i></i><i></i><i></i></div>',
        '<div class="living-hero-copy">',
          '<div class="living-topline"><span class="living-pulse" aria-hidden="true"></span><span>THE TRADING WORKSPACE / REIMAGINED</span><span class="living-version">06 / ORIGIN EVOLVED</span></div>',
          '<div class="living-headline"><span class="living-line">Make every</span><span class="living-line living-line-outline">trade teach</span><span class="living-line"><em>you something.</em></span></div>',
          '<p class="living-deck">Your setup. Your execution. Your decisions. One connected space to plan the trade, capture what happened, and understand what comes next.</p>',
          '<div class="living-hero-actions"><a class="living-main-cta" href="/">Open YM-FX <span aria-hidden="true">↗</span></a><a class="living-quiet-cta" href="#method">Explore the process <span aria-hidden="true">↘</span></a></div>',
          '<div class="living-micro-proof"><span>◈&nbsp; Plans &amp; playbooks</span><span>◈&nbsp; MT5 context</span><span>◈&nbsp; Guided reflection</span></div>',
          '<div class="living-hero-footer"><div class="living-runline"><span>01</span> PLAN <b></b> <span>02</span> CAPTURE <b></b> <span>03</span> TEST <b></b> <span>04</span> REVIEW</div><button type="button" class="living-theme-toggle" data-living-theme-toggle aria-label="Switch this concept to light appearance" aria-pressed="false"><i class="living-toggle-dot"></i> <span>LIGHT VIEW</span></button></div>',
        '</div>',
        '<div class="living-hero-visual" data-living-visual>',
          '<div class="living-visual-meta"><span>THE DECISION / IN CONTEXT</span><span class="living-visual-right">NOT LIVE DATA&nbsp;&nbsp; / &nbsp;&nbsp; 01</span></div>',
          '<div class="living-chart-float">',
             ctx.chartCard('living'),
          '</div>',
          '<div class="living-decision-note" aria-live="polite"><span class="living-note-mark">✳</span><div><small>BEHIND THE CHART</small><strong data-living-trade-setup>Pullback to a marked level</strong><p data-living-trade-reflection>Record the decision, not only the result.</p></div></div>',
          '<div class="living-stage-caption"><span>MARKET EXAMPLES, NOT MARKET SIGNALS</span><span>EXPLORE THE RECORD ↗</span></div>',
        '</div>',
      '</section>',
      '<section class="living-manifesto" data-living-reveal><span class="living-section-id">01 &nbsp; / &nbsp; THE SHIFT</span><div class="living-manifesto-grid"><h2>Trading improves when<br>the <em>decision</em> becomes visible.</h2><div><span class="living-rule"></span><p>Most platforms show the outcome. Your journal should help you understand the path that produced it.</p><p>Keep what the market did separate from what you thought, felt, planned and executed.</p></div></div></section>',
      '<section id="method" class="living-method">',
        '<div class="living-section-heading" data-living-reveal><span class="living-section-id">02 &nbsp; / &nbsp; A CONNECTED ROUTINE</span><div><h2>Four moments.<br><em>One better process.</em></h2><p>A simple loop that turns scattered trading activity into something you can learn from.</p></div></div>',
        '<div class="living-method-grid">',
          '<div class="living-method-steps" role="group" aria-label="Explore the trading process">'+phaseButtons()+
          '<div class="living-method-play"><button type="button" class="living-cycle" data-living-cycle aria-pressed="false"><span data-living-cycle-symbol>▶</span> <span data-living-cycle-label>Play the decision loop</span></button><span>YOU CONTROL THE PACE</span></div></div>',
          '<div class="living-method-panel" aria-live="polite"><div class="living-method-panel-head"><span>THE PROCESS / <strong data-living-step-number>'+p.n+'</strong></span><span data-living-step-meta>'+enc(p.meta)+'</span></div>',
          '<div class="living-process-art" aria-hidden="true"><span class="living-art-grid"></span><span class="living-art-ring living-art-ring-one"></span><span class="living-art-ring living-art-ring-two"></span><span class="living-art-core"><b data-living-art-number>'+p.n+'</b><i data-living-art-name>'+p.name+'</i></span><span class="living-art-laser"></span><span class="living-art-label">BEFORE → DURING → AFTER</span></div>',
          '<div class="living-method-panel-copy"><span class="living-panel-eyebrow" data-living-step-signal>'+p.signal+'</span><h3 data-living-step-title>'+p.verb+'</h3><p data-living-step-detail>'+p.detail+'</p><div class="living-method-next"><span data-living-step-question>'+p.short+'</span><button data-living-next type="button">Next moment &nbsp; ↗</button></div></div>',
          '</div>',
        '</div>',
      '</section>',
      '<section class="living-evidence" id="practice"><div class="living-section-heading" data-living-reveal><span class="living-section-id">03 &nbsp; / &nbsp; WHY IT MATTERS</span><div><h2>Your history should tell<br><em>a useful story.</em></h2><p>One record. Three questions. No rewriting the original evidence to fit the outcome.</p></div></div>',
      evidenceTiles(),'</section>',
      '<section id="platform" class="living-platform">',
        '<div class="living-section-heading" data-living-reveal><span class="living-section-id">04 &nbsp; / &nbsp; INSIDE YM-FX</span><div><h2>Everything connected.<br><em>Nothing crowded.</em></h2><p>The original platform features, reorganized around what the trader needs to do.</p></div></div>',
        '<div class="living-platform-grid"><div class="living-module-list" role="group" aria-label="Explore platform areas">'+moduleButtons()+'</div>',
        '<div class="living-module-stage" aria-live="polite"><div data-living-module-preview>'+modulePreview(m)+'</div><div class="living-module-copy"><span class="living-module-name" data-living-module-label>'+m.label+'</span><h3 data-living-module-headline>'+m.headline+'</h3><p data-living-module-lead>'+m.lead+'</p><div class="living-module-tags" data-living-module-tags>'+m.tags.map(s=>'<span>'+enc(s)+'</span>').join('')+'</div></div></div></div>',
      '</section>',
      '<section id="why" class="living-outro"><div class="living-outro-shape" aria-hidden="true">YM</div><div class="living-outro-inner" data-living-reveal><span class="living-section-id">05 &nbsp; / &nbsp; THE REASON</span><h2>The goal is not a<br><em>perfect trade.</em><br>It is a clearer next one.</h2><p>A private trading workspace for the trader who wants to refine the process—not chase another performance promise.</p><div><a href="/" class="living-main-cta">Enter your workspace <span aria-hidden="true">↗</span></a><a href="#top" class="living-top-link">Back to top ↑</a></div></div></section>',
      '<footer class="living-footer"><span>YOUNGMONEY / FX</span><span>PROCESS &nbsp; • &nbsp; PRECISION &nbsp; • &nbsp; DISCIPLINE</span><span>CONCEPT 06 · ILLUSTRATIVE INTERFACE</span></footer>',
      '</div>',
      '</article>'
    ].join('');
  }
  function paintPhase(i){
    activePhase=(i+phases.length)%phases.length;
    const p=phases[activePhase],a=host;
    a.querySelectorAll('[data-living-phase]').forEach(button=>{
      const selected=Number(button.dataset.livingPhase)===activePhase;
      button.classList.toggle('is-current',selected);button.setAttribute('aria-pressed',String(selected));
    });
    const setters={'[data-living-step-number]':p.n,'[data-living-step-meta]':p.meta,'[data-living-art-number]':p.n,'[data-living-art-name]':p.name,
      '[data-living-step-signal]':p.signal,'[data-living-step-title]':p.verb,'[data-living-step-detail]':p.detail,'[data-living-step-question]':p.short};
    Object.entries(setters).forEach(([sel,value])=>{const el=a.querySelector(sel);if(el)el.textContent=value;});
    const panel=a.querySelector('.living-method-panel');
    if(panel){panel.dataset.phase=String(activePhase);panel.classList.remove('living-phase-shift');void panel.offsetWidth;panel.classList.add('living-phase-shift');}
  }
  function paintModule(i){
    activeModule=(i+modules.length)%modules.length;
    const m=modules[activeModule],a=host;
    a.querySelectorAll('[data-living-module]').forEach(button=>{
      const selected=Number(button.dataset.livingModule)===activeModule;
      button.classList.toggle('is-current',selected);button.setAttribute('aria-pressed',String(selected));
    });
    const content=a.querySelector('[data-living-module-preview]');
    if(content)content.innerHTML=modulePreview(m);
    for(const [sel,value] of [['[data-living-module-label]',m.label],['[data-living-module-headline]',m.headline],['[data-living-module-lead]',m.lead]]){
      const el=a.querySelector(sel);if(el)el.textContent=value;
    }
    const tags=a.querySelector('[data-living-module-tags]');
    if(tags)tags.innerHTML=m.tags.map(s=>'<span>'+enc(s)+'</span>').join('');
  }
  function stopTour(){
    if(tourInterval){clearInterval(tourInterval);tourInterval=0;}
    const btn=host?.querySelector('[data-living-cycle]');
    if(btn){btn.setAttribute('aria-pressed','false');btn.querySelector('[data-living-cycle-symbol]').textContent='▶';btn.querySelector('[data-living-cycle-label]').textContent='Play the decision loop';}
  }
  function updateProgress(){
    scrollRaf=0;
    if(!host||!host.isConnected)return;
    const r=host.getBoundingClientRect(),max=Math.max(1,host.scrollHeight-innerHeight);
    const progress=Math.max(0,Math.min(1,-r.top/max));
    const bar=host.querySelector('[data-living-progress]');if(bar)bar.style.transform='scaleX('+progress.toFixed(4)+')';
  }
  function mount(el){
    host=el.querySelector('.concept-living');
    if(!host)return;
    const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
    host.addEventListener('click',event=>{
      const phase=event.target.closest('[data-living-phase]');
      if(phase){stopTour();paintPhase(Number(phase.dataset.livingPhase));return;}
      const next=event.target.closest('[data-living-next]');
      if(next){stopTour();paintPhase(activePhase+1);return;}
      const mod=event.target.closest('[data-living-module]');
      if(mod){paintModule(Number(mod.dataset.livingModule));return;}
      const toggle=event.target.closest('[data-living-theme-toggle]');
      if(toggle){const light=host.dataset.livingTheme!=='light';host.dataset.livingTheme=light?'light':'dark';toggle.setAttribute('aria-pressed',String(light));toggle.setAttribute('aria-label','Switch this concept to '+(light?'dark':'light')+' appearance');toggle.querySelector('span').textContent=light?'DARK VIEW':'LIGHT VIEW';return;}
      const cycle=event.target.closest('[data-living-cycle]');
      if(cycle){
        if(tourInterval){stopTour();return;}
        paintPhase(0);cycle.setAttribute('aria-pressed','true');cycle.querySelector('[data-living-cycle-symbol]').textContent='Ⅱ';cycle.querySelector('[data-living-cycle-label]').textContent='Pause sequence';
        let count=0;tourInterval=setInterval(()=>{count++;if(count>=4){stopTour();return;}paintPhase(count);},reduce?1700:2700);
      }
    });
    if(!reduce&&'IntersectionObserver' in window){
      const observed=host.querySelectorAll('[data-living-reveal]');
      const observer=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('is-in-view');observer.unobserve(e.target);}}),{threshold:.08,rootMargin:'0px 0px -25px 0px'});
      observed.forEach(x=>observer.observe(x));
    }else{host.querySelectorAll('[data-living-reveal]').forEach(x=>x.classList.add('is-in-view'));}
    const stage=host.querySelector('[data-living-visual]');
    if(stage&&!reduce&&matchMedia('(hover: hover) and (pointer: fine)').matches){
      stage.addEventListener('pointermove',e=>{const r=stage.getBoundingClientRect();const x=(e.clientX-r.left)/r.width-.5,y=(e.clientY-r.top)/r.height-.5;stage.style.setProperty('--living-x',(x*9).toFixed(2)+'px');stage.style.setProperty('--living-y',(y*7).toFixed(2)+'px');},{passive:true});
      stage.addEventListener('pointerleave',()=>{stage.style.setProperty('--living-x','0px');stage.style.setProperty('--living-y','0px');});
    }
    addEventListener('scroll',()=>{if(!scrollRaf)scrollRaf=requestAnimationFrame(updateProgress);},{passive:true});
    updateProgress();
  }
  function tradeChanged(index,examples){
    const t=examples[index];if(!host||!t)return;
    const title=host.querySelector('[data-living-trade-setup]'),text=host.querySelector('[data-living-trade-reflection]');
    if(title)title.textContent=t.setup;
    if(text)text.textContent=t.lesson;
    const c=host.querySelector('.living-chart-float');if(c){c.classList.remove('living-trade-switch');void c.offsetWidth;c.classList.add('living-trade-switch');}
  }
  window.YMFXConcept06={render,mount,tradeChanged};
})();
