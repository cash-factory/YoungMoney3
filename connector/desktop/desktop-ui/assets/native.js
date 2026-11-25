/* YoungMoney3 native Signal Desk bridge. No demo broker data is permitted in native mode. */
(() => {
  'use strict';
  const isNative = !!(window.__TAURI_INTERNALS__ || window.__TAURI__?.shell?.Command);
  const safe = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const empty = {paired:false,capture_active:false,source:'initializing',connection_state:'offline',sessions:[],events:[],device:'Local computer',copying_armed:false,copy_permission_available:false};
  let model={...empty}, screen=null, bridge=null, latestError='', starting=false, selected=null, terminals=[], refreshInFlight=false;
  const pending=new Map(); let seq=0;
  function handleResponse(line){
    let reply;
    try { reply=JSON.parse(line); }
    catch { console.warn('Malformed desktop bridge response'); return; }
    const req=pending.get(reply.id);
    if(!req)return;
    pending.delete(reply.id);
    clearTimeout(req.timer);
    reply.ok?req.resolve(reply.result):req.reject(new Error(reply.error||'The local connector could not complete this request'));
  }
  function lineHandler(data){
    const value=typeof data==='string'?data:String(data||'');
    // Tauri shell's stdout 'data' event is line-oriented and may omit the
    // newline. Support both one-line events and genuine chunked streams.
    if(!bridge)return;
    bridge.buffer+=value;
    if(bridge.buffer.length>1024*1024){bridge.buffer='';return;}
    let at;
    while((at=bridge.buffer.indexOf('\n'))>=0){
      const line=bridge.buffer.slice(0,at).trim();
      bridge.buffer=bridge.buffer.slice(at+1);
      if(line)handleResponse(line);
    }
    const remaining=bridge.buffer.trim();
    if(remaining.startsWith('{') && remaining.endsWith('}')){
      try { JSON.parse(remaining); bridge.buffer=''; handleResponse(remaining); }
      catch { /* wait for the rest of the JSON line */ }
    }
  }
  async function boot(){
    if(starting||bridge)return;
    starting=true;
    try{
      const {Command}=window.__TAURI__.shell;
      const process=Command.sidecar('binaries/ymfx-bridge', [], {processGroup:true});
      bridge={process,child:null,buffer:''};
      process.stdout.on('data',lineHandler);
      process.stderr.on('data',()=>{ /* no secrets or raw logs in the UI */ });
      process.on('close',()=>{bridge=null;model={...empty,connection_state:'attention'};latestError='Desktop engine stopped. Reopen the application to restart it.';rejectPending();refreshView();});
      bridge.child=await process.spawn();
      await refreshSnapshot();
    }catch(err){bridge=null;model={...empty,connection_state:'attention'};latestError='Unable to start the local connector service.';refreshView();}
    finally{starting=false;}
  }
  function rejectPending(){for(const [id,p] of pending){clearTimeout(p.timer);p.reject(new Error('Desktop engine closed'));pending.delete(id)}}
  function request(method,params={}){
    if(!bridge?.child)return Promise.reject(new Error('The local engine is not running'));
    const id=++seq;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{pending.delete(id);reject(new Error('The connector did not respond. Check its local status.'))},method==='pair_pc'?65000:method==='scan_terminals'?30000:18000);
      pending.set(id,{resolve,reject,timer});
      bridge.child.write(JSON.stringify({id,method,params})+'\n').catch(err=>{clearTimeout(timer);pending.delete(id);reject(err)});
    });
  }
  async function refreshSnapshot(){
    if(refreshInFlight||!bridge)return;
    refreshInFlight=true;
    try{const response=await request('snapshot');if(response?.source!=='local-connector'||response.demo!==false)throw new Error('Unverified source');model=response;latestError='';if(!selected||!model.sessions.some(x=>x.id===selected))selected=model.sessions[0]?.id||null;refreshView();}
    catch(err){latestError='Could not refresh the connector status.';refreshView();}
    finally{refreshInFlight=false;}
  }
  function refreshView(){
    if(!screen)return;
    screen.state.scenario=model.connection_state==='connected'?'connected':model.connection_state==='recovering'?'recovering':'offline';
    screen.render();
  }
  function statusLabel(){
    if(!model.paired)return 'Not paired';
    if(model.connection_state==='connected')return 'Connected and monitoring';
    if(model.connection_state==='recovering')return 'Recovering broker history';
    if(model.connection_state==='attention')return 'Connection needs attention';
    return 'Monitoring is stopped';
  }
  const statusTone=()=>model.connection_state==='connected'?'online':model.connection_state==='recovering'?'working':model.connection_state==='attention'?'danger':'';
  const badge=(value,tone='')=>`<span class="native-status ${tone}">${safe(value)}</span>`;
  function intro(title,detail){return `<div class="page-intro"><div class="crumb">YOUNGMONEY3 <span class="slash">/</span><span class="current">${safe(title.toUpperCase())}</span></div><h1>${safe(title)}</h1><p class="native-subtitle">${safe(detail)}</p></div>`}
  function action(label,method,primary=false){return `<button type="button" class="btn ${primary?'red':''}" data-native-action="${safe(method)}"><span>${safe(label)}</span></button>`}
  function cardHead(name,icon,detail=''){return `<div class="native-card-head"><h2>${screen.icon(icon)} ${safe(name)}</h2>${detail}</div>`}
  function infoRow(label,value){return `<div class="native-info-row"><span>${safe(label)}</span><strong>${safe(value||'Not verified')}</strong></div>`}
  function card(children,cls=''){return `<section class="native-card ${cls}">${children}</section>`}
  function viewHome(){
    const count=model.sessions.length,known=model.sessions.filter(x=>!!x.login&&!!x.server).length,mon=model.sessions.filter(x=>x.status==='monitoring').length;
    const paired=model.paired,working=model.capture_active;
    const stage=paired?(working?'Running':'Ready'):'Setup required';
    return intro('Trading Operations Hub','Your actual Windows connector: pairing, MT5 sessions and capture health in one place.')+
      `<div class="native-shell-grid">${card(`${cardHead('Connection overview','link',badge(stage,statusTone()))}<div class="native-health"><div class="native-health-copy"><div class="native-overline">CURRENT LOCAL STATE · VERIFIED</div><h2>${safe(statusLabel())}</h2><p>${paired?working?'The capture worker is active. Connection health is determined by confirmed connector events.':'Saved PC pairing is available. Start monitoring when you are ready.':'Connect this computer to YoungMoney3 to begin monitoring broker accounts.'}</p><div class="native-step-row"><span class="${paired?'is-ready':'is-unverified'}">${screen.icon(paired?'check':'lock')} PC pairing ${paired?'saved':'required'}</span><span class="${known?'is-ready':'is-unverified'}">${screen.icon(known?'check':'minus')} MT5 accounts ${known?'identified':'unverified'}</span><span class="is-unverified">${screen.icon('lock')} Copying separately authorized</span></div></div><div class="native-overview-art">${screen.media('connection')}</div></div>`)}
       ${card(`${cardHead('Quick actions','power')}<div class="native-action-row">${action('Manage MT5 accounts','accounts',true)}${paired?action(working?'Stop monitoring safely':'Start monitoring','toggle-capture'):action('Connect this PC','pair',true)}${action('Open YoungMoney3 dashboard','open_dashboard')}</div>`)}</div>
       <div class="native-kpi">${[
         ['Saved MT5 sessions',String(count),'Locally configured sessions'],
         ['Identified broker accounts',String(known),'From confirmed connector events'],
         ['Currently monitoring',String(mon),'Broker-linked sessions observed'],
         ['Copying status','Not verified','Requires separate authorization']
       ].map(([label,value,sub])=>card(`<div class="native-stat"><div class="native-overline">${label}</div><strong>${safe(value)}</strong><small>${safe(sub)}</small></div>`)).join('')}</div>
       <div class="native-operations">${card(cardHead('This computer','computer')+`<div class="native-pad">${infoRow('Device',model.device)}${infoRow('PC paired',model.paired?'Yes':'No')}${infoRow('Capture worker',model.capture_active?'Running':'Stopped')}${infoRow('Last status',statusLabel())}</div>`)}
       ${card(cardHead('Recent activity','clock')+activityRows(4))}</div>`;
  }
  function activityRows(limit=30){
    let rows=model.events.slice(-limit).reverse();
    return rows.length?`<div class="native-rows">${rows.map(ev=>`<div class="native-event"><div><b>${safe(ev.message)}</b><small>${safe(ev.kind)}</small></div><small>${safe(ev.time?.replace('T',' ').replace('+00:00',' UTC'))}</small></div>`).join('')}</div>`:
      `<div class="native-pad"><p>No connector events recorded in this session. Broker history is not represented by this list.</p></div>`;
  }
  function selectedAccount(){return model.sessions.find(x=>x.id===selected)||null}
  function viewAccounts(){
    const s=selectedAccount();
    return intro('My Accounts','Manage genuine local MT5 sessions. No demonstration accounts are shown in the installed application.')+
      `<div class="native-split">${card(cardHead('Saved terminal sessions','accounts',badge(`${model.sessions.length} configured`))+`<div class="native-rows">${model.sessions.length?model.sessions.map(x=>`<div class="native-account"><div><button type="button" data-native-select="${safe(x.id)}" aria-pressed="${x.id===selected}">${safe(x.name)} ${x.id===selected?'●':''}</button><small>${safe([x.server,x.login?'#'+x.login:'No broker login confirmed'].filter(Boolean).join(' · '))}</small></div>${badge(x.status==='monitoring'?'Monitoring':x.status==='recovering'?'Recovering':x.enabled?'Not verified':'Paused',x.status==='monitoring'?'online':x.status==='recovering'?'working':'')}</div>`).join(''):`<div class="native-pad"><p>No MT5 sessions are configured yet. Pair this PC, then use Add Account in YoungMoney3.</p></div>`}</div><div class="native-pad">${action('Add or manage accounts','open_dashboard')}</div>`)}
       ${card(cardHead('Account inspector','shield-check')+`<div class="native-pad native-inspector">${s?`<h2>${safe(s.name)}</h2>${infoRow('Broker server',s.server)}${infoRow('Account login',s.login)}${infoRow('Session',s.enabled?'Enabled':'Paused')}${infoRow('Terminal installation',s.terminal_present?'Found':'Missing')}${infoRow('Capture evidence',s.status)}${infoRow('Copy permission','Not verified by this interface')}<div class="native-inline-actions">${action(s.enabled?'Pause monitoring':'Resume monitoring',s.enabled?'pause-session':'resume-session',!s.enabled)}${action('Open account in dashboard','open_dashboard')}</div>`:`<p>Select a configured MT5 terminal on the left to inspect it.</p>`}<div class="native-help-bubble">Your original broker trade evidence is never edited by this UI. Pausing only updates the local session's monitoring preference; it does not close trades or alter recorded fills.</div></div>`)}</div>`;
  }
  function viewCopy(){
    return intro('Trade Copying','Inspect the higher-risk copying workflow separately from read-only monitoring.')+
      `<div class="native-shell-grid">${card(`${cardHead('Copy Fleet safety','shield-check',badge('Not armed','danger'))}<div class="native-health"><div class="native-health-copy"><div class="native-overline">ACCOUNT-BOUND LOCAL APPROVAL REQUIRED</div><h2>Execution remains protected</h2><p>The new desktop interface has not yet implemented verified follower consent or fleet arming. No order submission is available here.</p><div class="native-step-row"><span class="is-unverified">${screen.icon('lock')} Followers must be authorized per account</span><span class="is-unverified">${screen.icon('lock')} Broker mode and risk must be checked</span></div></div><div class="native-overview-art">${screen.media('copy')}</div></div>`)}
       ${card(cardHead('Controls','layers')+`<div class="native-action-row">${action('Open Copy Studio','open_copy_studio',true)}${action('Review account sessions','accounts')}<p>All live order authorization remains in the established connector until the new implementation passes supervised broker-side acceptance.</p></div>`)}</div>
       <div class="native-kpi">${[['Fleet state','Disarmed'],['Execution authority','None in new shell'],['Risk basis','Broker-verified'],['Order transmission','Disabled']].map(([l,v])=>card(`<div class="native-stat"><div class="native-overline">${safe(l)}</div><strong style="font-size:19px">${safe(v)}</strong></div>`)).join('')}</div>`;
  }
  function viewPair(){
    return intro('Connect this PC','Pair this Windows installation securely, then discover local MT5 terminals.')+
      `<div class="native-shell-grid">${card(cardHead('Secure pairing','link',badge(model.paired?'Paired':'Not paired',model.paired?'online':''))+`<div class="native-pad"><div class="native-overview-art" style="width:100%;max-width:580px;min-height:180px">${screen.media('pair')}</div><p>The one-time code is checked by the existing Python connector and is never written into browser preferences, screenshots or activity logs.</p><div class="native-inline-actions">${action('Open pairing page','open_dashboard',true)}</div><label class="field" style="margin-top:17px;max-width:500px"><span>32-character pairing code</span><input class="native-text-input" id="native-pair-code" type="password" inputmode="text" autocomplete="off" spellcheck="false" maxlength="32" placeholder="Paste your code from YoungMoney3" ${model.paired?'disabled':''}></label><div class="native-inline-actions">${action('Pair this computer','pair_pc',!model.paired)}${action('Scan local MT5 terminals','scan_terminals')}</div><div class="native-help-bubble">Pairing requires a valid short-lived code. It is not a trade-copying authorization.</div></div>`)}
       ${card(cardHead('Local workstation','computer')+`<div class="native-pad">${infoRow('Device name',model.device)}${infoRow('Pairing',model.paired?'Confirmed locally':'Not yet paired')}${infoRow('Capture service',model.capture_active?'Running':'Stopped')}${infoRow('Discovered terminals',terminals.length?String(terminals.length):'Not scanned')}<div style="margin-top:16px">${terminals.map(x=>`<div class="native-info-row"><span>Installation</span><strong>${safe(x.name)}</strong></div>`).join('')}</div></div>`)}</div>`;
  }
  function viewActivity(){return intro('Recent Activity','Local connector events. Sensitive tokens and broker passwords are never displayed.')+
      card(cardHead('Connection and capture events','activity',badge('Local service'))+activityRows(100))+
      `<div class="native-help-bubble">This view records accepted service events, not an immutable trade ledger. Broker fills and transaction history remain within the existing capture engine.</div>`;}
  function viewHelp(){return intro('Help & Guides','Guidance for the redesigned native desktop connector.')+
     `<div class="native-operations">${card(cardHead('Getting started','help')+`<div class="native-pad"><p>1. Pair the Windows computer with the code from YoungMoney3.</p><p>2. Add a broker account through the existing secure account flow.</p><p>3. Start read-only monitoring. Watch the verified status here.</p><p>4. Review any reconciliation issues before trusting journal metrics.</p></div>`)}${card(cardHead('Copying safely','shield-check')+`<div class="native-pad"><p>Trade copying is separate from monitoring. Followers require verified account identity, risk settings and explicit local approval. The new interface cannot arm or execute trades.</p><div class="native-inline-actions">${action('Open Copy Studio','open_copy_studio')}</div></div>`)}</div>`}
  function nativeSidebar(){return `<aside class="sidebar"><div class="brand-box"><img src="assets/ymfx-brand.svg" alt="YoungMoney3"><div class="brand-label"><strong>YOUNGMONEY3</strong><span>MT5 CONNECTOR</span></div></div><div class="brand-caption">Your trading companion.</div><nav class="side-nav" aria-label="Connector sections">${screen.NAV.map(([id,label,ic])=>`<button type="button" data-page="${id}" class="${screen.state.page===id?'active':''}" aria-current="${screen.state.page===id?'page':'false'}">${screen.icon(ic)}<span class="nav-label">${label}</span></button>`).join('')}</nav><div class="side-bottom"><div class="side-overline">LOCAL DEVICE</div><div class="side-workspace">${safe(model.device)}</div><div class="side-version">Staging · Native Desktop<br>Read-only monitoring / Copying separate</div></div></aside>`}
  function nativeTopbar(){return `<div class="topbar"><div class="toolbar-left"><strong style="font-size:13px">MT5 Connections</strong>${badge(model.paired?statusLabel():'Pairing required',statusTone())}</div><div class="toolbar-right" style="font-size:12px;color:#67717d"><span>Monitoring is read-only</span><span style="margin:0 9px">|</span><span>Copying requires approval</span></div></div>`}
  function nativeStatusbar(){return `<div class="system-bar"><div style="display:flex;gap:10px;align-items:center">${badge(statusLabel(),statusTone())}<span>Local device: ${safe(model.device)}</span></div><div>${latestError?`<span style="color:#bf1232">${safe(latestError)}</span>`:'Engine status from verified local connector'} · No copy authorization</div></div>`;}
  async function nativeCommand(name){
    if(['home','accounts','copy','pair','activity','help'].includes(name)){screen.navigate(name);return;}
    if(name==='toggle-capture')name=model.capture_active?'stop_monitoring':'start_monitoring';
    if(name==='pair_pc'){
      const input=document.getElementById('native-pair-code');const code=(input?.value||'').trim();
      if(!/^[a-f0-9]{32}$/i.test(code)){alert('Use the 32-character pairing code from YoungMoney3.');return;}
      if(input)input.value='';
      try{await request('pair_pc',{code});await refreshSnapshot();}catch(err){latestError='Pairing request was not accepted. '+String(err.message).slice(0,90);refreshView();}
      return;
    }
    if(name==='scan_terminals'){
      try{const data=await request('scan_terminals');terminals=Array.isArray(data.terminals)?data.terminals:[];latestError='';refreshView()}
      catch(err){latestError='Terminal discovery could not complete';refreshView()}
      return;
    }
    if(name==='pause-session'||name==='resume-session'){
      const row=selectedAccount();if(!row)return;
      try{await request('set_session_enabled',{id:row.id,enabled:name==='resume-session'});await refreshSnapshot()}
      catch(err){latestError='Could not update monitoring for this session';refreshView()}
      return;
    }
    try{await request(name);await refreshSnapshot()}catch(err){latestError=String(err.message).slice(0,110);refreshView()}
  }
  function install(deps){
    if(!isNative)return;
    screen=deps;
    document.body.classList.add('ym-native');
    Object.assign(deps.views,{home:viewHome,accounts:viewAccounts,copy:viewCopy,pair:viewPair,activity:viewActivity,help:viewHelp});
    deps.nativeSidebar=nativeSidebar;
    // Override shell slots through functions passed into the original UI renderer.
    // The source page's brand/safety elements remain visible while account data is real.
    document.addEventListener('click',evt=>{
      const action=evt.target.closest('[data-native-action]');
      if(action){evt.stopImmediatePropagation();evt.preventDefault();nativeCommand(action.dataset.nativeAction);return;}
      const row=evt.target.closest('[data-native-select]');
      if(row){evt.stopImmediatePropagation();evt.preventDefault();selected=row.dataset.nativeSelect;refreshView();return;}
    },true);
    window.addEventListener('beforeunload',()=>{if(bridge?.child)bridge.child.write(JSON.stringify({id:++seq,method:'shutdown'})+'\n').catch(()=>{});});
    setInterval(refreshSnapshot,3500);
    boot();
  }
  window.YMFXNative={install,isNative,nativeSidebar,nativeTopbar,nativeStatusbar};
})();