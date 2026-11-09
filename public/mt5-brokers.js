// Published terminal names. Each entity can have additional regional or account-specific servers.
// https://help.oanda.com/bvi/en/faqs/mt5-user-guide-bvi.htm
// https://blog.deriv.com/blog/your-guide-to-deriv-mt5-the-world-famous-cfd-trading-platform
// https://community.deriv.com/t/deriv-mt5-login-error-authorization-failed-invalid-account-error-message/50035
// https://www.mql5.com/en/docs/python_metatrader5/mt5login_py
const mt5Directory = [
  {broker:'Deriv', demo:['Deriv-Demo'], live:['DerivBVI-Server','DerivBVI-Server-02','DerivBVI-Server-03']},
  {broker:'OANDA Global Markets Limited',demo:['OANDA_Global-Demo-1'],live:['OANDA_Global-Live-1']},
  {broker:'MetaQuotes',demo:['MetaQuotes-Demo'],live:[]}
];
function populateMt5Brokers({links=[],demoOnly=true}) {
  const registry=new Map();
  function add(broker,server) {
    if (!broker || !server) return;
    const key=broker.trim().toLowerCase();
    if (!registry.has(key)) registry.set(key,{name:broker,servers:new Set()});
    registry.get(key).servers.add(server);
  }
  for(const row of mt5Directory) {
    for(const name of (demoOnly ? row.demo : [...row.demo,...row.live])) add(row.broker,name);
  }
  for(const link of links) if(link.status==='connected') add(link.company,link.server);
  const broker=document.getElementById('broker');
  const choices=document.getElementById('server-choice');
  const manual=document.getElementById('manual-server');
  const exact=document.getElementById('server');
  function selectServer() {
    manual.hidden=Boolean(choices.value);
    exact.disabled=manual.hidden;
    exact.required=!manual.hidden;
  }
  document.getElementById('broker-options').replaceChildren(...Array.from(registry.values())
    .sort((a,b)=>a.name.localeCompare(b.name)).map(row=>new Option(row.name,row.name)));
  function selectBroker() {
    const row=registry.get(broker.value.trim().toLowerCase());
    choices.replaceChildren();
    if(row) for(const name of row.servers) choices.add(new Option(name,name));
    choices.add(new Option('Enter server manually',''));
    exact.value='';
    selectServer();
  }
  broker.addEventListener('input',selectBroker);
  choices.addEventListener('change',selectServer);
  selectBroker();
}
