if (window.parent !== window && window.parent.location.origin === location.origin) {
  document.body.classList.add('embedded');
  const theme = getComputedStyle(window.parent.document.documentElement);
  for (const key of ['--bg-card','--bg-secondary','--text-primary','--text-secondary','--border','--brand']) {
    document.documentElement.style.setProperty(key, theme.getPropertyValue(key));
  }
  document.documentElement.style.colorScheme = window.parent.document.documentElement.classList.contains('dark') ? 'dark' : 'light';
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape') window.frameElement?.closest('dialog')?.close();
  });
}
const byId = id => document.getElementById(id);
byId('view-accounts').addEventListener('click',()=>{
  const dialog=window.frameElement?.closest('dialog');
  if(dialog) dialog.close(); else location.assign('/#mt5');
});
const base64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const api = async (action, data) => {
  const result = await fetch('/api/mt5/'+action,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});
  const value = await result.json();
  if (!result.ok) throw Error(value.error || 'Connection failed.');
  return value;
};
api('status',{}).then(result=>{populateMt5Brokers(result);for(const account of result.accounts) byId('account').add(new Option(account.name,account.id));}).catch(()=>{byId('status').textContent='Sign in to your dashboard to link an account.';});
document.querySelector('form').addEventListener('submit',async event=>{
  event.preventDefault();
  const button=event.currentTarget.querySelector('button[type=submit]');
  button.disabled=true;
  const status=byId('status');
  try {
    const device=(await api('status',{})).devices.find(d=>d.id===location.hash.slice(1));
    if (!device || Date.now()-device.last_seen>90000) throw Error('PC offline. Open the connector on your PC.');
    const pub=await crypto.subtle.importKey('spki',Uint8Array.from(atob(device.public_key),c=>c.charCodeAt(0)),{name:'RSA-OAEP',hash:'SHA-256'},false,['wrapKey']);
    const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt']);
    const iv=crypto.getRandomValues(new Uint8Array(12));
    const server=byId('server-choice').value || byId('server').value.trim();
    const bytes=new TextEncoder().encode(JSON.stringify({login:byId('login').value,server,password:byId('password').value}));
    byId('password').value='';
    const data=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,bytes);
    bytes.fill(0);
    const wrapped=await crypto.subtle.wrapKey('raw',key,pub,'RSA-OAEP');
    const result=await api('connect',{device:device.id,account:byId('account').value,server,envelope:{iv:base64(iv),data:base64(data),wrapped:base64(wrapped)}});
    document.querySelector('form').hidden=true;
    byId('view-accounts').hidden=false;
    status.textContent='Your PC is preparing MetaTrader. You can follow this request in your account list.';
    const deadline=Date.now()+8*60*1000;
    while(Date.now()<deadline) {
      await new Promise(resolve=>setTimeout(resolve,3000));
      let snapshot;
      try { snapshot=await api('status',{}); }
      catch { status.textContent='Checking the dashboard connection. Your request has already been submitted.'; continue; }
      const link=snapshot.links.find(l=>l.id===result.id);
      if(!link) continue;
      if(link.status==='connected') {
        status.textContent=link.last_sync?'Monitoring '+link.company+' · '+link.login+'. Your first sync was received.':
          'Broker login verified for '+link.company+' · '+link.login+'. Waiting for the first journal sync.';
        if(link.last_sync) return;
      } else if(['failed','expired','revoked'].includes(link.status) || link.expires<=Date.now()) {
        document.querySelector('form').hidden=false;
        throw Error(link.last_error || 'This login request expired. Check the connector, then try again.');
      } else {
        status.textContent=link.status==='verifying'?'Your broker is checking the login details.':'Your PC is preparing MetaTrader for this login.';
      }
    }
    status.textContent='Open your account list for the latest status.';
  } catch(e){status.textContent=e.message;} finally{button.disabled=false;}
});
