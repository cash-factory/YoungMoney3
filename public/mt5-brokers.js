// An offline convenience directory, NOT MetaTrader's live broker discovery.
// Server names below are suggestions only. The user must select their own exact
// account server (from MT5's File > Open an Account / their broker account page).
// JustMarkets MT5 server examples: https://get.justmarkets.help/hc/zh-cn/articles/14009133872412
const mt5Directory = [
  {broker:'JustMarkets',aliases:['Just Markets','JustMarket','Just Global Markets'],
    demo:['JustMarkets-Demo','JustMarkets-Demo2','Justmarkets-Demo3'],
    live:['JustMarkets-Live','JustMarkets-Live2','Justmarkets-Live3']},
  {broker:'Weltrade',aliases:['Wel Trade'],demo:[],live:[]},
  // Other recognizable broker names enable forgiving discovery, but a server
  // must be obtained from the user's own MT5 terminal or broker account page.
  {broker:'Exness',aliases:[],demo:[],live:[]},
  {broker:'IC Markets',aliases:['ICMarkets','International Capital Markets'],demo:[],live:[]},
  {broker:'Pepperstone',aliases:['Pepper Stone'],demo:[],live:[]},
  {broker:'XM',aliases:['XM Global'],demo:[],live:[]},
  {broker:'HFM',aliases:['HotForex'],demo:[],live:[]},
  {broker:'FBS',aliases:[],demo:[],live:[]},
  {broker:'Eightcap',aliases:['Eight Cap'],demo:[],live:[]},
  {broker:'Tickmill',aliases:['Tick Mill'],demo:[],live:[]},
  {broker:'FundedNext',aliases:['Funded Next'],demo:['FundedNext-Server 3'],live:[]},
  {broker:'Deriv',aliases:[],demo:['Deriv-Demo'],live:['DerivBVI-Server','DerivBVI-Server-02','DerivBVI-Server-03']},
  {broker:'OANDA Global Markets Limited',aliases:['OANDA','Oanda Global'],demo:['OANDA_Global-Demo-1'],live:['OANDA_Global-Live-1']},
  {broker:'MetaQuotes',aliases:['Meta Quotes'],demo:['MetaQuotes-Demo'],live:[]}
];

function normalizeBrokerName(text) {
  return String(text || '').normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase().replace(/[^a-z0-9]/g,'');
}
function brokerEditDistance(a,b) {
  if (Math.abs(a.length-b.length)>2) return 3;
  let previous=Array.from({length:b.length+1},(_,index)=>index);
  for(let i=1;i<=a.length;i++){
    const next=[i];
    for(let j=1;j<=b.length;j++){
      next[j]=Math.min(next[j-1]+1,previous[j]+1,previous[j-1]+(a[i-1]===b[j-1]?0:1));
    }
    previous=next;
  }
  return previous[b.length];
}
function buildBrokerRegistry(links=[],demoOnly=true) {
  const rows=new Map();
  for(const entry of mt5Directory) {
    const key=normalizeBrokerName(entry.broker);
    const servers=new Map();
    for(const name of entry.demo) servers.set(name.toLowerCase(),{name,mode:'Demo',origin:'directory'});
    if(!demoOnly) for(const name of entry.live) servers.set(name.toLowerCase(),{name,mode:'Live',origin:'directory'});
    rows.set(key,{name:entry.broker,aliases:entry.aliases||[],servers});
  }
  for(const link of links) {
    if(link.status!=='connected'||!link.company||!link.server||(demoOnly && link.trade_mode===2)) continue;
    const key=normalizeBrokerName(link.company);
    if(!key) continue;
    if(!rows.has(key)) rows.set(key,{name:link.company,aliases:[],servers:new Map()});
    const row=rows.get(key),serverKey=link.server.toLowerCase();
    row.servers.set(serverKey,{name:link.server,mode:link.trade_mode===0?'Demo':link.trade_mode===1?'Contest':'Account',origin:'linked'});
  }
  return Array.from(rows.values());
}
function getBrokerMatches(query,registry) {
  const needle=normalizeBrokerName(query);
  if(!needle) return registry.slice().sort((a,b)=>a.name.localeCompare(b.name)).slice(0,8);
  const score=row=>{
    const names=[row.name,...row.aliases,...Array.from(row.servers.values(),server=>server.name)];
    let best=99;
    for(const name of names){
      const test=normalizeBrokerName(name);
      if(test===needle)best=Math.min(best,0);
      else if(test.startsWith(needle))best=Math.min(best,1);
      else if(test.includes(needle))best=Math.min(best,2);
      else if(needle.length>=5 && brokerEditDistance(test,needle)<=(needle.length>=8?2:1)) best=Math.min(best,3);
    }
    return best;
  };
  return registry.map(row=>({row,score:score(row)})).filter(item=>item.score<99)
    .sort((a,b)=>a.score-b.score||a.row.name.localeCompare(b.row.name)).slice(0,8).map(item=>item.row);
}
function populateMt5Brokers({links=[],demoOnly=true}) {
  const registry=buildBrokerRegistry(links,demoOnly);
  const broker=document.getElementById('broker');
  const suggestions=document.getElementById('broker-results');
  const choices=document.getElementById('server-choice');
  const manual=document.getElementById('manual-server');
  const exact=document.getElementById('server');
  const help=document.getElementById('broker-help');
  let currentMatches=[],active=-1;
  function hideSuggestions(){
    suggestions.hidden=true;
    suggestions.replaceChildren();
    broker.setAttribute('aria-expanded','false');
    active=-1;
  }
  function selectServer() {
    const selected=Boolean(choices.value);
    manual.hidden=selected;
    exact.disabled=selected;
    exact.required=!selected;
  }
  function matchingBroker(){
    const normalized=normalizeBrokerName(broker.value);
    return registry.find(row=>[row.name,...row.aliases].some(name=>normalizeBrokerName(name)===normalized));
  }
  function updateServerChoices(){
    const row=matchingBroker();
    choices.replaceChildren(new Option('Enter my exact MT5 server',''));
    const serverList=row?Array.from(row.servers.values()).sort((a,b)=>a.name.localeCompare(b.name)):[];
    for(const server of serverList) {
      const label=server.name+' · '+server.mode+(server.origin==='linked'?' (previously linked)':' (suggested)');
      choices.add(new Option(label,server.name));
    }
    choices.closest('label').hidden=serverList.length===0;
    choices.value='';
    exact.value='';
    selectServer();
    if(row) help.textContent='Selected broker: '+row.name+'. Choose the exact server assigned to your account. Suggested server names are not automatically verified.';
    else if(broker.value.trim()) help.textContent='No exact broker selection yet. You can choose a suggestion or enter the exact server shown in MetaTrader 5.';
    else help.textContent='Start typing a broker name. For unlisted brokers, enter the server shown in MetaTrader 5.';
  }
  function chooseBroker(row){
    broker.value=row.name;
    hideSuggestions();
    updateServerChoices();
  }
  function renderSuggestions(){
    currentMatches=getBrokerMatches(broker.value,registry);
    active=-1;
    suggestions.replaceChildren();
    if(!currentMatches.length){hideSuggestions();return;}
    currentMatches.forEach((row,index)=>{
      const item=document.createElement('button');
      item.type='button';
      item.className='broker-option';
      item.setAttribute('role','option');
      item.setAttribute('aria-selected','false');
      const name=document.createElement('span');
      name.textContent=row.name;
      const meta=document.createElement('small');
      meta.textContent=row.servers.size ? row.servers.size+' server suggestion(s)' : 'Find exact server in MT5';
      item.append(name,meta);
      item.addEventListener('click',()=>chooseBroker(row));
      suggestions.append(item);
    });
    suggestions.hidden=false;
    broker.setAttribute('aria-expanded','true');
  }
  function markActive(next){
    const items=Array.from(suggestions.children);
    if(!items.length)return;
    active=(next+items.length)%items.length;
    items.forEach((item,index)=>item.setAttribute('aria-selected',String(index===active)));
    items[active].scrollIntoView({block:'nearest'});
  }
  broker.addEventListener('input',()=>{
    updateServerChoices();
    renderSuggestions();
  });
  broker.addEventListener('focus',renderSuggestions);
  broker.addEventListener('keydown',event=>{
    if(event.key==='Escape'){hideSuggestions();return;}
    if(event.key==='ArrowDown'){
      event.preventDefault();
      if(suggestions.hidden)renderSuggestions();
      markActive(active+1);
    }else if(event.key==='ArrowUp'){
      event.preventDefault();
      if(suggestions.hidden)renderSuggestions();
      markActive(active-1);
    }else if(event.key==='Enter'&&!suggestions.hidden&&active>=0){
      event.preventDefault();
      chooseBroker(currentMatches[active]);
    }
  });
  document.addEventListener('click',event=>{
    if(event.target!==broker&&!suggestions.contains(event.target))hideSuggestions();
  });
  choices.addEventListener('change',selectServer);
  updateServerChoices();
}
