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
  const button=event.currentTarget.querySelector('button');
  button.disabled=true;
  const status=byId('status');
  try {
    const device=(await api('status',{})).devices.find(d=>d.id===location.hash.slice(1));
    if (!device || Date.now()-device.last_seen>90000) throw Error('PC offline. Open the connector on your PC.');
    const pub=await crypto.subtle.importKey('spki',Uint8Array.from(atob(device.public_key),c=>c.charCodeAt(0)),{name:'RSA-OAEP',hash:'SHA-256'},false,['wrapKey']);
    const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt']);
    const iv=crypto.getRandomValues(new Uint8Array(12));
    const bytes=new TextEncoder().encode(JSON.stringify({login:byId('login').value,server:byId('server-choice').value || byId('server').value.trim(),password:byId('password').value}));
    byId('password').value='';
    const data=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,bytes);
    bytes.fill(0);
    const wrapped=await crypto.subtle.wrapKey('raw',key,pub,'RSA-OAEP');
    const result=await api('connect',{device:device.id,account:byId('account').value,envelope:{iv:base64(iv),data:base64(data),wrapped:base64(wrapped)}});
    status.textContent='Waiting for your PC to verify the account…';
    for (let attempt=0;attempt<24;attempt++) {
      await new Promise(resolve=>setTimeout(resolve,4000));
      const link=(await api('status',{})).links.find(l=>l.id===result.id);
      if(link?.status==='connected'){status.textContent='Connected to '+link.company+' · '+link.login+'. View sync status in MT5 Connections.'; return;}
      if(link && ['failed','expired','revoked'].includes(link.status)) throw Error(link.last_error || 'Login expired. Retry with the connector online.');
    }
    throw Error('Verification timed out. Check MT5 Connections for the latest result.');
  } catch(e){status.textContent=e.message;} finally{button.disabled=false;}
});
