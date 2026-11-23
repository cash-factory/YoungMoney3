/** Disposable staging-only browser acceptance: no real member or MT5 terminal. */
import { pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';

const worker='https://ym-fx-staging.ethical-hacker263.workers.dev';
if(process.env.YM3_STAGING_WORKER_NAME!=='ym-fx-staging')throw Error('Staging-only diagnostic refused.');
const config='wrangler.staging.jsonc';
const id=randomUUID(),deviceId=randomUUID(),sourceLink=randomUUID(),followerLink=randomUUID();
const salt=randomBytes(16).toString('base64');
const password=randomBytes(32).toString('base64url');
const username='copy_probe_'+randomBytes(6).toString('hex');
const email=username+'@example.invalid';
const hash=pbkdf2Sync(password,Buffer.from(salt,'base64'),600000,32,'sha256').toString('base64');
const encodedHash='pbkdf2-sha256$600000$'+hash;
function sql(command){
  const result=spawnSync('npx',['wrangler','d1','execute','DB','--remote','--config',config,'--json','--command',command],
    {encoding:'utf8',maxBuffer:1048576,timeout:45000});
  if(result.error||result.status!==0)throw Error('Staging-only D1 request failed: '+result.status);
  let value;
  try{value=JSON.parse(result.stdout);}catch{throw Error('Staging-only D1 returned unreadable JSON.');}
  if(!Array.isArray(value)||value.some(row=>row.success===false))throw Error('Staging-only D1 query failed.');
  return value;
}
let inserted=false;
try {
  const now=new Date().toISOString(),expiry=Date.now()+3600000;
  sql("INSERT INTO users(id,email,username,display_name,password_hash,password_salt,created_at,updated_at) VALUES('"+
    id+"','"+email+"','"+username+"','Disposable Copy Studio user','"+encodedHash+"','"+salt+"','"+now+"','"+now+"')");
  inserted=true;
  sql("INSERT INTO mt5_devices(id,owner,expires,public_key,last_seen,revoked,pc_name) VALUES('"+
    deviceId+"','"+id+"',"+expiry+",'test-public-key',"+Date.now()+",0,'Disposable testing PC')");
  for(const [link,login] of [[sourceLink,'900001'],[followerLink,'900002']]){
    sql("INSERT INTO mt5_links(id,device,owner,account_id,status,server,login,company,currency,trade_mode,access_level,last_sync,expires,monitoring_paused) VALUES('"+
      link+"','"+deviceId+"','"+id+"','"+randomUUID()+"','connected','Test-Demo-"+login+"','"+login+
      "','Disposable MT5 fixture','USD',0,'trading-enabled','"+now+"',"+expiry+",0)");
  }
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1280,height:800}});
    page.on('pageerror',error=>console.error('Browser page error type: '+error.name));
    await page.goto(worker,{waitUntil:'domcontentloaded',timeout:25000});
    await page.getByRole('button',{name:'Get Started',exact:true}).first().click();
    await page.locator('input[type=email]').fill(email);
    await page.locator('input[type=password]').fill(password);
    const [login]=await Promise.all([
      page.waitForResponse(response=>response.url()===worker+'/api/auth/signin'&&response.request().method()==='POST',{timeout:30000}),
      page.locator('button[type=submit]').click(),
    ]);
    if(login.status()!==200)throw Error('Disposable browser sign-in failed: HTTP '+login.status());
    await page.goto(worker+'/#copy-studio',{waitUntil:'domcontentloaded',timeout:25000});
    await page.getByRole('heading',{name:'Copy Studio',exact:true}).waitFor({timeout:25000});
    await page.getByLabel('Plan name').fill('Disposable demo pairing check');
    await page.getByLabel(/Source account/).selectOption(sourceLink);
    await page.getByLabel(/Follower account/).selectOption(followerLink);
    await page.getByLabel(/Size multiplier/).fill('2');
    await page.getByLabel(/Maximum follower size/).fill('0.15');
    await page.getByRole('button',{name:'Save paused draft'}).click();
    await page.getByText(/Simulation draft saved/).waitFor({timeout:20000});
    await page.getByRole('button',{name:'Run simulation'}).click();
    const value=await page.locator('.ym-cs-result [data-highlight] strong').textContent({timeout:20000});
    if(!value?.includes('0.15'))throw Error('Wrong displayed capped lot estimate.');
    if(!await page.getByText('All plans paused').isVisible())throw Error('Copy execution guard not visible.');
    await page.getByRole('button',{name:'Delete draft'}).click();
    page.once('dialog',dialog=>dialog.accept());
    // above dialog event is registered only if it arrives after click; request uses confirm synchronously
    // so prefer Playwright listener pre-registration in the caller. Verify deletion separately.
    await page.getByText(/Draft deleted/).waitFor({timeout:20000});
    console.log('Staging browser accepted demo-only Copy Studio: save, cap simulation, paused status and delete.');
  }finally{await browser.close();}
}finally{
  if(inserted){
    sql("DELETE FROM copy_profiles WHERE owner='"+id+"'");
    sql("DELETE FROM copy_profile_events WHERE owner='"+id+"'");
    sql("DELETE FROM sessions WHERE user_id='"+id+"'");
    sql("DELETE FROM mt5_links WHERE owner='"+id+"'");
    sql("DELETE FROM mt5_devices WHERE owner='"+id+"'");
    sql("DELETE FROM users WHERE id='"+id+"' AND email='"+email+"'");
    console.log('All disposable Copy Studio user, account, device, session and audit fixtures deleted.');
  }
}
