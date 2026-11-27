/* YoungMoney3 native Signal Desk bridge. No demo broker data is permitted in native mode. */
(() => {
  'use strict';
  const isNative = !!(window.__TAURI_INTERNALS__ || window.__TAURI__?.shell?.Command);
  const safe = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const empty = {paired:false,capture_active:false,source:'initializing',connection_state:'offline',sessions:[],events:[],device:'Local computer',copying_armed:false,copy_permission_available:false};
  let model={...empty}, screen=null, bridge=null, latestError='', starting=false, selected=null, terminals=[], refreshInFlight=false;
  let lastSnapshotKey=null, lastRenderedPage=null, lastRenderedRevision=0;
  let framePoll=null, windowVisible=true;
  let editingSession=false, removingSession=false, addingAccount=false, commandBusy=false, actionNotice='';
  let activityFilter='all';
  // Incremental native DOM reconciliation: keep the SVG artwork, focus, scroll,
  // video/motion timeline, and window chrome mounted across status updates.
  // Replacing the entire app every 3.5 seconds was the main flicker defect.
  function patchNode(oldNode, nextNode) {
    if (oldNode.nodeType !== nextNode.nodeType || oldNode.nodeName !== nextNode.nodeName ||
        (oldNode.nodeType === 1 &&
         ((oldNode.hasAttribute('data-native-select') && oldNode.getAttribute('data-native-select') !== nextNode.getAttribute('data-native-select')) ||
          (oldNode.hasAttribute('data-page') && oldNode.getAttribute('data-page') !== nextNode.getAttribute('data-page')) ||
          (oldNode.hasAttribute('data-native-guide-frame') && oldNode.getAttribute('data-native-guide-frame') !== nextNode.getAttribute('data-native-guide-frame'))))) {
      oldNode.replaceWith(nextNode.cloneNode(true));
      return;
    }
    if (oldNode.nodeType === Node.TEXT_NODE || oldNode.nodeType === Node.COMMENT_NODE) {
      if (oldNode.nodeValue !== nextNode.nodeValue) oldNode.nodeValue = nextNode.nodeValue;
      return;
    }
    if (oldNode.nodeType !== Node.ELEMENT_NODE || oldNode.isEqualNode(nextNode)) return;
    const active = document.activeElement === oldNode;
    for (const attr of Array.from(oldNode.attributes)) {
      if (!nextNode.hasAttribute(attr.name)) oldNode.removeAttribute(attr.name);
    }
    for (const attr of Array.from(nextNode.attributes)) {
      // Never clobber the active input's contents during an IPC update.
      if (active && (attr.name === 'value' || attr.name === 'checked')) continue;
      if (oldNode.getAttribute(attr.name) !== attr.value) oldNode.setAttribute(attr.name, attr.value);
    }
    if (oldNode.id === 'toast-host') return; // transient announcements own their lifecycle
    if (oldNode.id === 'page-view' && lastRenderedPage !== renderPage) {
      oldNode.replaceWith(nextNode.cloneNode(true));
      return;
    }
    let child = oldNode.firstChild, target = nextNode.firstChild;
    while (target) {
      const nextTarget = target.nextSibling;
      if (child) {
        const nextChild = child.nextSibling;
        patchNode(child, target);
        child = nextChild;
      } else oldNode.appendChild(target.cloneNode(true));
      target = nextTarget;
    }
    while (child) {
      const nextChild = child.nextSibling;
      child.remove();
      child = nextChild;
    }
  }
  let renderPage = 'home';
  function patch(host, html, page) {
    renderPage = page;
    const t = document.createElement('template');
    t.innerHTML = html;
    const candidate = t.content.firstElementChild;
    if (!candidate) return;
    if (!host.firstElementChild) host.appendChild(candidate);
    else patchNode(host.firstElementChild, candidate);
    lastRenderedPage = page;
    lastRenderedRevision++;
  }
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
      process.on('close',()=>{bridge=null;lastSnapshotKey=null;if(!window.YMFXUpdates?.isInstalling()){model={...empty,connection_state:'attention'};latestError='Desktop engine stopped. Reopen the application to restart it.';}rejectPending();refreshView();});
      bridge.child=await process.spawn();
      await refreshSnapshot();
    }catch(err){bridge=null;lastSnapshotKey=null;model={...empty,connection_state:'attention'};latestError='Unable to start the local connector service.';refreshView();}
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
    try{
      const response=await request('snapshot');
      if(response?.source!=='local-connector'||response.demo!==false)throw new Error('Unverified source');
      const key=JSON.stringify(response);
      const changed=key!==lastSnapshotKey || latestError!=='';
      model=response;
      lastSnapshotKey=key;
      latestError='';
      if(!selected||!model.sessions.some(x=>x.id===selected))selected=model.sessions[0]?.id||null;
      // Identical polls MUST NOT rerender the interface or restart motion.
      if(changed){refreshView();window.YMFXUpdates?.onSnapshot();}
    }
    catch(err){
      if(latestError!=='Could not refresh the connector status.'){
        latestError='Could not refresh the connector status.';
        refreshView();
      }
    }
    finally{refreshInFlight=false;}
  }
  function refreshView(){
    if(!screen)return;
    screen.state.scenario=model.connection_state==='connected'?'connected':model.connection_state==='recovering'?'recovering':'offline';
    screen.render();
  }
  function statusLabel(){
    if(!model.paired)return 'Not paired';
    if(model.connection_state==='connected'){
       const count=model.sessions.filter(x=>x.status==='monitoring').length;
       return count?count+' of '+model.sessions.length+' MT5 account(s) monitoring':'PC connected · no confirmed account capture';
     }
    if(model.connection_state==='recovering')return 'Checking connection and broker history';
    if(model.connection_state==='stopping')return 'Stopping capture safely';
    if(model.connection_state==='attention')return 'Connection needs attention';
    return 'Monitoring is stopped';
  }
  const statusTone=()=>model.connection_state==='connected'?(model.sessions.some(x=>x.status==='monitoring')?'online':'working'):model.connection_state==='recovering'||model.connection_state==='stopping'?'working':model.connection_state==='attention'?'danger':'';
  const badge=(value,tone='')=>`<span class="native-status ${tone}">${safe(value)}</span>`;
  function intro(title,detail){return `<div class="page-intro"><div class="crumb">YOUNGMONEY3 <span class="slash">/</span><span class="current">${safe(title.toUpperCase())}</span></div><h1>${safe(title)}</h1><p class="native-subtitle">${safe(detail)}</p></div>`}
  function action(label,method,primary=false,disabled=false){return `<button type="button" class="btn ${primary?'red':''}" data-native-action="${safe(method)}" ${disabled||commandBusy?'disabled':''}><span>${safe(label)}</span></button>`}
  function showNotice(message){actionNotice=String(message||'').slice(0,160);refreshView();}
  const statusMap={
    'monitoring':['Monitoring','online'],'stale':['Waiting for fresh scan','working'],'recovering':['Reconnecting','working'],
    'needs-attention':['Needs attention','danger'],'terminal-missing':['MT5 missing','danger'],
    'paused':['Paused',''],'paused-by-dashboard':['Paused remotely','working'],
    'offline':['Offline',''],'not-verified':['Awaiting capture','']};
  const sessionStatus=x=>statusMap[x.status]||['Not verified',''];
  function sessionNextStep(s){
     if(!model.paired)return 'Pair this computer with your YoungMoney3 dashboard.';
     if(!s.terminal_present)return 'Open the saved MT5 terminal and verify the broker login.';
     if(!s.verified_link)return 'Scan this PC from the dashboard and select the matching broker account.';
     if(!s.enabled)return 'This session is paused. Resume it only when you want capture.';
     if(!model.capture_active)return 'Start monitoring and wait for confirmed broker capture.';
     if(s.status==='recovering')return 'Keep MT5 logged in and inspect broker-history recovery on the dashboard.';
     if(s.status==='stale')return 'Capture evidence is older than two minutes. Check Recent Activity, MT5 connectivity and the next completed scan.';
     if(s.status==='needs-attention'||s.status==='terminal-missing')return 'Review Recent Activity and correct the MT5 terminal issue.';
     if(s.status==='monitoring')return 'Review the latest broker records and any unresolved integrity checks.';
     return 'Check the selected broker login and wait for a completed capture cycle.';
   }
   function editableSession(s){
    if(!editingSession)return '';
    return `<div class="native-edit-box"><label class="native-field-label" for="native-session-name">Session display name</label><input id="native-session-name" class="native-text-input" maxlength="48" value="${safe(s.name)}" aria-label="Session display name"><div class="native-inline-actions">${action('Save new name','save-session-name',true)}${action('Cancel','cancel-session-name')}</div></div>`;
  }
  function removalPrompt(){
    if(!removingSession)return '';
    return `<div class="native-edit-box native-danger-zone"><strong>Remove local session shortcut?</strong><p>This removes a saved local session entry only. It does NOT erase broker records, uploaded journal evidence or Windows credentials. Monitoring must be stopped first.</p><label class="native-field-label" for="native-remove-confirm">Type REMOVE to confirm</label><input class="native-text-input" id="native-remove-confirm" autocomplete="off" placeholder="REMOVE"><div class="native-inline-actions">${action('Remove local session','remove-session-confirmed',false,model.capture_active)}${action('Cancel','cancel-session-removal')}</div></div>`;
  }

  function cardHead(name,icon,detail=''){return `<div class="native-card-head"><h2>${screen.icon(icon)} ${safe(name)}</h2>${detail}</div>`}
  function infoRow(label,value){return `<div class="native-info-row"><span>${safe(label)}</span><strong>${safe(value||'Not verified')}</strong></div>`}
  function card(children,cls=''){return `<section class="native-card ${cls}">${children}</section>`}
  function viewHome(){
    const count=model.sessions.length,known=model.sessions.filter(x=>!!x.login&&!!x.server).length,mon=model.sessions.filter(x=>x.status==='monitoring').length;
    const paired=model.paired,working=model.capture_active;
    const stage=paired?(working?'Running':'Ready'):'Setup required';
    return intro('Trading Operations Hub','Manage local MT5 account access. Device and PC management live in your YoungMoney3 dashboard.')+
      `<div class="native-shell-grid">${card(`${cardHead('Connection overview','link',badge(stage,statusTone()))}<div class="native-health"><div class="native-health-copy"><div class="native-overline">CURRENT LOCAL STATE · VERIFIED</div><h2>${safe(statusLabel())}</h2><p>${paired?working?'The capture worker is active. Connection health is determined by confirmed connector events.':'Saved PC pairing is available. Start monitoring when you are ready.':'Connect this computer to YoungMoney3 to begin monitoring broker accounts.'}</p><div class="native-step-row"><span class="${paired?'is-ready':'is-unverified'}">${screen.icon(paired?'check':'lock')} PC pairing ${paired?'saved':'required'}</span><span class="${known?'is-ready':'is-unverified'}">${screen.icon(known?'check':'minus')} MT5 accounts ${known?'identified':'unverified'}</span><span class="is-unverified">${screen.icon('lock')} Copying separately authorized</span></div></div><div class="native-overview-art">${screen.media('connection')}</div></div>`)}
       ${card(`${cardHead('Quick actions','power')}<div class="native-action-row">${action('Add MT5 account','prepare-account-setup',true)}${action('My Accounts','accounts')}${paired?action(working?'Stop monitoring safely':'Start monitoring','toggle-capture'):action('Connect this PC','pair',true)}${action('Open YoungMoney3 dashboard','open_dashboard')}</div>`)}</div>
       <div class="native-kpi">${[
         ['Saved MT5 sessions',String(count),'Locally configured sessions'],
         ['Identified broker accounts',String(known),'From confirmed connector events'],
         ['Currently monitoring',String(mon),'Broker-linked sessions observed'],
         ['Pending journal uploads',model.queued_updates==null?'Not yet checked':String(model.queued_updates),'Actual local upload queue']
       ].map(([label,value,sub])=>card(`<div class="native-stat"><div class="native-overline">${label}</div><strong>${safe(value)}</strong><small>${safe(sub)}</small></div>`)).join('')}</div>
       <div class="native-operations">${card(cardHead('Selected trading account','accounts')+`<div class="native-pad">${infoRow('MT5 account',selectedAccount()?.login?`${selectedAccount().login} · ${selectedAccount().server}`:'No verified login yet')}${infoRow('Local profile',selectedAccount()?.name||'Add an account')}${infoRow('Broker capture',selectedAccount()?sessionStatus(selectedAccount())[0]:'Not started')}${infoRow('Copying','Requires separate authorization')}${action('Manage this account','accounts')}</div>`)}
       ${card(cardHead('Recent activity','clock')+activityRows(4))}</div>
       ${window.YMFXUpdates?.panel(screen.icon) || ''}`;
  }
  function activityRows(limit=30){
    const all=model.events.slice(-limit).reverse();
    const rows=activityFilter==='all'?all:all.filter(ev=>
      activityFilter==='attention'?/error|revoked|conflict|retry|reconnecting|setup-error/.test(ev.kind):
      activityFilter==='capture'?/session|running|queued|sync|capture|preparing/.test(ev.kind):
      /pc-|pair|control|monitoring-policy/.test(ev.kind));
    return rows.length?`<div class="native-rows">${rows.map(ev=>`<div class="native-event"><div><b>${safe(ev.message)}</b><small>${safe(ev.kind)}</small></div><small>${safe(ev.time?.replace('T',' ').replace('+00:00',' UTC'))}</small></div>`).join('')}</div>`:
      `<div class="native-pad"><p>No ${activityFilter==='all'?'connector':'matching'} events. This list describes service activity, not individual broker fills or trades.</p></div>`;
  }

  function selectedAccount(){return model.sessions.find(x=>x.id===selected)||null}
  function setupPanel(){
    const setup=model.setup||{status:'idle'};
    if(!addingAccount&&setup.status==='idle')return '';
    const options=terminals.map(t=>`<option value="${safe(t.id)}">${safe(t.name)}</option>`).join('');
    const active=['preparing','awaiting-login','needs-open'].includes(setup.status);
    return card(cardHead('Add a dedicated MT5 account','accounts',badge(setup.status==='error'?'Needs attention':active?'In progress':'Setup',''))+
      `<div class="native-pad native-setup-flow"><p>Each account gets a private MetaTrader 5 terminal. Log in directly in MT5. No broker password is entered or saved by Signal Desk.</p>`+
      `<div class="native-inline-actions">${action('Find MT5 installations','scan_terminals')}${action('Close setup','cancel-add-account')}</div>`+
      `${terminals.length?`<label class="native-field-label" for="native-source-id">Installed MT5 program</label><select class="native-text-input" id="native-source-id">${options}</select><label class="native-field-label" for="native-account-label">Local account label (can change later)</label><input class="native-text-input" id="native-account-label" maxlength="48" value="New MT5 account" autocomplete="off"><div class="native-inline-actions">${action('Create and open MT5 login','add_account',true,setup.status==='preparing')}</div>`:
      `<p>No MT5 installation discovered yet. Install MT5 on this Windows PC, then choose Find MT5 installations.</p>`}`+
      `${active||setup.status==='error'?`<div class="native-help-bubble" role="status">${safe(setup.message||'Preparing account setup.')}${setup.session_id?`<div class="native-inline-actions">${action('Open its MT5 login window','open-setup-terminal')}</div>`:''}</div>`:''}`+
      `<div class="native-help-bubble">A new profile starts with monitoring OFF. After signing in, return to the authenticated dashboard to choose which accounts to monitor or include in copying. No orders are enabled here.</div></div>`, 'native-account-setup');
  }
  function viewAccounts(){
    const s=selectedAccount();
    const canRetry=!!(s && s.verified_link && s.terminal_present && s.enabled && model.capture_active);
    return intro('My Accounts','Open dedicated MT5 logins here; select monitoring and copying permissions from the dashboard.')+setupPanel()+
      `<div class="native-split">${card(cardHead('Saved terminal sessions','accounts',badge(`${model.sessions.length} configured`))+`<div class="native-rows">${model.sessions.length?model.sessions.map(x=>{
        const [state,tone]=sessionStatus(x);
        return `<div class="native-account ${x.id===selected?'native-selected-account':''}"><div><button type="button" data-native-select="${safe(x.id)}" aria-pressed="${x.id===selected}">${safe(x.account_name||x.name)}</button><small>${safe([x.server,x.login?'#'+x.login:'Broker login not verified'].filter(Boolean).join(' · '))}</small></div>${badge(state,tone)}</div>`;
      }).join(''):`<div class="native-pad"><p>No local MT5 account sessions. Choose Add account to open a dedicated terminal login.</p></div>`}</div><div class="native-pad">${action('Add an MT5 account','prepare-account-setup',true)}</div>`)}
       ${card(cardHead('Account inspector','shield-check')+`<div class="native-pad native-inspector">${s?`<div class="native-inspector-heading"><h2>${safe(s.account_name||s.name)}</h2>${badge(sessionStatus(s)[0],sessionStatus(s)[1])}</div>${infoRow('Local session',s.name)}${infoRow('Broker server',s.server)}${infoRow('Account login',s.login)}${infoRow('Session',s.enabled?'Enabled':'Paused')}${infoRow('MT5 terminal',s.terminal_present?'Found':'Missing')}${infoRow('Verified broker link',s.verified_link?'Yes':'Not verified')}${infoRow('Capture evidence',sessionStatus(s)[0])}${infoRow('Last completed scan',s.last_sync?s.last_sync.replace('T',' ').replace('+00:00',' UTC'):'No confirmed scan yet')}${infoRow('Copy authorization','Not verified by this shell')}${infoRow('Recommended next action',sessionNextStep(s))}<div class="native-inline-actions">${s.verified_link?action(s.enabled?'Pause this session':'Resume this session',s.enabled?'pause-session':'resume-session',!s.enabled):'<span class="native-not-yet-linked">Select this MT5 account for monitoring on the dashboard.</span>'}${action('Recheck broker history','retry-session',false,!canRetry)}${action('Rename session','edit-session-name')}</div><div class="native-inline-actions">${action('Open MT5 login','open_account_terminal')}${action('Manage on dashboard','open_dashboard')}${action('Remove local shortcut','remove-session',false,model.capture_active)}</div>${editableSession(s)}${removalPrompt()}`:`<p>Select a saved MT5 session to inspect its verified broker and capture information.</p>`}<div class="native-help-bubble">Recovery and integrity: the existing MT5 engine reconciles broker history after disconnections. A successful PC connection does not prove individual trade capture. Use the recommended next action above, and verify the last completed broker scan. Broker fills, original stops and risk evidence are not editable here.</div></div>`)}</div>`;
  }

  function viewCopy(){
    return intro('Trade Copying','Inspect the higher-risk copying workflow separately from read-only monitoring.')+
      `<div class="native-shell-grid">${card(`${cardHead('Copy Fleet safety','shield-check',badge('Not armed','danger'))}<div class="native-health"><div class="native-health-copy"><div class="native-overline">ACCOUNT-BOUND LOCAL APPROVAL REQUIRED</div><h2>Execution remains protected</h2><p>The new desktop interface has not yet implemented verified follower consent or fleet arming. No order submission is available here.</p><div class="native-step-row"><span class="is-unverified">${screen.icon('lock')} Followers must be authorized per account</span><span class="is-unverified">${screen.icon('lock')} Broker mode and risk must be checked</span></div></div><div class="native-overview-art">${screen.media('copy')}</div></div>`)}
       ${card(cardHead('Controls','layers')+`<div class="native-action-row">${action('Open Copy Studio','open_copy_studio',true)}${action('Review account sessions','accounts')}<p>Copying steps: select source and followers on the Dashboard; configure allocation and risk; review the non-executing preview; obtain separate local consent in the established connector; arm only after every prerequisite is verified. Signal Desk cannot grant consent or arm fleets yet. Arming can route future signals but does not immediately place an order. Emergency pause cannot undo orders already dispatched.</p></div>`)}</div>
       <div class="native-kpi">${[['Fleet authorization','Not available in this shell'],['Execution authority','None in new shell'],['Risk basis','Broker-verified'],['Order transmission','Disabled']].map(([l,v])=>card(`<div class="native-stat"><div class="native-overline">${safe(l)}</div><strong style="font-size:19px">${safe(v)}</strong></div>`)).join('')}</div>`;
  }
  function viewPair(){
    return intro('Connect this PC','Pair securely, then manage your device name and linked accounts from the dashboard.')+
      `<div class="native-shell-grid">${card(cardHead('Secure pairing','link',badge(model.paired?'Paired':'Not paired',model.paired?'online':''))+`<div class="native-pad"><div class="native-overview-art" style="width:100%;max-width:580px;min-height:180px">${screen.media('pair')}</div><p>The one-time code is checked by the existing Python connector and is never written into browser preferences, screenshots or activity logs.</p><div class="native-inline-actions">${action('Open pairing page','open_dashboard',true)}</div><label class="field" style="margin-top:17px;max-width:500px"><span>32-character pairing code</span><input class="native-text-input" id="native-pair-code" type="password" inputmode="text" autocomplete="off" spellcheck="false" maxlength="32" placeholder="Paste your code from YoungMoney3" ${model.paired?'disabled':''}></label><div class="native-inline-actions">${action('Pair this computer','pair_pc',!model.paired)}${action('Scan local MT5 terminals','scan_terminals')}</div><div class="native-help-bubble">Pairing requires a valid short-lived code. It is not a trade-copying authorization.</div></div>`)}
       ${card(cardHead('Local workstation','computer')+`<div class="native-pad">${infoRow('Account setup','Manage PC identity from your dashboard')}${infoRow('Pairing',model.paired?'Confirmed locally':'Not yet paired')}${infoRow('Capture service',model.capture_active?'Running':'Stopped')}${infoRow('Discovered terminals',terminals.length?String(terminals.length):'Not scanned')}<div style="margin-top:16px">${terminals.map(x=>`<div class="native-info-row"><span>Installation</span><strong>${safe(x.name)}</strong></div>`).join('')}</div></div>`)}</div>`;
  }
  function viewActivity(){
    return intro('Recent Activity','Audited connector events, per-account reconciliation, errors and recovery diagnostics.')+
      card(cardHead('Local connection and capture events','activity',badge('Verified source'))+`<div class="native-filter-row" role="group" aria-label="Filter connector activity">${[['all','All events'],['attention','Needs attention'],['capture','Capture'],['device','PC & permissions']].map(([id,label])=>`<button type="button" class="native-filter-btn ${activityFilter===id?'active':''}" data-native-filter="${id}" aria-pressed="${activityFilter===id}">${label}</button>`).join('')}</div>`+activityRows(100))+
      `<div class="native-help-bubble">Logs contain sanitized operational events only. They are not proof of individual order execution or broker fills. For trade evidence, use the journal's immutable broker records.</div>`;
  }

  function viewHelp(){return window.YMFXNativeGuide?.render({intro,action,safe,screen,model}) || intro('Help & Guides','Guidance for the redesigned native desktop connector.')+
     `<div class="native-operations">${card(cardHead('Getting started','help')+`<div class="native-pad"><p>1. Pair the Windows computer with the code from YoungMoney3.</p><p>2. Choose Add Account here, select an installed MT5 program and log in inside the private terminal window.</p><p>3. On your dashboard, scan paired devices and choose which verified accounts to monitor.</p><p>4. Start read-only monitoring only after the dashboard confirms the exact broker login.</p><p>5. Review any reconciliation issues before trusting journal metrics.</p></div>`)}${card(cardHead('Copying safely','shield-check')+`<div class="native-pad"><p>Trade copying is separate from monitoring. Followers require verified account identity, risk settings and explicit local approval. The new interface cannot arm or execute trades.</p><div class="native-inline-actions">${action('Open Copy Studio','open_copy_studio')}</div></div>`)}</div>`}
  function nativeSidebar(){return `<aside class="sidebar"><div class="brand-box"><img src="assets/ymfx-brand.svg" alt="YoungMoney3"><div class="brand-label"><strong>YOUNGMONEY3</strong><span>MT5 CONNECTOR</span></div></div><div class="brand-caption">Your trading companion.</div><nav class="side-nav" aria-label="Connector sections">${screen.NAV.map(([id,label,ic])=>`<button type="button" data-page="${id}" class="${screen.state.page===id?'active':''}" aria-current="${screen.state.page===id?'page':'false'}">${screen.icon(ic)}<span class="nav-label">${label}</span></button>`).join('')}</nav><div class="side-bottom"><div class="side-overline">PAIRED YOUNGMONEY3 USERNAME</div><div class="side-workspace">${safe(model.user?'@'+model.user:'Pair to identify user')}</div><div class="side-overline" style="margin-top:12px">CONNECTED BROKER LOGINS</div><div class="side-workspace">${safe(model.sessions.filter(x=>x.verified_link).length+' verified / '+model.sessions.length+' saved')}</div><div class="side-overline" style="margin-top:12px">TRADING ACCOUNT</div><div class="side-workspace">${safe(selectedAccount()?.login?`${selectedAccount().account_name||selectedAccount().name} · ${selectedAccount().login}`:'No broker login verified')}</div><div class="side-version">Staging · Native Desktop<br>Read-only monitoring / Copying separate</div></div></aside>`}
  function nativeTopbar(){return `<div class="topbar"><div class="toolbar-left"><strong style="font-size:13px">MT5 Connections</strong>${badge(model.paired?statusLabel():'Pairing required',statusTone())}${model.user?'<span class="native-user-chip" title="Your paired dashboard username">@'+safe(model.user)+'</span>':''}</div><div class="toolbar-right" style="font-size:12px;color:#67717d">${window.YMFXUpdates?.topbar() || ''}<span>Copying requires approval</span></div></div>`}
  function nativeStatusbar(){return `<div class="system-bar" role="status" aria-live="polite"><div style="display:flex;gap:10px;align-items:center">${badge(statusLabel(),statusTone())}<span>${safe(selectedAccount()?.login?`Account ${selectedAccount().login}`:'No linked MT5 login')}</span></div><div>${actionNotice?safe(actionNotice):latestError?`<span style="color:#bf1232">${safe(latestError)}</span>`:'Engine status from verified local connector'} · Copy execution unavailable in this shell</div></div>`;}
  async function nativeCommand(name){
    if(['home','accounts','copy','pair','activity','help'].includes(name)){
      screen.navigate(name);return;
    }
    if(name==='prepare-account-setup'){addingAccount=true;screen.navigate('accounts');if(!terminals.length)await nativeCommand('scan_terminals');else refreshView();return;}
    if(name==='cancel-add-account'){addingAccount=false;refreshView();return;}
    if(name==='edit-session-name'){editingSession=true;removingSession=false;refreshView();document.getElementById('native-session-name')?.focus();return;}
    if(name==='remove-session'){removingSession=true;editingSession=false;refreshView();document.getElementById('native-remove-confirm')?.focus();return;}
    if(name==='cancel-session-name'){editingSession=false;refreshView();return;}
    if(name==='cancel-session-removal'){removingSession=false;refreshView();return;}
    if(commandBusy)return;
    if(name==='toggle-capture')name=model.capture_active?'stop_monitoring':'start_monitoring';
    const account=selectedAccount();
    let method=name, params={};
    if(name==='pair_pc'){
      const input=document.getElementById('native-pair-code');
      const code=(input?.value||'').trim();
      if(!/^[a-f0-9]{32}$/i.test(code)){showNotice('Paste the full 32-character pairing code from your authenticated YoungMoney3 dashboard.');return;}
      if(input)input.value='';
      params={code};
    } else if(name==='add_account'){
      const source_id=document.getElementById('native-source-id')?.value;
      const label=document.getElementById('native-account-label')?.value.trim();
      if(!source_id||!label){showNotice('Choose an installed MT5 program and enter an account label.');return;}
      params={source_id,name:label};
    } else if(name==='open-setup-terminal'){
      const id=model.setup?.session_id;
      if(!id){showNotice('The account terminal is not ready yet.');return;}
      method='open_account_terminal';params={id};
    } else if(name==='open_account_terminal'){
      if(!account)return;params={id:account.id};
    } else if(name==='pause-session'||name==='resume-session'){
      if(!account)return;
      method='set_session_enabled';params={id:account.id,enabled:name==='resume-session'};
    } else if(name==='retry-session'){
      if(!account||!account.verified_link||!model.capture_active){showNotice('Start monitoring and verify the account before requesting a recheck.');return;}
      method='retry_session';params={id:account.id};
    } else if(name==='save-session-name'){
      if(!account)return;
      const newName=document.getElementById('native-session-name')?.value.trim()||'';
      if(newName.length<2||newName.length>48){showNotice('Enter a session name between 2 and 48 characters.');return;}
      method='rename_session';params={id:account.id,name:newName};
    } else if(name==='remove-session-confirmed'){
      if(!account)return;
      if(document.getElementById('native-remove-confirm')?.value!=='REMOVE'){
        showNotice('Type REMOVE to confirm. Your broker history and Windows credentials will be retained.');return;
      }
      method='remove_session';params={id:account.id,confirm:'REMOVE'};
    }
    commandBusy=true;
    showNotice('Working on your request…');
    try{
      const data=await request(method,params);
      if(method==='scan_terminals')terminals=Array.isArray(data.terminals)?data.terminals:[];
      if(method==='rename_session'){editingSession=false;actionNotice='Session name saved locally.';}
      else if(method==='remove_session'){removingSession=false;selected=null;actionNotice='Local shortcut removed. Broker records are preserved.';}
      else if(method==='retry_session'){actionNotice='Broker history recheck queued. Confirmation appears after the next verified capture cycle.';}
      else if(method==='set_session_enabled'){actionNotice='Monitoring preference saved for this account.';}
      else if(method==='pair_pc'){actionNotice='Pairing request submitted. Waiting for the local engine to verify it.';}
      else if(method==='stop_monitoring'){actionNotice='Safe stop requested. Broker evidence and queued uploads are retained.';}
      else if(method==='start_monitoring'){actionNotice='Monitoring requested. Awaiting confirmed broker capture.';}
      else if(method==='scan_terminals'){actionNotice=`Found ${terminals.length} local MT5 installation(s).`;}
      else if(method==='open_dashboard'||method==='open_copy_studio'){actionNotice=data.opened?'Opened in your browser.':'Could not open the external page.';}
      else actionNotice='Request accepted by the local engine.';
      commandBusy=false;
      // `request` replies are acknowledgments, not proof of broker success.
      // Fresh evidence is independently returned by the following snapshot.
      await refreshSnapshot();
      refreshView();
    } catch(err){
      commandBusy=false;
      latestError=String(err?.message||'Local operation failed').slice(0,110);
      actionNotice='Action unsuccessful. '+latestError;
      refreshView();
    }
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
      if(window.YMFXNativeGuide?.handleClick(evt,{screen,refreshView,nativeCommand})){evt.stopImmediatePropagation();evt.preventDefault();return;}
      if(window.YMFXUpdates?.handleClick(evt)){evt.stopImmediatePropagation();evt.preventDefault();return;}
      const action=evt.target.closest('[data-native-action]');
      if(action){evt.stopImmediatePropagation();evt.preventDefault();nativeCommand(action.dataset.nativeAction);return;}
      const row=evt.target.closest('[data-native-select]');
      if(row){evt.stopImmediatePropagation();evt.preventDefault();selected=row.dataset.nativeSelect;editingSession=false;removingSession=false;refreshView();return;}
      const filter=evt.target.closest('[data-native-filter]');
      if(filter){evt.stopImmediatePropagation();evt.preventDefault();activityFilter=filter.dataset.nativeFilter;refreshView();return;}
    },true);
    document.addEventListener('input',evt=>{window.YMFXNativeGuide?.handleInput(evt,refreshView);},true);
    window.addEventListener('beforeunload',()=>{if(bridge?.child)bridge.child.write(JSON.stringify({id:++seq,method:'shutdown'})+'\n').catch(()=>{});});
    // Do not poll a hidden/minimized desktop window; resume on activation.
    // A visible window polls at a steady cadence, but only changed evidence is painted.
    document.addEventListener('visibilitychange',()=>{
      windowVisible=!document.hidden;
      if(windowVisible)refreshSnapshot();
    });
    framePoll=setInterval(()=>{if(windowVisible)refreshSnapshot()},3500);
    window.YMFXUpdates?.attach({
      refreshView, getModel:()=>model, request, hasBridge:()=>!!bridge?.child,
      isBusy:()=>commandBusy,
      waitForBridgeStop:async(timeoutMs=15000)=>{
        const until=Date.now()+timeoutMs;
        while(bridge?.child && Date.now()<until){
          await new Promise(resolve=>setTimeout(resolve,200));
        }
        if(bridge?.child)throw new Error('Desktop engine did not stop');
      }
    });
    boot();
  }
  window.YMFXNative={install,isNative,nativeSidebar,nativeTopbar,nativeStatusbar,patch,debug:()=>({domRevision:lastRenderedRevision,modelKey:lastSnapshotKey,renderedPage:lastRenderedPage})};
})();